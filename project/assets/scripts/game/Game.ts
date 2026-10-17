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
    DMG_TABLE, TECH_BUILDING, QUEUE_MAX, UNLOAD_TIME, MAX_CREDITS, FactionDef, FACTIONS,
    tileToWorld, dist, clamp, GROUP_COUNT, ProdCat, Stance, SuperWeaponId, SUPER_WEAPONS,
    unitCategory, BUILD_REQUIRES, VET_XP_RATIO, VET_MAX_LEVEL, CRATE_INTERVAL,
    BUILD_RADIUS_TILES, makeRng,
} from '../core/Core';
import { TerrainMap, CrystalNode } from '../world/Terrain';
import { PathFinder } from '../world/Path';
import { Unit, Building, Projectile, Fx, Entity, SpatialGrid, PlayerId, Zone, Crate } from './Entities';
import { AIController } from './AI';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type GamePhase = 'playing' | 'won' | 'lost';

export interface GameOptions {
    credits: number;
    superWeapons: boolean;
    crates: boolean;
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
    grid = new SpatialGrid();
    units: Unit[] = [];
    buildings: Building[] = [];
    projectiles: Projectile[] = [];
    fx: Fx[] = [];
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
    buildTile = { tx: 0, ty: 0 };
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
        this.terrain.generate(seed);
        this.finder = new PathFinder((tx, ty) => this.isBlocked(tx, ty));
        this.difficulty = difficulty;
        this.events = events;
        this.rng = makeRng(seed ^ 0x9e3779b9);
        this.options = {
            credits: options?.credits ?? START_CREDITS,
            superWeapons: options?.superWeapons ?? true,
            crates: options?.crates ?? true,
        };

        const enemyFaction: Faction = humanFaction === 'BU' ? 'DS' : 'BU';
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

    private setupBase(pid: PlayerId) {
        const p = this.players[pid];
        const f = FACTIONS[p.faction];
        const bx = pid === 0 ? 11 : MAP_TILES - 12;
        const by = MAP_TILES / 2;
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
        const b = new Building(def, owner, tx, ty, instant ? 1 : 0.03);
        this.buildings.push(b);
        this.events.onSpawn?.(b);
        return b;
    }

