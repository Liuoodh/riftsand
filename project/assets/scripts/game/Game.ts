/**
 * Game — the simulation core.
 * Owns the world, the two players, orders, combat, economy, fog and win state.
 * No rendering code lives here: the view layer subscribes through GameEvents.
 *
 * The production model follows the classic sidebar rules:
 *  - four independent queues (structures / infantry / vehicles / aircraft)
 *  - money is deducted gradually while an item builds, so a dry economy stalls it
 *  - extra factories of the same type speed the queue up with diminishing returns
 *  - finished structures wait in a "ready" slot until the player places them
 */
import {
    BUILDINGS, UNITS, Faction, BuildingDef, UnitDef, START_CREDITS, TILE, HALF, MAP_TILES,
    TECH_BUILDING, QUEUE_MAX, UNLOAD_TIME, MAX_CREDITS, FactionDef, FACTIONS,
    verseMul, canHurt, DmgType,
    tileToWorld, dist, clamp, GROUP_COUNT, ProdCat, Stance, SuperWeaponId, SUPER_WEAPONS,
    unitCategory, BUILD_REQUIRES, VET_XP_RATIO, VET_MAX_LEVEL, CRATE_INTERVAL,
    BUILD_RADIUS_TILES, makeRng, PROJ_PHYSICS, gameSpeedMul, GAME_SPEED_MAX, BUILDUP_TIME, MAPS, mapById, colorById, setActiveTeamColor,
} from '../core/Core';
import { TerrainMap, CrystalNode } from '../world/Terrain';
import { PathFinder } from '../world/Path';
import { TileOccupation } from '../world/TileOccupation';
import { AUTHORED } from '../world/Maps';
import { Unit, Building, Projectile, Fx, Entity, SpatialGrid, PlayerId, Zone, Crate, Decal, setWorldBlocked, setUnitBlocked, setRoomCheck } from './Entities';
import { AIController } from './AI';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type GamePhase = 'playing' | 'won' | 'lost';

export interface GameOptions {
    credits: number;
    superWeapons: boolean;
    crates: boolean;
    /** map preset id (see Core.MAPS) */
    mapId: string;
    /** [player, enemy] colour ids (see Core.PLAYER_COLORS) */
    colors: [string, string];
}

export interface GameEvents {
    onSpawn?: (e: Entity) => void;
    onDeath?: (e: Entity) => void;
    onFx?: (fx: Fx) => void;
    onMessage?: (text: string, kind?: string) => void;
    onFogDirty?: () => void;
    onGameOver?: (win: boolean) => void;
    /** short procedural sfx cue, throttled by the audio layer */
    onSfx?: (name: string, x?: number, y?: number) => void;
    /** camera shake for heavy impacts */
    onShake?: (strength: number) => void;
}

export interface QueueItem {
    defId: string;
    cost: number;
    time: number;
    /** credits actually paid so far */
    spent: number;
    /** 0..1 */
    progress: number;
}

export interface ProdQueue {
    cat: ProdCat;
    items: QueueItem[];
    /** structure queue only: finished, waiting for placement */
    ready: boolean;
}

export interface SuperWeaponState {
    id: SuperWeaponId;
    t: number;
    total: number;
    ready: boolean;
    sourceId: number;
}

export interface PlayerState {
    id: PlayerId;
    faction: Faction;
    credits: number;
    /* fog of war */
    visible: Uint8Array;
    explored: Uint8Array;
    /* stats */
    earned: number;
    built: number;
    lost: number;
    kills: number;
    ai: AIController | null;
    defeated: boolean;
    isHuman: boolean;
    queues: Record<ProdCat, ProdQueue>;
    sw: SuperWeaponState[];
}

const REVEAL_TICK = 0.22;
const CATS: ProdCat[] = ['structure', 'infantry', 'vehicle', 'aircraft'];
const REPAIR_COST_PER_HP = 0.4;
const REPAIR_SECONDS = 24;

export class Game {
    terrain: TerrainMap;
    finder: PathFinder;
    /** who stands on which cell — see world/TileOccupation.ts */
    occupancy: TileOccupation;
    /** non-blocking rubble left behind by destroyed structures */
    ruins: Array<{ x: number; y: number; size: number; seed: number }> = [];
    /**
     * Ore fields that recently proved unreachable, with the time they may be
     * reconsidered. Prevents a truck from re-running A* into the same wall every
     * frame (the reference keeps a "no route" timer for the same reason).
     */
    nodeCooldown = new Map<number, number>();
    /** ring buffer of blocked-unit decisions, enabled by tests (see moveDebug) */
    moveDebug = false;
    moveLog: any[] = [];
    /** hypothetical footprint consulted by isBlocked() during placement checks */
    virtualBlock: { tx: number; ty: number; size: number } | null = null;
    grid = new SpatialGrid();
    units: Unit[] = [];
    buildings: Building[] = [];
    projectiles: Projectile[] = [];
    fx: Fx[] = [];
    decals: Decal[] = [];
    zones: Zone[] = [];
    crates: Crate[] = [];
    players: PlayerState[] = [];
    time = 0;
    phase: GamePhase = 'playing';
    difficulty: Difficulty = 'normal';
    events: GameEvents = {};
    options: GameOptions;

    /** player 0 = human */
    selection: Unit[] = [];
    selectedBuilding: Building | null = null;
    /** structure waiting to be placed (human only) */
    placeMode: string | null = null;
    /** retail speed slot 0..6 (2 = 1.0x); scales the whole simulation clock */
    speed = 2;
    buildTile = { tx: 0, ty: 0 };
    /** unit whose route is being planned right now (see pathCostFor) */
    private pathingFor: Unit | null = null;
    /** where each side's starting base goes; authored maps override this */
    baseTile: Array<{ tx: number; ty: number }> = [
        { tx: 18, ty: MAP_TILES / 2 },
        { tx: MAP_TILES - 19, ty: MAP_TILES / 2 },
    ];
    /** super weapon currently being aimed by the player */
    swTargeting: SuperWeaponId | null = null;

    /* ---- mobile command layer ---- */
    groupIds: number[][] = Array.from({ length: GROUP_COUNT }, () => []);
    holdFormation = true;    // group moves march at the slowest member's speed
    waypointMode = false;    // taps append to the order queue instead of replacing
    autoReplace = true;      // warn / auto-queue a harvester when one dies

    private revealTimer = 0;
    private tmp: Entity[] = [];
    private nodeClaim: Record<number, number> = {};
    private detectors: Array<{ pid: PlayerId; x: number; y: number; r: number }> = [];
    private strikeQueue: Array<{ x: number; y: number; owner: PlayerId; t: number }> = [];
    private crateTimer = CRATE_INTERVAL * 0.6;
    private regenTimer = 0;
    private rng: () => number;
    private lastHarvesterCount: number[] = [0, 0];

    constructor(seed: number, humanFaction: Faction, difficulty: Difficulty, events: GameEvents, options?: Partial<GameOptions>) {
        this.terrain = new TerrainMap();
        // the chosen map decides the terrain mix; its stored seed wins over the
        // per-match random seed so a named map always looks the same
        const map = mapById(options?.mapId ?? 'basin');
        /*
         * Two kinds of map, one loader.
         *
         * A procedural map is a seed + mix constants. An authored map is an
         * explicit 80x80 grid from assets/maps (compiled into world/Maps.ts) and
         * also carries its own spawn tiles, because a hand-drawn layout cannot
         * assume the hard-coded base positions are free.
         */
        const authored = map.data ? AUTHORED[map.data] : undefined;
        if (authored) {
            this.terrain.loadMap(authored);
            for (const s of authored.spawns ?? []) {
                if (s.player === 0 || s.player === 1) this.baseTile[s.player] = { tx: s.tx, ty: s.ty };
            }
        } else {
            this.terrain.generate(map.seed, map);
        }
        this.finder = new PathFinder(
            (tx, ty) => this.isBlocked(tx, ty),
            (tx, ty) => this.pathCostFor(tx, ty),
        );
        this.occupancy = new TileOccupation(MAP_TILES);
        // movement asks the world directly (see Entities.setWorldBlocked): a unit
        // must never step into a cell it does not fit in
        setWorldBlocked((x, y, r) => this.worldBlockedAt(x, y, r));
        setUnitBlocked((u, x, y) => this.stepBlockedByUnit(u, x, y));
        // capacity-only test for the CloseEnough rule (reference canStopAtTile)
        setRoomCheck((u, x, y) => this.occupancy.hasRoomFor(
            u, Math.floor((x + HALF) / TILE), Math.floor((y + HALF) / TILE),
        ));
        this.difficulty = difficulty;
        this.events = events;
        this.rng = makeRng(seed ^ 0x9e3779b9);
        this.options = {
            credits: options?.credits ?? START_CREDITS,
            superWeapons: options?.superWeapons ?? true,
            crates: options?.crates ?? true,
            mapId: options?.mapId ?? 'basin',
            colors: options?.colors ?? ['azure', 'crimson'],
        };

        const enemyFaction: Faction = humanFaction === 'BU' ? 'DS' : 'BU';
        // player colours are independent of the faction, exactly like the retail
        // house-colour picker
        const colors = options?.colors;
        if (colors && colors[0]) setActiveTeamColor(humanFaction, colorById(colors[0]).hex);
        if (colors && colors[1]) setActiveTeamColor(enemyFaction, colorById(colors[1]).hex);
        this.players = [
            this.newPlayer(0, humanFaction, true),
            this.newPlayer(1, enemyFaction, false),
        ];
        this.setupBase(0);
        this.setupBase(1);
        this.players[1].ai = new AIController(this, 1, difficulty);
        this.updateVisibility(this.players[0]);
        this.updateVisibility(this.players[1]);
        this.revealAll(this.players[1]);
        this.lastHarvesterCount = [this.countHarvesters(0), this.countHarvesters(1)];
    }

    /* ------------------------------------------------------------ */
    /* setup                                                         */
    /* ------------------------------------------------------------ */
    private newQueue(cat: ProdCat): ProdQueue {
        return { cat, items: [], ready: false };
    }

    private newPlayer(id: PlayerId, faction: Faction, human: boolean): PlayerState {
        return {
            id, faction, credits: this.options.credits,
            visible: new Uint8Array(MAP_TILES * MAP_TILES),
            explored: new Uint8Array(MAP_TILES * MAP_TILES),
            earned: 0, built: 0, lost: 0, kills: 0,
            ai: null, defeated: false, isHuman: human,
            queues: {
                structure: this.newQueue('structure'),
                infantry: this.newQueue('infantry'),
                vehicle: this.newQueue('vehicle'),
                aircraft: this.newQueue('aircraft'),
            },
            sw: [],
        };
    }

    get human() { return this.players[0]; }
    get enemy() { return this.players[1]; }
    get factionDef(): FactionDef { return FACTIONS[this.human.faction]; }
    /** kept for the HUD / input layer */
    get buildMode(): string | null { return this.placeMode; }

    /** simulation time multiplier for the current speed slot */
    get speedMul() { return gameSpeedMul(this.speed); }

    setSpeed(slot: number) {
        this.speed = Math.max(0, Math.min(GAME_SPEED_MAX, Math.round(slot)));
        this.events.onMessage?.(`游戏速度 ${this.speedMul.toFixed(1)}x`, 'info');
    }

    cycleSpeed() {
        this.setSpeed((this.speed + 1) % (GAME_SPEED_MAX + 1));
    }

    private setupBase(pid: PlayerId) {
        const p = this.players[pid];
        const f = FACTIONS[p.faction];
        // far enough from the rim that the camera can centre on the base;
        // authored maps override this from their spawn list
        const b = this.baseTile[pid] ?? { tx: pid === 0 ? 18 : MAP_TILES - 19, ty: MAP_TILES / 2 };
        const bx = b.tx;
        const by = b.ty;
        const coreDef = BUILDINGS[f.core];
        const dropDef = p.faction === 'BU' ? BUILDINGS.sluice : BUILDINGS.market;
        const powDef = p.faction === 'BU' ? BUILDINGS.furnace : BUILDINGS.sunwell;
        const barDef = p.faction === 'BU' ? BUILDINGS.barracks : BUILDINGS.tent;

        this.place(coreDef, pid, bx - 2, by - 2, true);
        this.place(powDef, pid, bx + 2, by + 1, true);
        this.place(dropDef, pid, bx + 2, by - 5, true);
        this.place(barDef, pid, bx - 4, by - 6, true);

        const coreY = (by - 2) * TILE + 2 * TILE - HALF;
        const frontY = coreY - 2 * TILE - 44;
        const hDef = UNITS[f.harvester];
        for (let i = 0; i < 2; i++) {
            this.spawnUnit(pid, hDef, bx * TILE + TILE / 2 - HALF - 34 + i * 34, frontY);
        }
        const infDef = UNITS[p.faction === 'BU' ? 'pebble' : 'sandfly'];
        for (let i = 0; i < 3; i++) {
            this.spawnUnit(pid, infDef, bx * TILE + TILE / 2 - HALF - 46 + i * 30, frontY - 44);
        }
        // one engineer each: opens the capture/repair loop from turn one
        this.spawnUnit(pid, UNITS[f.engineer], bx * TILE + TILE / 2 - HALF + 12, frontY - 82);
        p.credits = this.options.credits;
    }

    place(def: BuildingDef, owner: PlayerId, tx: number, ty: number, instant = true): Building {
        /*
         * A placed structure is ALREADY PAID FOR.
         *
         * The sidebar work is what "builds" it; placing it only plays the raise
         * animation (reference: BuildStatus.BuildUp, GeneralRules.buildupTime).
         * The old code started a second, full-length construction here, so a
         * ready building still took `def.time` seconds to become usable and
         * could be attacked into rubble while it was "under construction".
         * Now hp is full immediately and only `progress` animates 0 -> 1 over
         * BUILDUP_TIME, which the renderer uses as the rise/fade height.
         */
        const b = new Building(def, owner, tx, ty, instant ? 1 : 0);
        b.hp = def.hp;
        b.maxHp = def.hp;
        b.status = instant ? 'ready' : 'buildup';
        b.buildDur = instant ? 0 : BUILDUP_TIME;
        b.buildT = b.buildDur;
        this.buildings.push(b);
        this.events.onSpawn?.(b);
        if (!instant) this.events.onSfx?.('place', b.x, b.y);
        return b;
    }

    spawnUnit(owner: PlayerId, def: UnitDef, x: number, y: number): Unit {
        let px = clamp(x, -HALF + 20, HALF - 20);
        let py = clamp(y, -HALF + 20, HALF - 20);
        // A unit must never appear inside a wall or a structure footprint: the
        // reference resolves the building's exit cell before spawning, so do the
        // geometric equivalent here instead of letting the physics untangle it.
        if (this.worldBlockedAt(px, py, def.radius)) {
            const spot = this.nearestStandable(
                Math.floor((px + HALF) / TILE), Math.floor((py + HALF) / TILE), def.radius, 5,
            );
            if (spot) { px = spot.x; py = spot.y; }
        }
        const u = new Unit(def, owner, px, py);
        u.owner = owner;
        let stx = Math.floor((px + HALF) / TILE);
        let sty = Math.floor((py + HALF) / TILE);
        // A cell holds one vehicle or three infantry; place the new unit on a
        // cell that can actually take it (reference: ExitFactoryTask searches
        // the factory's exit cells before spawning).
        if (!this.occupancy.hasRoomFor(u, stx, sty)) {
            const spot = this.findSpawnCell(u, stx, sty, 4);
            if (spot) { px = spot.x; py = spot.y; stx = spot.tx; sty = spot.ty; u.x = px; u.y = py; u.prevX = px; u.prevY = py; }
        } else if (def.kind !== 'infantry' && this.occupancy.at(stx, sty)) {
            /*
             * A cell can legally hold two harvesters, so `hasRoomFor` says yes
             * even when someone is already parked there. Spawning on top of that
             * unit produced two trucks drawn as one sprite; move to a free cell
             * unless the map is genuinely packed.
             */
            const spot = this.findSpawnCell(u, stx, sty, 3);
            if (spot) { px = spot.x; py = spot.y; stx = spot.tx; sty = spot.ty; u.x = px; u.y = py; u.prevX = px; u.prevY = py; }
        }
        u.cellX = stx;
        u.cellY = sty;
        this.occupancy.add(u, stx, sty);
        if (def.kind === 'infantry') u.subCell = this.occupancy.claimSubCell(u, stx, sty);
        this.units.push(u);
        this.players[owner].built++;
        this.events.onSpawn?.(u);
        return u;
    }

    /* ------------------------------------------------------------ */
    /* queries                                                       */
    /* ------------------------------------------------------------ */
    buildingAt(tx: number, ty: number): Building | null {
        for (const b of this.buildings) {
            if (b.dead) continue;
            if (b.occupies(tx, ty)) return b;
        }
        return null;
    }