    spawnUnit(owner: PlayerId, def: UnitDef, x: number, y: number): Unit {
        const u = new Unit(def, owner, clamp(x, -HALF + 20, HALF - 20), clamp(y, -HALF + 20, HALF - 20));
        u.owner = owner;
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

    isBlocked(tx: number, ty: number) {
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
        if (e.isBuilding) return p.explored[i] === 1;
        return p.visible[i] === 1;
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
                if (this.buildingAt(x, y)) return { ok: false, reason: '与建筑重叠' };
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
    sellSelectedBuilding() {
        const b = this.selectedBuilding;
        if (!b || b.dead || !b.done) return;
        const ratio = clamp(b.hp / b.maxHp, 0.15, 1);
        const refund = Math.floor(b.def.cost * 0.5 * ratio);
        this.human.credits = Math.min(MAX_CREDITS, this.human.credits + refund);
        b.dead = true;
        this.events.onDeath?.(b);
        this.selectedBuilding = null;
        this.events.onMessage?.(`拆除 ${b.def.name}，回收 ${refund} 晶体`, 'info');
        this.events.onSfx?.('sell');
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
    selectInRect(minX: number, minY: number, maxX: number, maxY: number, additive = false): number {
        const inBox = (e: Unit) => e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY;
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

    private pathToEntity(u: Unit, target: Entity) {
        const edge = target.isBuilding ? target.radius + 20 : target.radius + 12;
        const a = Math.atan2(u.y - target.y, u.x - target.x);
        const gx = target.x + Math.cos(a) * edge;
        const gy = target.y + Math.sin(a) * edge;
        if (u.isAir) { u.path = [{ x: gx, y: gy }]; u.repath = 0; return; }
        const path = this.finder.find(u.x, u.y, gx, gy);
        u.path = path || [{ x: gx, y: gy }];
        u.repath = 3;
    }

    private moveUnitTo(u: Unit, x: number, y: number, keepOrder: boolean) {
        x = clamp(x, -HALF + 24, HALF - 24);
        y = clamp(y, -HALF + 24, HALF - 24);
        if (!keepOrder) u.order = { k: 'move', x, y };
        if (u.isAir) {
            u.path = [{ x, y }];
        } else {
            const path = this.finder.find(u.x, u.y, x, y);
            u.path = path ? path : [{ x, y }];
        }
        u.repath = 4;
    }

    private startHarvest(u: Unit, node: CrystalNode | null) {
        const target = node || this.nearestNode(u.x, u.y);
        u.order = { k: 'harvest', node: target, phase: 'seek', timer: 0 };
        u.mineNode = target;
        u.stop();
    }

    nearestNode(x: number, y: number, exclude: CrystalNode | null = null): CrystalNode | null {
        let best: CrystalNode | null = null;
        let bd = Infinity;
        for (const n of this.terrain.nodes) {
            if (n.amount <= 0) continue;
            if (exclude && n.id === exclude.id) continue;
            const d = dist(x, y, n.x, n.y);
            if (d < bd) { bd = d; best = n; }
        }
        return best;
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
        this.applySeparation(dt);
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

            if (!b.done) {
                b.progress += dt / Math.max(1, b.def.time);
                if (b.progress >= 1) {
                    b.progress = 1;
                    b.hp = b.def.hp;
                    this.pushFx(b.x, b.y, 'spawn', 0.6, b.size);
                    if (p.isHuman) {
                        this.events.onMessage?.(`${b.def.name} 建造完成`, 'good');
                        this.events.onSfx?.('ready');
                    }
                }
                b.hp = Math.max(b.hp, b.def.hp * Math.max(0.12, b.progress));
                continue;
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

            // cloak state: stealth units re-cloak shortly after firing
            const fieldCloak = this.time < u.mirageUntil;
            u.cloaked = fieldCloak || (!!u.def.cloak && u.cloakT > 2.2);

            if (u.slowUntil > -1 && this.time > u.slowUntil) u.slowUntil = -1;
            if (u.invulnUntil > -1 && this.time > u.invulnUntil) u.invulnUntil = -1;

            // elite units slowly regenerate out of combat
            if (u.level >= VET_MAX_LEVEL && u.calm > 4 && u.hp < u.maxHp) {
                u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.012 * dt);
            }

            if (u.isHarvester) {
                this.updateHarvester(u, dt);
            } else {
                this.updateCombatant(u, dt);
            }

            if (u.cd > 0) u.cd -= dt * (this.prodFactor(this.players[u.owner]) < 1 ? 0.65 : 1);

            if (u.speedCap > 0 && u.path.length === 0) u.speedCap = 0;

            // stuck detection for ground units
            if (u.path.length > 0 && u.repath > 0) {
                u.repath -= dt;
                if (u.repath <= 0) {
                    u.path.length = 0;
                    if (u.order.k === 'move') {
                        const p = this.finder.find(u.x, u.y, u.order.x, u.order.y);
                        if (p) u.path = p;
                    }
                }
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
                if (u.path.length === 0 || u.repath <= 0) this.pathToEntity(u, t);
                u.moveStep(dt, 1);
            } else {
                u.stop();
                if (w && u.cd <= 0) { this.fire(u, w, t); u.cd = w.cd * u.rofMul; }
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
                const d = dist(u.x, u.y, t.x, t.y);
                if (u.cd <= 0 && d <= w.range * 1.02) { this.fire(u, w, t); u.cd = w.cd * u.rofMul; }
                if (u.stance === 'aggressive' && d > w.range * 0.85 && u.path.length === 0) {
                    this.pathToEntity(u, t);
                }
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
                if (!node || node.amount <= 0) node = this.nearestNode(u.x, u.y);
                order.node = node;
                u.mineNode = node;
                if (!node) { u.order = { k: 'idle' }; return; }
                const pth = this.finder.find(u.x, u.y, node.x, node.y - TILE);
                u.path = pth || [{ x: node.x, y: node.y - TILE }];
                order.phase = 'toMine';
                order.timer = 0;
                break;
            }
            case 'toMine': {
                const node = order.node;
                if (!node || node.amount <= 0) { order.phase = 'seek'; return; }
                const d = dist(u.x, u.y, node.x, node.y);
                if (d < TILE * 2.2) {
                    order.phase = 'mining';
                    order.timer = u.def.mineTime || 3;
                    u.stop();
                    break;
                }
                if (u.path.length > 0) u.moveStep(dt, 1);
                else order.phase = 'seek';
                break;
            }
            case 'mining': {
                const node = order.node!;
                order.timer -= dt;
                const cargo = u.def.cargo || 500;
                const rate = cargo / Math.max(0.5, u.def.mineTime || 3);
                u.cargo = Math.min(cargo, u.cargo + rate * dt);
                if (node) {
                    node.amount -= rate * dt;
                    if (node.amount < 0) node.amount = 0;
                }
                if (order.timer <= 0 || u.cargo >= cargo || !node || node.amount <= 0) {
                    const drop = this.nearestDropoff(p, u.x, u.y);
                    if (drop) {
                        const pth = this.finder.find(u.x, u.y, drop.x, drop.y + drop.radius + 14);
                        u.path = pth || [{ x: drop.x, y: drop.y + drop.radius + 14 }];
                        order.phase = 'toBase';
                    } else {
                        order.phase = 'seek';
                    }
                }
                break;
            }
            case 'toBase': {
                const drop = this.nearestDropoff(p, u.x, u.y);
                if (!drop) { order.phase = 'seek'; return; }
                if (dist(u.x, u.y, drop.x, drop.y) < drop.radius + 34) {
                    order.phase = 'unload';
                    order.timer = UNLOAD_TIME;
                    u.stop();
                    break;
                }
                if (u.path.length > 0) u.moveStep(dt, 1);
                else {
                    const pth = this.finder.find(u.x, u.y, drop.x, drop.y + drop.radius + 14);
                    u.path = pth || [];
                    if (u.path.length === 0) order.phase = 'seek';
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
    canShootAt(shooter: Unit | Building, w: { antiAir?: boolean }, e: Entity): boolean {
        if (e.dead || e.owner === shooter.owner) return false;
        if (e instanceof Unit) {
            if (e.isAir && !w.antiAir) return false;
            if (e.cloaked && !this.isDetected(shooter.owner, e)) return false;
        }
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
        const ox = src.x;
        const oy = src.y - (src instanceof Unit && src.isAir ? 0 : 8);
        const d = dist(ox, oy, target.x, target.y);
        const speed = w.proj === 'bullet' ? 900 : w.proj === 'shell' ? 420 : w.proj === 'rocket' ? 330 : 260;
        const dur = Math.max(0.06, d / speed);
        const p = new Projectile({
            x: ox, y: oy, tx: target.x, ty: target.y, dur, kind: w.proj,
            owner: src.owner, dmg: w.dmg * (src instanceof Unit ? src.damageMul : 1),
            dmgType: w.type, splash: w.splash, target,
        });
        p.source = src instanceof Unit ? src : null;
        this.projectiles.push(p);
        this.pushFx(ox, oy, 'muzzle', 0.12, w.proj === 'bullet' ? 0.5 : 0.9);
        if (src instanceof Unit) {
            src.cloakT = 0;
            if (src.def.kind === 'infantry') src.face = Math.atan2(target.y - src.y, target.x - src.x);
            this.events.onSfx?.(w.proj === 'bullet' ? 'gun' : w.proj === 'shell' ? 'cannon' : 'rocket', ox, oy);
        } else {
            this.events.onSfx?.('cannon', ox, oy);
        }
    }

    private updateProjectiles(dt: number) {
        for (const pr of this.projectiles) {
            if (pr.dead) continue;
            pr.step(dt);
            if (pr.dead) this.impact(pr);
        }
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
        }
    }

    private impact(pr: Projectile) {
        const t = pr.target;
        if (t && !t.dead) {
            this.damage(t, pr.dmg, pr.dmgType, pr.owner, pr.source);
        } else {
            this.grid.query(pr.tx, pr.ty, 24, this.tmp);
            for (const e of this.tmp) {
                if (e.dead || e.owner === pr.owner) continue;
                this.damage(e, pr.dmg * 0.5, pr.dmgType, pr.owner, pr.source);
            }
            for (const b of this.buildings) {
                if (b.dead || b.owner === pr.owner) continue;
                if (dist(pr.tx, pr.ty, b.x, b.y) < b.radius) { this.damage(b, pr.dmg * 0.5, pr.dmgType, pr.owner, pr.source); }
            }
        }
        if (pr.splash > 0) {
            this.grid.query(pr.tx, pr.ty, pr.splash, this.tmp);
            for (const e of this.tmp) {
                if (e.dead) continue;
                const d = dist(pr.tx, pr.ty, e.x, e.y);
                if (d > pr.splash) continue;
                const k = 1 - (d / pr.splash) * 0.65;
                if (t && e.id === t.id) continue;
                this.damage(e, pr.dmg * 0.65 * k, pr.dmgType, pr.owner, pr.source);
            }
            for (const b of this.buildings) {
                if (b.dead) continue;
                if (t && b.id === t.id) continue;
                const d = dist(pr.tx, pr.ty, b.x, b.y);
                if (d > pr.splash + b.radius * 0.6) continue;
                this.damage(b, pr.dmg * 0.5, pr.dmgType, pr.owner, pr.source);
            }
            this.pushFx(pr.tx, pr.ty, 'boom', 0.5, Math.min(2.2, pr.splash / 26));
            this.events.onSfx?.('boom', pr.tx, pr.ty);
        } else {
            this.pushFx(pr.tx, pr.ty, 'spark', 0.22, 0.7);
        }
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
        const mult = DMG_TABLE[type][target.armor] ?? 1;
        target.hp -= amount * mult;
        target.lastHit = this.time;
        target.hitFlash = 0.12;
        if (target.hp <= 0) this.kill(target, owner, source);
    }

    kill(e: Entity, killer: PlayerId, source: Unit | null = null) {
        if (e.dead) return;
        e.dead = true;
        e.hp = 0;
        this.players[e.owner].lost++;
        if (killer !== e.owner) this.players[killer].kills++;
        this.pushFx(e.x, e.y, 'boom', e.isBuilding ? 0.9 : 0.5, e.isBuilding ? (e as Building).size * 0.9 : 1.3);
        this.events.onSfx?.('boom', e.x, e.y);
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
    }

    private applySeparation(dt: number) {
        const tmp: Entity[] = [];
        const maxPush = 60 * dt;
        for (const u of this.units) {
            if (u.dead || u.isAir) continue;
            this.grid.query(u.x, u.y, u.radius * 3, tmp);
            for (const e of tmp) {
                const o = e as Unit;
                if (o === u || o.dead || !o.def || o.isAir) continue;
                const dx = u.x - o.x;
                const dy = u.y - o.y;
                const d2 = dx * dx + dy * dy;
                const rr = (u.radius + o.radius) * 0.92;
                if (d2 >= rr * rr || d2 < 0.001) continue;
                const d = Math.sqrt(d2);
                const push = Math.min(maxPush, (rr - d) * 0.5);
                u.x += (dx / d) * push;
                u.y += (dy / d) * push;
            }
            u.x = clamp(u.x, -HALF + 12, HALF - 12);
            u.y = clamp(u.y, -HALF + 12, HALF - 12);
        }
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

/** internal alias so orders can be passed around without the union widening */
type OrderLike = Unit['order'];