    /**
     * True when a disc of `r` centred at (x, y) overlaps terrain or a structure.
     * This is the coarse "footprint" test the reference performs against its
     * tile-occupation table; keeping it geometric avoids a parallel index.
     */
    worldBlockedAt(x: number, y: number, r: number) {
        const T = TILE;
        const x0 = Math.floor((x - r + HALF) / T);
        const x1 = Math.floor((x + r + HALF) / T);
        const y0 = Math.floor((y - r + HALF) / T);
        const y1 = Math.floor((y + r + HALF) / T);
        for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
                if (!this.isBlocked(tx, ty)) continue;
                // distance from the disc centre to the tile square
                const cx = clamp(x, tx * T - HALF, tx * T + T - HALF);
                const cy = clamp(y, ty * T - HALF, ty * T + T - HALF);
                const dx = x - cx, dy = y - cy;
                if (dx * dx + dy * dy < r * r * 0.86) return true;
            }
        }
        return false;
    }

    /**
     * Would this structure cut its owner's base off from income?
     *
     * Retail map makers keep the refinery apron clear; a random-placing AI does
     * not, and a ring of buildings around the ore field leaves every truck
     * permanently unable to deliver (measured: AI income 0 for six minutes).
     * A candidate footprint is therefore rejected when a refinery would lose its
     * route to the nearest ore field, or the core would lose its route to a
     * refinery.
     */
    wouldSealBase(def: BuildingDef, tx: number, ty: number, owner: PlayerId): boolean {
        const refineries = this.buildings.filter((b) => !b.dead && b.owner === owner && b.def.dropoff);
        const core = this.buildings.find((b) => !b.dead && b.owner === owner && b.def.isCore);
        if (!refineries.length && !core) return false;
        this.virtualBlock = { tx, ty, size: def.size };
        let sealed = false;
        for (const r of refineries) {
            const node = this.nearestNode(r.x, r.y);
            if (!node) continue;
            const path = this.finder.find(r.x, r.y, node.x, node.y, { radius: 12 });
            if (!path || path.length === 0) { sealed = true; break; }
        }
        if (!sealed && core) {
            for (const r of refineries) {
                const path = this.finder.find(core.x, core.y, r.x, r.y, { radius: 12 });
                if (!path || path.length === 0) { sealed = true; break; }
            }
        }
        this.virtualBlock = null;
        return sealed;
    }

    /** nearest cell that has room for this unit, preferring close ones */
    private findSpawnCell(u: Unit, tx: number, ty: number, maxR = 4): { x: number; y: number; tx: number; ty: number } | null {
        /*
         * Two passes: an EMPTY cell first, a merely "has room" cell second.
         *
         * A cell takes one vehicle, but two harvesters are allowed to share one
         * (they need that at the refinery dock). At spawn time that rule stacked
         * both trucks on the same pixel, which reads as a glitch. Vehicles are
         * always spread at spawn; sharing is only for the dock.
         */
        for (let pass = 0; pass < 2; pass++) {
            for (let r = 0; r <= maxR; r++) {
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const nx = tx + dx, ny = ty + dy;
                        if (nx < 0 || ny < 0 || nx >= MAP_TILES || ny >= MAP_TILES) continue;
                        if (pass === 0 && this.occupancy.at(nx, ny)) continue;
                        if (!this.occupancy.hasRoomFor(u, nx, ny)) continue;
                        const wx = nx * TILE + TILE / 2 - HALF;
                        const wy = ny * TILE + TILE / 2 - HALF;
                        if (this.worldBlockedAt(wx, wy, u.radius)) continue;
                        return { x: wx, y: wy, tx: nx, ty: ny };
                    }
                }
            }
        }
        return null;
    }

    /** nearest tile a hull of `r` can stand on, searched outward from (tx, ty) */
    private nearestStandable(tx: number, ty: number, r: number, maxR = 4): { x: number; y: number } | null {
        for (let rad = 0; rad <= maxR; rad++) {
            for (let dy = -rad; dy <= rad; dy++) {
                for (let dx = -rad; dx <= rad; dx++) {
                    if (rad > 0 && Math.abs(dx) !== rad && Math.abs(dy) !== rad) continue;
                    const nx = tx + dx, ny = ty + dy;
                    if (nx < 0 || ny < 0 || nx >= MAP_TILES || ny >= MAP_TILES) continue;
                    const wx = nx * TILE + TILE / 2 - HALF;
                    const wy = ny * TILE + TILE / 2 - HALF;
                    if (!this.worldBlockedAt(wx, wy, r)) return { x: wx, y: wy };
                }
            }
        }
        return null;
    }

    isBlocked(tx: number, ty: number) {
        const vb = this.virtualBlock;
        if (vb && tx >= vb.tx && ty >= vb.ty && tx < vb.tx + vb.size && ty < vb.ty + vb.size) return true;
        if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return true;
        if (this.terrain.isSolid(tx, ty)) return true;
        return this.buildingAt(tx, ty) !== null;
    }

    myUnits(p: PlayerState) { return this.units.filter(u => !u.dead && u.owner === p.id); }
    myBuildings(p: PlayerState) { return this.buildings.filter(b => !b.dead && b.owner === p.id); }

    countBuilding(p: PlayerState, id: string) {
        let n = 0;
        for (const b of this.buildings) if (!b.dead && b.owner === p.id && b.def.id === id && b.done) n++;
        return n;
    }

    private countHarvesters(pid: PlayerId) {
        let n = 0;
        for (const u of this.units) if (!u.dead && u.owner === pid && u.isHarvester) n++;
        return n;
    }

    hasTech(p: PlayerState, level: number) {
        if (level <= 0) return true;
        const tb = TECH_BUILDING[p.faction];
        return this.countBuilding(p, tb) > 0;
    }

    power(p: PlayerState) {
        let made = 0, used = 0;
        for (const b of this.buildings) {
            if (b.dead || b.owner !== p.id || !b.done) continue;
            if (b.def.power >= 0) made += b.def.power;
            else used -= b.def.power;
        }
        return { made, used, ok: made >= used };
    }

    /** how fast production runs right now (power shortage slows it down) */
    prodFactor(p: PlayerState) {
        const pw = this.power(p);
        return pw.ok ? 1 : 0.55;
    }

    /** radar / minimap and super weapons need a healthy grid */
    radarOnline(p: PlayerState) { return this.power(p).ok; }

    /** how many finished factories of a category the player owns */
    factoryCount(p: PlayerState, cat: ProdCat) {
        let n = 0;
        for (const b of this.buildings) {
            if (b.dead || b.owner !== p.id || !b.done) continue;
            if (b.def.factory === cat) n++;
        }
        return n;
    }

    /** extra factories speed a queue up with diminishing returns, like the classics */
    factorySpeed(p: PlayerState, cat: ProdCat) {
        const n = this.factoryCount(p, cat);
        if (n <= 1) return n === 1 ? 1 : 0;
        return Math.min(2.4, Math.pow(1.25, n - 1));
    }

    primaryFactory(p: PlayerState, cat: ProdCat): Building | null {
        let best: Building | null = null;
        for (const b of this.buildings) {
            if (b.dead || b.owner !== p.id || !b.done || b.def.factory !== cat) continue;
            if (!best || b.id < best.id) best = b;
        }
        return best;
    }

    isVisibleTo(p: PlayerState, e: Entity) {
        if (e.owner === p.id) return true;
        if (e instanceof Unit && e.cloaked && !this.isDetected(p.id, e)) return false;
        const tx = Math.floor((e.x + HALF) / TILE);
        const ty = Math.floor((e.y + HALF) / TILE);
        if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return false;
        const i = ty * MAP_TILES + tx;
        /*
         * Retail visibility is "has this cell ever been explored": the shroud is
         * permanent, so an enemy that walks through cleared ground is visible
         * without a friendly unit nearby (MapShroud.isShrouded() only tests
         * ShroudType.Unexplored). `visible` is still maintained for targeting and
         * cloak detection, but it no longer gates rendering.
         */
        return p.explored[i] === 1;
    }

    /** a detector of `pid` covers this spot */
    isDetected(pid: PlayerId, e: Entity) {
        for (const d of this.detectors) {
            if (d.pid !== pid) continue;
            const dx = e.x - d.x, dy = e.y - d.y;
            if (dx * dx + dy * dy <= d.r * d.r) return true;
        }
        return false;
    }

    /* ------------------------------------------------------------ */
    /* building placement                                            */
    /* ------------------------------------------------------------ */
    canPlace(def: BuildingDef, tx: number, ty: number, owner: PlayerId = 0, ignoreRadius = false): { ok: boolean; reason: string } {
        if (tx < 0 || ty < 0 || tx + def.size > MAP_TILES || ty + def.size > MAP_TILES) {
            return { ok: false, reason: '超出地图边界' };
        }
        for (let y = ty; y < ty + def.size; y++) {
            for (let x = tx; x < tx + def.size; x++) {
                if (this.terrain.isSolid(x, y)) return { ok: false, reason: '地形无法建造' };
                if (this.terrain.isCrystal(x, y)) return { ok: false, reason: '不能在矿脉上建造' };
                if (this.buildingAt(x, y)) return { ok: false, reason: '与建筑重叠' };
            }
        }
        /*
         * Do not drop a structure on top of a unit.
         *
         * The reference checks the target cells against its occupation table; we
         * do the geometric equivalent. Without this, a building placed over a
         * hull embeds it, and the only way out is the collision safety net, which
         * shows up as a unit being shoved sideways out of a wall.
         */
        const x0 = tx * TILE - HALF;
        const y0 = ty * TILE - HALF;
        const x1 = x0 + def.size * TILE;
        const y1 = y0 + def.size * TILE;
        for (const u of this.units) {
            if (u.dead || u.isAir) continue;
            const pad = u.radius * 0.55;
            if (u.x > x0 - pad && u.x < x1 + pad && u.y > y0 - pad && u.y < y1 + pad) {
                return { ok: false, reason: '单位挡住了建造位置' };
            }
        }
        if (!ignoreRadius && !def.isCore) {
            const cx = tx * TILE + (def.size * TILE) / 2 - HALF;
            const cy = ty * TILE + (def.size * TILE) / 2 - HALF;
            const reach = BUILD_RADIUS_TILES * TILE + (def.size * TILE) / 2;
            let near = false;
            for (const b of this.buildings) {
                if (b.dead || b.owner !== owner || !b.done) continue;
                const dx = b.x - cx, dy = b.y - cy;
                if (dx * dx + dy * dy <= (reach + b.radius) * (reach + b.radius)) { near = true; break; }
            }
            if (!near) return { ok: false, reason: '必须靠近己方建筑' };
        }
        return { ok: true, reason: '' };
    }

    /* ------------------------------------------------------------ */
    /* sidebar production                                            */
    /* ------------------------------------------------------------ */
    queueInfo(p: PlayerState, cat: ProdCat): ProdQueue { return p.queues[cat]; }

    readyStructure(p: PlayerState): QueueItem | null {
        const q = p.queues.structure;
        return q.ready && q.items.length ? q.items[0] : null;
    }

    availableStructures(p: PlayerState): BuildingDef[] {
        const out: BuildingDef[] = [];
        for (const id in BUILDINGS) {
            const d = BUILDINGS[id];
            if (d.faction !== p.faction || d.isCore) continue;
            out.push(d);
        }
        return out;
    }

    availableUnitsFor(p: PlayerState, cat: ProdCat): UnitDef[] {
        const out: UnitDef[] = [];
        for (const id in UNITS) {
            const d = UNITS[id];
            if (d.faction !== p.faction) continue;
            if (unitCategory(d) !== cat) continue;
            out.push(d);
        }
        return out;
    }

    /** why a structure/unit cannot be produced right now ('' = available) */
    lockReason(p: PlayerState, def: BuildingDef | UnitDef): string {
        const isUnit = (d: any) => !!d.kind && !!d.from;
        if (isUnit(def)) {
            const u = def as UnitDef;
            if (!this.hasTech(p, u.tech)) return `需要 ${BUILDINGS[TECH_BUILDING[p.faction]].name}`;
            if (this.factoryCount(p, unitCategory(u)) === 0) {
                return `需要 ${BUILDINGS[u.from].name}`;
            }
            return '';
        }
        const b = def as BuildingDef;
        const req = BUILD_REQUIRES[b.id];
        if (req && this.countBuilding(p, BUILDINGS[req].id) === 0) return `需要 ${BUILDINGS[req].name}`;
        if (!b.isCore && this.factoryCount(p, 'structure') === 0) return '需要指挥核心';
        if (b.superWeapon && !this.options.superWeapons) return '超级武器已关闭';
        return '';
    }

    /** max items allowed in a queue, structures hold a single item */
    queueCap(cat: ProdCat) { return cat === 'structure' ? 1 : QUEUE_MAX; }

    private makeItem(defId: string, cost: number, time: number): QueueItem {
        return { defId, cost, time, spent: 0, progress: 0 };
    }

    queueBuild(defId: string, pid: PlayerId = 0) {
        const def = BUILDINGS[defId];
        const p = this.players[pid];
        if (!def) return false;
        if (this.lockReason(p, def)) { if (p.isHuman) this.events.onMessage?.(this.lockReason(p, def), 'warn'); return false; }
        const q = p.queues.structure;
        if (q.ready) { if (p.isHuman) this.events.onMessage?.('已有建筑等待放置', 'warn'); return false; }
        if (q.items.length >= 1) return false;
        q.items.push(this.makeItem(defId, def.cost, def.time));
        if (p.isHuman) this.events.onMessage?.(`${def.name} 开始建造`, 'info');
        return true;
    }

    queueUnit(cat: ProdCat, defId: string, times = 1, pid: PlayerId = 0): number {
        const def = UNITS[defId];
        const p = this.players[pid];
        if (!def || cat === 'structure') return 0;
        if (this.lockReason(p, def)) { if (p.isHuman) this.events.onMessage?.(this.lockReason(p, def), 'warn'); return 0; }
        const q = p.queues[cat];
        let n = 0;
        for (let i = 0; i < times; i++) {
            if (q.items.length >= QUEUE_MAX) {
                if (p.isHuman) this.events.onMessage?.('生产队列已满', 'warn');
                break;
            }
            q.items.push(this.makeItem(defId, def.cost, def.time));
            n++;
        }
        if (n > 1 && p.isHuman) this.events.onMessage?.(`${def.name} × ${n} 已排队`, 'good');
        return n;
    }

    cancelQueue(cat: ProdCat, index: number, pid: PlayerId = 0) {
        const p = this.players[pid];
        const q = p.queues[cat];
        const item = q.items[index];
        if (!item) return;
        if (cat === 'structure' && q.ready && index === 0) q.ready = false;
        p.credits = Math.min(MAX_CREDITS, p.credits + Math.floor(item.spent));
        q.items.splice(index, 1);
    }

    /** pull the finished structure out of the queue so it can be placed */
    takeReadyStructure(pid: PlayerId = 0): BuildingDef | null {
        const p = this.players[pid];
        const q = p.queues.structure;
        const item = q.items[0];
        if (!q.ready || !item) return null;
        q.items.shift();
        q.ready = false;
        return BUILDINGS[item.defId] || null;
    }

    /** begin placement of a ready structure (human) */
    beginPlace(defId: string) {
        const ready = this.readyStructure(this.human);
        if (!ready || ready.defId !== defId) return false;
        this.placeMode = defId;
        this.swTargeting = null;
        return true;
    }

    cancelBuild() { this.placeMode = null; }

    confirmBuild(tx: number, ty: number): boolean {
        if (!this.placeMode) return false;
        const ready = this.readyStructure(this.human);
        if (!ready || ready.defId !== this.placeMode) { this.placeMode = null; return false; }
        const def = BUILDINGS[this.placeMode];
        const check = this.canPlace(def, tx, ty, 0);
        if (!check.ok) {
            this.events.onMessage?.(check.reason, 'warn');
            return false;
        }
        this.takeReadyStructure(0);
        const b = this.place(def, 0, tx, ty, false);
        this.placeMode = null;
        this.events.onMessage?.(`${def.name} 开始施工`, 'info');
        this.pushFx(b.x, b.y, 'build', 0.7, b.size);
        this.events.onSfx?.('build');
        return true;
    }

    /* ------------------------------------------------------------ */
    /* structure management                                          */
    /* ------------------------------------------------------------ */
    /**
     * Sell a structure.
     *
     * Reference: game/action/factories/SellObjectActionFactory.ts +
     * game/trait/SellTrait.ts — a ready building enters `BuildStatus.BuildDown`
     * (PackBuildingTask, `general.buildupTime`), plays its art in reverse, and the
     * refund (purchaseValue * RefundPercent, default 50%) is credited when the
     * builddown completes. Selling is refused while the building is still rising.
     */
    sellSelectedBuilding() {
        const b = this.selectedBuilding;
        if (!b || b.dead) return;
        if (b.status !== 'ready' || b.progress < 1) {
            this.events.onMessage?.('建筑还没建好，不能卖出', 'warn');
            return;
        }
        // refund scales with damage, so selling a burning husk is not free money
        const ratio = clamp(b.hp / b.maxHp, 0.15, 1);
        b.refund = Math.floor(b.def.cost * 0.5 * ratio);
        b.status = 'builddown';
        b.buildDur = 1.0;
        b.buildT = b.buildDur;
        this.selectedBuilding = null;
        this.events.onMessage?.(`拆除 ${b.def.name}…`, 'info');
        this.events.onSfx?.('sell');
        this.events.onShake?.(1.2);
    }

    /** called when the builddown timer ends */
    private finishSell(b: Building) {
        const p = this.players[b.owner];
        p.credits = Math.min(MAX_CREDITS, p.credits + b.refund);
        this.events.onMessage?.(`${b.def.name} 已回收 ${b.refund} 晶体`, 'good');
        this.pushFx(b.x, b.y, 'dust', 0.8, b.size * 1.1);
        this.spawnDebris(b.x, b.y, 5 + b.size * 2, 1);
        this.removeBuilding(b, true);
    }

    /**
     * Drop a structure from the world.
     *
     * `leaveRuin` keeps a non-blocking rubble marker, which is what the retail
     * engine does for anything bigger than a wall: the footprint is freed (units
     * can drive over it) but the ground is visibly scarred.
     */
    private removeBuilding(b: Building, leaveRuin: boolean) {
        b.dead = true;
        if (leaveRuin) {
            this.ruins.push({
                x: b.x, y: b.y, size: b.size,
                seed: Math.floor(this.rng() * 100000),
            });
            if (this.ruins.length > 48) this.ruins.shift();
        }
        // free anything standing inside the footprint so nothing is embedded
        for (const u of this.units) {
            if (u.dead || u.isAir) continue;
            if (!b.occupies(u.cellX, u.cellY)) continue;
            const spot = this.nearestStandable(u.cellX, u.cellY, u.radius, 4);
            if (spot) { u.x = spot.x; u.y = spot.y; this.syncCell(u); }
        }
        this.events.onDeath?.(b);
    }

    toggleRepair() {
        const b = this.selectedBuilding;
        if (!b || b.dead || !b.done) return;
        b.repairing = !b.repairing;
        this.events.onMessage?.(b.repairing ? `维修 ${b.def.name} 中` : '停止维修', 'info');
    }

    /* ------------------------------------------------------------ */
    /* unit orders                                                   */
    /* ------------------------------------------------------------ */
    clearSelection() {
        this.selection.length = 0;
        this.selectedBuilding = null;
    }

    selectUnit(u: Unit, additive = false) {
        if (!additive) { this.selection.length = 0; this.selectedBuilding = null; }
        if (this.selection.indexOf(u) < 0) this.selection.push(u);
    }

    selectBuilding(b: Building) {
        this.selection.length = 0;
        this.selectedBuilding = b;
        this.placeMode = null;
    }

    selectAllArmy() {
        this.selectedBuilding = null;
        this.selection.length = 0;
        for (const u of this.units) {
            if (u.dead || u.owner !== 0 || u.isHarvester) continue;
            this.selection.push(u);
        }
        if (this.selection.length === 0) {
            for (const u of this.units) if (!u.dead && u.owner === 0) this.selection.push(u);
        }
    }

    /** double-tap: every unit of the same type that is currently on screen */
    selectSameType(u: Unit, bounds?: { x0: number; y0: number; x1: number; y1: number }) {
        this.selectedBuilding = null;
        this.selection.length = 0;
        for (const o of this.units) {
            if (o.dead || o.owner !== 0 || o.def.id !== u.def.id) continue;
            if (bounds && (o.x < bounds.x0 || o.x > bounds.x1 || o.y < bounds.y0 || o.y > bounds.y1)) continue;
            this.selection.push(o);
        }
        if (this.selection.indexOf(u) < 0) this.selection.push(u);
    }

    /**
     * Box select. Combat units win over harvesters so a sloppy drag around the
     * base does not drag the economy along.
     */
    selectInRect(
        minX: number, minY: number, maxX: number, maxY: number,
        additive = false, hit?: (u: Unit) => boolean,
    ): number {
        // in an isometric view a screen-space rectangle is not an axis-aligned
        // world box, so the caller may supply its own projected hit test
        const inBox = (e: Unit) => (hit ? hit(e) : (e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY));
        const army: Unit[] = [];
        const eco: Unit[] = [];
        for (const u of this.units) {
            if (u.dead || u.owner !== 0) continue;
            if (!inBox(u)) continue;
            (u.isHarvester ? eco : army).push(u);
        }
        const picked = army.length > 0 ? army : eco;
        if (!additive) { this.selection.length = 0; this.selectedBuilding = null; }
        for (const u of picked) if (this.selection.indexOf(u) < 0) this.selection.push(u);
        return picked.length;
    }

    /* ---- control groups ---- */
    setGroup(n: number) {
        if (n < 0 || n >= this.groupIds.length) return;
        const alive = this.selection.filter(u => !u.dead);
        if (alive.length === 0) { this.groupIds[n].length = 0; return; }
        this.groupIds[n] = alive.map(u => u.id);
        this.events.onMessage?.(`第 ${n + 1} 编队 · ${alive.length} 个单位`, 'info');
    }

    groupUnits(n: number): Unit[] {
        if (n < 0 || n >= this.groupIds.length) return [];
        const ids = this.groupIds[n];
        if (ids.length === 0) return [];
        const out: Unit[] = [];
        for (const u of this.units) if (!u.dead && ids.indexOf(u.id) >= 0) out.push(u);
        return out;
    }

    selectGroup(n: number): boolean {
        const list = this.groupUnits(n);
        if (list.length === 0) return false;
        this.selectedBuilding = null;
        this.selection.length = 0;
        for (const u of list) this.selection.push(u);
        return true;
    }

    groupCenter(n: number): { x: number; y: number } | null {
        const list = this.groupUnits(n);
        if (list.length === 0) return null;
        let x = 0, y = 0;
        for (const u of list) { x += u.x; y += u.y; }
        return { x: x / list.length, y: y / list.length };
    }

    private pruneGroups() {
        for (const ids of this.groupIds) {
            for (let i = ids.length - 1; i >= 0; i--) {
                if (!this.units.some(u => u.id === ids[i] && !u.dead)) ids.splice(i, 1);
            }
        }
    }

    /* ---- movement ---- */
    orderMove(x: number, y: number, append = false) {
        if (this.selection.length === 0) return;
        const n = this.selection.length;
        const cols = Math.ceil(Math.sqrt(n));
        const gap = 30;
        const cap = this.holdFormation && n > 1
            ? Math.min(...this.selection.filter(u => !u.dead).map(u => u.def.speed))
            : 0;
        let i = 0;
        for (const u of this.selection) {
            if (u.dead) continue;
            const gx = i % cols - (cols - 1) / 2;
            const gy = -Math.floor(i / cols) + (Math.ceil(n / cols) - 1) / 2;
            const tx = x + gx * gap;
            const ty = y + gy * gap;
            u.speedCap = cap;
            const o = { k: 'move' as const, x: tx, y: ty };
            if (append) this.appendOrder(u, o);
            else { u.orderQueue.length = 0; this.applyOrder(u, o); }
            i++;
        }
        this.pushFx(x, y, 'spark', 0.45, 0.7);
    }

    orderAttack(target: Entity, append = false) {
        if (this.selection.length === 0) return;
        for (const u of this.selection) {
            if (u.dead) continue;
            u.speedCap = 0;
            const o = { k: 'attack' as const, target };
            if (append) this.appendOrder(u, o);
            else { u.orderQueue.length = 0; this.applyOrder(u, o); }
        }
    }

    orderCapture(target: Entity) {
        for (const u of this.selection) {
            if (u.dead || !u.isEngineer) continue;
            u.speedCap = 0;
            u.orderQueue.length = 0;
            this.applyOrder(u, { k: 'capture', target });
        }
    }

    orderCaptureFor(u: Unit, target: Entity) {
        if (u.dead || !u.isEngineer) return;
        u.orderQueue.length = 0;
        this.applyOrder(u, { k: 'capture', target });
    }

    /** deploy a specific MCV (AI expansion) */
    tryDeploy(u: Unit) { return this.deployMcv(u); }

    /** single-unit variants used by the AI */
    orderAttackFor(u: Unit, target: Entity) {
        if (u.dead) return;
        u.orderQueue.length = 0;
        this.applyOrder(u, { k: 'attack', target });
    }

    orderAttackMoveFor(u: Unit, x: number, y: number) {
        if (u.dead) return;
        u.orderQueue.length = 0;
        this.applyOrder(u, { k: 'attackmove', x, y });
    }

    orderMoveFor(u: Unit, x: number, y: number) {
        if (u.dead) return;
        u.orderQueue.length = 0;
        this.applyOrder(u, { k: 'move', x, y });
    }

    orderAttackMove(x: number, y: number) {
        if (this.selection.length === 0) return;
        for (const u of this.selection) {
            if (u.dead) continue;
            u.orderQueue.length = 0;
            this.applyOrder(u, { k: 'attackmove', x, y });
        }
    }

    orderStop() {
        for (const u of this.selection) {
            if (u.dead) continue;
            u.orderQueue.length = 0;
            this.applyOrder(u, { k: 'idle' });
        }
    }

    /** spread units out around their current position, dodging splash damage */
    orderScatter() {
        const list = this.selection.filter(u => !u.dead);
        for (const u of list) {
            let best: { x: number; y: number } | null = null;
            let bestScore = -Infinity;
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2 + this.rng() * 0.4;
                const r = 52 + this.rng() * 46;
                const x = clamp(u.x + Math.cos(a) * r, -HALF + 24, HALF - 24);
                const y = clamp(u.y + Math.sin(a) * r, -HALF + 24, HALF - 24);
                const tx = Math.floor((x + HALF) / TILE);
                const ty = Math.floor((y + HALF) / TILE);
                if (this.isBlocked(tx, ty)) continue;
                let score = r;
                for (const o of list) {
                    if (o === u) continue;
                    score += Math.min(60, dist(x, y, o.x, o.y)) * 0.6;
                }
                if (score > bestScore) { bestScore = score; best = { x, y }; }
            }
            if (best) this.applyOrder(u, { k: 'move', x: best.x, y: best.y });
        }
        this.events.onSfx?.('scatter');
    }

    orderHarvest(node: CrystalNode | null) {
        for (const u of this.selection) {
            if (u.dead || !u.isHarvester) continue;
            u.orderQueue.length = 0;
            this.startHarvest(u, node);
        }
    }

    cycleStance() {
        const list = this.selection.filter(u => !u.dead && !u.isHarvester && !u.isEngineer && !u.isMcv);
        if (list.length === 0) return;
        const order: Stance[] = ['aggressive', 'guard', 'hold'];
        const next = order[(order.indexOf(list[0].stance) + 1) % order.length];
        for (const u of list) u.stance = next;
        const label = next === 'aggressive' ? '主动' : next === 'guard' ? '警戒' : '坚守';
        this.events.onMessage?.(`姿态：${label}`, 'info');
        this.events.onSfx?.('click');
    }

    /** order a selected MCV to unpack into a command core */
    orderDeploy() {
        for (const u of this.selection) {
            if (u.dead || !u.isMcv) continue;
            this.deployMcv(u);
        }
    }

    private deployMcv(u: Unit): boolean {
        const p = this.players[u.owner];
        const coreDef = BUILDINGS[FACTIONS[p.faction].core];
        const tx = Math.round((u.x + HALF) / TILE) - Math.floor(coreDef.size / 2);
        const ty = Math.round((u.y + HALF) / TILE) - Math.floor(coreDef.size / 2);
        const check = this.canPlace(coreDef, tx, ty, u.owner, true);
        if (!check.ok) {
            if (p.isHuman) this.events.onMessage?.(`无法部署：${check.reason}`, 'warn');
            return false;
        }
        const b = this.place(coreDef, u.owner, tx, ty, false);
        b.progress = 0.35;
        b.hp = b.maxHp * 0.35;
        u.dead = true;
        this.events.onDeath?.(u);
        this.pushFx(b.x, b.y, 'build', 1.0, coreDef.size);
        this.events.onSfx?.('deploy');
        if (p.isHuman) this.events.onMessage?.('指挥核心已展开', 'good');
        return true;
    }

    /** engineers repair friendly structures on arrival, capture hostile ones */
    private resolveEngineer(u: Unit, b: Building) {
        const p = this.players[u.owner];
        if (b.owner === u.owner) {
            b.hp = b.maxHp;
            b.repairing = false;
            this.pushFx(b.x, b.y, 'spawn', 0.6, b.size);
            if (p.isHuman) this.events.onMessage?.(`${b.def.name} 已修复`, 'good');
        } else {
            b.owner = u.owner;
            b.captured++;
            b.hp = Math.max(b.maxHp * 0.32, b.hp);
            b.repairing = false;
            this.pushFx(b.x, b.y, 'promote', 0.9, b.size);
            if (p.isHuman) this.events.onMessage?.(`已接管 ${b.def.name}`, 'good');
            else this.events.onMessage?.('我方建筑被敌方工兵接管', 'warn');
            this.events.onSfx?.('capture');
        }
        u.dead = true;
        u.hp = 0;
        this.events.onDeath?.(u);
    }

    private applyOrder(u: Unit, o: OrderLike) {
        if (u.isHarvester && o.k !== 'move' && o.k !== 'attackmove' && o.k !== 'idle') return;
        u.order = o as any;
        if (o.k === 'move' || o.k === 'attackmove') {
            this.moveUnitTo(u, o.x, o.y, true);
        } else if (o.k === 'attack' || o.k === 'capture') {
            u.stop();
            this.pathToEntity(u, o.target);
        } else if (o.k === 'idle') {
            u.stop();
            u.speedCap = 0;
        }
    }

    private appendOrder(u: Unit, o: OrderLike) {
        if (u.order.k === 'idle') { this.applyOrder(u, o); return; }
        if (u.orderQueue.length >= 6) u.orderQueue.shift();
        u.orderQueue.push(o as any);
    }

    /** called whenever the current order finishes */
    private advanceOrder(u: Unit) {
        if (u.orderQueue.length > 0) {
            const next = u.orderQueue.shift()!;
            this.applyOrder(u, next as OrderLike);
            return;
        }
        u.order = { k: 'idle' };
    }

    /**
     * Path to a firing position around a target.
     *
     * Returns false when there is no route. The caller must not retry every
     * frame in that case: alternating between two "nearest reachable" points is
     * exactly what used to make units wobble back and forth in front of a wall.
     */
    private pathToEntity(u: Unit, target: Entity): boolean {
        const edge = target.isBuilding ? target.radius + 20 : target.radius + 12;
        const a = Math.atan2(u.y - target.y, u.x - target.x);
        const gx = target.x + Math.cos(a) * edge;
        const gy = target.y + Math.sin(a) * edge;
        if (u.isAir) { u.path = [{ x: gx, y: gy }]; u.repath = 0; return true; }
        const path = this.findPath(u, gx, gy, 48);
        if (path) {
            u.path = path;
            u.repath = 3;
            u.repathTry = 0;
            return true;
        }
        // no route: retarget at the closest reachable spot, then stop asking
        this.relocateTo(u, gx, gy, false);
        u.repathHold = 1.5;
        return false;
    }

    /**
     * Path to a point, or null when the route does not really reach it.
     *
     * `PathFinder.find` falls back to `bestEffort`, which happily returns a path
     * that ends at the unit's OWN cell when nothing is reachable. Treating that
     * as success is what left trucks "moving" on a one-node path to nowhere: the
     * waypoint was under 3px away, got popped, and the order restarted forever.
     */
    private findPath(u: Unit, gx: number, gy: number, tolerance = 44): { x: number; y: number }[] | null {
        if (u.isAir) return [{ x: gx, y: gy }];
        const path = this.findFor(u, gx, gy);
        if (!path || path.length === 0) return null;
        if (this.finder.lastFound) return path;
        // Defensive: with bestEffort off this cannot happen, but a truncated
        // result must never be mistaken for an arrival.
        const end = path[path.length - 1];
        const lg = this.finder.lastGoal;
        return Math.hypot(end.x - lg.x, end.y - lg.y) <= tolerance ? path : null;
    }

    /**
     * Run a path query on behalf of `u`.
     *
     * The cost function needs to know whose route is being planned: tiles that
     * already hold other units are more expensive, so a group ordered onto one
     * point fans out instead of all committing to the same straight line and
     * then shoving each other. Reference: MoveTask plans against
     * `reservedPathNodes` + `findObstacles`, both of which see other units.
     */
    private findFor(u: Unit, gx: number, gy: number, opts?: { radius?: number }) {
        const prev = this.pathingFor;
        this.pathingFor = u;
        try {
            return this.finder.find(u.x, u.y, gx, gy, { radius: opts?.radius ?? u.steerRadius });
        } finally {
            this.pathingFor = prev;
        }
    }

    /**
     * Terrain cost plus a crowd penalty.
     *
     * Hard-blocking occupied tiles deadlocks a continuous-movement engine (the
     * block table goes stale the moment anybody accelerates), so this is a soft
     * penalty: the planner still has a route, it just prefers the emptier one.
     * A tile holding three tanks costs six times a clear one, which is enough to
     * make the second and third tank pick a lane of their own.
     */
    private pathCostFor(tx: number, ty: number): number {
        const base = this.terrain.costAt(tx, ty);
        const set = this.occupancy ? this.occupancy.at(tx, ty) : null;
        if (!set || set.size === 0) return base;
        const me = this.pathingFor;
        let others = 0;
        for (const o of set) {
            if (o === me || o.dead) continue;
            others++;
        }
        return others === 0 ? base : base * (1 + Math.min(5, others * 1.6));
    }

    /**
     * Retarget an order at the closest cell this unit can actually stand on.
     *
     * Reference: MoveTask.findRelocationTile + updateTarget — the move task
     * never abandons a destination just because the exact tile is blocked, it
     * relocates to the nearest reachable one. `PathFinder.relocate` does the
     * flood fill, so the returned point is guaranteed reachable *from where the
     * unit is standing* (the old `findFreeNear` only checked "is it free").
     */
    private relocateTo(u: Unit, gx: number, gy: number, retarget = true): boolean {
        if (u.isAir) { u.path = [{ x: gx, y: gy }]; u.repath = 4; return true; }
        const prevFor = this.pathingFor;
        this.pathingFor = u;
        const path = this.finder.relocate(u.x, u.y, gx, gy, { radius: u.steerRadius });
        this.pathingFor = prevFor;
        if (!path || path.length === 0) return false;
        u.path = path;
        u.repath = 4;
        const lg = this.finder.lastGoal;
        if (retarget && (u.order.k === 'move' || u.order.k === 'attackmove')) {
            u.order.x = lg.x;
            u.order.y = lg.y;
        }
        return true;
    }

    /**
     * A reachable parking spot around a structure.
     *
     * The retail dock is a set of cells on one side of the refinery; if that side
     * is walled in the truck simply cannot unload. Trying all eight sides is the
     * cheap equivalent, and it also spreads trucks out instead of having them
     * queue on a single point.
     */
    private findDock(u: Unit, drop: Building): { x: number; y: number }[] | null {
        /*
         * Dock = any free cell touching the refinery footprint.
         *
         * Reference: the refinery's dock cells are the tiles around its
         * foundation. Approximating that with "a point at radius+22 in the
         * approach direction" put the target in a wall whenever the base grew
         * around the building; enumerating the ring and taking the nearest
         * reachable cell is both simpler and robust.
         */
        const ring: Array<{ tx: number; ty: number; d: number }> = [];
        const x0 = drop.tx - 1, y0 = drop.ty - 1;
        const x1 = drop.tx + drop.size, y1 = drop.ty + drop.size;
        for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
                const onRing = tx === x0 || ty === y0 || tx === x1 || ty === y1;
                if (!onRing) continue;
                if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) continue;
                if (this.isBlocked(tx, ty)) continue;
                if (!this.occupancy.hasRoomFor(u, tx, ty)) continue;
                const wx = tx * TILE + TILE / 2 - HALF;
                const wy = ty * TILE + TILE / 2 - HALF;
                if (this.worldBlockedAt(wx, wy, u.steerRadius)) continue;
                // spread trucks over the apron instead of stacking them on one
                // cell: a cell accepts two harvesters, the third has to queue
                let crowd = 0;
                const here = this.occupancy.at(tx, ty);
                if (here) for (const o of here) if (o !== u && !o.dead && o.isHarvester) crowd++;
                ring.push({ tx, ty, d: Math.hypot(wx - u.x, wy - u.y) + crowd * 70 });
            }
        }
        ring.sort((a, b) => a.d - b.d);
        for (const c of ring.slice(0, 4)) {
            const wx = c.tx * TILE + TILE / 2 - HALF;
            const wy = c.ty * TILE + TILE / 2 - HALF;
            const path = this.findPath(u, wx, wy, 26);
            if (path) return path;
        }
        return null;
    }

    /** is this unit standing beside the structure's footprint? */
    private atFootprint(u: Unit, b: Building): boolean {
        const half = (b.size * TILE) / 2;
        const cx = clamp(u.x, b.x - half, b.x + half);
        const cy = clamp(u.y, b.y - half, b.y + half);
        return Math.hypot(u.x - cx, u.y - cy) < TILE * 0.95;
    }

    /** the point this unit is currently trying to reach */
    private orderGoal(u: Unit): { x: number; y: number } | null {
        const o = u.order;
        if (o.k === 'move' || o.k === 'attackmove') return { x: o.x, y: o.y };
        if (o.k === 'harvest') return o.node ? { x: o.node.x, y: o.node.y } : null;
        if (o.k === 'attack' && o.target && !o.target.dead) return { x: o.target.x, y: o.target.y };
        return null;
    }

    /**
     * Spiral outward from a point looking for ground a unit can actually stand on.
     *
     * Kept only for the AI's structure placement (a "is this spot clear" test).
     * Unit movement must use `relocateTo`: a free cell is worthless if the unit
     * cannot drive to it, and assuming otherwise was a silent-stall bug.
     */
    private findFreeNear(x: number, y: number, maxR: number): { x: number; y: number } | null {
        const T = TILE;
        for (let r = 0; r <= maxR; r += T * 0.5) {
            const steps = r < 1 ? 1 : Math.max(8, Math.ceil((Math.PI * 2 * r) / (T * 0.55)));
            for (let i = 0; i < steps; i++) {
                const a = (i / steps) * Math.PI * 2;
                const px = x + Math.cos(a) * r;
                const py = y + Math.sin(a) * r;
                if (px < -HALF + 24 || py < -HALF + 24 || px > HALF - 24 || py > HALF - 24) continue;
                const tx = Math.floor((px + HALF) / T);
                const ty = Math.floor((py + HALF) / T);
                if (this.terrain.isSolid(tx, ty)) continue;
                if (this.isBlocked(tx, ty)) continue;
                return { x: px, y: py };
            }
        }
        return null;
    }

    /** recompute a path without touching the current order (retry must not drift it) */
    private repathTo(u: Unit, x: number, y: number) {
        if (u.isAir) {
            u.path = [{ x, y }];
        } else {
            const p = this.findPath(u, x, y, 60);
            if (p) u.path = p;
            else if (!this.relocateTo(u, x, y, false)) u.path = [];
        }
        u.repath = 4;
    }

    /** the reference gives up after 5 unreachable targets; do the same */
    /**
     * The order could not be completed.
     *
     * `reason` matters for the player-facing message: only a missing ROUTE means
     * "unreachable". Being squeezed by friendly traffic ends the order too, but
     * telling the player "无法抵达目标" there is a lie — and it was the message
     * they saw on an empty flat map.
     */
    private giveUpOrder(u: Unit, reason: 'nopath' | 'blocked' = 'nopath') {
        const wasMoving = u.order.k !== 'idle';
        u.retry = 0;
        u.stuck = 0;
        u.waitT = 0;
        u.stallT = 0;
        u.blockT = 0;
        u.repathTry = 0;
        u.progGoalD = 0;
        u.stop();
        u.order = { k: 'idle' };
        if (wasMoving && u.owner === 0 && reason === 'nopath') {
            /*
             * Only a real "there is no route" earns a message.
             *
             * Retail never tells the player anything when a unit gives up a tile
             * to its friends — it just parks. Printing "blocked by friendly
             * units, standing by" made a normal crowd read as a bug, and the
             * player quite reasonably asked why friends cannot swap places.
             */
            this.events.onMessage?.('无法抵达目标，已取消行进', 'warn');
        }
    }

    private moveUnitTo(u: Unit, x: number, y: number, keepOrder: boolean) {
        x = clamp(x, -HALF + 24, HALF - 24);
        y = clamp(y, -HALF + 24, HALF - 24);
        if (!keepOrder) u.order = { k: 'move', x, y };
        u.retry = 0;
        u.waitT = 0;
        u.blockT = 0;
        u.repathTry = 0;
        u.parkTry = 0;
        u.parkX = NaN;
        u.parkY = NaN;
        u.repathHold = 0;
        if (u.isAir) {
            u.path = [{ x, y }];
            u.repath = 4;
            return;
        }
        const path = this.findPath(u, x, y);
        if (path) {
            u.path = path;
            u.repath = 4;
            return;
        }
        /*
         * Unreachable: retarget at the nearest reachable cell (reference:
         * findRelocationTile). Only when literally nowhere is reachable does the
         * order end — that is `MoveResult.Fail`.
         */
        if (!this.relocateTo(u, x, y)) this.giveUpOrder(u, 'nopath');
    }

    private startHarvest(u: Unit, node: CrystalNode | null) {
        const target = node || this.nearestNode(u.x, u.y);
        u.order = { k: 'harvest', node: target, phase: 'seek', timer: 0 };
        u.mineNode = target;
        u.stop();
    }

    /** nearest reachable field, biased away from fields other trucks already work */
    /** mark a field unreachable for a while so harvesters stop re-trying it */
    private coolNode(n: CrystalNode, seconds = 8) {
        this.nodeCooldown.set(n.id, this.time + seconds);
    }

    private nodeReady(n: CrystalNode) {
        const until = this.nodeCooldown.get(n.id);
        return until === undefined || until <= this.time;
    }

    pickHarvestNode(u: Unit): CrystalNode | null {
        let best: CrystalNode | null = null;
        let bestScore = Infinity;
        for (const n of this.terrain.nodes) {
            if (n.amount <= 0) continue;
            if (this.buildingAt(n.tx, n.ty)) continue;
            if (!this.nodeReady(n)) continue;
            let load = 0;
            for (const o of this.units) {
                if (o !== u && !o.dead && o.isHarvester && o.mineNode === n) load++;
            }
            const score = dist(u.x, u.y, n.x, n.y) + load * 110;
            if (score < bestScore) { bestScore = score; best = n; }
        }
        return best;
    }

    nearestNode(x: number, y: number, exclude: CrystalNode | null = null): CrystalNode | null {
        let best: CrystalNode | null = null;
        let bd = Infinity;
        for (const n of this.terrain.nodes) {
            if (n.amount <= 0) continue;
            if (exclude && n.id === exclude.id) continue;
            // ore buried under a structure can never be mined: skip it so a
            // harvester never parks against a wall forever
            if (this.buildingAt(n.tx, n.ty)) continue;
            if (!this.nodeReady(n)) continue;
            const d = dist(x, y, n.x, n.y);
            if (d < bd) { bd = d; best = n; }
        }
        return best;
    }

    /**
     * Where a truck should park to unload. Approaching from its own side (instead
     * of a fixed slot south of the building) stops two trucks from queueing on
     * the exact same point and shoving each other while unloading.
     */
    private dockPoint(u: Unit, drop: Building) {
        const dx = u.x - drop.x;
        const dy = u.y - drop.y;
        const d = Math.hypot(dx, dy) || 1;
        const r = drop.radius + 20;
        return { x: drop.x + (dx / d) * r, y: drop.y + (dy / d) * r };
    }

    nearestDropoff(p: PlayerState, x: number, y: number): Building | null {
        let best: Building | null = null;
        let bd = Infinity;
        for (const b of this.buildings) {
            if (b.dead || b.owner !== p.id || !b.def.dropoff || !b.done) continue;
            const d = dist(x, y, b.x, b.y);
            if (d < bd) { bd = d; best = b; }
        }
        return best;
    }

    /* ------------------------------------------------------------ */
    /* super weapons                                                 */
    /* ------------------------------------------------------------ */
    private syncSuperWeapons(p: PlayerState) {
        if (!this.options.superWeapons) { p.sw.length = 0; return; }
        const have: Record<string, Building> = {};
        for (const b of this.buildings) {
            if (b.dead || b.owner !== p.id || !b.done || !b.def.superWeapon) continue;
            have[b.def.superWeapon] = b;
        }
        // drop states whose provider is gone
        for (let i = p.sw.length - 1; i >= 0; i--) {
            if (!have[p.sw[i].id]) p.sw.splice(i, 1);
        }
        for (const id in have) {
            const sid = id as SuperWeaponId;
            if (p.sw.some(s => s.id === sid)) continue;
            p.sw.push({
                id: sid, t: 0, total: SUPER_WEAPONS[sid].charge, ready: false, sourceId: have[id].id,
            });
        }
    }

    swOf(p: PlayerState, id: SuperWeaponId): SuperWeaponState | null {
        return p.sw.find(s => s.id === id) || null;
    }

    beginSwTargeting(id: SuperWeaponId) {
        const st = this.swOf(this.human, id);
        if (!st || !st.ready) return;
        if (!this.radarOnline(this.human)) { this.events.onMessage?.('电力不足，超级武器离线', 'warn'); return; }
        this.swTargeting = id;
        this.placeMode = null;
    }

    cancelSwTargeting() { this.swTargeting = null; }

    launchSuperWeapon(id: SuperWeaponId, x: number, y: number, pid: PlayerId = 0): boolean {
        const p = this.players[pid];
        const st = this.swOf(p, id);
        if (!st || !st.ready) return false;
        if (!this.radarOnline(p)) return false;
        st.ready = false;
        st.t = 0;
        const def = SUPER_WEAPONS[id];
        this.events.onSfx?.('superweapon');
        if (id === 'orbital') {
            this.strikeQueue.push({ x, y, owner: pid, t: 1.4 });
            this.pushFx(x, y, 'target', 1.4, 1);
            this.events.onMessage?.(p.isHuman ? '轨道打击已锁定目标' : '警告：敌方轨道打击来袭', p.isHuman ? 'good' : 'warn');
        } else if (id === 'aegis') {
            this.zones.push(new Zone(x, y, def.radius, 20, 'aegis', pid, def.color));
            this.events.onMessage?.(p.isHuman ? '力场护盾展开' : '敌方力场展开', 'good');
        } else if (id === 'sandstorm') {
            const z = new Zone(x, y, def.radius, 12, 'sandstorm', pid, def.color);
            z.dps = 26;
            this.zones.push(z);
            this.events.onMessage?.(p.isHuman ? '沙暴领域成型' : '警告：沙暴来袭', p.isHuman ? 'good' : 'warn');
        } else if (id === 'mirage') {
            this.zones.push(new Zone(x, y, def.radius, 20, 'mirage', pid, def.color));
            this.events.onMessage?.(p.isHuman ? '蜃楼帷幕升起' : '敌方部队失去踪迹', 'good');
        }
        return true;
    }

    private tickSuperWeapons(dt: number) {
        for (const p of this.players) {
            this.syncSuperWeapons(p);
            if (!this.radarOnline(p)) continue;
            for (const s of p.sw) {
                if (s.ready) continue;
                s.t += dt;
                if (s.t >= s.total) {
                    s.t = s.total;
                    s.ready = true;
                    if (p.isHuman) {
                        this.events.onMessage?.(`${SUPER_WEAPONS[s.id].name} 充能完成`, 'good');
                        this.events.onSfx?.('swready');
                    }
                }
            }
        }
    }

    private tickZones(dt: number) {
        for (const z of this.zones) {
            z.step(dt);
            if (z.dead) continue;
            for (const u of this.units) {
                if (u.dead || !z.contains(u.x, u.y)) continue;
                if (z.kind === 'aegis') {
                    if (u.owner === z.owner) u.invulnUntil = this.time + 0.3;
                } else if (z.kind === 'mirage') {
                    if (u.owner === z.owner) u.mirageUntil = this.time + 0.3;
                } else if (z.kind === 'sandstorm') {
                    if (u.owner !== z.owner) {
                        u.slowUntil = this.time + 0.35;
                        this.damage(u, z.dps * dt, 'explosive', z.owner, null, true);
                    }
                }
            }
        }
        for (let i = this.zones.length - 1; i >= 0; i--) if (this.zones[i].dead) this.zones.splice(i, 1);

        // orbiting strikes land after a short warning delay
        for (let i = this.strikeQueue.length - 1; i >= 0; i--) {
            const s = this.strikeQueue[i];
            s.t -= dt;
            if (s.t > 0) continue;
            this.strikeQueue.splice(i, 1);
            this.orbitalImpact(s.x, s.y, s.owner);
        }
    }

    private orbitalImpact(x: number, y: number, owner: PlayerId) {
        const r = 118;
        this.pushFx(x, y, 'boom', 0.9, 4.2);
        this.events.onSfx?.('orbital');
        for (const u of this.units) {
            if (u.dead || u.owner === owner) continue;
            const d = dist(x, y, u.x, u.y);
            if (d > r) continue;
            this.damage(u, 420 * (1 - (d / r) * 0.55), 'explosive', owner, null);
        }
        for (const b of this.buildings) {
            if (b.dead || b.owner === owner) continue;
            const d = dist(x, y, b.x, b.y);
            if (d > r + b.radius * 0.5) continue;
            this.damage(b, 380 * (1 - (d / r) * 0.4), 'explosive', owner, null);
        }
    }

    /* ------------------------------------------------------------ */
    /* supply crates                                                 */
    /* ------------------------------------------------------------ */
    private tickCrates(dt: number) {
        if (!this.options.crates) return;
        this.crateTimer -= dt;
        if (this.crateTimer <= 0 && this.crates.length < 3) {
            this.crateTimer = CRATE_INTERVAL;
            for (let tries = 0; tries < 40; tries++) {
                const tx = 6 + Math.floor(this.rng() * (MAP_TILES - 12));
                const ty = 6 + Math.floor(this.rng() * (MAP_TILES - 12));
                if (this.isBlocked(tx, ty) || this.terrain.isCrystal(tx, ty)) continue;
                const w = tileToWorld(tx, ty);
                if (dist(w.x, w.y, 0, 0) < 300) continue;
                const roll = this.rng();
                const kind: Crate['kind'] = roll < 0.5 ? 'credits' : roll < 0.8 ? 'repair' : 'promote';
                this.crates.push(new Crate(w.x, w.y, kind));
                break;
            }
        }
        for (let i = this.crates.length - 1; i >= 0; i--) {
            const c = this.crates[i];
            c.t += dt;
            let taken: Unit | null = null;
            for (const u of this.units) {
                if (u.dead || u.isAir) continue;
                if (dist(u.x, u.y, c.x, c.y) < 24 + u.radius) { taken = u; break; }
            }
            if (!taken) continue;
            const p = this.players[taken.owner];
            if (c.kind === 'credits') {
                p.credits = Math.min(MAX_CREDITS, p.credits + 900);
                p.earned += 900;
                if (p.isHuman) this.events.onMessage?.('拾获补给箱 · +900 晶体', 'good');
            } else if (c.kind === 'repair') {
                for (const u of this.units) {
                    if (u.dead || u.owner !== taken.owner) continue;
                    if (dist(u.x, u.y, c.x, c.y) > 320) continue;
                    u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.5);
                }
                if (p.isHuman) this.events.onMessage?.('拾获维修包 · 附近部队已修复', 'good');
            } else {
                this.gainXpAmount(taken, Math.max(120, taken.def.cost * VET_XP_RATIO * 0.8));
                if (p.isHuman) this.events.onMessage?.('拾获晋升核心 · 单位获得经验', 'good');
            }
            this.pushFx(c.x, c.y, 'promote', 0.6, 1);
            this.events.onSfx?.('crate');
            this.crates.splice(i, 1);
        }
    }

    /* ------------------------------------------------------------ */
    /* main update                                                   */
    /* ------------------------------------------------------------ */
    update(dt: number) {
        if (this.phase !== 'playing') return;
        this.time += dt;

        this.grid.clear();
        for (const u of this.units) if (!u.dead) this.grid.insert(u);

        this.updateBuildings(dt);
        this.tickProduction(dt);
        this.updateUnits(dt);
        this.resolveCollisions(dt);
        this.updateProjectiles(dt);
        this.updateFx(dt);
        this.tickZones(dt);
        this.tickSuperWeapons(dt);
        this.tickCrates(dt);

        this.players[1].ai?.update(dt);

        this.regenTimer += dt;
        if (this.regenTimer >= 2) {
            this.regenTimer = 0;
            for (const n of this.terrain.nodes) {
                if (n.amount < n.max) n.amount = Math.min(n.max, n.amount + 14);
            }
        }

        this.revealTimer += dt;
        if (this.revealTimer >= REVEAL_TICK) {
            this.revealTimer = 0;
            this.updateVisibility(this.players[0]);
            this.updateVisibility(this.players[1]);
            this.events.onFogDirty?.();
        }

        // harvesters that died are worth replacing without nagging the player
        for (const p of this.players) {
            const n = this.countHarvesters(p.id);
            if (n < this.lastHarvesterCount[p.id] && this.autoReplace) {
                if (p.isHuman) this.events.onMessage?.('采集车损失 · 建议补充', 'warn');
                this.events.onSfx?.('alarm');
            }
            this.lastHarvesterCount[p.id] = n;
        }

        // reap dead entities
        if (this.units.some(u => u.dead)) {
            for (let i = this.units.length - 1; i >= 0; i--) {
                if (this.units[i].dead) this.units.splice(i, 1);
            }
            this.selection = this.selection.filter(u => !u.dead);
            this.pruneGroups();
        }
        if (this.buildings.some(b => b.dead)) {
            for (let i = this.buildings.length - 1; i >= 0; i--) {
                if (this.buildings[i].dead) this.buildings.splice(i, 1);
            }
            if (this.selectedBuilding && this.selectedBuilding.dead) this.selectedBuilding = null;
        }

        this.checkVictory();
    }

    /* ------------------------------------------------------------ */
    /* production tick                                               */
    /* ------------------------------------------------------------ */
    private tickProduction(dt: number) {
        for (const p of this.players) {
            for (const cat of CATS) {
                const q = p.queues[cat];
                if (q.ready) continue;
                const item = q.items[0];
                if (!item) continue;
                if (this.factoryCount(p, cat) === 0) continue;
                const speed = this.prodFactor(p) * this.factorySpeed(p, cat);
                const perSec = (item.cost / Math.max(0.1, item.time)) * speed;
                const want = Math.min(item.cost - item.spent, perSec * dt);
                if (want <= 0) continue;
                const spend = Math.min(p.credits, want);
                if (spend <= 0) {
                    if (p.isHuman && cat !== 'structure' && Math.floor(this.time) !== Math.floor(this.time - dt)) {
                        // silent: the HUD already shows the empty credit counter
                    }
                    continue;
                }
                p.credits -= spend;
                item.spent += spend;
                item.progress = clamp(item.spent / item.cost, 0, 1);
                if (item.spent >= item.cost - 0.01) {
                    item.progress = 1;
                    item.spent = item.cost;
                    this.finishQueueItem(p, q);
                }
            }
        }
    }

    private finishQueueItem(p: PlayerState, q: ProdQueue) {
        const item = q.items[0];
        if (!item) return;
        if (q.cat === 'structure') {
            if (p.isHuman) {
                q.ready = true;
                this.events.onMessage?.(`${BUILDINGS[item.defId].name} 建造完成 · 点击卡片放置`, 'good');
                this.events.onSfx?.('ready');
            } else {
                // the AI places immediately; if the site is blocked it retries
                // next tick instead of losing the structure
                if (p.ai?.placeStructure(item.defId)) {
                    q.items.shift();
                    q.ready = false;
                } else {
                    q.ready = true;
                }
            }
            return;
        }
        q.items.shift();
        const def = UNITS[item.defId];
        const fac = this.primaryFactory(p, q.cat);
        if (!def || !fac) return;
        const sp = this.spawnPointFor(fac);
        const u = this.spawnUnit(p.id, def, sp.x, sp.y);
        u.order = { k: 'idle' };
        if (fac.rally) this.applyOrder(u, { k: 'move', x: fac.rally.x, y: fac.rally.y });
        this.pushFx(sp.x, sp.y, 'spawn', 0.5, 1);
        if (p.isHuman) this.events.onSfx?.('unitready');
    }

    private spawnPointFor(b: Building): { x: number; y: number } {
        const off = (b.size * TILE) / 2 + 20;
        const candidates: Array<[number, number]> = [
            [0, -off], [off, -off * 0.4], [-off, -off * 0.4],
            [off, off * 0.5], [-off, off * 0.5], [0, off],
            [off * 1.5, 0], [-off * 1.5, 0],
        ];
        for (const [dx, dy] of candidates) {
            const x = b.x + dx;
            const y = b.y + dy;
            if (!this.isBlocked(Math.floor((x + HALF) / TILE), Math.floor((y + HALF) / TILE))) {
                return { x, y };
            }
        }
        return { x: b.x, y: b.y - off };
    }

    private updateBuildings(dt: number) {
        for (const b of this.buildings) {
            if (b.dead) continue;
            const p = this.players[b.owner];
            b.pulse += dt;

            if (b.status === 'builddown') {
                b.buildT -= dt;
                b.progress = Math.max(0.02, Math.min(1, b.buildT / Math.max(0.01, b.buildDur)));
                if (b.buildT <= 0) {
                    b.progress = 0;
                    b.status = 'ready';
                    this.finishSell(b);
                }
                continue;
            }

            if (b.status === 'buildup') {
                // rise animation only — the structure is already complete
                b.buildT -= dt;
                b.progress = b.buildDur > 0 ? clamp(1 - b.buildT / b.buildDur, 0, 1) : 1;
                if (b.buildT <= 0) {
                    b.progress = 1;
                    b.status = 'ready';
                    this.pushFx(b.x, b.y, 'spawn', 0.6, b.size);
                    if (p.isHuman) {
                        this.events.onMessage?.(`${b.def.name} 部署完成`, 'good');
                        this.events.onSfx?.('ready');
                    }
                }
                continue;
            }

            // battle damage: smoke first, then open flames
            const hurt = b.hp / b.maxHp;
            if (hurt < 0.55 && Math.random() < dt * 0.9) {
                const sx = b.x + (Math.random() - 0.5) * b.radius;
                const sy = b.y + (Math.random() - 0.5) * b.radius * 0.6;
                const sm = new Fx(sx, sy, 'smoke', 1.1 + Math.random() * 0.6, 1.2);
                sm.vz = 16;
                sm.vx = (Math.random() - 0.5) * 8;
                this.fx.push(sm);
                this.events.onFx?.(sm);
            }
            if (hurt < 0.28 && Math.random() < dt * 0.8) {
                const fx = new Fx(
                    b.x + (Math.random() - 0.5) * b.radius * 0.8,
                    b.y + (Math.random() - 0.5) * b.radius * 0.5,
                    'fire', 0.55 + Math.random() * 0.3, 1.1,
                );
                this.fx.push(fx);
                this.events.onFx?.(fx);
            }

            // repair mode
            if (b.repairing) {
                if (b.hp >= b.maxHp) { b.repairing = false; }
                else {
                    const heal = (b.maxHp / REPAIR_SECONDS) * dt;
                    const cost = heal * REPAIR_COST_PER_HP;
                    if (p.credits >= cost) {
                        p.credits -= cost;
                        b.hp = Math.min(b.maxHp, b.hp + heal);
                    }
                }
            }

            // defensive weapon
            if (b.def.weapon) {
                b.cd -= dt * (this.prodFactor(p) < 1 ? 0.6 : 1);
                if (b.cd <= 0) {
                    const tgt = this.findTargetFor(b, b.def.weapon, b.x, b.y, b.def.weapon.range);
                    if (tgt) {
                        this.fire(b, b.def.weapon, tgt);
                        b.cd = b.def.weapon.cd;
                    }
                }
            }
        }
    }

    private updateUnits(dt: number) {
        for (const u of this.units) {
            if (u.dead) continue;
            if (u.hitFlash > 0) u.hitFlash -= dt;
            u.bob += dt;
            u.cloakT += dt;
            u.calm += dt;
            if (u.scan > 0) u.scan -= dt;
            /*
             * The turret lock is rebuilt from the unit's persistent focus, not
             * from a timer.
             *
             * Reference: TurretTrait.desiredFacing is rewritten every tick by
             * whoever owns the unit's attention — DriveLocomotor points it at the
             * current attack target (AttackTrait.currentTarget, which survives
             * between target scans) or at the move bearing, and MoveTrait points
             * it at the hull only when there is neither. Nothing expires. Our old
             * 2.2 s timer, plus clearing the aim whenever the scan cooldown was
             * running, made the barrel swing back and re-acquire over and over.
             */
            if (!u.focus || u.focus.dead) {
                u.focus = null;
                u.turretAim = null;
            }

            // cloak state: stealth units re-cloak shortly after firing
            const fieldCloak = this.time < u.mirageUntil;
            u.cloaked = fieldCloak || (!!u.def.cloak && u.cloakT > 2.2);

            if (u.slowUntil > -1 && this.time > u.slowUntil) u.slowUntil = -1;
            if (u.invulnUntil > -1 && this.time > u.invulnUntil) u.invulnUntil = -1;
            if (u.recoil > 0) u.recoil -= dt;
            u.blockedNow = false;

            // sample the ground under the unit: dunes and ore slow it down
            if (!u.isAir) {
                const tx = Math.floor((u.x + HALF) / TILE);
                const ty = Math.floor((u.y + HALF) / TILE);
                const mul = this.terrain.speedAt(tx, ty, u.def.kind === 'infantry', u.isHover);
                u.terrainMul = mul > 0 ? mul : 0.35;
            } else {
                u.terrainMul = 1;
            }

            // elite units slowly regenerate out of combat
            if (u.level >= VET_MAX_LEVEL && u.calm > 4 && u.hp < u.maxHp) {
                u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.012 * dt);
            }

            if (u.isHarvester) {
                this.updateHarvester(u, dt);
            } else {
                this.updateCombatant(u, dt);
            }
            // the order above decided what the turret is interested in; swing it
            // now so the 8-way image is right on the same frame. A living focus
            // keeps the barrel on it even between target scans.
            if (u.focus && !u.focus.dead) u.aimAt(u.focus.x, u.focus.y);
            u.aimTurret(dt, u.turretAim);

            if (u.cd > 0) u.cd -= dt * (this.prodFactor(this.players[u.owner]) < 1 ? 0.65 : 1);

            // shot-up hulls trail smoke
            if (u.hp < u.maxHp * 0.35 && Math.random() < dt * 0.7) {
                const sm = new Fx(u.x + (Math.random() - 0.5) * 6, u.y + (Math.random() - 0.5) * 4, 'smoke', 0.9, 0.7);
                sm.vz = 12;
                this.fx.push(sm);
                this.events.onFx?.(sm);
            }

            // dust kicked up by tracks and hover skirts
            if (!u.isAir && u.def.kind !== 'infantry' && u.speedCur > 26 && u.path.length > 0) {
                u.dustT -= dt;
                if (u.dustT <= 0) {
                    u.dustT = 0.2 + Math.random() * 0.14;
                    this.pushFx(
                        u.x - Math.cos(u.face) * u.radius * 0.8,
                        u.y - Math.sin(u.face) * u.radius * 0.8,
                        'dust', 0.55, 0.8,
                    );
                }
            }

            if (u.speedCap > 0 && u.path.length === 0) u.speedCap = 0;

            // periodic re-path toward a moving attack target
            if (u.path.length > 0 && u.repath > 0) {
                u.repath -= dt;
            }
        }
    }

    private updateCombatant(u: Unit, dt: number) {
        const w = u.def.weapon;
        const o = u.order;

        if (o.k === 'attack') {
            const t = o.target;
            if (!t || t.dead) { this.advanceOrder(u); return; }
            if (u.isEngineer) { this.advanceOrder(u); return; }
            const d = dist(u.x, u.y, t.x, t.y);
            const range = (w ? w.range : 90) * 0.92 + (t.isBuilding ? t.radius * 0.7 : t.radius);
            if (d > range) {
                if (u.repathHold <= 0 && (u.path.length === 0 || u.repath <= 0)) this.pathToEntity(u, t);
                if (u.path.length > 0) u.moveStep(dt, 1);
            } else {
                u.stop();
                u.focus = t;
                u.aimAt(t.x, t.y);
                // swing on the same tick so aimReady() judges the new bearing
                u.aimTurret(dt, u.turretAim);
                if (w && u.cd <= 0 && u.aimReady()) { this.fire(u, w, t); u.cd = w.cd * u.rofMul; }
            }
            return;
        }

        if (o.k === 'capture') {
            const t = o.target as Building;
            if (!t || t.dead || !u.isEngineer) { this.advanceOrder(u); return; }
            const d = dist(u.x, u.y, t.x, t.y);
            if (d > t.radius + 22) {
                if (u.path.length === 0 || u.repath <= 0) this.pathToEntity(u, t);
                u.moveStep(dt, 1);
            } else {
                u.stop();
                this.resolveEngineer(u, t);
            }
            return;
        }

        if (o.k === 'deploy') {
            if (u.isMcv) this.deployMcv(u);
            this.advanceOrder(u);
            return;
        }

        if (o.k === 'attackmove') {
            if (w && u.scan <= 0) {
                u.scan = 0.22 + Math.random() * 0.12;
                const t = this.findTargetFor(u, w, u.x, u.y, w.range * 0.95);
                if (t) {
                    u.stop();
                    u.focus = t;
                    if (u.cd <= 0) { this.fire(u, w, t); u.cd = w.cd * u.rofMul; }
                    return;
                }
            }
            if (u.path.length > 0) u.moveStep(dt, 1);
            else this.advanceOrder(u);
            return;
        }

        if (o.k === 'move') {
            if (u.path.length > 0) u.moveStep(dt, 1);
            else this.advanceOrder(u);
            return;
        }

        // idle: stance decides how far a unit will pick fights on its own
        if (w && u.stance !== 'hold' && u.scan <= 0) {
            u.scan = 0.22 + Math.random() * 0.12;
            const acq = w.range * (u.stance === 'aggressive' ? 1.4 : 0.98);
            const t = this.findTargetFor(u, w, u.x, u.y, acq);
            if (t) {
                u.focus = t;
                const d = dist(u.x, u.y, t.x, t.y);
                if (u.cd <= 0 && d <= w.range * 1.02) { this.fire(u, w, t); u.cd = w.cd * u.rofMul; }
                if (u.stance === 'aggressive' && d > w.range * 0.85 && u.path.length === 0) {
                    this.pathToEntity(u, t);
                }
            } else if (u.focus && Math.hypot(u.focus.x - u.x, u.focus.y - u.y) > w.range * 1.35) {
                // the lock is only dropped when the target really left the fight
                u.focus = null;
            }
        }
        if (u.path.length > 0) u.moveStep(dt, 1);
    }

    private updateHarvester(u: Unit, dt: number) {
        const p = this.players[u.owner];
        let o = u.order;
        // a direct move order always wins; once it finishes the truck returns to work
        if (o.k === 'move') {
            if (u.path.length > 0) u.moveStep(dt, 1);
            else this.advanceOrder(u);
            return;
        }
        if (o.k !== 'harvest') {
            o = { k: 'harvest', node: u.mineNode, phase: 'seek', timer: 0 };
            u.order = o;
        }
        const order = o as { k: 'harvest'; node: CrystalNode | null; phase: string; timer: number };

        switch (order.phase) {
            case 'seek': {
                let node = order.node;
                if (!node || node.amount <= 0) node = this.pickHarvestNode(u);
                order.node = node;
                u.mineNode = node;
                if (!node) { u.order = { k: 'idle' }; return; }
                const pth = this.findPath(u, node.x, node.y, TILE * 1.2);
                if (!pth) {
                    // No route: cool the field and look for another one. Falling
                    // back to "walk straight at it" is what used to drive trucks
                    // into the refinery wall over and over.
                    this.coolNode(node, 10);
                    order.node = null;
                    order.timer = 0.4;
                    u.order = { k: 'harvest', node: null, phase: 'seek', timer: 0.4 };
                    return;
                }
                u.path = pth;
                order.phase = 'toMine';
                order.timer = 0;
                break;
            }
            case 'toMine': {
                const node = order.node;
                if (!node || node.amount <= 0 || this.buildingAt(node.tx, node.ty)) { order.phase = 'seek'; return; }
                const d = dist(u.x, u.y, node.x, node.y);
                if (d < TILE * 1.35) {
                    order.phase = 'mining';
                    order.timer = u.def.mineTime || 3;
                    u.stop();
                    break;
                }
                if (u.path.length > 0) {
                    u.moveStep(dt, 1);
                    if (u.blockedNow) {
                        order.timer += dt;
                        /*
                         * Two trucks converging on one ore cell deadlock: the cell
                         * takes one vehicle, so each waits for the other and
                         * neither ever mines. After a moment, ask whoever is in
                         * the way to move, then give the field a rest and pick
                         * another one.
                         */
                        if (order.timer > 1.2) {
                            order.timer = 0;
                            const blocker = this.blockerAt(u) || this.nearestBlocker(u);
                            if (blocker && blocker.owner === u.owner && !blocker.isHarvester) {
                                this.requestAside(blocker, u);
                            } else if (blocker && blocker.isHarvester) {
                                // truck vs truck: one of them has to reverse
                                this.backOff(u);
                            } else {
                                this.coolNode(node, 5);
                                order.node = null;
                                order.phase = 'seek';
                            }
                        }
                    } else {
                        // decay instead of reset: two trucks wedged against each
                        // other flicker in and out of "blocked" every frame, and a
                        // hard reset meant the timeout never fired
                        order.timer = Math.max(0, order.timer - dt * 0.4);
                    }
                } else {
                    /*
                     * The path ran out before the truck was close enough.
                     *
                     * Re-path a couple of times before giving up on the field:
                     * the old code cooled the node the instant the path emptied,
                     * which on a busy ore field happened constantly (a second
                     * truck temporarily occupying the target cell is enough).
                     */
                    const again = this.findPath(u, node.x, node.y, TILE * 0.9);
                    if (again) {
                        u.path = again;
                        order.timer = 0;
                    } else {
                        order.timer += dt;
                        if (order.timer > 2.2) {
                            this.coolNode(node, 8);
                            order.node = null;
                            order.phase = 'seek';
                            order.timer = 0;
                        }
                    }
                }
                break;
            }
            case 'mining': {
                const node = order.node!;
                /*
                 * No refinery = no work.
                 *
                 * With the dropoff destroyed the truck used to keep mining: cargo
                 * hit its cap, the unload branch found no dropoff, the phase fell
                 * back to 'seek', and the loop ate the whole ore field without a
                 * single credit reaching the player (measured: income frozen at
                 * 6806 for 120s while two trucks sat on a field chewing it).
                 * The retail harvester simply waits until a refinery exists.
                 */
                const drop = this.nearestDropoff(p, u.x, u.y);
                if (!drop) {
                    u.order = { k: 'idle' };
                    u.stop();
                    return;
                }
                order.timer -= dt;
                const cargo = u.def.cargo || 500;
                const rate = cargo / Math.max(0.5, u.def.mineTime || 3);
                u.cargo = Math.min(cargo, u.cargo + rate * dt);
                if (node) {
                    node.amount -= rate * dt;
                    if (node.amount < 0) node.amount = 0;
                }
                if (order.timer <= 0 || u.cargo >= cargo || !node || node.amount <= 0) {
                    const pth = this.findDock(u, drop)
                        || this.findFor(u, drop.x, drop.y);
                    u.path = pth || [];
                    order.phase = 'toBase';
                    order.timer = 0;
                }
                break;
            }
            case 'toBase': {
                const drop = this.nearestDropoff(p, u.x, u.y);
                if (!drop) { order.phase = 'seek'; return; }
                const dd = dist(u.x, u.y, drop.x, drop.y);
                // "Beside the refinery" is what counts, not an exact point: the
                // retail dock is a set of cells around the foundation. A base can
                // also wall in its own refinery, in which case a truck parks as
                // close as it can and unloads there rather than shuttling ore
                // forever.
                if (this.atFootprint(u, drop) || dd < drop.radius + 34
                    || (u.path.length === 0 && dd < drop.radius + 74)) {
                    order.phase = 'unload';
                    order.timer = UNLOAD_TIME;
                    u.stop();
                    break;
                }
                if (u.path.length > 0) {
                    u.moveStep(dt, 1);
                    if (u.blockedNow) order.timer += dt;
                    if (order.timer > 1.2) {
                        /*
                         * Truck-vs-truck deadlock on the way home.
                         *
                         * Two trucks meeting in a one-cell corridor (refinery on
                         * one side, ore field on the other) both want the same
                         * middle cell. Re-pathing does not help — the corridor has
                         * exactly one lane — so the slower answer is the right one:
                         * back off a cell and let the other pass, exactly what the
                         * mining phase already does.
                         */
                        order.timer = 0;
                        const blocker = this.blockerAt(u) || this.nearestBlocker(u);
                        if (blocker && blocker.owner === u.owner && blocker.isHarvester) {
                            this.backOff(u);
                        } else {
                            const pth = this.findDock(u, drop);
                            if (pth) u.path = pth;
                        }
                    }
                } else {
                    const pth = this.findDock(u, drop)
                        || this.findFor(u, drop.x, drop.y);
                    if (pth && pth.length > 1) u.path = pth;
                    else order.phase = 'seek';
                }
                break;
            }
            case 'unload': {
                order.timer -= dt;
                if (order.timer <= 0) {
                    const gain = Math.floor(u.cargo);
                    p.credits = Math.min(MAX_CREDITS, p.credits + gain);
                    p.earned += gain;
                    u.cargo = 0;
                    order.phase = 'seek';
                    order.node = order.node && order.node.amount > 0 ? order.node : null;
                    if (p.isHuman) this.events.onSfx?.('unload');
                }
                break;
            }
        }
    }

    /* ------------------------------------------------------------ */
    /* combat                                                        */
    /* ------------------------------------------------------------ */
    /** can this weapon legally shoot at that target? */
    canShootAt(shooter: Unit | Building, w: { antiAir?: boolean; type?: DmgType }, e: Entity): boolean {
        if (e.dead || e.owner === shooter.owner) return false;
        if (e instanceof Unit) {
            if (e.isAir && !w.antiAir) return false;
            if (e.cloaked && !this.isDetected(shooter.owner, e)) return false;
        }
        /*
         * Do not waste shots on something the warhead cannot scratch.
         *
         * Reference: AttackTrait.checkArmor() — `100 * verse <= 1` means the
         * attacker never even acquires that target. Without it a rifle squad
         * happily emptied magazines into a concrete core and never reported that
         * it was useless, which read as "my units are broken".
         */
        if (w.type && !canHurt(w.type, e.armor)) return false;
        return true;
    }

    findTargetFor(shooter: Unit | Building, w: { range: number; antiAir?: boolean }, x: number, y: number, range: number): Entity | null {
        this.grid.query(x, y, range + 40, this.tmp);
        let best: Entity | null = null;
        let bestScore = Infinity;
        for (const e of this.tmp) {
            if (!this.canShootAt(shooter, w, e)) continue;
            const d = dist(x, y, e.x, e.y);
            const pad = e.isBuilding ? (e as Building).radius : e.armor === 'air' ? 10 : 8;
            if (d > range + pad) continue;
            let score = d;
            // AA weapons prioritise aircraft, ground weapons ignore them entirely
            if (w.antiAir && e instanceof Unit && e.isAir) score *= 0.65;
            if (score < bestScore) { bestScore = score; best = e; }
        }
        if (!best) {
            for (const b of this.buildings) {
                if (b.dead || b.owner === shooter.owner) continue;
                if (!this.canShootAt(shooter, w, b)) continue;
                const d = dist(x, y, b.x, b.y);
                if (d < range + b.radius) { best = b; break; }
            }
        }
        return best;
    }

    /** legacy helper kept for the AI */
    findTarget(x: number, y: number, range: number, owner: PlayerId, preferBuildings = false): Entity | null {
        return this.findTargetFor({ owner } as any, { range } as any, x, y, range);
    }

    fire(src: Unit | Building, w: UnitDef['weapon'], target: Entity) {
        if (!w) return;
        // ground weapons refuse aircraft, and cloaked targets need detection
        if (!this.canShootAt(src, w, target)) return;
        const isUnit = src instanceof Unit;
        const u = isUnit ? src as Unit : null;
        const phys = PROJ_PHYSICS[w.proj];

        // muzzle sits on the hull edge in the facing direction
        const face = u ? u.face : Math.atan2(target.y - src.y, target.x - src.x);
        const muzzle = u ? Math.max(7, u.radius * 0.9) : Math.min(26, (src as Building).radius * 0.45);
        const ox = src.x + Math.cos(face) * muzzle;
        const oy = src.y + Math.sin(face) * muzzle;
        // bombs fall from the aircraft; AA rounds start at the target's altitude
        const oz = w.proj === 'bomb' && u && u.isAir ? u.altitude : (target instanceof Unit && target.isAir ? target.altitude : 8);

        // lead the target: three fixed-point iterations are plenty for these speeds
        const speed = w.speed || phys.speed;
        let ax = target.x;
        let ay = target.y;
        if (target instanceof Unit && !target.isAir) {
            for (let i = 0; i < 3; i++) {
                const tt = dist(ox, oy, ax, ay) / Math.max(70, speed);
                ax = target.x + target.vx * tt;
                ay = target.y + target.vy * tt;
            }
        }
        const ballistic = w.ballistic ?? phys.ballistic;
        if (ballistic) {
            // lobbed rounds are not laser guided: a little scatter makes them
            // miss fast movers the way the classics do
            const scatter = w.proj === 'bomb' ? 9 : 15;
            ax += (Math.random() - 0.5) * scatter;
            ay += (Math.random() - 0.5) * scatter;
        }

        const pr = new Projectile({
            x: ox, y: oy, z: oz, kind: w.proj,
            owner: src.owner, dmg: w.dmg * (u ? u.damageMul : 1),
            dmgType: w.type, splash: w.splash, target,
            speed: w.speed, ballistic, homing: w.homing,
            falloff: w.falloff,
        });
        pr.source = u;
        if (ballistic) pr.launchArc(ax, ay, target instanceof Unit && target.isAir ? target.altitude : 0);
        else pr.launchStraight(ax, ay);
        this.projectiles.push(pr);

        this.pushFx(ox, oy, 'muzzle', 0.12, w.proj === 'bullet' ? 0.5 : 0.95);
        if (u) {
            u.cloakT = 0;
            u.recoil = w.proj === 'bullet' ? 0.06 : 0.18;
            // The turret swings onto the target (reference: AttackTask writes
            // turretTrait.desiredFacing). The hull does NOT snap around — only
            // turretless infantry pivot in place.
            const ang = Math.atan2(target.y - u.y, target.x - u.x);
            u.turretAim = ang;
            if (u.def.kind === 'infantry') u.face = ang;
            this.events.onSfx?.(w.proj === 'bullet' ? 'gun' : w.proj === 'shell' ? 'cannon' : 'rocket', ox, oy);
        } else {
            this.events.onSfx?.('cannon', ox, oy);
        }
    }

    private updateProjectiles(dt: number) {
        for (const pr of this.projectiles) {
            if (pr.dead) continue;
            if (pr.homing) pr.steer(dt);
            pr.step(dt);
            if (Math.abs(pr.x) > HALF + 90 || Math.abs(pr.y) > HALF + 90) {
                pr.dead = true;
                continue;
            }
            if (pr.dead) { this.impactAt(pr, pr.x, pr.y, null); continue; }

            // rocket / bomb exhaust
            if (pr.kind === 'rocket' || pr.kind === 'bomb') {
                pr.trailT -= dt;
                if (pr.trailT <= 0) {
                    pr.trailT = 0.05;
                    const smoke = new Fx(pr.x, pr.y, 'smoke', 0.55, 0.7);
                    smoke.z = Math.max(0, pr.z);
                    smoke.vz = 12;
                    this.fx.push(smoke);
                    this.events.onFx?.(smoke);
                }
            }

            // walls stop anything flying low enough
            const tx = Math.floor((pr.x + HALF) / TILE);
            const ty = Math.floor((pr.y + HALF) / TILE);
            const bAt = this.buildingAt(tx, ty);
            if (pr.z < 26 && (this.terrain.isSolid(tx, ty) || (bAt && bAt.owner !== pr.owner))) {
                this.impactAt(pr, pr.x, pr.y, bAt);
                continue;
            }

            const hit = this.sweepHit(pr);
            if (hit) {
                this.impactAt(pr, hit.x, hit.y, hit);
                continue;
            }

            if (pr.ballistic && pr.z <= 0) {
                this.impactAt(pr, pr.x, pr.y, null);
            }
        }
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
        }
    }

    /** first enemy whose body intersects the projectile's path this frame */
    private sweepHit(pr: Projectile): Entity | null {
        const dx = pr.x - pr.prevX;
        const dy = pr.y - pr.prevY;
        const r = Math.hypot(dx, dy) + pr.hitRadius + 40;
        this.grid.query(pr.x, pr.y, r, this.tmp);
        let best: Entity | null = null;
        let bestT = Infinity;
        for (const e of this.tmp) {
            if (e.dead || e.owner === pr.owner) continue;
            const eu = e as Unit;
            if (eu.isAir && pr.z < 12) continue;      // ground fire passes underneath
            if (!eu.isAir && pr.z > 46) continue;     // high arcs fly over infantry
            // ballistic rounds only collide on the way down
            if (pr.ballistic && pr.vz > 10 && e.isBuilding === false) continue;
            const hitR = pr.hitRadius + e.radius;
            const t = segmentCircleT(pr.prevX, pr.prevY, dx, dy, e.x, e.y, hitR);
            if (t < 0 || t > 1 || t >= bestT) continue;
            bestT = t;
            best = e;
        }
        return best;
    }

    /** apply damage + visuals at an impact point */
    private impactAt(pr: Projectile, x: number, y: number, hit: Entity | null) {
        pr.dead = true;
        const target = hit && !hit.dead ? hit : (pr.target && !pr.target.dead ? pr.target : null);
        const direct = target && dist(x, y, target.x, target.y) <= pr.hitRadius + target.radius + 8;

        if (direct && target) {
            this.damage(target, pr.dmg, pr.dmgType, pr.owner, pr.source);
        }

        if (pr.splash > 0) {
            const r = pr.splash;
            const falloff = pr.falloff;
            this.grid.query(x, y, r, this.tmp);
            for (const e of this.tmp) {
                if (e.dead || (direct && e.id === target!.id)) continue;
                const d = dist(x, y, e.x, e.y);
                if (d > r + e.radius * 0.5) continue;
                const k = 1 - (1 - falloff) * Math.min(1, d / r);
                this.damage(e, pr.dmg * k, pr.dmgType, pr.owner, pr.source);
            }
            for (const b of this.buildings) {
                if (b.dead || (direct && b.id === target!.id)) continue;
                const d = dist(x, y, b.x, b.y);
                if (d > r + b.radius * 0.55) continue;
                const k = 1 - (1 - falloff) * Math.min(1, d / r);
                this.damage(b, pr.dmg * k * 0.85, pr.dmgType, pr.owner, pr.source);
            }
            const scale = Math.min(2.6, 0.6 + r / 34);
            this.pushFx(x, y, 'boom', 0.55, scale);
            this.spawnDebris(x, y, Math.min(9, 3 + Math.floor(r / 18)), scale);
            this.addCrater(x, y, Math.min(42, r * 0.5));
            this.events.onSfx?.('boom', x, y);
            if (scale > 1.35) this.events.onShake?.(Math.min(9, scale * 2.4));
        } else {
            this.pushFx(x, y, 'spark', 0.22, 0.8);
            this.spawnDebris(x, y, 2, 0.5);
        }
    }

    private spawnDebris(x: number, y: number, count: number, scale: number) {
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 30 + Math.random() * 110 * scale;
            const f = new Fx(x, y, 'debris', 0.45 + Math.random() * 0.55, 0.5 + Math.random() * 0.7 * scale);
            f.vx = Math.cos(a) * sp;
            f.vy = Math.sin(a) * sp;
            f.vz = 50 + Math.random() * 130;
            f.g = 520;
            f.spin = (Math.random() - 0.5) * 12;
            this.fx.push(f);
            this.events.onFx?.(f);
        }
    }

    private addCrater(x: number, y: number, r: number) {
        this.decals.push(new Decal(x, y, r, 'crater', 45));
        if (this.decals.length > 64) this.decals.shift();
    }

    damage(target: Entity, amount: number, type: 'small' | 'ap' | 'explosive', owner: PlayerId, source: Unit | null = null, silent = false) {
        if (target.dead) return;
        if (target instanceof Unit) {
            if (target.invulnerable) {
                if (!silent) this.pushFx(target.x, target.y, 'shield', 0.26, 1);
                return;
            }
            amount *= target.armorMul;
            target.calm = 0;
            target.cloakT = Math.min(target.cloakT, 0.9);
        }
        const mult = verseMul(type, target.armor);
        target.hp -= amount * mult;
        target.lastHit = this.time;
        target.hitFlash = 0.12;
        if (target.hp <= 0) this.kill(target, owner, source);
    }

    kill(e: Entity, killer: PlayerId, source: Unit | null = null) {
        if (e.dead) return;
        e.dead = true;
        if (e instanceof Unit) this.occupancy.remove(e, e.cellX, e.cellY);
        e.hp = 0;
        this.players[e.owner].lost++;
        if (killer !== e.owner) this.players[killer].kills++;
        const big = e.isBuilding;
        if (big) {
            if (this.selectedBuilding === (e as Building)) this.selectedBuilding = null;
            this.ruins.push({
                x: e.x, y: e.y, size: (e as Building).size,
                seed: Math.floor(this.rng() * 100000),
            });
            if (this.ruins.length > 48) this.ruins.shift();
        }
        this.pushFx(e.x, e.y, 'boom', big ? 0.95 : 0.5, big ? (e as Building).size * 0.9 : 1.3);
        this.spawnDebris(e.x, e.y, big ? 12 : 5, big ? 1.8 : 1);
        if (big) this.addCrater(e.x, e.y, (e as Building).radius * 0.7);
        this.events.onSfx?.('boom', e.x, e.y);
        if (big) this.events.onShake?.(4);
        if (source && !source.dead && source.owner === killer) this.gainXp(source, e);
        this.events.onDeath?.(e);
    }

    private gainXp(u: Unit, target: Entity) {
        if (u.level >= VET_MAX_LEVEL) return;
        const base = Math.min(700, Math.max(20, target.cost));
        const amount = base * (target instanceof Unit ? 1 + target.level * 0.5 : 1);
        this.gainXpAmount(u, amount);
    }

    private gainXpAmount(u: Unit, amount: number) {
        if (u.level >= VET_MAX_LEVEL) return;
        u.xp += amount;
        const need = Math.max(80, u.def.cost * VET_XP_RATIO);
        while (u.level < VET_MAX_LEVEL && u.xp >= need) {
            u.xp -= need;
            u.level++;
            this.pushFx(u.x, u.y, 'promote', 0.8, 1.2);
            const p = this.players[u.owner];
            if (p.isHuman) {
                this.events.onMessage?.(`${u.def.name} 晋升${u.level >= 2 ? '精锐' : '老兵'}`, 'good');
                this.events.onSfx?.('promote');
            }
        }
    }

    pushFx(x: number, y: number, kind: Fx['kind'], life: number, scale: number) {
        const f = new Fx(x, y, kind, life, scale);
        this.fx.push(f);
        this.events.onFx?.(f);
    }

    private updateFx(dt: number) {
        for (const f of this.fx) f.step(dt);
        for (let i = this.fx.length - 1; i >= 0; i--) if (this.fx[i].dead) this.fx.splice(i, 1);
        for (const d of this.decals) d.step(dt);
        for (let i = this.decals.length - 1; i >= 0; i--) if (this.decals[i].dead) this.decals.splice(i, 1);
        // hard caps keep long matches from drowning the renderer
        while (this.fx.length > 240) {
            const old = this.fx.shift();
            if (old) old.dead = true;
        }
    }

    /**
     * Per-frame collision pass.
     *
     * The reference engine has **no positional resolution between units**: cell
     * reservation (TileOccupation) plus MoveTask's wait / move-aside / re-path
     * chain is the entire mechanism. We used to split overlaps and push both
     * bodies apart, which is what let a walking soldier shovel a standing one
     * across the map, and what let two enemies slide through each other because
     * the shove was capped per frame.
     *
     * What is left here is only what the simulation genuinely needs:
     *   - get a hull out of solid ground it somehow ended up inside,
     *   - spread infantry that share a cell onto their sub-positions,
     *   - re-register units on the occupancy table (which also runs crush),
     *   - drive the blocked-unit chain (aside / re-route / give up).
     */
    private resolveCollisions(dt: number) {
        for (const u of this.units) {
            if (u.dead) continue;
            // a unit with no path has stopped driving: bleed off the residual
            // speed, otherwise it keeps reporting "moving" forever (which used
            // to suppress the sub-cell spread and the idle animations)
            if (u.path.length === 0 && u.speedCur > 0) {
                u.speedCur = Math.max(0, u.speedCur - u.accel * 5 * dt);
            }
            if (!u.isAir) this.resolveWorldCollision(u, dt);
            u.x = clamp(u.x, -HALF + 12, HALF - 12);
            u.y = clamp(u.y, -HALF + 12, HALF - 12);
            this.syncCell(u);
        }
        this.spreadInfantry(dt);
        this.separateHulls(dt);
        this.handleBlocked(dt);
    }

    /**
     * Push apart two hulls that already share a tile.
     *
     * The movement rule only ever *refuses* a step that would close the gap; it
     * has no way to undo an overlap that already exists. Two tanks can end up
     * inside each other's stand-off ring through a spawn, a relocation, or a
     * follower entering a leader's tile just before the leader stopped — and once
     * that happens the pair is welded: every step either hull wants to take is
     * vetoed by the other, which is the pile-up in the screenshot (two selection
     * rings on one tile, neither moving).
     *
     * A tiny symmetric shove, clamped by the terrain test and capped per frame,
     * lets them come apart without any of the old "one unit shoves another" mass
     * behaviour.
     */
    private separateHulls(dt: number) {
        for (const a of this.units) {
            if (a.dead || a.isAir || a.def.kind === 'infantry') continue;
            this.grid.query(a.x, a.y, a.radius + 30, this.tmp);
            for (const e of this.tmp) {
                const b = e as Unit;
                if (b === a || b.dead || b.isAir || !b.def || b.def.kind === 'infantry') continue;
                if (b.id < a.id) continue;                 // handle each pair once
                /*
                 * Only separate hulls that are BOTH standing still.
                 *
                 * A mover approaching a parked friend generates exactly the
                 * overlap this pass is meant to undo, and pushing the parked one
                 * out of the way turns separation into the old "a tank shoves
                 * another tank down the road" behaviour — measured 147 px of
                 * displacement, straight onto the mover's destination tile, which
                 * is why the mover then parked 1.5 tiles short. Movement is
                 * already prevented from creating new overlaps by
                 * `stepBlockedByUnit`; this pass only repairs a pair that is
                 * already welded together and going nowhere.
                 */
                if (a.speedCur > 4 || b.speedCur > 4) continue;
                const share = a.isHarvester && b.isHarvester ? 0.46 : 0.92;
                /*
                 * Separate to a full tile, not just to the stand-off ring.
                 *
                 * `minD` is only the "do the sprites intersect" distance (~24 px).
                 * Two hulls resting exactly at `minD` are still inside the same
                 * 32 px tile — which is what the screenshot shows: two selection
                 * rings on one tile. Pushing to a full tile guarantees they
                 * register on different cells, so neither one's next step is
                 * vetoed by the other's presence in its own cell.
                 */
                const minD = Math.max((a.radius + b.radius) * share, TILE * 1.12);
                let dx = b.x - a.x, dy = b.y - a.y;
                let d = Math.hypot(dx, dy);
                if (d >= minD - 0.4) continue;
                if (d < 0.01) {
                    // exactly concentric: split along the hull's flank
                    dx = Math.cos(a.face + Math.PI / 2);
                    dy = Math.sin(a.face + Math.PI / 2);
                    d = 1;
                }
                const push = Math.min((minD - d) * 0.5, 40 * dt);
                const nx = dx / d, ny = dy / d;
                const ax = a.x - nx * push, ay = a.y - ny * push;
                if (!this.worldBlockedAt(ax, ay, a.steerRadius)) { a.x = ax; a.y = ay; }
                const bx = b.x + nx * push, by = b.y + ny * push;
                if (!this.worldBlockedAt(bx, by, b.steerRadius)) { b.x = bx; b.y = by; }
            }
        }
    }

    /**
     * Infantry sharing a cell stand on separate sub-positions (0..2).
     * Bounded to a few pixels and clamped inside the cell, so this can never
     * turn into the old "push" — it is a visual tidy-up, not a collision solver.
    /**
     * Infantry sharing a cell stand on distinct sub-positions.
     *
     * Reference: `ObjectPosition.computeSubCellOffset()` — sub-cell `n` is
     * `± TILE/4` from the cell centre on each axis (`(0,0)`, `(-8,-8)`,
     * `(+8,-8)`, `(-8,+8)`, `(+8,+8)`), and `MoveTask.canStopAtTile` allows at
     * most three infantry on one tile, each on a different sub-cell.
     *
     * We used to nudge neighbours apart until they were 11px away from each
     * other, which is *closer* than the retail layout and made a squad read as
     * one blob (the "兵和兵叠在一起" report). Driving each man to his own fixed
     * sub-cell point gives the retail spacing (16px diagonal) and stops the
     * pairwise jitter, because every unit now has a stable target instead of a
     * reaction to its neighbours.
     */
    private spreadInfantry(dt: number) {
        const T = TILE;
        const q = T * 0.25;             // reference: LEPTONS_PER_TILE / 4
        for (const a of this.units) {
            if (a.dead || a.speedCur > 4) continue;
            const here = this.occupancy.at(a.cellX, a.cellY);
            if (!here || here.size < 2) continue;

            if (a.def.kind === 'infantry') {
                const sc = a.subCell;
                const ox = sc ? (((sc - 1) % 2) * 2 - 1) * q : 0;
                const oy = sc ? (2 * Math.floor((sc - 1) / 2) - 1) * q : 0;
                this.driftTo(a, ox, oy, 26 * dt);
                continue;
            }

            /*
             * Two vehicles can share a cell (harvesters at the dock need it, and
             * a cell holds two of them by design). Standing on the exact same
             * pixel makes them read as one broken sprite, so they get a small
             * fixed offset pair — the vehicle equivalent of infantry sub-cells.
             * Kept well inside the cell so neither can be pushed out of it.
             */
            const mates: Unit[] = [];
            for (const o of here) if (!o.dead && o.def.kind !== 'infantry') mates.push(o);
            if (mates.length < 2) continue;
            mates.sort((x, y) => x.id - y.id);
            const idx = mates.indexOf(a);
            if (idx < 0) continue;
            const off = T * 0.22;
            this.driftTo(a, idx === 0 ? -off : off, idx === 0 ? -off : off, 22 * dt);
        }
    }

    /** ease a unit toward cell centre + (ox, oy) without ever leaving the cell */
    private driftTo(u: Unit, ox: number, oy: number, maxStep: number) {
        const T = TILE;
        const tx = u.cellX * T + T / 2 - HALF + ox;
        const ty = u.cellY * T + T / 2 - HALF + oy;
        const dx = tx - u.x, dy = ty - u.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.4) return;
        const step = Math.min(d, maxStep);
        const x0 = u.cellX * T - HALF + 1, x1 = x0 + T - 2;
        const y0 = u.cellY * T - HALF + 1, y1 = y0 + T - 2;
        u.x = clamp(u.x + (dx / d) * step, x0, x1);
        u.y = clamp(u.y + (dy / d) * step, y0, y1);
    }

    /**
     * Blocked-unit chain, mirroring MoveTask.onTick's obstacle branch.
     *
     *   0.18s  ask a friendly bystander to step aside (MoveAsideTask)
     *   0.55s  re-route around the blocker (blockedPathNodes)
     *   twice  widen: aim at the nearest reachable cell to the goal
     *   then   MoveResult.Fail — stop asking, hold position
     */
    private handleBlocked(dt: number) {
        for (const u of this.units) {
            if (u.dead) continue;
            if (u.repathHold > 0) u.repathHold -= dt;
            if (u.asideT > 0) u.asideT -= dt;

            /*
             * Watchdog: a live move order with an empty path must never stall
             * silently.
             *
             * This was the shape of the "there is obviously a road" report: the
             * relocation helper picked a free cell the unit could not reach, the
             * path came back empty, and `handleBlocked` skipped every unit whose
             * path was empty — so the unit stood there for the rest of the match
             * with a `move` order and no failure message. Nothing in the old
             * chain could recover from it. A stall is now retried once and then
             * ends the order, which at least tells the player.
             */
            const wantsMove = u.order.k === 'move' || u.order.k === 'attackmove';
            if (!u.isAir && u.path.length === 0 && wantsMove) {
                const goal = this.orderGoal(u);
                const dg = goal ? Math.hypot(goal.x - u.x, goal.y - u.y) : 0;
                /*
                 * CloseEnough is a success, not a stall.
                 *
                 * `moveStep` empties the path when the destination tile is full
                 * and the unit is within 1.5 tiles of it — that is the retail
                 * CloseEnough bail-out. The watchdog used to treat any empty path
                 * more than 18 px from the goal as a stall: it re-planned from a
                 * tile that was one step from the destination, the unit twitched
                 * toward it, hit the same full tile, and repeated for 2.4 s before
                 * cancelling. That twitch is the "units keep shuffling after they
                 * arrive" report, and it also poisoned pathsim with fake stalls.
                 * Only a unit that is genuinely far from its goal needs rescuing.
                 */
                if (dg > TILE * 1.8) {
                    const prev = u.stallT;
                    u.stallT += dt;
                    if (prev < 0.6 && u.stallT >= 0.6) {
                        if (!this.relocateTo(u, goal!.x, goal!.y) ) u.stallT = 2.4;
                    } else if (u.stallT >= 2.4) {
                        u.stallT = 0;
                        this.giveUpOrder(u, 'blocked');
                    }
                } else {
                    /*
                     * Empty path, still holding a move order, already close.
                     *
                     * Every branch of `handleBlocked` below skips units with an
                     * empty path, so this state had no exit: the hull stood there
                     * for the rest of the match with `order = 'move'` and nothing
                     * moving it. It is a finished order whatever the exact
                     * distance — the path ran out within two tiles of the goal,
                     * which is exactly the CloseEnough bail-out.
                     */
                    u.stop();
                    u.stallT = 0;
                    u.blockT = 0;
                    u.waitT = 0;
                    if (u.order.k === 'move' || u.order.k === 'attackmove') u.order = { k: 'idle' };
                    continue;
                }
            } else {
                u.stallT = 0;
            }

            /*
             * Harvesters are driven by their own state machine (ore cooldown,
             * alternative dock cells, back-off). Running the generic chain on
             * top of it fought with those decisions, so they are exempt here —
             * their blockers are handled where the phase timers live.
             */
            if (u.order.k === 'harvest') { u.blockT = 0; u.trafficT = 0; continue; }

            /*
             * CloseEnough: near the goal and down to the last leg.
             *
             * This is the single biggest cause of "the hull keeps swinging while
             * it drives". A unit that has almost arrived, whose last waypoint is
             * occupied by a friend, used to go round the whole blocked-unit
             * chain: wait 0.35 s, re-plan a detour, drive 20 px the new way,
             * get blocked again, re-plan again — measured as a hull changing
             * heading by 90-140 degrees three times in four seconds, which the
             * player reads as the body wobbling. Retail checks
             * `isCloseEnoughToDest` before it ever considers a detour and simply
             * parks; a crowd around a destination is normal, not an obstruction.
             */
            if (u.path.length <= 1) {
                const g0 = this.orderGoal(u);
                const gtx = g0 ? Math.floor((g0.x + HALF) / TILE) : -1;
                const gty = g0 ? Math.floor((g0.y + HALF) / TILE) : -1;
                /*
                 * CloseEnough only when the destination tile is genuinely full.
                 *
                 * Parking merely because the unit is "close" stops it 2.5 tiles
                 * short of an empty destination — movetest caught exactly that
                 * (`距目标 78.4px`). The distance test is a guard against
                 * shuffling around a crowd; it is not a licence to give up on an
                 * empty tile.
                 */
                const destFull = g0 ? !this.occupancy.hasRoomFor(u, gtx, gty) : false;
                /*
                 * Already relocated and standing on (or beside) that spot: the
                 * order is done. Retail's move task ends on reaching the
                 * relocation tile; searching again would pick a different tile and
                 * swing the hull at it.
                 */
                if (g0 && !Number.isNaN(u.parkX)
                    && Math.hypot(u.x - u.parkX, u.y - u.parkY) < TILE * 1.4) {
                    u.stop();
                    u.blockT = 0;
                    u.waitT = 0;
                    if (u.order.k === 'move' || u.order.k === 'attackmove') u.order = { k: 'idle' };
                    continue;
                }
                if (g0 && destFull && Math.hypot(g0.x - u.x, g0.y - u.y) < TILE * 2.5) {
                    /*
                     * Prefer a nearer free tile over parking here.
                     *
                     * CloseEnough is the last resort, not the first: a unit 1.5
                     * tiles out that finds its destination occupied should take the
                     * free tile next door (32 px away) rather than stop where it
                     * stands (measured 49.8 px short in movetest). Only when
                     * relocation has already been tried do we accept the current
                     * spot.
                     */
                    if (Number.isNaN(u.parkX) && this.parkNear(u, g0.x, g0.y, 5)) {
                        u.parkTry++;
                        u.blockT = 0;
                        continue;
                    }
                    u.stop();
                    u.blockT = 0;
                    u.waitT = 0;
                    if (u.order.k === 'move' || u.order.k === 'attackmove') u.order = { k: 'idle' };
                    continue;
                }
                /*
                 * Last leg and the destination is taken: relocate once
                 * (findRelocationTile). It has to run *now*, not after the
                 * ten-round give-up chain — a tank three tiles from the click with
                 * `path.length === 1` is not blocked by traffic, it simply has
                 * nowhere to stand. Waiting eight seconds first left four of six
                 * tanks milling around the destination for the rest of the match.
                 */
                if (g0 && destFull && Number.isNaN(u.parkX) && this.parkNear(u, g0.x, g0.y, 5)) {
                    u.parkTry++;
                    u.blockT = 0;
                    continue;
                }
                /*
                 * We already relocated and are not there yet: keep driving to the
                 * spot. If it stays unreachable, `failMove` parks the unit after
                 * the wait budget instead of cancelling here — cancelling on the
                 * first blocked frame is what turned a crowd into nine dead tanks.
                 */
            }

            if (u.isAir || u.path.length === 0 || u.waitT > 0) {
                u.trafficT = 0;
                u.blockT = 0;
                u.progT = 0;
                u.progX = u.x;
                u.progY = u.y;
                continue;
            }

            /*
             * Stuck is "this tick produced no progress", sampled continuously.
             *
             * Reference: MoveTask only advances `inPlanningForTicks` while the
             * unit sits in MoveState.PlanMove — i.e. while it cannot drive at
             * all. A unit that is merely accelerating, turning or crawling
             * across ore is NOT planning, and the counter does not move.
             *
             * The old code added dt every frame regardless, so a tank that was
             * still spinning up from standstill collected 0.3s of "blocked" in
             * the first quarter second, burned all four re-path attempts and
             * cancelled its own order — on an empty desert, one second after
             * being told to move. That is the single biggest source of the
             * "cannot reach a target that is plainly reachable" reports.
             *
             * A hard reset on the first moving tick would reintroduce the
             * flicker problem (a wedged hull gains a pixel, resets, wedges
             * again), so the timer decays instead of snapping to zero.
             */
            if (!u.blockedNow) {
                u.blockT = Math.max(0, u.blockT - dt * 3);
                u.trafficT = Math.max(0, u.trafficT - dt);
                u.progT = 0;
                continue;
            }

            const ahead = this.blockerAt(u) || this.nearestBlocker(u);
            /*
             * Traffic, not a wall: if the thing in front is driving off, the
             * correct response is patience (reference: MoveTask `break`s out of
             * the obstacle loop the moment the blocker has velocity — it does not
             * start a timer and re-plan after 2.6 s).
             *
             * The old 2.6 s cap was a re-plan generator: in a column of tanks the
             * leader is *always* moving, so every follower re-planned its route
             * every three seconds, and every re-plan pointed the nose somewhere
             * new. That is the hull "swinging" the player still sees: measured 5
             * heading changes and 9 sprite swaps on one tank in 45 s, all of them
             * caused by detours around a friend who was already leaving.
             *
             * Eight seconds is the safety valve for a genuine deadlock (a ring of
             * tanks all waiting on each other), not a normal-traffic timer.
             */
            if (ahead && ahead.speedCur > 6 && ahead.path.length > 0 && u.trafficT < 8) {
                u.trafficT += dt;
                u.blockT = Math.max(0, u.blockT - dt * 2);
                continue;
            }

            u.blockT += dt;
            /*
             * Wait before touching the route.
             *
             * Reference: WaitTicksTask(40) is 2.7 s at 15 tps before a blocked
             * unit even looks for an alternative. 0.35 s meant a column of tanks
             * re-planned each other's routes four times a second — every re-plan
             * pointed the nose somewhere new, which is the other half of the
             * "body keeps swinging" report. One second is a compromise between
             * retail patience and how long a mobile player will wait.
             */
            if (u.blockT < 1.0) continue;

            if (this.moveDebug) {
                this.moveLog.push({
                    t: +this.time.toFixed(1), id: u.id, phase: (u.order as any).phase,
                    cell: [u.cellX, u.cellY], want: [u.blockTx, u.blockTy],
                    blocker: ahead ? { id: ahead.id, cell: [ahead.cellX, ahead.cellY], kind: ahead.def.kind } : null,
                    rt: u.repathTry, path: u.path.length,
                });
                if (this.moveLog.length > 60) this.moveLog.shift();
            }

            /*
             * Order of remedies, same as MoveTask's obstacle branch:
             *
             *   1. re-plan a short path to the nearest waypoint that is actually
             *      free (retail: freeWaypointIndex + computePath with 15 nodes)
             *   2. swap sub-cells (infantry vs infantry)
             *   3. push a completely idle friend aside (MoveAsideTask)
             *   4. wait (WaitTicksTask) — being queued behind friends is not a
             *      failure, and it must not cancel the order
             *
             * Pushing used to come before re-routing, so a column of tanks spent
             * its time shoving each other instead of driving around the jam.
             */
            // 1. local detour
            if (this.repathAround(u, ahead)) {
                u.blockT = 0;
                u.repathTry++;
                continue;
            }
            // 2. infantrymen trade sub-positions instead of standing off
            if (ahead && u.def.kind === 'infantry' && ahead.def.kind === 'infantry'
                && u.asideT <= 0 && this.sidestepInfantry(u, ahead)) {
                u.asideT = 1.2;
                u.blockT = 0;
                continue;
            }
            // 3. a standing friendly is asked to step out of the lane
            if (ahead && ahead.owner === u.owner && u.asideT <= 0 && this.requestAside(ahead, u)) {
                u.asideT = 1.2;
                u.blockT = 0;
                u.repathTry++;
                continue;
            }

            u.blockT = 0;
            u.repathTry++;
            /*
             * 4. wait.
             *
             * Reference: WaitTicksTask(40) ≈ 2.7 s at 15 tps, and the planning
             * counter only bails after MAX_PLANNING_TICKS (200 ≈ 13 s) — or after
             * five unreachable targets in a row. Our chain used to run out after
             * four attempts (about two seconds) and cancel the order, which is
             * why a ten-tank group lost five of its ten orders on open ground.
             */
            if (u.repathTry <= 6) {
                u.waitT = 0.45;
                continue;
            }
            // 5. MoveResult.Fail: park on the nearest tile that is free
            this.failMove(u);
        }
    }

    /** nearest unit physically in front of this one, when the cell lookup misses */
    private nearestBlocker(u: Unit): Unit | null {
        const ux = Math.cos(u.face), uy = Math.sin(u.face);
        this.grid.query(u.x, u.y, u.radius + 34, this.tmp);
        let best: Unit | null = null;
        let bestD = Infinity;
        for (const e of this.tmp) {
            const o = e as Unit;
            if (o === u || o.dead || !o.def || o.isAir) continue;
            const dx = o.x - u.x, dy = o.y - u.y;
            const d = Math.hypot(dx, dy);
            // close enough to actually be touching, and roughly ahead
            if (d < 0.001 || d > u.radius + o.radius + 3) continue;
            if ((dx * ux + dy * uy) / d < 0.15) continue;   // behind us
            if (d < bestD) { bestD = d; best = o; }
        }
        return best;
    }

    /**
     * Can `u` step to (x, y) as far as other units are concerned?
     *
     * Two rules, both from the reference:
     *   1. cell capacity — one vehicle, or three infantry on distinct sub-cells
     *      (TileOccupation / MoveTask.canStopAtTile);
     *   2. no interpenetration — a step that brings two hulls closer than their
     *      combined radius is refused if it is closing an already-touching pair.
     *      Cell occupancy alone lets two tanks sit 1px apart either side of a
     *      cell border, which reads as driving through each other.
     *
     * Rule 2 only refuses steps that make the overlap worse, so a unit that
     * somehow starts overlapped can always drive out of it.
     */
    private stepBlockedByUnit(u: Unit, x: number, y: number): boolean {
        const tx = Math.floor((x + HALF) / TILE);
        const ty = Math.floor((y + HALF) / TILE);
        /*
         * Traffic is not a wall.
         *
         * Reference: MoveTask's obstacle loop only treats a unit as an obstacle
         * when it is *stationary* (`blocker.moveTrait.moveState === Idle`), a
         * building, or mid-collision; when the blocker still has velocity the
         * loop `break`s and the unit keeps driving. That rule is what lets a
         * column of tanks follow each other — and its absence is why a tank
         * column used to lock up: our capacity test rejected the leader's cell
         * even while the leader was driving out of it, so every follower queued
         * behind a moving tank forever, ran out of re-path attempts and cancelled
         * its order ("cannot reach" on an empty plane).
         */
        const set = this.occupancy.at(tx, ty);
        let vacating = false;
        if (set && set.size > 0) {
            /*
             * `sameLane` must start false: a cell that only contains US is not a
             * "lane being vacated", it is just our own cell, and returning early
             * there skipped the hull stand-off test entirely — which is how two
             * tanks driving head-on were allowed to walk right through each other
             * (measured 1.3px apart) even with the rule in place.
             */
            let sameLane = false;
            let others = 0;
            for (const o of set) {
                if (o === u || o.dead) continue;
                others++;
                /*
                 * "Going the same way **and about to leave this tile**".
                 *
                 * Reference: MoveTask breaks out of the obstacle loop for a
                 * blocker with velocity unless
                 * `blocker.moveTrait.currentWaypoint?.tile === node.tile` — i.e.
                 * it only trusts the tile to clear if the blocker's next waypoint
                 * is somewhere else. Our version dropped that second half, so a
                 * leader that was merely rolling to a stop *inside* the tile still
                 * counted as "vacating", the follower moved in, and when the
                 * leader halted the two hulls sat in one cell 25 px apart, each
                 * one's next step vetoed by the other. That is the pile-up in the
                 * screenshot: two selection rings on one tile, neither moving.
                 */
                const sameDir = Math.cos(o.face - u.face) > 0.55;
                const oNext = o.path.length > 0 ? o.path[0] : null;
                const leaving = !!oNext
                    && (Math.floor((oNext.x + HALF) / TILE) !== tx || Math.floor((oNext.y + HALF) / TILE) !== ty);
                if (!(o.speedCur > 6 && o.path.length > 0 && sameDir && leaving)) { sameLane = false; break; }
                sameLane = true;
            }
            /*
             * A vacating cell is exempt from the *capacity* test only.
             *
             * This used to `return false` outright, which also skipped the hull
             * stand-off test below — the capacity rule only ever meant "one hull
             * per tile", and a column needs the leader's tile to be reusable
             * while the leader is still driving out of it. Skipping the radius
             * check as well is what let a group of tanks ordered to one point
             * overlap each other on the way there.
             */
            vacating = others > 0 && sameLane;
        }
        if (!vacating && !this.occupancy.hasRoomFor(u, tx, ty)) return true;

        this.grid.query(x, y, u.radius + 42, this.tmp);
        for (const e of this.tmp) {
            const o = e as Unit;
            if (o === u || o.dead || !o.def || o.isAir) continue;
            /*
             * Crushers ignore hostile infantry entirely — that is how a tank
             * drives onto a cell and flattens whoever is standing there
             * (MoveTask: `obstacle.obj.rules.crushable` + unit.crusher =>
             * continue). Without this the tank is politely stopped by the man it
             * is supposed to run over.
             */
            if (u.canCrush && o.owner !== u.owner && o.def.kind === 'infantry') continue;
            /*
             * Interpenetration only matters between two hulls.
             *
             * Infantry are handled by cell capacity + sub-positions: a vehicle is
             * allowed to drive onto a cell that holds infantry (it scatters or
             * crushes them), and infantry are stopped by the vehicle's cell rather
             * than by a radius. Applying a radius test here made a lone rifleman
             * standing beside a parked truck wedge it permanently.
             */
            if (u.def.kind === 'infantry' || o.def.kind === 'infantry') continue;
            const share = u.isHarvester && o.isHarvester ? 0.46 : 0.92;
            const minD = (u.radius + o.radius) * share;
            const dNew = Math.hypot(o.x - x, o.y - y);
            if (dNew >= minD) continue;
            const dCur = Math.hypot(o.x - u.x, o.y - u.y);
            /*
             * Inside the stand-off ring: only a step that genuinely opens the gap
             * is allowed.
             *
             * The tolerance used to be +1.0 px, which meant two hulls already
             * closer than the ring could not separate either — a step that opened
             * the gap by 0.4 px was refused, the axis-slide fallback produced
             * exactly such a step, and the pair stayed welded together for the
             * rest of the match. 0.05 px still refuses any step that closes or
             * holds the distance (including the sideways shuffle that let a
             * head-on pair walk through each other) while letting a wedged pair
             * drive apart.
             */
            if (dNew < dCur + 0.05) return true;
        }
        return false;
    }

    /**
     * Reverse one cell out of a deadlock.
     *
     * Two trucks that want the same ore cell lock nose to nose: neither can
     * enter, neither will give up, and the timer just re-picks the same field.
     * Backing off is what a driver does, and it breaks the symmetry immediately.
     */
    private backOff(u: Unit): boolean {
        const bx = u.x - Math.cos(u.face) * TILE * 1.25;
        const by = u.y - Math.sin(u.face) * TILE * 1.25;
        const tx = Math.floor((bx + HALF) / TILE);
        const ty = Math.floor((by + HALF) / TILE);
        if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return false;
        if (this.isBlocked(tx, ty) || !this.occupancy.hasRoomFor(u, tx, ty)) return false;
        if (this.worldBlockedAt(bx, by, u.steerRadius)) return false;
        u.path = [{ x: bx, y: by }];
        u.asideT = 1.4;
        return true;
    }

    /** hop sideways around another infantryman (reference: relocateToSubCell) */
    private sidestepInfantry(u: Unit, blocker: Unit): boolean {
        const ang = Math.atan2(u.y - blocker.y, u.x - blocker.x) || 0;
        const hop = (u.radius + blocker.radius) * 0.75;
        for (const s of [1, -1]) {
            const a = ang + (s * Math.PI) / 2;
            const px = u.x + Math.cos(a) * hop;
            const py = u.y + Math.sin(a) * hop;
            if (!u.canStepTo(px, py)) continue;
            u.path.unshift({ x: px, y: py });
            u.asideT = 0.55;
            return true;
        }
        return false;
    }

    /** closest unit occupying the cell this one is trying to enter */
    private blockerAt(u: Unit): Unit | null {
        let tx = u.blockTx, ty = u.blockTy;
        // The hint is only written when a step is refused; after the unit moves on
        // it can be several cells out of date. Recompute from the current facing.
        if (tx < 0 || ty < 0 || Math.abs(tx - u.cellX) > 2 || Math.abs(ty - u.cellY) > 2) {
            const look = Math.min(20, u.radius + 6);
            tx = Math.floor((u.x + Math.cos(u.face) * look + HALF) / TILE);
            ty = Math.floor((u.y + Math.sin(u.face) * look + HALF) / TILE);
            u.blockTx = tx;
            u.blockTy = ty;
        }
        const set = this.occupancy.at(tx, ty);
        if (!set || set.size === 0) return null;
        let best: Unit | null = null;
        let bestD = Infinity;
        for (const o of set) {
            if (o === u || o.dead || o.isAir) continue;
            const d = Math.hypot(o.x - u.x, o.y - u.y);
            if (d < bestD) { bestD = d; best = o; }
        }
        return best;
    }

    /**
     * Ask a standing friendly unit to step out of the way.
     * Reference: MoveTask pushes `MoveAsideTask(game, pushDirection)` onto the
     * blocker's order queue once, then waits a tick. It never edits coordinates.
     */
    private requestAside(blocker: Unit, by: Unit): boolean {
        if (blocker.asideT > 0 || blocker.dead || blocker.isAir) return false;
        if (blocker.order.k !== 'idle' || blocker.path.length > 0) return false;
        if (blocker.speedCur > 6) return false;

        const dx = by.x - blocker.x, dy = by.y - blocker.y;
        const d = Math.hypot(dx, dy) || 1;
        const fx = dx / d, fy = dy / d;              // towards the caller
        /*
         * Try every sidestep, not just the two perpendicular ones.
         *
         * Reference: MoveAsideTask walks the blocker toward the push direction
         * and keeps looking while the tile is taken. Two candidates meant a
         * blocker wedged against a wall (or against a third tank) simply refused,
         * the caller fell through to "give up", and the player saw two friendlies
         * deadlocked. Eight headings at two distances, caller-side first, gives
         * the blocker somewhere to go in every case that has anywhere to go.
         */
        const dirs: Array<{ x: number; y: number }> = [
            { x: -fy, y: fx }, { x: fy, y: -fx },
            /*
             * Sideways only — never straight ahead.
             *
             * The list used to include `{-fx,-fy}`, i.e. "move away from the
             * caller along the caller's own approach line". That looks harmless
             * for one step, but `requestAside` fires again as soon as the caller
             * catches up, so the bystander is nudged another tile ahead, and
             * another: measured 147 px of travel that ended exactly on the
             * caller's destination tile. The caller then has nowhere to go and
             * parks 1.5 tiles short. Diagonal candidates keep the sidestep
             * sideways while still working for a hull wedged against a wall.
             */
            { x: (-fx - fy) * 0.7071, y: (-fy + fx) * 0.7071 },
            { x: (-fx + fy) * 0.7071, y: (-fy - fx) * 0.7071 },
        ];
        for (const reach of [TILE * 1.15, TILE * 2.0]) {
            for (const dir of dirs) {
                const c = { x: blocker.x + dir.x * reach, y: blocker.y + dir.y * reach };
                const tx = Math.floor((c.x + HALF) / TILE);
                const ty = Math.floor((c.y + HALF) / TILE);
                if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) continue;
                if (this.isBlocked(tx, ty)) continue;
                if (!this.occupancy.hasRoomFor(blocker, tx, ty)) continue;
                if (this.worldBlockedAt(c.x, c.y, blocker.steerRadius)) continue;
                const path = this.findFor(blocker, c.x, c.y);
                if (!path || path.length === 0) continue;
                blocker.asideT = 1.4;
                blocker.order = { k: 'move', x: c.x, y: c.y };
                blocker.path = path;
                blocker.repath = 0;
                blocker.repathTry = 0;
                blocker.waitT = 0;
                return true;
            }
        }
        return false;
    }

    /**
     * Re-plan to the nearest *free* waypoint on the remaining path.
     *
     * Reference: MoveTask finds `freeWaypointIndex` (the last obstacle-free
     * waypoint before the blocker) and calls `computePath` to exactly that tile
     * with `maxExpandedNodes: 15` and the blocked tiles excluded. Two things
     * matter and both were missing here:
     *
     *   - the anchor is a waypoint on our own route, not the final destination,
     *     so the query is short and succeeds even when the destination is full
     *     of tanks;
     *   - the detour replaces the path instead of being rejected as "no route",
     *     which is what turned a traffic jam into a cancelled order.
     *
     * Returns false when even the near waypoints are unreachable, in which case
     * the caller waits or pushes instead of failing.
     */
    private repathAround(u: Unit, blocker: Unit | null): boolean {
        if (u.path.length < 2) return false;
        const avoid = new Set<number>();
        if (blocker) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const tx = blocker.cellX + dx, ty = blocker.cellY + dy;
                    if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) continue;
                    /*
                     * Never exclude the cells around our own position: the unit
                     * has to be able to leave the cell it is standing in. Doing so
                     * made A* fail immediately, the truck kept its old path, and
                     * two trucks facing each other deadlocked for the whole match.
                     */
                    if (Math.abs(tx - u.cellX) <= 1 && Math.abs(ty - u.cellY) <= 1) continue;
                    avoid.add(ty * MAP_TILES + tx);
                }
            }
        }
        this.finder.avoid = avoid;
        try {
            /*
             * Walk backwards from the destination: the far anchor gives the
             * widest detour, so it is the most likely to succeed when a crowd is
             * bunched up near the front of the column.
             */
            for (let i = u.path.length - 1; i >= 1; i--) {
                const node = u.path[i];
                const tx = Math.floor((node.x + HALF) / TILE);
                const ty = Math.floor((node.y + HALF) / TILE);
                if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) continue;
                if (this.isBlocked(tx, ty)) continue;
                // a full tile is useless as an anchor; somebody will block it again
                if (!this.occupancy.hasRoomFor(u, tx, ty)) continue;
                const p = this.findFor(u, node.x, node.y);
                if (p && p.length > 1) {
                    /*
                     * Refuse a detour that points the hull somewhere completely
                     * different from where it was already going.
                     *
                     * A* is free to come back with a route that leaves in the
                     * opposite direction, and the hull has to physically turn
                     * around to follow it — 140 degrees, four times a second,
                     * while the column shuffles. If the first leg of the detour
                     * is more than ~50 degrees off the first leg of the current
                     * path, this anchor is not a useful detour; try the next one.
                     */
                    const a0 = Math.atan2(u.path[0].y - u.y, u.path[0].x - u.x);
                    const a1 = Math.atan2(p[0].y - u.y, p[0].x - u.x);
                    let dd = a1 - a0;
                    while (dd > Math.PI) dd -= Math.PI * 2;
                    while (dd < -Math.PI) dd += Math.PI * 2;
                    if (Math.abs(dd) > (50 * Math.PI) / 180) continue;
                    u.path = p.concat(u.path.slice(i + 1));
                    u.repath = 2;
                    return true;
                }
            }
        } finally {
            this.finder.avoid = null;
        }
        return false;
    }

    /**
     * Park on the nearest tile this unit can actually stand on and reach.
     *
     * Reference: MoveTask.findRelocationTile — RadialTileFinder from the target
     * tile, radius 0..5, filtered by `canStopAtTile` (tile capacity) and by the
     * island map (reachability). Ten tanks ordered onto one tile cannot all
     * occupy it; retail keeps every order alive and fans them out around the
     * destination. Our chain cancelled nine of the ten orders instead, which is
     * exactly the "friendly units jam each other" report.
     */
    private parkNear(u: Unit, cx: number, cy: number, maxR = 5): boolean {
        /*
         * Rank candidates, then verify reachability.
         *
         * The scan-order version (nearest ring first, row by row) took whichever
         * tile came first, which is often *behind* the hull — the unit then swung
         * 150 degrees to park and the player saw the body turn around for no
         * reason. pickParkingSpot scores by distance plus a turn penalty, so a
         * spot two tiles further along the direction of travel wins over one
         * behind us. A* is then run only on the winner; if it turns out to be
         * unreachable, that tile is excluded and the next best is tried.
         */
        const skip = new Set<number>();
        for (let attempt = 0; attempt < 6; attempt++) {
            const spot = this.pickParkingSpot(u, cx, cy, maxR, skip);
            if (!spot) break;
            const p = this.findFor(u, spot.x, spot.y);
            /*
             * A one-node path is legal: smooth() collapses a clear line of sight
             * into a single point. What must be rejected is bestEffort, which
             * returns a path ending at the unit's own cell — lastFound tells the
             * two apart.
             */
            if (p && p.length > 0 && this.finder.lastFound) {
                u.path = p;
                u.repath = 2;
                u.parkX = spot.x;
                u.parkY = spot.y;
                return true;
            }
            const tx = Math.floor((spot.x + HALF) / TILE);
            const ty = Math.floor((spot.y + HALF) / TILE);
            skip.add(ty * MAP_TILES + tx);
        }
        (this as any).__parkFail = skip.size ? 'unreachable' : 'no-spot';
        return false;
    }

    /**
     * Pick the best parking tile, then verify it is reachable.
     *
     * Scan order alone (nearest ring first, row by row) picks whichever tile
     * happens to come first, which is often *behind* the hull: the unit then has
     * to swing 150 degrees to park, and the player sees the body turn around for
     * no reason. Scoring candidates by `distance + 30 x |turn|` prefers a spot a
     * couple of tiles further along the direction of travel — the same preference
     * retail's MovePositionHelper expresses.
     */
    private pickParkingSpot(u: Unit, cx: number, cy: number, maxR = 5, skip?: Set<number>): { x: number; y: number } | null {
        const ctx = Math.floor((cx + HALF) / TILE);
        const cty = Math.floor((cy + HALF) / TILE);
        const curD = Math.hypot(u.x - cx, u.y - cy);
        const out: Array<{ x: number; y: number; score: number }> = [];
        for (let r = 0; r <= maxR; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const tx = ctx + dx, ty = cty + dy;
                    if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) continue;
                    if (skip && skip.has(ty * MAP_TILES + tx)) continue;
                    if (this.isBlocked(tx, ty)) continue;
                    if (!this.occupancy.hasRoomFor(u, tx, ty)) continue;
                    if (this.cellClaimedBy(tx, ty, u)) continue;
                    const wx = tx * TILE + TILE / 2 - HALF;
                    const wy = ty * TILE + TILE / 2 - HALF;
                    const candD = Math.hypot(wx - cx, wy - cy);
                    if (candD > curD + TILE * 0.5) continue;
                    if (this.worldBlockedAt(wx, wy, u.steerRadius)) continue;
                    let turn = Math.atan2(wy - u.y, wx - u.x) - u.face;
                    while (turn > Math.PI) turn -= Math.PI * 2;
                    while (turn < -Math.PI) turn += Math.PI * 2;
                    out.push({ x: wx, y: wy, score: candD + Math.abs(turn) * 30 });
                }
            }
        }
        if (out.length === 0) return null;
        out.sort((a, b) => a.score - b.score);
        return out[0];
    }

    /**
     * Has another unit already reserved this parking tile?
     *
     * See parkNear: without this, a group relocating in the same tick picks the
     * same empty tile and fights over it forever.
     */
    private cellClaimedBy(tx: number, ty: number, self: Unit): boolean {
        for (const o of this.units) {
            if (o === self || o.dead || Number.isNaN(o.parkX)) continue;
            if (Math.floor((o.parkX + HALF) / TILE) === tx && Math.floor((o.parkY + HALF) / TILE) === ty) {
                return true;
            }
        }
        return false;
    }

    /** MoveResult.Fail: park nearby, or end the order if there is genuinely nowhere */
    private failMove(u: Unit) {
        u.blockedNow = false;
        u.blockT = 0;
        u.repathTry = 0;
        u.repathHold = 0.6;
        u.stallT = 0;
        if (u.order.k === 'move' || u.order.k === 'attackmove') {
            const goal = this.orderGoal(u);
            /*
             * Relocation already happened in handleBlocked, once per order, the
             * moment the last leg turned out to be occupied. Repeating the search
             * here used a different anchor after `parkX` had been recorded, and
             * the two fought each other — measured as four of ten tanks cancelling
             * as "unreachable" while standing three tiles from the goal.
             */
            const near = goal ? Math.hypot(goal.x - u.x, goal.y - u.y) : 0;
            /*
             * One last direct query before parking.
             *
             * The give-up chain can conclude "stuck" after a friend that has just
             * sidestepped, at which point the route to the goal is actually clear
             * again — but every re-route so far was anchored at a detour waypoint,
             * not at the destination. Asking once for the destination itself is
             * cheap and recovers the common "a blocker moved out of the way"
             * case (measured: a walker parking 48.7 px short of an empty tile).
             */
            if (goal && near <= TILE * 6) {
                const direct = this.findPath(u, goal.x, goal.y);
                if (direct) {
                    u.path = direct;
                    u.repathTry = 0;
                    u.blockedNow = false;
                    return;
                }
            }
            /*
             * Nowhere to stand within five tiles of the goal.
             *
             * Retail reports CloseEnough here, which is a *success*: the unit
             * parks where it is and the order simply ends. Only a destination
             * that is still far away after the radial search has failed is
             * treated as genuinely unreachable, because that is the only case
             * where "no route" is the honest answer.
             */
            if (goal && near > TILE * 6) {
                this.giveUpOrder(u, 'nopath');
                return;
            }
            u.stop();
            if (u.order.k === 'move' || u.order.k === 'attackmove') u.order = { k: 'idle' };
        }
        // A harvester keeps its destination: the ore field is still where it
        // wants to go, it just cannot get there this second. Clearing the node
        // here is what made trucks ping-pong between the same two fields forever.
    }

    /**
     * Register the unit on its new cell and run the crush check.
     *
     * Reference: game/gameobject/trait/MoveTrait.ts:240 — when a crusher enters a
     * tile it destroys every crushable enemy on it. There is no speed test: a
     * tank crawling forward still flattens infantry. Our old rule (speed > 24)
     * meant a tank stuck in traffic stopped crushing, which looked wrong.
     */
    private syncCell(u: Unit) {
        const tx = Math.floor((u.x + HALF) / TILE);
        const ty = Math.floor((u.y + HALF) / TILE);
        if (tx === u.cellX && ty === u.cellY) {
            if (u.def.kind === 'infantry') u.subCell = this.occupancy.claimSubCell(u, tx, ty);
            return;
        }
        this.occupancy.move(u, u.cellX, u.cellY, tx, ty);
        u.cellX = tx;
        u.cellY = ty;
        if (u.def.kind === 'infantry') u.subCell = this.occupancy.claimSubCell(u, tx, ty);

        const here = this.occupancy.at(tx, ty);
        if (!here || here.size === 0) return;
        for (const other of here) {
            if (other === u || other.dead) continue;
            if (other.def.kind !== 'infantry') continue;
            if (other.owner !== u.owner) {
                if (u.canCrush) this.crush(other, u);
                continue;
            }
            // A friendly soldier caught under a track is scattered, not crushed
            // (reference: MoveTask issues ScatterTask to friendly crushables).
            if (u.canCrush) this.scatterInfantry(other);
        }
    }

    /** send a friendly infantryman one cell out of a vehicle's path */
    private scatterInfantry(inf: Unit) {
        if (inf.dead || inf.asideT > 0) return;
        for (let r = 1; r <= 2; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const tx = inf.cellX + dx, ty = inf.cellY + dy;
                    if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) continue;
                    if (!this.occupancy.hasRoomFor(inf, tx, ty)) continue;
                    const wx = tx * TILE + TILE / 2 - HALF;
                    const wy = ty * TILE + TILE / 2 - HALF;
                    if (this.worldBlockedAt(wx, wy, inf.radius)) continue;
                    inf.asideT = 1.2;
                    inf.order = { k: 'move', x: wx, y: wy };
                    inf.path = [{ x: wx, y: wy }];
                    inf.repath = 0;
                    inf.repathTry = 0;
                    return;
                }
            }
        }
    }

    private crush(victim: Unit, by: Unit) {
        if (victim.dead) return;
        victim.hp = 0;
        this.occupancy.remove(victim, victim.cellX, victim.cellY);
        this.kill(victim, by.owner, by);
        this.pushFx(victim.x, victim.y, 'dust', 0.55, 1.1);
        this.events.onSfx?.('scatter', victim.x, victim.y);
        if (this.players[by.owner].isHuman) this.events.onMessage?.(`${by.def.name} 碾过 ${victim.def.name}`, 'info');
    }

    /** push a unit out of a solid tile or a building footprint */
    /**
     * Safety net for a hull that is *already* inside solid ground (spawned on top
     * of a structure, or shoved there by separation).
     *
     * The old version snapped the unit to a free cell centre up to 3 tiles away,
     * which is what made a harvester look like it "kept resetting" at match
     * start: it walked into the corner of the refinery, got snapped back a tile,
     * walked in again, forever. Now it walks out under its own power at a capped
     * speed, so the motion reads as shrugging off a wall.
     */
    private resolveWorldCollision(u: Unit, dt: number) {
        if (u.isAir) return;
        // NOTE: do not touch u.blockedNow here. That flag is set by moveStep when
        // a step is refused, and clearing it from this pass silently disabled the
        // entire wait/aside/re-path chain — a unit pressed against a parked hull
        // would sit there forever with blockedNow = false.
        if (!this.worldBlockedAt(u.x, u.y, u.steerRadius)) return;
        if ((this as any).dbgOn) {
            ((this as any).dbgResolve ||= []).push({
                t: +this.time.toFixed(1), id: u.id, k: u.order.k, ph: (u.order as any).phase,
                x: +u.x.toFixed(1), y: +u.y.toFixed(1), r: u.radius,
            });
        }
        const tx = Math.floor((u.x + HALF) / TILE);
        const ty = Math.floor((u.y + HALF) / TILE);
        /*
         * The rescue must use the SAME radius as the movement test.
         *
         * `canStepTo` refuses a step only when the *steering* disc does not fit
         * (see Unit.steerRadius: the drawn hull is allowed to overhang a wall by
         * a few pixels, exactly like a retail sprite). Testing the rescuer with
         * the full visual radius made it disagree: a legal step landed the unit
         * in a spot the rescuer called "inside a wall", so it teleported the unit
         * back to prevX/prevY — every tick, forever, at full throttle. That was
         * the residual "cannot reach, it just vibrates in place" report, and it
         * showed up most around cliffs and along building edges.
         */
        const spot = this.nearestStandable(tx, ty, u.steerRadius, 3);
        if (!spot) {
            u.x = u.prevX;
            u.y = u.prevY;
            return;
        }
        const dx = spot.x - u.x;
        const dy = spot.y - u.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.6) {
            u.x = spot.x;
            u.y = spot.y;
            return;
        }
        const step = Math.min(d, 110 * dt);
        u.x += (dx / d) * step;
        u.y += (dy / d) * step;
        // the current path starts inside a wall; ask for a fresh one soon
        if (u.path.length > 0 && u.repath <= 0) u.repath = 0.3;
    }

    /* ------------------------------------------------------------ */
    /* fog of war                                                    */
    /* ------------------------------------------------------------ */
    private reveal(p: PlayerState, x: number, y: number, rTiles: number) {
        const cx = Math.floor((x + HALF) / TILE);
        const cy = Math.floor((y + HALF) / TILE);
        const r = Math.ceil(rTiles);
        const r2 = rTiles * rTiles;
        for (let y2 = cy - r; y2 <= cy + r; y2++) {
            if (y2 < 0 || y2 >= MAP_TILES) continue;
            for (let x2 = cx - r; x2 <= cx + r; x2++) {
                if (x2 < 0 || x2 >= MAP_TILES) continue;
                const dx = x2 - cx, dy = y2 - cy;
                if (dx * dx + dy * dy > r2) continue;
                const i = y2 * MAP_TILES + x2;
                p.visible[i] = 1;
                p.explored[i] = 1;
            }
        }
    }

    updateVisibility(p: PlayerState) {
        p.visible.fill(0);
        for (const u of this.units) {
            if (u.dead || u.owner !== p.id) continue;
            this.reveal(p, u.x, u.y, u.def.sight + u.sightBonus);
        }
        for (const b of this.buildings) {
            if (b.dead || b.owner !== p.id) continue;
            this.reveal(p, b.x, b.y, b.def.sight);
        }
        // refresh the detector list used for cloak checks
        this.detectors = this.detectors.filter(d => d.pid !== p.id);
        for (const b of this.buildings) {
            if (b.dead || b.owner !== p.id || !b.done || !b.def.detects) continue;
            this.detectors.push({ pid: p.id, x: b.x, y: b.y, r: b.def.sight * TILE * 0.95 });
        }
    }

    /** the AI does not cheat with vision but we keep its explored map fully lit */
    private revealAll(p: PlayerState) {
        p.explored.fill(1);
    }

    /* ------------------------------------------------------------ */
    /* win / lose                                                    */
    /* ------------------------------------------------------------ */
    private checkVictory() {
        if (this.phase !== 'playing') return;
        const alive = (pid: PlayerId) =>
            this.buildings.some(b => !b.dead && b.owner === pid && b.def.isCore)
            || this.units.some(u => !u.dead && u.owner === pid && u.isMcv);
        if (!alive(1)) {
            this.phase = 'won';
            this.events.onGameOver?.(true);
        } else if (!alive(0)) {
            this.phase = 'lost';
            this.events.onGameOver?.(false);
        }
    }

    /* ------------------------------------------------------------ */
    /* helpers for UI                                                */
    /* ------------------------------------------------------------ */
    availableBuildings(p: PlayerState): BuildingDef[] {
        return this.availableStructures(p).filter(d => !this.lockReason(p, d));
    }

    missingRequirement(p: PlayerState, d: BuildingDef): string {
        return this.lockReason(p, d);
    }
}

/** closest intersection (0..1) of a segment and a circle, -1 when it misses */
function segmentCircleT(x0: number, y0: number, dx: number, dy: number, cx: number, cy: number, r: number): number {
    const fx = x0 - cx;
    const fy = y0 - cy;
    const a = dx * dx + dy * dy;
    if (a < 0.0001) return (fx * fx + fy * fy <= r * r) ? 0 : -1;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    if (t1 >= 0 && t1 <= 1) return t1;
    if (t2 >= 0 && t2 <= 1) return t2;
    return -1;
}

/** internal alias so orders can be passed around without the union widening */
type OrderLike = Unit['order'];
