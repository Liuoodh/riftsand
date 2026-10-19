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
import { TerrainMap, CrystalNode, ORE_BAIL_VALUE, GEM_BAIL_VALUE } from '../world/Terrain';
import { TileCollection, MapBounds, Tile, RadialBackFirstTileFinder } from '../sim/Tiles';
import { TileOccupation } from '../sim/TileOccupation';
import { Passability, MovementZone, SpeedType } from '../sim/Passability';
import { MoveTask } from '../sim/MoveTask';
import { MoveTrait, MoveState, MoveResult, TICK } from '../sim/MoveTrait';
import { facingToRad, radToFacing } from '../sim/Math2';
import { SimWorld } from '../sim/World';
import { Position } from '../sim/Position';
import { UnitOrders } from '../sim/Task';
import { AUTHORED } from '../world/Maps';
import { Unit, Building, Projectile, Fx, Entity, SpatialGrid, PlayerId, Zone, Crate, Decal, BuildStatus, Order } from './Entities';
import { AIController } from './AI';
import { PowerTrait, PowerLevel } from '../sim/player/PowerTrait';
import { Production, ProductionRules, FactoryType, PrereqCategory } from '../sim/player/Production';
import { ProductionQueue, QueueStatus, QueueType } from '../sim/player/ProductionQueue';
import { GENERAL } from '../sim/rules/GeneralRules';
import { LandType, getLandType } from '../sim/rules/TerrainRules';
import { PoweredTrait } from '../sim/traits/PoweredTrait';
import { TurretTrait } from '../sim/traits/TurretTrait';
import { DockTrait } from '../sim/traits/DockTrait';
import { RallyTrait } from '../sim/traits/RallyTrait';
import { HarvesterTrait } from '../sim/traits/HarvesterTrait';
import { FactoryTrait, FactoryStatus } from '../sim/traits/FactoryTrait';
import { SuppressionTrait } from '../sim/traits/SuppressionTrait';
import { IdleActionTrait } from '../sim/traits/IdleActionTrait';
import { AgentTrait } from '../sim/traits/AgentTrait';
import { CrashableTrait, CrashWorld } from '../sim/traits/CrashableTrait';
import { AirportBoundTrait, AirportWorld } from '../sim/traits/AirportBoundTrait';
import { HelipadTrait } from '../sim/traits/HelipadTrait';
import { UnitReloadTrait } from '../sim/traits/UnitReloadTrait';
import { HoverBobTrait } from '../sim/traits/HoverBobTrait';
import { RockingTrait } from '../sim/traits/RockingTrait';
import { C4ChargeTrait, C4World } from '../sim/traits/C4ChargeTrait';
import { CrewedTrait, CrewWorld } from '../sim/traits/CrewedTrait';
import { FreeUnitTrait, FreeUnitWorld } from '../sim/traits/FreeUnitTrait';
import { SuperWeaponTrait, SuperWeaponWorld } from '../sim/traits/SuperWeaponTrait';
import { SuperWeaponsTrait } from '../sim/player/SuperWeaponsTrait';
import { UnitRepairTrait, RepairWorld } from '../sim/traits/UnitRepairTrait';
import { WallTrait, WallWorld } from '../sim/traits/WallTrait';
import { OverpoweredTrait, OverpoweredWorld } from '../sim/traits/OverpoweredTrait';
import { SpawnLinkTrait, SpawnLinkWorld } from '../sim/traits/SpawnLinkTrait';
import { MissileSpawnTrait } from '../sim/traits/MissileSpawnTrait';
import { UnlandableTrait, UnlandableWorld } from '../sim/traits/UnlandableTrait';
import { DeathType } from '../sim/gameobject/DeathType';
import { GatherOreTask } from '../sim/task/harvester/GatherOreTask';
import { ReturnOreTask } from '../sim/task/harvester/ReturnOreTask';
import { HarvestWorld } from '../sim/task/harvester/HarvestWorld';

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
    /** reference: AI houses take the AI branch in refund/purifier rules */
    isAi: boolean;
    /** neutral houses (crates, civilians); always false here but read by traits */
    isNeutral: boolean;
    /**
     * Both are rebuilt on every spawn / unspawn, like the reference's live Sets.
     * Traits ask `unit.owner.buildings` for refineries, factories and helipads;
     * keeping the array here means those queries are one loop, not a filter of
     * every entity in the game.
     */
    buildings: Building[];
    powerTrait: PowerTrait;
    production: Production;
    queues: Record<ProdCat, ProductionQueue>;
    sw: SuperWeaponState[];
    /**
     * Reference `player.superWeaponsTrait` — the authority on which weapons the
     * player owns. `sw` is the same objects, kept as an array so the HUD can
     * index it without a Map.
     */
    superWeaponsTrait: SuperWeaponsTrait;
    isCombatant(): boolean;
}

const REVEAL_TICK = 0.22;
const CATS: ProdCat[] = ['structure', 'infantry', 'vehicle', 'aircraft'];
const REPAIR_COST_PER_HP = 0.4;
const REPAIR_SECONDS = 24;

export class Game {
    terrain: TerrainMap;
    /** cell grid the sim reasons about (reference: game.map.tiles) */
    tiles!: TileCollection;
    mapBounds!: MapBounds;
    /** passability graph + A* (reference: game.map.terrain) */
    passability!: Passability;
    /** who stands on which cell — see sim/TileOccupation.ts */
    occupancy!: TileOccupation;
    /** adapter handed to MoveTask / locomotors */
    simWorld!: SimWorld;
    /** fixed-timestep accumulator (the reference runs at ticks, not frames) */
    private simAcc = 0;
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
    /**
     * Probe hook: the regression scripts set this to false to measure movement
     * without the AI opponent interfering. It used to be a phantom field that
     * nothing read, so those runs were quietly fighting a live AI.
     */
    aiEnabled = true;
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
        /*
         * Simulation world.
         *
         * The reference keeps a `GameMap` object with tiles / bounds / terrain /
         * tileOccupation; MoveTask and the locomotors only ever talk to that
         * object. We build the same thing here, backed by the existing
         * TerrainMap, so the ported code needs no special cases.
         */
        this.tiles = new TileCollection(MAP_TILES);
        this.mapBounds = new MapBounds(MAP_TILES, MAP_TILES);
        this.syncTiles();
        this.occupancy = new TileOccupation(MAP_TILES, this.tiles);
        this.passability = new Passability({
            tiles: this.tiles,
            mapBounds: this.mapBounds,
            tileOccupation: this.occupancy,
            speedAt: (rx, ry, isInfantry, hover) => this.terrain.speedAt(rx, ry, isInfantry, hover),
        });
        // a structure appearing / disappearing changes passability
        this.occupancy.onChange = (tiles, obj) => this.passability.handleTileOccupationUpdate(tiles, obj);
        this.simWorld = {
            terrain: this.passability,
            tiles: this.tiles,
            mapBounds: this.mapBounds,
            tileOccupation: this.occupancy,
            currentTick: 0,
            areFriendly: (a, b) => a.owner === b.owner,
            crushObject: (victim, by) => this.crush(victim, by),
        };
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

    /**
     * Reference `Rules.general.prereqCategories`, derived from our defs:
     * POWER = any producer, FACTORY = anything that unlocks a queue, BARRACKS =
     * the infantry factory, RADAR = a detector, TECH = the tech building, PROC =
     * a refinery.
     */
    private productionRules(): ProductionRules {
        const all = Object.keys(BUILDINGS).map((id) => BUILDINGS[id]);
        const categories = new Map<PrereqCategory, string[]>();
        categories.set(PrereqCategory.Power, all.filter((d) => d.power > 0 && !d.isCore && d.cost > 0).map((d) => d.id));
        categories.set(PrereqCategory.Factory, all.filter((d) => !!d.factory && !d.isCore).map((d) => d.id));
        categories.set(PrereqCategory.Barracks, all.filter((d) => d.factory === 'infantry').map((d) => d.id));
        categories.set(PrereqCategory.Radar, all.filter((d) => !!d.detects).map((d) => d.id));
        categories.set(PrereqCategory.Tech, Object.keys(TECH_BUILDING).map((f) => BUILDINGS[TECH_BUILDING[f]].id));
        categories.set(PrereqCategory.Proc, all.filter((d) => !!d.dropoff).map((d) => d.id));
        return { general: { maximumQueuedObjects: GENERAL.maximumQueuedObjects, prereqCategories: categories } };
    }

    /**
     * Give every def the three fields the reference's ObjectRules expose, once.
     * BuildingDef/UnitDef stay the single source of truth; this is the adapter
     * layer Production reads.
     */
    private static defsNormalised = false;
    private normaliseDefs() {
        if (Game.defsNormalised) return;
        Game.defsNormalised = true;
        for (const id in BUILDINGS) {
            const d: any = BUILDINGS[id];
            d.owner = d.owner ?? d.faction;
            d.techLevel = d.techLevel ?? d.tech;
            d.prerequisite = d.prerequisite ?? (BUILD_REQUIRES[id] ? [BUILD_REQUIRES[id]] : []);
            d.buildCat = d.buildCat ?? (d.weapon ? 0 : 1);
        }
        for (const id in UNITS) {
            const d: any = UNITS[id];
            d.owner = d.owner ?? d.faction;
            d.techLevel = d.techLevel ?? d.tech;
            // the factory check covers the producing building; units have no
            // separate prerequisite list in our data
            d.prerequisite = d.prerequisite ?? [];
        }
    }

    private newPlayer(id: PlayerId, faction: Faction, human: boolean): PlayerState {
        this.normaliseDefs();
        const p: any = {
            id, faction, credits: this.options.credits,
            visible: new Uint8Array(MAP_TILES * MAP_TILES),
            explored: new Uint8Array(MAP_TILES * MAP_TILES),
            earned: 0, built: 0, lost: 0, kills: 0,
            ai: null, defeated: false, isHuman: human, isAi: !human, isNeutral: false,
            buildings: [],
            sw: [],
            isCombatant: () => true,
        };
        p.powerTrait = new PowerTrait(p);
        p.superWeaponsTrait = new SuperWeaponsTrait(p.sw);
        const rules = this.productionRules();
        const allObjects: any[] = [];
        for (const k of Object.keys(BUILDINGS)) allObjects.push(BUILDINGS[k]);
        for (const k of Object.keys(UNITS)) allObjects.push(UNITS[k]);
        p.production = Production.factory(
            p,
            rules,
            { superWeapons: this.options.superWeapons },
            allObjects,
        );
        p.queues = {
            structure: p.production.getQueue(QueueType.Structures),
            infantry: p.production.getQueue(QueueType.Infantry),
            vehicle: p.production.getQueue(QueueType.Vehicles),
            aircraft: p.production.getQueue(QueueType.Aircrafts),
        };
        return p as PlayerState;
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
         * Weapons and production are gated on BuildStatus.Ready, so a structure
         * that is still rising cannot shoot or deliver — that is the behaviour
         * the reference's `attackTrait.setDisabled(...)` produces.
         */
        const b = new Building(def, owner, tx, ty, instant ? 1 : 0);
        b.hp = def.hp;
        b.maxHp = def.hp;
        b.status = instant ? BuildStatus.Ready : BuildStatus.BuildUp;
        b.buildDur = instant ? 0 : GENERAL.buildupTime * 60;
        b.buildT = b.buildDur;
        b.tile = this.tiles.getByMapCoords(tx, ty)!;
        b.tileLookup = (rx: number, ry: number) => this.tiles.getByMapCoords(rx, ry);
        const p = this.players[owner];
        b.player = p;

        /* ---- reference trait wiring ---- */
        if (def.power < 0) b.poweredTrait = new PoweredTrait(b);
        if (def.weapon) b.turretTrait = new TurretTrait();
        if (def.factory) {
            const type = def.factory === 'infantry'
                ? FactoryType.InfantryType
                : def.factory === 'vehicle'
                    ? FactoryType.UnitType
                    : def.factory === 'aircraft'
                        ? FactoryType.AircraftType
                        : FactoryType.BuildingType;
            b.factoryTrait = new FactoryTrait(type) as any;
            b.rallyTrait = new RallyTrait() as any;
        }
        if (def.dropoff || def.factory === 'aircraft') {
            b.dockTrait = new DockTrait(b, def.factory === 'aircraft' ? 2 : 1);
            b.dockTrait.onSpawn();
            if (def.factory === 'aircraft') {
                // reference Building.factory: UnitReload + Helipad traits
                b.helipadTrait = new HelipadTrait() as any;
                b.unitReloadTrait = new UnitReloadTrait() as any;
                /*
                 * Reference AirforceCommand: the pad also repairs whatever is
                 * parked on it, on the *reload* clock rather than the depot
                 * clock (`repairRules.unitReload ? reloadRate : uRepairRate`).
                 */
                b.unitRepairTrait = new UnitRepairTrait();
                b.unitRepairTrait.onSpawn(b, this.repairWorld);
            }
        }
        // reference Building.factory: every structure can be charged with C4
        // (`rules.canC4 && !rules.wall`) and every structure is crewed
        if (!def.wall) b.c4ChargeTrait = new C4ChargeTrait();
        if (!def.wall) b.crewedTrait = new CrewedTrait();
        if (def.freeUnit) b.freeUnitTrait = new FreeUnitTrait();
        if (def.superWeapon) b.superWeaponTrait = new SuperWeaponTrait(def.superWeapon);
        if (def.wall) b.wallTrait = new WallTrait();

        // the passability graph learns about the footprint before anybody paths
        this.occupancy.occupyTileRange(b.tile, b);
        this.buildings.push(b);
        p.buildings.push(b);
        if (def.power !== 0) p.powerTrait.updateFrom(b, 'add', this.powerWorld);
        if (b.factoryTrait) {
            const ft = b.factoryTrait as any;
            if (!p.production.getPrimaryFactory(ft.type)) p.production.setPrimaryFactory(b);
            p.production.incrementFactoryCount(ft.type);
            ft.onSpawn(b, this.factoryWorld);
        }
        this.events.onSpawn?.(b);
        if (!instant) this.events.onSfx?.('place', b.x, b.y);
        // NotifySpawn fan-out that needs the player's building list to be current
        b.superWeaponTrait?.onSpawn(b, this.superWeaponWorld);
        b.wallTrait?.onSpawn(b, this.wallWorld);
        return b;
    }

    /** world adapter for the reference PoweredTrait / ProductionTrait hooks */
    private get powerWorld() {
        return {
            onPowerLow: (pl: PlayerState) => {
                pl.production.applyPowerLevel(PowerLevel.Low, pl.powerTrait.getPower(), pl.powerTrait.getDrain(), GENERAL);
            },
            onPowerRestore: (pl: PlayerState) => {
                pl.production.applyPowerLevel(PowerLevel.Normal, 0, 0, GENERAL);
            },
            onPowerChange: (pl: PlayerState) => {
                if (pl.powerTrait.isLowPower()) {
                    pl.production.applyPowerLevel(PowerLevel.Low, pl.powerTrait.getPower(), pl.powerTrait.getDrain(), GENERAL);
                }
            },
        };
    }

    /* ------------------------------------------------------------ */
    /* v0.24 trait adapters (building side)                          */
    /* ------------------------------------------------------------ */

    /**
     * The reference `damageInfo` bag handed to `NotifyDestroy`.
     *
     * Only three fields are ever read by the traits: who did it (`player`), with
     * what (`obj`), and whether the weapon was a suicide one. Our weapons have no
     * `suicide` flag, so the last one is constant — but keeping the shape means
     * `CrewedTrait.onDestroy` stays a verbatim copy.
     */
    private damageInfoFor(killer: PlayerId, source: Unit | null): any {
        return { player: killer, obj: source ?? undefined, weapon: { rules: { suicide: false } } };
    }

    /** world adapter for CrewedTrait */
    private get crewWorld(): CrewWorld {
        const self = this;
        return {
            currentTick: this.simWorld.currentTick,
            crewTypeFor: (faction: string) =>
                faction === 'DS' ? GENERAL.crew.sovietCrew : faction === 'BU' ? GENERAL.crew.alliedCrew : undefined,
            survivorDivisorFor: (faction: string) =>
                faction === 'DS'
                    ? GENERAL.crew.sovietSurvivorDivisor
                    : faction === 'BU'
                      ? GENERAL.crew.alliedSurvivorDivisor
                      : 0,
            engineerTypeFor: (faction: string) =>
                faction === 'DS' ? GENERAL.crew.sovietEngineer : faction === 'BU' ? GENERAL.crew.alliedEngineer : undefined,
            /*
             * `sellTrait.computeRefundValue(target)`.
             *
             * Reference behaviour, both quirks included: the value is the plain
             * purchase price (NOT scaled by remaining health — reading `hp` here
             * would be useless anyway, since `kill()` has already zeroed it), and
             * an AI house refunds at 100% instead of `RefundPercent`.
             */
            refundValue: (target: Building) =>
                target.player?.isAi
                    ? target.def.cost
                    : Math.floor(target.def.cost * GENERAL.refundPercent),
            foundationTiles: (target: Building) => {
                const out: Tile[] = [];
                for (let y = target.ty; y < target.ty + target.size; y++) {
                    for (let x = target.tx; x < target.tx + target.size; x++) {
                        const t = self.tiles.getByMapCoords(x, y);
                        if (t && self.mapBounds.isWithinBounds(t)) out.push(t);
                    }
                }
                return out;
            },
            canPlaceInfantryOn: (tile: Tile) =>
                self.passability.getPassableSpeed(tile, SpeedType.Foot, true, false, [], true) > 0,
            createUnit: (type: string, owner: any) => {
                const def = UNITS[type];
                return def ? self.createUnitForPlayer(def, self.playerOf(owner) ?? owner) : undefined;
            },
            spawnObject: (unit: Unit, tile: Tile) => self.spawnObject(unit, tile),
            generateRandomInt: (min: number, max: number) => min + Math.floor(self.rng() * (max - min + 1)),
            scatter: (unit: Unit, ignored: any[]) => self.scatterUnit(unit, ignored),
            canProduceVeteran: (player: any, _rules: any) => !!self.playerOf(player)?.isAi === false && false,
            setVeteran: (unit: Unit) => {
                unit.level = Math.max(unit.level, 1);
            },
            subCellForInfantry: () => 2,
        };
    }

    /** world adapter for FreeUnitTrait */
    private get freeUnitWorld(): FreeUnitWorld {
        const self = this;
        return {
            freeUnitTypeFor: (building: Building) => building.def.freeUnit,
            isVehicleType: (type: string) => {
                const d = UNITS[type];
                return !!d && d.kind !== 'infantry';
            },
            isInfantryType: (type: string) => UNITS[type]?.kind === 'infantry',
            createUnit: (type: string, owner: any) => {
                const def = UNITS[type];
                return def ? self.createUnitForPlayer(def, self.playerOf(owner) ?? owner) : undefined;
            },
            /*
             * Reference FreeUnitTrait walks `RadialBackFirstTileFinder` outward
             * from the footprint and takes the first cell that is passable for
             * the unit, within one height level, and free of obstacles *and*
             * overlays (so a free tank does not park on an ore field). When every
             * ring is covered it still accepts the first merely-passable cell.
             */
            findSpawnTile: (building: Building, unit: Unit) => {
                let fallback: Tile | undefined;
                const finder = new RadialBackFirstTileFinder(
                    self.tiles,
                    self.mapBounds,
                    building.tile,
                    { width: building.size, height: building.size },
                    1,
                    1,
                    (tile) => {
                        const isValid =
                            self.passability.getPassableSpeed(
                                tile,
                                unit.rules.speedType,
                                unit.isInfantry(),
                                false,
                            ) > 0 &&
                            Math.abs(tile.z - building.tile.z) < 2 &&
                            self.passability.findObstacles({ tile, onBridge: undefined }, unit).length === 0;
                        if (!fallback && isValid) fallback = tile;
                        return isValid && !self.terrain.hasOre(tile.rx, tile.ry);
                    },
                );
                return finder.getNextTile() ?? fallback;
            },
            spawnObject: (unit: Unit, tile: Tile) => self.spawnObject(unit, tile),
            refund: (player: any, unit: Unit) => {
                const pl = self.playerOf(player);
                if (pl) pl.credits = Math.min(MAX_CREDITS, pl.credits + unit.def.cost);
            },
            isNeutral: (player: any) => !!self.playerOf(player)?.isNeutral,
            log: (message: string) => console.warn(message),
        };
    }

    /** world adapter for SuperWeaponTrait */
    private get superWeaponWorld(): SuperWeaponWorld {
        const self = this;
        return {
            createSuperWeapon: (name: string, player: PlayerState) => {
                if (!self.options.superWeapons) return null;
                const sid = name as SuperWeaponId;
                if (!SUPER_WEAPONS[sid]) return null;
                /*
                 * The object that goes into `player.sw` *is* the one the trait
                 * stores — `add()` mirrors it, so `swOf` and the HUD see the same
                 * instance the trait manages.
                 */
                const st: any = {
                    id: sid,
                    name,
                    t: 0,
                    total: SUPER_WEAPONS[sid].charge,
                    ready: false,
                    sourceId: 0,
                };
                return st;
            },
            getOwnedBuildings: (player: PlayerState) => player?.buildings ?? [],
            pauseIfLowPower: (player: PlayerState, superWeapon: any) => {
                // the reference pauses a fresh weapon when the grid is already brown;
                // here `tickSuperWeapons` gates the whole charge on `radarOnline`,
                // which is the same predicate, so nothing extra is needed
                void player;
                void superWeapon;
            },
        };
    }

    /** world adapter for UnitRepairTrait (airfield pad repair) */
    private get repairWorld(): RepairWorld {
        const self = this;
        return {
            currentTick: this.simWorld.currentTick,
            repairRules: GENERAL.repair,
            baseTicksPerSecond: GENERAL.baseTicksPerSecond,
            dockedUnits: (building: Building) => building.dockTrait?.getDockedUnits() ?? [],
            hasDockedUnits: (building: Building) => !!building.dockTrait?.hasDockedUnits(),
            undockUnit: (building: Building, unit: any) => building.dockTrait?.undockUnit(unit),
            isAirUnit: (unit: any) => !!unit?.isAirborne,
            areFriendly: (a: any, b: any) => a.owner === b.owner,
            isPoweredOn: (building: Building) => !building.poweredTrait || building.poweredTrait.isPoweredOn(),
            healBy: (unit: Unit, amount: number, _source: any) => {
                unit.hp = Math.min(unit.maxHp, unit.hp + amount);
            },
            getCredits: (player: any) => this.playerOf(player)?.credits ?? 0,
            spendCredits: (player: any, amount: number) => {
                const pl = this.playerOf(player);
                if (pl) pl.credits = Math.max(0, pl.credits - amount);
            },
            purchaseValue: (unit: Unit) => unit.def.cost,
            findRallyNode: (building: Building) => {
                const rp = (building.rallyTrait as any)?.rallyPoint ?? building.rally;
                if (!rp) return undefined;
                const rx = rp.rx ?? Math.floor((rp.x + HALF) / TILE);
                const ry = rp.ry ?? Math.floor((rp.y + HALF) / TILE);
                const tile = self.tiles.getByMapCoords(rx, ry);
                return tile ? { tile, onBridge: false } : undefined;
            },
            sendToRallyPoint: (unit: Unit, rallyNode: any) => {
                self.startMove(unit, rallyNode.tile, { closeEnoughTiles: GENERAL.closeEnough });
            },
            resetRallyPoint: (building: Building) => {
                // reference computeDefaultRallyPoint: one cell below the footprint
                const tile = self.tiles.getByMapCoords(building.tx, building.ty + building.size);
                if (tile && building.rallyTrait) {
                    (building.rallyTrait as any).changeRallyPoint?.(tile, building, self as any);
                }
            },
            hasFactory: (building: Building) => !!building.factoryTrait,
            onRepairStart: () => {},
            onRepairFinish: () => {},
            usesReloadRate: (building: Building) => !!building.unitReloadTrait,
            isNeutral: (player: any) => !!this.playerOf(player)?.isNeutral,
            needsEngineer: (building: Building) => !!building.rules.needsEngineer,
            hasHelipad: (building: Building) => !!building.helipadTrait,
        };
    }

    /** world adapter for WallTrait */
    private get wallWorld(): WallWorld {
        const self = this;
        return {
            objectsOnTile: (tile: Tile) => {
                const b = self.buildingAt(tile.rx, tile.ry);
                return b ? [b] : [];
            },
            getTile: (rx: number, ry: number) => self.tiles.getByMapCoords(rx, ry),
            neighbourTiles: (tile: Tile) => self.tiles.getAllNeighbourTiles(tile),
            landTypeOf: (tile: Tile) => tile.landType,
            wallLandType: LandType.Wall,
            destroyObject: (wall: Building, source: any) => {
                self.kill(wall, source?.player ?? wall.owner, source?.obj ?? null);
            },
            inflictsDamage: (wall: Building, amount: number, source: any) => {
                self.damage(wall, amount, 'explosive', source?.player ?? wall.owner, source?.obj ?? null, true);
            },
        };
    }

    /** world adapter for C4ChargeTrait */
    private get c4World(): C4World {
        const self = this;
        return {
            currentTick: this.simWorld.currentTick,
            destroyObject: (target: Entity, attackerInfo: any, isDemolish: boolean) => {
                if (target.dead) return;
                if (isDemolish && target instanceof Building) {
                    target.deathType = DeathType.Demolish;
                }
                self.kill(target, attackerInfo?.player ?? target.owner, attackerInfo?.obj ?? null);
            },
        };
    }

    /** world adapter for SpawnLinkTrait */
    private get spawnLinkWorld(): SpawnLinkWorld {
        const self = this;
        const centerOf = (o: any) => (o?.x !== undefined ? o : o?.tile ? { x: o.tile.rx * TILE + TILE / 2 - HALF, y: o.tile.ry * TILE + TILE / 2 - HALF } : undefined);
        return {
            currentTick: this.simWorld.currentTick,
            currentTargetOf: (obj: any) => obj?.attackTarget ?? undefined,
            isInWeaponRange: (source: any, target: any) => {
                const w = source?.def?.weapon;
                if (!w) return false;
                const a = centerOf(source);
                const b = centerOf(target);
                if (!a || !b) return false;
                return Math.hypot(b.x - a.x, b.y - a.y) <= w.range;
            },
            hasAmmo: (obj: any) => !obj.ammoTrait || obj.ammo === undefined || obj.ammo > 0,
            canTarget: (weapon: any, target: any) =>
                !!weapon && (!(target?.isAir) || !!weapon.antiAir),
            attackTask: (child: any, target: any) => {
                child.attackTarget = target;
                if (target?.x !== undefined) self.pathToEntity(child, target);
                return undefined;
            },
            cancelAllTasks: (child: any) => child.orders?.clear?.(child),
            addTask: (child: any, task: any) => {
                if (task) child.orders?.addTask?.(task);
            },
            getCurrentTask: (obj: any) => obj?.orders?.getCurrentTask?.(),
            requestTargetUpdate: () => {},
            cancelTask: (task: any) => task?.cancel?.(),
            attackStateIdle: (task: any) => !task,
            isAttackTask: (task: any) => !!task?.isAttackTask,
            moveTask: (child: any, tile: any) => {
                self.startMove(child, tile, { closeEnoughTiles: 0 });
                return child.orders?.getCurrentTask?.();
            },
            updateMoveTarget: (task: any, tile: any) => task?.updateTarget?.(tile, false),
            isMoveTask: (task: any) => !!task?.path,
        };
    }

    /** world adapter for UnlandableTrait */
    private get unlandableWorld(): UnlandableWorld {
        return {
            shouldLeave: (obj: any) => !!this.players[obj?.owner]?.isNeutral || !!obj?.def?.unlandable,
            isIdle: (obj: any) => !obj?.orders?.hasTasks?.(),
            mapSize: () => this.tiles.getMapSize(),
            getTile: (rx: number, ry: number) => this.tiles.getByMapCoords(rx, ry),
            generateRandom: () => this.rng(),
            exitMoveTask: (obj: any, exitTile: any) => {
                this.startMove(obj, exitTile, { closeEnoughTiles: 0 });
                return undefined;
            },
            unspawn: (obj: any) => {
                if (!obj?.dead) this.kill(obj, obj.owner, null);
            },
            addTask: (obj: any, task: any) => {
                if (task) obj.orders?.addTask?.(task);
            },
            cancelAllTasks: (obj: any) => obj?.orders?.clear?.(obj),
        };
    }

    /** world adapter for OverpoweredTrait */
    private get overpoweredWorld(): OverpoweredWorld {
        return {
            currentTargetOf: (obj: any) => obj?.attackTarget ?? obj?.focus ?? undefined,
            getCurrentTask: (obj: any) => obj?.orders?.getCurrentTask?.(),
            setTaskWeapon: () => {},
            cancelTask: (task: any) => task?.cancel?.(),
            isPoweredOn: (obj: any) => !obj?.poweredTrait || obj.poweredTrait.isPoweredOn(true),
        };
    }

    /** queued for after the current tick, like the reference's world.afterTick */
    private afterTickQueue: Array<() => void> = [];
    afterTick(fn: () => void): void {
        this.afterTickQueue.push(fn);
    }

    /** world adapter for GatherOreTask / ReturnOreTask */
    private get harvestWorld(): HarvestWorld {
        const self = this;
        return {
            // the tasks build MoveTasks, which talk to the shared sim world
            ...this.simWorld,
            general: {
                closeEnough: GENERAL.closeEnough,
                harvesterTooFarDistance: GENERAL.harvesterTooFarDistance,
            },
            gemValue: GEM_BAIL_VALUE,
            isOreTile: (tile: Tile) => this.terrain.hasOre(tile.rx, tile.ry),
            oreValueAt: (tile: Tile) => this.terrain.oreValueAt(tile.rx, tile.ry),
            collectBail: (tile: Tile) => {
                const before = this.terrain.hasOre(tile.rx, tile.ry);
                const value = this.terrain.collectBail(tile.rx, tile.ry);
                // the last bail clears the overlay: the cell becomes clear
                // ground for pathing, exactly like removing a tiberium object
                if (before && !this.terrain.hasOre(tile.rx, tile.ry)) this.syncTiles();
                return value;
            },
            hasRefinery: (unit: Unit) => unit.owner != null && this.players[unit.owner].buildings.some((b) => !!b.def.dropoff && !b.dead),
            findRefinery: (unit: Unit) => this.findRefineryFor(unit),
            refineryDockTile: (refinery: Building) => this.refineryDockTile(refinery),
            deliverOre: (unit: Unit, refinery: Building) => this.deliverOre(unit, refinery),
            createGatherTask: (unit: Unit, target?: Tile, explicit?: boolean) => new GatherOreTask(self.harvestWorld, target, !!explicit),
            createReturnTask: (unit: Unit, forceTarget?: Building) => new ReturnOreTask(self.harvestWorld, forceTarget),
            tileDistance: (a: Tile, b: Tile) => Math.max(Math.abs(a.rx - b.rx), Math.abs(a.ry - b.ry)),
            afterTick: (fn: () => void) => this.afterTick(fn),
        };
    }

    /**
     * Reference ReturnOreTask.findClosestReachableRefinery: prefer the nearest
     * refinery with a free pad, but never walk past a closer one by more than
     * HarvesterTooFarDistance.
     */
    private findRefineryFor(unit: Unit): Building | undefined {
        const p = this.players[unit.owner];
        const refineries = p.buildings
            .filter((b) => !b.dead && !!b.def.dropoff && !!b.dockTrait)
            .sort((a, b) => this.cellDist(unit.tile, a.tile, a.size) - this.cellDist(unit.tile, b.tile, b.size));
        const closest = refineries[0];
        const available = refineries.find((b) => (b.dockTrait?.getAvailableDockCount() ?? 0) > 0);
        if (!available || !closest) return closest;
        if (this.cellDist(unit.tile, available.tile, available.size) - this.cellDist(unit.tile, closest.tile, closest.size) > GENERAL.harvesterTooFarDistance) {
            return closest;
        }
        return available;
    }

    private cellDist(from: Tile, to: Tile, size: number): number {
        const cx = to.rx + Math.floor(size / 2);
        const cy = to.ry + Math.floor(size / 2);
        return Math.abs(from.rx - cx) + Math.abs(from.ry - cy);
    }

    /** the refinery pad: right edge + 1, vertical middle (reference DockingOffset0) */
    refineryDockTile(refinery: Building): Tile | undefined {
        return this.tiles.getByMapCoords(refinery.tx + refinery.size, refinery.ty + Math.floor(refinery.size / 2));
    }

    /**
     * Reference ReturnOreTask unload:
     *   credits += ore * 25 + gems * 50
     *   purifier bonus: +25% per powered ore purifier
     *   AI houses get virtual purifiers (brutal 4, normal 2) — the retail
     *   economy cheat, reproduced here because the AI is expected to field
     *   combined arms, not to out-mine the player.
     */
    private deliverOre(unit: Unit, refinery: Building): void {
        const p = this.players[refinery.owner];
        const h = unit.harvesterTrait;
        if (!h) return;
        const oreValue = h.ore * ORE_BAIL_VALUE + h.gems * GEM_BAIL_VALUE;
        p.credits = Math.min(MAX_CREDITS, p.credits + oreValue);
        p.earned += oreValue;
        let purifierCount = p.buildings.filter((b) => !b.dead && (b.def as any).orePurifier).length;
        if (p.isAi) {
            purifierCount += this.difficulty === 'hard' ? 4 : this.difficulty === 'normal' ? 2 : 0;
        }
        if (purifierCount > 0) {
            const bonus = purifierCount * Math.floor(oreValue * GENERAL.purifierBonus);
            p.credits = Math.min(MAX_CREDITS, p.credits + bonus);
            p.earned += bonus;
        }
        if (p.isHuman) {
            this.events.onMessage?.(`${refinery.def.name} 卸货 +${oreValue}`, 'good');
            this.events.onSfx?.('unload', refinery.x, refinery.y);
        }
    }

    /** world adapter for FactoryTrait */
    private get factoryWorld() {
        return {
            tiles: this.tiles,
            mapBounds: this.mapBounds,
            passability: this.passability,
            tileOccupation: this.occupancy,
            general: GENERAL,
            createUnitForPlayer: (rules: UnitDef, owner: PlayerState) => this.createUnitForPlayer(rules, owner),
            spawnObject: (unit: Unit, tile: Tile) => this.spawnObject(unit, tile),
            startExitMove: (unit: Unit, building: Building, rallyPoint: Tile) =>
                this.startMove(unit, rallyPoint, { closeEnoughTiles: GENERAL.closeEnough }),
            isTileOccupiedBy: (tile: Tile, building: Building) => this.buildingAt(tile.rx, tile.ry) === building,
            getProduction: (pid: PlayerId) => this.players[pid]?.production,
            getBuildings: (pid: PlayerId) => this.players[pid]?.buildings ?? [],
            getPlayer: (pid: PlayerId) => this.players[pid],
        };
    }

    /**
     * Reference `world.createUnitForPlayer` — build the object and its traits,
     * but do not put it on the map yet. FactoryTrait spawns it at the exit cell.
     */
    createUnitForPlayer(def: UnitDef, owner: PlayerState | PlayerId): Unit {
        const pid = typeof owner === 'number' ? owner : owner.id;
        const u = new Unit(def, pid, 0, 0);
        u.player = this.players[pid];
        this.initUnit(u);
        return u;
    }

    /**
     * Resolve "a player or a player id" to the PlayerState.
     *
     * Ported traits pass whatever the reference passed (a player object), but
     * several call paths in this project still hold a numeric id — the same trap
     * that silently broke harvesting and factory production in v0.23. Every
     * adapter that receives a `player` goes through here.
     */
    private playerOf(o: any): PlayerState | undefined {
        if (o === undefined || o === null) return undefined;
        return typeof o === 'number' ? this.players[o] : o;
    }

    /** wire the reference traits a unit owns, once, before it is spawned */
    private initUnit(u: Unit) {
        /*
         * Reference state machine wiring.
         *
         * A fresh unit owns a MoveTrait (velocity / reservation / state), an
         * order queue and a Position adapter; the tile occupation table learns
         * about it before the first tick, exactly like spawn in the reference.
         */
        u.moveTrait = new MoveTrait(u, this.occupancy);
        u.moveTrait.onTileChange = (oldTile, newTile) => this.onUnitTileChange(u, oldTile, newTile);
        u.orders = new UnitOrders();
        u.position = new Position(u, this.tiles);

        if (u.def.kind === 'harvester') {
            /*
             * The project's `def.cargo` is a credit figure (300 cr); the
             * reference stores `Storage` in *bails* (a retail harvester has 20
             * bails ≈ 500 cr of ore). Converting keeps the intended capacity
             * while letting GatherOreTask count bails exactly like the original.
             */
            const storageBails = Math.max(1, Math.round((u.def.cargo ?? GENERAL.harvesterStorage * ORE_BAIL_VALUE) / ORE_BAIL_VALUE));
            u.harvesterTrait = new HarvesterTrait(storageBails);
            u.harvesterTrait.makeGatherTask = (_world: any, target?: Tile, explicit?: boolean) =>
                new GatherOreTask(this.harvestWorld, target, !!explicit);
            u.harvesterTrait.makeReturnTask = () => new ReturnOreTask(this.harvestWorld);
        }
        if (u.hasTurret) {
            u.turretTrait = new TurretTrait();
            u.turretTrait.onSpawn(u);
        }
        if (u.isAir) {
            const maxAmmo = Math.max(1, Math.round((u.def as any).ammo ?? 1));
            let ammo = maxAmmo;
            u.ammoTrait = {
                get ammo() { return ammo; },
                set ammo(v: number) { ammo = Math.max(0, Math.min(maxAmmo, v)); },
                maxAmmo,
                isFull() { return ammo === maxAmmo; },
            };
            u.airportBoundTrait = new AirportBoundTrait(['airpad', 'strip']);
            // reference Aircraft.factory: every non-missile aircraft can crash
            u.crashableTrait = new CrashableTrait(u);
        }
        // reference UnlandableTrait: transports and scripted fly-bys leave the map
        if ((u.def as any).unlandable) u.unlandableTrait = new UnlandableTrait();
        // reference SpawnLinkTrait: only a `spawner` child carries it; the parent
        // is bound by whoever launched it (there is no carrier in the roster yet)
        if ((u.def as any).spawnedBy) u.spawnLinkTrait = new SpawnLinkTrait();
        if (u.isInfantry()) {
            /*
             * Reference Infantry.factory, in the same order:
             *   fearless units get no SuppressionTrait at all
             *   spies (rules.agent) get AgentTrait
             *   everyone gets IdleActionTrait
             */
            if (!(u.def as any).fearless) u.suppressionTrait = new SuppressionTrait();
            if ((u.def as any).agent) u.agentTrait = new AgentTrait();
            u.idleActionTrait = new IdleActionTrait();
        }
        if (u.isVehicle()) {
            // reference Vehicle.factory: hover vehicles bob, tracked/wheeled ones tilt
            if (u.isHover) {
                u.hoverBobTrait = new HoverBobTrait();
                u.hoverBobTrait.onSpawn(u, this.hoverWorld());
            }
            u.rockingTrait = new RockingTrait();
        }
    }

    /** world adapter for HoverBobTrait */
    private hoverWorld(): any {
        return {
            hoverHeight: 6,
            hoverBob: 0.6,
            currentTick: this.simWorld.currentTick,
            bridgeElevation: () => 0,
        };
    }

    /**
     * `[AudioVisual] IdleActionFrequency` — seconds between idle actions.
     * Retail default 2 s; the trait subtracts up to half of it at random.
     */
    private static readonly IDLE_ACTION_FREQUENCY = 2;

    /** world adapter for IdleActionTrait */
    private get infantryWorld(): any {
        return {
            idleActionFrequency: Game.IDLE_ACTION_FREQUENCY,
            random: () => this.rng(),
            scatterUnit: (unit: Unit) => this.scatterUnit(unit),
        };
    }

    /**
     * Reference ScatterTask applied to one unit.
     *
     * Picks the neighbouring free cell furthest from the unit's current
     * attackers and walks there; a fraidycat civilian does this on its own.
     */
    /**
     * Run a few cells away from the nearest threat.
     *
     * `ignored` is the reference's `ScatterTask` option: a unit that has just
     * been thrown out of a building by `CrewedTrait` must not treat that very
     * building as the thing to run away from, so its own wreck is excluded from
     * the threat scan.
     */
    private scatterUnit(u: Unit, ignored: any[] = []): void {
        if (u.dead) return;
        let best: Tile | null = null;
        let bestScore = -Infinity;
        const tx = Math.floor((u.x + HALF) / TILE);
        const ty = Math.floor((u.y + HALF) / TILE);
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                if (!dx && !dy) continue;
                const tile = this.tiles.getByMapCoords(tx + dx, ty + dy);
                if (!tile) continue;
                if (this.passability.getPassableSpeed(tile, u.rules.speedType, u.isInfantry(), false) <= 0) continue;
                let score = Math.hypot(dx, dy);
                for (const threat of this.units) {
                    if (threat.dead || threat.owner === u.owner) continue;
                    if (ignored.includes(threat)) continue;
                    score += Math.min(8, dist(tile.rx * TILE + TILE / 2 - HALF, tile.ry * TILE + TILE / 2 - HALF, threat.x, threat.y) / TILE) * 0.5;
                }
                if (score > bestScore) { bestScore = score; best = tile; }
            }
        }
        if (best) this.startMove(u, best, { closeEnoughTiles: 0 });
    }

    /**
     * World adapter for CrashableTrait.
     *
     * WingedLocomotor.tickCrash: pick a random roll/pitch delta once, then spin
     * the hull by it and descend 30 leptons per tick. JumpjetLocomotor.tickCrash
     * instead yaws 6° and drops `2 * jumpjetCrash` straight down.
     */
    private get crashWorld(): CrashWorld {
        const self = this;
        return {
            crashMovement(unit: Unit, state: any) {
                const jumpjet = (unit.def as any).jumpjet;
                if (jumpjet) {
                    const rate = 2 * ((unit.def as any).jumpjetCrash ?? 50);
                    unit.direction = (unit.direction - 6 + 360) % 360;
                    return { x: 0, y: -rate, z: 0 };
                }
                if (state.rollDelta === undefined) state.rollDelta = Math.floor(self.rng() * 31) - 15;
                if (state.pitchDelta === undefined) state.pitchDelta = Math.floor(self.rng() * 16);
                /*
                 * The reference drops a fixed 30 leptons per tick, and a retail
                 * aircraft sits at ~2000 leptons — so the fall always takes
                 * about 66 ticks (1.1 s). Our altitude is in px (26-34), so the
                 * rate is derived from the altitude instead of hard-coded:
                 * same fall duration, same feel.
                 */
                if (state.fallRate === undefined) {
                    const alt = unit.crashAltitude ?? unit.altitude ?? 0;
                    state.fallRate = Math.max(0.4, alt / 66);
                }
                unit.roll = (unit.roll ?? 0) + state.rollDelta;
                unit.pitch = (unit.pitch ?? 0) + state.pitchDelta;
                // keep the last horizontal velocity and fall
                return { x: unit.vx * 0.5, y: unit.vy * 0.5, z: -state.fallRate };
            },
            moveBy(unit: Unit, dx: number, dy: number, dz: number): boolean {
                const alt = unit.crashAltitude ?? unit.altitude ?? 0;
                const nextAlt = alt + dz;
                unit.crashAltitude = nextAlt;
                unit.x += dx;
                unit.y += dy;
                if (unit.x < -HALF + 8 || unit.x > HALF - 8 || unit.y < -HALF + 8 || unit.y > HALF - 8) return true;
                return nextAlt <= 0;
            },
            destroyCrashed(unit: Unit, attackerInfo: any) {
                // the wreck does splash damage on impact, exactly like retail
                self.impactFx(unit.x, unit.y, unit.def.radius * 2.2);
                self.kill(unit, attackerInfo?.player ?? unit.owner, attackerInfo ?? null);
            },
        };
    }

    /** damage every unit/building in a small radius (crash impact) */
    private impactFx(x: number, y: number, radius: number): void {
        this.pushFx(x, y, 'boom', 0.9, radius / TILE);
        this.events.onShake?.(2.5);
        const dmg = 40;
        for (const u of this.units) {
            if (u.dead || u.isAir) continue;
            const d = dist(x, y, u.x, u.y);
            if (d <= radius) this.damage(u, dmg * (1 - d / radius), 'explosive', 2);
        }
        for (const b of this.buildings) {
            if (b.dead) continue;
            const d = dist(x, y, b.x, b.y);
            if (d <= radius + b.radius) this.damage(b, dmg * (1 - d / (radius + b.radius)) * 0.4, 'explosive', 2);
        }
    }

    /** world adapter for AirportBoundTrait */
    private get airportWorld(): AirportWorld {
        const self = this;
        return {
            buildingsOf: (pid: PlayerId) => this.players[pid]?.buildings ?? [],
            nameOf: (building: Building) => building.def.id,
            sendToAirport: (unit: Unit, airport: Building) => {
                if (unit.dockedAt === airport) return;
                const tile = airport.dockTrait?.getDockTile(0) ?? airport.tile;
                if (!tile) return;
                if (this.tileAt(unit.x, unit.y) !== tile) this.startMove(unit, tile, { closeEnoughTiles: 0 });
            },
            crashAircraft: (unit: Unit) => this.startCrash(unit, unit.owner, null),
        };
    }

    /**
     * Aircraft per-tick work — the slice of WingedLocomotor.tickStationary that
     * this project models.
     *
     *   - out of ammo  -> fly to the home pad and land
     *   - on the pad   -> UnitReloadTrait refills one round at a time
     *   - full again   -> take off and resume fighting
     *
     * Retail picks the pad at `preferredAirport` first and only re-scans when it
     * is gone or full; that is what stops two aircraft from swapping pads in
     * mid-air forever.
     */
    private updateAircraft(u: Unit, dt: number): void {
        const ammo = u.ammoTrait;
        const bound = u.airportBoundTrait;
        if (!ammo || !bound) {
            this.updateCombatant(u, dt);
            return;
        }

        const outOfAmmo = ammo.ammo <= 0;
        if (u.landed) {
            const pad = u.dockedAt as Building | undefined;
            if (!pad || pad.dead) {
                u.landed = false;
                u.dockedAt = undefined;
                bound.clearPreferredAirport();
                return;
            }
            u.moveTrait.setDisabled(true);
            if (ammo.isFull()) {
                // rearmed: release the pad and launch
                pad.dockTrait?.undockUnit(u);
                u.landed = false;
                u.dockedAt = undefined;
                u.moveTrait.setDisabled(false);
                this.events.onSfx?.('unitready', u.x, u.y);
            }
            return;
        }

        if (!outOfAmmo) {
            this.updateCombatant(u, dt);
            return;
        }

        // out of ammo: head home. No pad anywhere -> the reference crashes it.
        const airport = bound.ensureAirport(u, this.airportWorld);
        if (!airport) return;
        const dockTile = airport.dockTrait?.getDockTile(0) ?? airport.tile;
        if (dockTile && this.tileAt(u.x, u.y) === dockTile) {
            u.landed = true;
            u.dockedAt = airport;
            u.x = dockTile.rx * TILE + TILE / 2 - HALF;
            u.y = dockTile.ry * TILE + TILE / 2 - HALF;
            u.orders?.clear(u);
            u.moveTrait.resetIdle();
            /*
             * Reference MoveToDockTask.onEnd: the reservation becomes an actual
             * dock. Without this the pad still reports "reserved, not occupied",
             * `hasDockedUnits()` stays false and UnitReloadTrait never ticks —
             * the aircraft would sit on the pad with an empty magazine forever.
             */
            const padDock = airport.dockTrait;
            if (padDock) {
                const reserved = padDock.getReservedDockForUnit(u);
                const dockNumber = reserved ?? padDock.getFirstEmptyDockNumber() ?? 0;
                padDock.unreserveDockForUnit(u);
                padDock.dockUnitAt(u, dockNumber);
            }
        }
    }

    /** world adapter for UnitReloadTrait */
    private get reloadWorld() {
        return { reloadRateMinutes: GENERAL.reloadRate, currentTick: this.simWorld.currentTick };
    }

    /** world adapter for HelipadTrait */
    private get helipadWorld() {
        return {
            airportBoundAircraft: (pid: PlayerId) =>
                this.units.filter((u) => !u.dead && u.owner === pid && u.isAir && !!u.airportBoundTrait),
        };
    }

    /**
     * Reference `world.spawnObject(unit, tile)` — the tile is authoritative.
     * Sub-cell fitting and the occupancy write happen here so every spawn path
     * (factory, script, test) behaves identically.
     */
    spawnObject(u: Unit, tile?: Tile): void {
        if (!tile) tile = this.tileAt(u.x, u.y);
        const infantry = u.def.kind === 'infantry';
        let target = tile;
        const roomHere = infantry
            ? this.occupancy.getGroundObjectsOnTile(target).filter((o: any) => o.isInfantry()).length < 3
            : this.occupancy.getGroundObjectsOnTile(target).filter((o: any) => o.isUnit()).length === 0;
        if (!roomHere) {
            const spot = this.findSpawnCell(u, target.rx, target.ry, 4);
            if (spot) target = this.tiles.getByMapCoords(spot.tx, spot.ty) ?? target;
        }
        u.tile = target;
        u.position.tile = target;
        u.x = target.rx * TILE + TILE / 2 - HALF;
        u.y = target.ry * TILE + TILE / 2 - HALF;
        u.prevX = u.x;
        u.prevY = u.y;
        if (infantry) {
            const used = this.occupancy
                .getGroundObjectsOnTile(target)
                .filter((o: any) => o !== u && o.isInfantry())
                .map((o: any) => o.position.desiredSubCell);
            const free = [2, 4, 3].find((k) => used.indexOf(k) === -1) ?? 2;
            u.subCell = free;
            u.desiredSubCell = free;
            const off = u.position.computeSubCellOffset(free);
            u.x = target.rx * TILE + off.x - HALF;
            u.y = target.ry * TILE + off.y - HALF;
        }
        this.occupancy.occupySingleTile(target, u);
        this.units.push(u);
        this.players[u.owner].built++;
        u.harvesterTrait?.onSpawn(u, this.harvestWorld);
        this.events.onSpawn?.(u);
    }

    spawnUnit(owner: PlayerId, def: UnitDef, x: number, y: number): Unit {
        let px = clamp(x, -HALF + 20, HALF - 20);
        let py = clamp(y, -HALF + 20, HALF - 20);
        // never appear inside a wall or a structure footprint
        if (this.worldBlockedAt(px, py, def.radius)) {
            const spot = this.nearestStandable(
                Math.floor((px + HALF) / TILE), Math.floor((py + HALF) / TILE), def.radius, 5,
            );
            if (spot) { px = spot.x; py = spot.y; }
        }
        const u = this.createUnitForPlayer(def, owner);
        this.spawnObject(u, this.tileAt(px, py));
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
        /*
         * "Would this structure cut its owner off from income?"
         *
         * The candidate is hypothetical, so it must NOT be written into the
         * shared occupation table: doing that invalidates the passability graph
         * twice per candidate and forces a full rebuild + island pass, which is
         * what made the AI freeze for a few frames every time it picked a build
         * spot. Instead we flood the *cached* graph with the footprint treated
         * as walls — one pass, no mutation, no rebuild.
         */
        const blocked = (t: Tile) => tx <= t.rx && t.rx < tx + def.size && ty <= t.ry && t.ry < ty + def.size;
        const origin = core ? this.freeCellNear(core) : refineries.length ? this.freeCellNear(refineries[0]) : null;
        if (!origin) return false;
        const reach = this.passability.computeReachableMask(origin, SpeedType.Track, false, blocked);
        const reachable = (t: Tile) => reach[t.ry * MAP_TILES + t.rx] === 1;
        let sealed = false;
        for (const r of refineries) {
            const cell = this.freeCellNear(r);
            if (!cell || !reachable(cell)) { sealed = true; break; }
            const node = this.nearestNode(r.x, r.y);
            if (node) {
                const oreCell = this.tileAt(node.x, node.y);
                if (!reachable(oreCell)) { sealed = true; break; }
            }
        }
        return sealed;
    }

    /** a driveable cell touching the structure's footprint (building centres are walls) */
    private freeCellNear(b: Building): Tile | null {
        for (let ty = b.ty - 1; ty <= b.ty + b.size; ty++) {
            for (let tx = b.tx - 1; tx <= b.tx + b.size; tx++) {
                const onRing = tx === b.tx - 1 || ty === b.ty - 1 || tx === b.tx + b.size || ty === b.ty + b.size;
                if (!onRing) continue;
                const t = this.tiles.getByMapCoords(tx, ty);
                if (!t) continue;
                if (this.passability.getPassableSpeed(t, SpeedType.Track, false) > 0) return t;
            }
        }
        return null;
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
                        const tile = this.tiles.getByMapCoords(nx, ny);
                        if (!tile) continue;
                        const here = this.occupancy.getGroundObjectsOnTile(tile);
                        if (pass === 0 && here.length) continue;
                        const room = u.def.kind === 'infantry'
                            ? here.filter((o: any) => o.isInfantry()).length < 3
                            : here.filter((o: any) => o.isUnit()).length === 0;
                        if (!room) continue;
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

    /**
     * Power grid — straight from the player's PowerTrait.
     *
     * `made` is health-scaled output, `used` the sum of consumers. `ok` is the
     * only question the rest of the game asks: low power slows production,
     * blacks out radar and disables powered defences.
     */
    power(p: PlayerState) {
        const pt = p.powerTrait;
        return { made: pt.getPower(), used: pt.getDrain(), ok: !pt.isLowPower() };
    }

    /** how fast production runs right now (power shortage slows it down) */
    prodFactor(p: PlayerState) {
        return p.production.buildSpeedModifier;
    }

    /** radar / minimap and super weapons need a healthy grid */
    radarOnline(p: PlayerState) { return !p.powerTrait.isLowPower(); }

    private factoryTypeFor(cat: ProdCat): FactoryType {
        if (cat === 'structure') return FactoryType.BuildingType;
        if (cat === 'infantry') return FactoryType.InfantryType;
        if (cat === 'aircraft') return FactoryType.AircraftType;
        return FactoryType.UnitType;
    }

    /** how many finished factories of a category the player owns */
    factoryCount(p: PlayerState, cat: ProdCat) {
        return p.production.getFactoryCount(this.factoryTypeFor(cat));
    }

    /**
     * Extra factories speed a queue up with diminishing returns.
     * Reference: `1 / pow(MultipleFactory, count - 1)`.
     */
    factorySpeed(p: PlayerState, cat: ProdCat) {
        const n = this.factoryCount(p, cat);
        if (n <= 1) return n === 1 ? 1 : 0;
        return Math.pow(1 / GENERAL.multipleFactory, n - 1);
    }

    primaryFactory(p: PlayerState, cat: ProdCat): Building | null {
        return p.production.getPrimaryFactory(this.factoryTypeFor(cat)) ?? null;
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
    queueInfo(p: PlayerState, cat: ProdCat): ProductionQueue { return p.queues[cat]; }

    readyStructure(p: PlayerState): QueueItem | null {
        const q = p.queues.structure;
        return q.ready ? (q.getFirst() as any) ?? null : null;
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

    queueBuild(defId: string, pid: PlayerId = 0) {
        const def = BUILDINGS[defId];
        const p = this.players[pid];
        if (!def) return false;
        if (this.lockReason(p, def)) {
            if (p.isHuman) this.events.onMessage?.(this.lockReason(p, def), 'warn');
            return false;
        }
        const q = p.queues.structure;
        if (q.ready) { if (p.isHuman) this.events.onMessage?.('已有建筑等待放置', 'warn'); return false; }
        if (q.currentSize >= q.maxSize) return false;
        q.push(def, 1, def.cost);
        if (p.isHuman) this.events.onMessage?.(`${def.name} 开始建造`, 'info');
        return true;
    }

    queueUnit(cat: ProdCat, defId: string, times = 1, pid: PlayerId = 0): number {
        const def = UNITS[defId];
        const p = this.players[pid];
        if (!def || cat === 'structure') return 0;
        if (this.lockReason(p, def)) {
            if (p.isHuman) this.events.onMessage?.(this.lockReason(p, def), 'warn');
            return 0;
        }
        const q = p.queues[cat];
        const before = q.currentSize;
        q.push(def, times, def.cost);
        const n = q.currentSize - before;
        if (n <= 0 && p.isHuman) this.events.onMessage?.('生产队列已满', 'warn');
        else if (n > 1 && p.isHuman) this.events.onMessage?.(`${def.name} × ${n} 已排队`, 'good');
        return n;
    }

    cancelQueue(cat: ProdCat, index: number, pid: PlayerId = 0) {
        const p = this.players[pid];
        const q = p.queues[cat];
        const item = q.getAll()[index];
        if (!item) return;
        // only the head row has been paid into; the rest are placeholders
        const refund = index === 0 ? Math.floor(item.creditsSpent) : 0;
        q.pop(item.rules, 1);
        p.credits = Math.min(MAX_CREDITS, p.credits + refund);
    }

    /** pull the finished structure out of the queue so it can be placed */
    takeReadyStructure(pid: PlayerId = 0): BuildingDef | null {
        const p = this.players[pid];
        const q = p.queues.structure;
        const item = q.getFirst();
        if (!q.ready || !item) return null;
        q.shift(item.rules, 1);
        return (item.defId ? BUILDINGS[item.defId] : null) || null;
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
        if (b.status !== BuildStatus.Ready || b.progress < 1) {
            this.events.onMessage?.('建筑还没建好，不能卖出', 'warn');
            return;
        }
        /* SellTrait.computeRefundValue: purchaseValue * RefundPercent */
        const ratio = clamp(b.hp / b.maxHp, 0.15, 1);
        b.refund = Math.floor(b.def.cost * GENERAL.refundPercent * ratio);
        b.setBuildStatus(BuildStatus.BuildDown);
        b.buildDur = GENERAL.buildupTime * 60;
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
        // reference NotifySell.onSell: selling is a demolition too, the crew leaves
        b.crewedTrait?.onSell(b, this.crewWorld);
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
        if (b.dead) return;
        b.dead = true;
        this.occupancy.unoccupyTileRange(b.tile, b);
        this.unregisterBuilding(b);
        // reference NotifyUnspawn: the wall tells its neighbours to re-tile
        b.wallTrait?.onUnspawn(b, this.wallWorld);
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
            if (!b.occupies(u.tile.rx, u.tile.ry)) continue;
            const spot = this.nearestStandable(u.tile.rx, u.tile.ry, u.radius, 4);
            if (spot) {
                this.occupancy.unoccupySingleTile(u.tile, u);
                u.x = spot.x;
                u.y = spot.y;
                u.tile = this.tileAt(spot.x, spot.y);
                this.occupancy.occupySingleTile(u.tile, u);
            }
        }
        this.events.onDeath?.(b);
    }

    /**
     * Reference NotifyUnspawn fan-out: power off the grid, hand the factory
     * title to an heir, decrement the factory count, and drop any queued item
     * whose prerequisites just disappeared (ProductionTrait.ensurePrerequisites).
     */
    private unregisterBuilding(b: Building): void {
        const p = this.players[b.owner];
        const idx = p.buildings.indexOf(b);
        if (idx !== -1) p.buildings.splice(idx, 1);

        if (b.def.power !== 0) p.powerTrait.updateFrom(b, 'remove', this.powerWorld);
        b.dockTrait?.onUnspawn();
        // reference HelipadTrait.onUnspawn: the owner's aircraft re-home
        b.helipadTrait?.onUnspawn?.(b, this.helipadWorld);
        // reference SuperWeaponTrait.onUnspawn: drop the weapon unless a sibling stands
        b.superWeaponTrait?.onUnspawn(b, this.superWeaponWorld);

        const type = (b.factoryTrait as any)?.type;
        if (type !== undefined) {
            if (p.production.getPrimaryFactory(type) === b) p.production.crownPrimaryFactoryHeir(type);
            p.production.decrementFactoryCount(type);
        }
        this.ensurePrerequisites(p);
    }

    /**
     * Engineer capture / owner change — reference NotifyOwnerChange fan-out for
     * power, factories and the player's building list.
     */
    private changeBuildingOwner(b: Building, newOwner: PlayerId): void {
        const oldOwner = this.players[b.owner];
        const idx = oldOwner.buildings.indexOf(b);
        if (idx !== -1) oldOwner.buildings.splice(idx, 1);
        if (b.def.power !== 0) oldOwner.powerTrait.updateFrom(b, 'remove', this.powerWorld);
        const type = (b.factoryTrait as any)?.type;
        if (type !== undefined) {
            if (oldOwner.production.getPrimaryFactory(type) === b) oldOwner.production.crownPrimaryFactoryHeir(type);
            oldOwner.production.decrementFactoryCount(type);
        }

        b.owner = newOwner;
        const p = this.players[newOwner];
        b.player = p;
        p.buildings.push(b);
        if (b.def.power !== 0) p.powerTrait.updateFrom(b, 'add', this.powerWorld);
        if (type !== undefined) {
            if (!p.production.getPrimaryFactory(type)) p.production.setPrimaryFactory(b);
            p.production.incrementFactoryCount(type);
        }
        this.ensurePrerequisites(oldOwner);
        this.ensurePrerequisites(p);
        // reference HelipadTrait.onChange: both sides re-home their aircraft
        b.helipadTrait?.onOwnerChange?.(b, oldOwner, this.helipadWorld);
        b.helipadTrait?.onOwnerChange?.(b, p, this.helipadWorld);
        // reference SuperWeaponTrait.onChange: the weapon follows the building
        b.superWeaponTrait?.onChange(b, oldOwner, p, this.superWeaponWorld);
    }

    private ensurePrerequisites(p: PlayerState): void {
        for (const queue of p.production.getAllQueues()) {
            const rows = queue.getAll();
            for (const item of rows) {
                if (!p.production.isAvailableForProduction(item.rules)) {
                    const refund = item.creditsSpent;
                    queue.pop(item.rules, item.quantity);
                    p.credits = Math.min(MAX_CREDITS, p.credits + refund);
                }
            }
        }
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
            /*
             * Reference: capture and demolition are two *different* orders.
             * `CaptureBuildingOrder` sends an engineer in; `AttackOrder` with
             * `isC4 = true` (a `c4` unit aiming at a hostile structure) runs
             * `PlantC4Task`. Our UI exposes capture on its own button, so the
             * attack command is what carries C4.
             */
            const o = this.engineerOrderFor(u, target, 'attack');
            if (append) this.appendOrder(u, o);
            else { u.orderQueue.length = 0; this.applyOrder(u, o); }
        }
    }

    orderCapture(target: Entity) {
        for (const u of this.selection) {
            if (u.dead || !u.isEngineer) continue;
            u.speedCap = 0;
            u.orderQueue.length = 0;
            this.applyOrder(u, this.engineerOrderFor(u, target, 'capture'));
        }
    }

    orderCaptureFor(u: Unit, target: Entity) {
        if (u.dead || !u.isEngineer) return;
        u.orderQueue.length = 0;
        this.applyOrder(u, this.engineerOrderFor(u, target, 'capture'));
    }

    /**
     * Which engineer action this order means.
     *
     * `mode === 'capture'` is the explicit capture button: always capture.
     * `mode === 'attack'` is the attack command, and that is where the
     * reference's `AttackOrder` C4 branch lives — a `c4` unit aiming at a
     * hostile structure with a `c4ChargeTrait` gets `isC4 = true` and plants a
     * charge instead of shooting. A c4 unit that is *not* an engineer (a future
     * Tanya-style commando) also takes this branch.
     */
    private engineerOrderFor(u: Unit, target: Entity, mode: 'attack' | 'capture'): Order {
        const canPlant =
            u.c4 &&
            target instanceof Building &&
            target.owner !== u.owner &&
            !!target.c4ChargeTrait &&
            !target.dead;
        if (canPlant && mode === 'attack') return { k: 'demolish', target };
        if (canPlant && !u.isEngineer && mode === 'capture') return { k: 'demolish', target };
        if (mode === 'capture') return { k: 'capture', target };
        return { k: 'attack', target };
    }

    /** deploy a specific MCV (AI expansion) */
    tryDeploy(u: Unit) { return this.deployMcv(u); }

    /** single-unit variants used by the AI */
    orderAttackFor(u: Unit, target: Entity) {
        if (u.dead) return;
        u.orderQueue.length = 0;
        this.applyOrder(u, this.engineerOrderFor(u, target, 'attack'));
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
        this.occupancy.unoccupySingleTile(u.tile, u);
        u.dead = true;
        this.events.onDeath?.(u);
        this.pushFx(b.x, b.y, 'build', 1.0, coreDef.size);
        this.events.onSfx?.('deploy');
        if (p.isHuman) this.events.onMessage?.('指挥核心已展开', 'good');
        return true;
    }

    /**
     * Reference `PlantC4Task.onEnter`.
     *
     * The charge is armed on the *target*, not carried by the engineer: the
     * engineer is consumed (the reference unspawns it inside `EnterBuildingTask`),
     * and `C4ChargeTrait` counts down on its own. Re-planting is refused by
     * `setCharge` while a charge is already ticking.
     */
    private plantC4(u: Unit, b: Building): void {
        if (!b.c4ChargeTrait || b.c4ChargeTrait.hasCharge()) return;
        const ticks = Math.floor(60 * GENERAL.c4Delay * GENERAL.baseTicksPerSecond);
        b.c4ChargeTrait.setCharge(ticks, { player: u.owner, obj: u });
        this.pushFx(b.x, b.y, 'spark', 0.5, b.size * 0.8);
        this.events.onSfx?.('place', b.x, b.y);
        const p = this.players[u.owner];
        if (p.isHuman) this.events.onMessage?.(`${u.def.name} 在 ${b.def.name} 上安放了炸药`, 'good');
        else this.events.onMessage?.(`${b.def.name} 被敌方${u.def.name}布置了炸药！`, 'warn');
        // reference: the planter does not survive planting
        this.occupancy.unoccupySingleTile(u.tile, u);
        u.dead = true;
        u.hp = 0;
        this.events.onDeath?.(u);
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
            this.changeBuildingOwner(b, u.owner);
            b.captured++;
            b.hp = Math.max(b.maxHp * 0.32, b.hp);
            b.repairing = false;
            this.pushFx(b.x, b.y, 'promote', 0.9, b.size);
            if (p.isHuman) this.events.onMessage?.(`已接管 ${b.def.name}`, 'good');
            else this.events.onMessage?.('我方建筑被敌方工兵接管', 'warn');
            this.events.onSfx?.('capture');
        }
        this.occupancy.unoccupySingleTile(u.tile, u);
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

    /* ------------------------------------------------------------ */
    /* movement — everything below goes through the ported MoveTask   */
    /* ------------------------------------------------------------ */

    /** height level + land kind for every cell, refreshed after map load */
    private syncTiles() {
        this.tiles.syncFrom(
            (rx, ry) => this.terrain.levelAt(rx, ry),
            (rx, ry) => {
                const i = this.terrain.idx(rx, ry);
                return getLandType(this.terrain.kind[i], this.terrain.solid[i] === 1);
            },
            (rx, ry) => this.terrain.kind[this.terrain.idx(rx, ry)],
        );
    }

    tileAt(x: number, y: number): Tile {
        const tx = clamp(Math.floor((x + HALF) / TILE), 0, MAP_TILES - 1);
        const ty = clamp(Math.floor((y + HALF) / TILE), 0, MAP_TILES - 1);
        return this.tiles.getByMapCoords(tx, ty)!;
    }

    /**
     * Test / editor hook: the terrain arrays were edited in place.
     *
     * The passability graph is cached per speed type, so a direct write to
     * `terrain.kind` / `terrain.solid` (which is what the probe scripts do to
     * sculpt a test arena) has to invalidate it or the next path query still
     * believes the old map.
     */
    rebuildPassability() {
        this.syncTiles();
        (this.passability as any).passabilityGraphs.clear();
        (this.passability as any).invalidatedTiles.clear();
    }

    tileOf(tx: number, ty: number): Tile | undefined {
        return this.tiles.getByMapCoords(tx, ty);
    }

    /**
     * Cancel the current order and start a reference MoveTask.
     *
     * This replaces the old "compute a polyline, then steer along it" model.
     * The task owns the whole journey: it plans, re-plans when blocked, waits,
     * pushes the blocker aside, or parks next to an occupied destination.
     */
    private startMove(u: Unit, tile: Tile | undefined, options?: {
        closeEnoughTiles?: number;
        strictCloseEnough?: boolean;
        forceWaitOnPathBlocked?: boolean;
    }) {
        if (!tile) return;
        u.stop();
        const task = new MoveTask(this.simWorld, tile, false, options);
        u.orders.addTask(task);
    }

    /**
     * Stand-off cell for shooting at `target`.
     *
     * Reference: MoveInWeaponRangeTask / AttackMoveTargetTask walk to the nearest
     * cell from which the weapon can hit. We aim at a point just outside the
     * target's hull along the current bearing, which is the same cell the retail
     * approach picks, and let MoveTask handle the rest.
     */
    private approachTile(u: Unit, target: Entity): Tile {
        if (target.isBuilding) {
            /*
             * A structure is a footprint, not a point: aiming at
             * `centre + radius` puts the destination INSIDE the building for the
             * diagonal approaches (a 3x3 core already extends 1.5 tiles), and the
             * move task then relocates the unit somewhere useless. Scan the ring
             * of cells around the footprint and take the closest driveable one.
             */
            const b = target as Building;
            let best: Tile | null = null;
            let bestD = Infinity;
            for (let ty = b.ty - 1; ty <= b.ty + b.size; ty++) {
                for (let tx = b.tx - 1; tx <= b.tx + b.size; tx++) {
                    const onRing = tx === b.tx - 1 || ty === b.ty - 1 || tx === b.tx + b.size || ty === b.ty + b.size;
                    if (!onRing) continue;
                    const t = this.tiles.getByMapCoords(tx, ty);
                    if (!t) continue;
                    if (!this.passability.getPassableSpeed(t, u.rules.speedType, u.isInfantry())) continue;
                    const wx = tx * TILE + TILE / 2 - HALF;
                    const wy = ty * TILE + TILE / 2 - HALF;
                    const d = Math.hypot(wx - u.x, wy - u.y);
                    if (d < bestD) { bestD = d; best = t; }
                }
            }
            if (best) return best;
        }
        const edge = target.isBuilding ? target.radius + TILE : target.radius + TILE * 0.6;
        const a = Math.atan2(u.y - target.y, u.x - target.x);
        return this.tileAt(target.x + Math.cos(a) * edge, target.y + Math.sin(a) * edge);
    }

    private pathToEntity(u: Unit, target: Entity): boolean {
        if (u.isAir) {
            u.stop();
            const task = new MoveTask(this.simWorld, this.tileAt(target.x, target.y), false, { closeEnoughTiles: 2 });
            u.orders.addTask(task);
            return true;
        }
        const tile = this.approachTile(u, target);
        this.startMove(u, tile, { closeEnoughTiles: 1, forceWaitOnPathBlocked: false });
        return true;
    }

    private moveUnitTo(u: Unit, x: number, y: number, keepOrder: boolean) {
        x = clamp(x, -HALF + 24, HALF - 24);
        y = clamp(y, -HALF + 24, HALF - 24);
        if (!keepOrder) u.order = { k: 'move', x, y };
        this.startMove(u, this.tileAt(x, y), { closeEnoughTiles: 0 });
    }

    /** a cell next to a structure where a truck can unload */
    private dockTile(u: Unit, drop: Building): Tile | undefined {
        const ring: Tile[] = [];
        const x0 = drop.tx - 1, y0 = drop.ty - 1;
        const x1 = drop.tx + drop.size, y1 = drop.ty + drop.size;
        for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
                const onRing = tx === x0 || ty === y0 || tx === x1 || ty === y1;
                if (!onRing) continue;
                const t = this.tiles.getByMapCoords(tx, ty);
                if (!t) continue;
                if (!this.passability.getPassableSpeed(t, SpeedType.Track, false)) continue;
                if (this.occupancy.getGroundObjectsOnTile(t).length) continue;
                ring.push(t);
            }
        }
        if (!ring.length) return this.tileAt(drop.x, drop.y);
        ring.sort((a, b) => {
            const da = Math.hypot(a.rx + 0.5 - (u.x + HALF) / TILE, a.ry + 0.5 - (u.y + HALF) / TILE);
            const db = Math.hypot(b.rx + 0.5 - (u.x + HALF) / TILE, b.ry + 0.5 - (u.y + HALF) / TILE);
            return da - db;
        });
        return ring[0];
    }

    /**
     * Explicit harvest order — reference OrderFactory.createGatherOrder.
     * The initial target is a *tile*; GatherOreTask walks to it and starts
     * collecting one bail per tick.
     */
    private startHarvest(u: Unit, node: CrystalNode | null) {
        u.stop();
        const target = node ? this.tileAt(node.x, node.y) : undefined;
        u.orders.addTask(new GatherOreTask(this.harvestWorld, target, true));
        u.harvesterTrait && (u.harvesterTrait.lastGatherExplicit = true);
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
    /**
     * Reconcile the player's super weapon bag with what is actually on the map.
     *
     * Adding is `SuperWeaponTrait.onSpawn`'s job — this pass only defends
     * against a provider that vanished through a path that forgot to unspawn it
     * (a scripted kill, a map reset). The trait keeps `p.sw` in sync via its
     * mirror, so there is exactly one authority.
     */
    private syncSuperWeapons(p: PlayerState) {
        if (!this.options.superWeapons) { p.superWeaponsTrait.clear(); return; }
        for (const st of p.superWeaponsTrait.getAll()) {
            const provider = p.buildings.find((b) => !b.dead && b.superWeaponTrait?.getName() === st.name);
            if (!provider) p.superWeaponsTrait.remove(st.name);
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
        this.tickMovement(dt);
        this.updateProjectiles(dt);
        this.updateFx(dt);
        this.tickZones(dt);
        this.tickSuperWeapons(dt);
        this.tickCrates(dt);

        if (this.aiEnabled) this.players[1].ai?.update(dt);

        // reference world.afterTick: spawn-time work that must not run inside
        // the same notification that queued it
        if (this.afterTickQueue.length) {
            const queued = this.afterTickQueue;
            this.afterTickQueue = [];
            for (const fn of queued) fn();
        }

        this.regenTimer += dt;
        if (this.regenTimer >= 2) {
            this.regenTimer = 0;
            this.terrain.regrow(14);
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
    /**
     * Reference ProductionTrait[NotifyTick.onTick] / ProductionTrait.tickQueue.
     *
     * The formula is copied: every tick the queue may spend
     *   `min(credits, cost/buildTime + leftover, remaining)`
     * and the item is done when `creditsSpent === creditsEach`. Money is only
     * taken as the item builds, so a dry economy stalls it mid-bar instead of
     * refusing the order.
     *
     * Calibration: the reference derives `buildTime` from `cost / BuildSpeed`;
     * our defs already carry a tuned `time` in seconds, so that is used as the
     * base instead. Every *modifier* is unchanged — extra factories, low power
     * and walls all scale the same way they do in retail.
     */
    private prodAcc = 0;
    private tickProduction(dt: number) {
        this.prodAcc += dt * GENERAL.baseTicksPerSecond;
        let steps = 0;
        while (this.prodAcc >= 1 && steps < 12) {
            this.prodAcc -= 1;
            steps++;
            for (const p of this.players) {
                for (const queue of p.production.getAllQueues()) this.tickQueue(p, queue);
            }
        }
    }

    private tickQueue(p: PlayerState, queue: ProductionQueue): void {
        if (queue.status !== QueueStatus.Active) return;
        const item = queue.getFirst();
        if (!item) return;

        const factoryType = p.production.getFactoryTypeForQueueType(queue.type);
        const factoryCount = p.production.getFactoryCount(factoryType);
        const multipleFactoryPenalty = 1 / Math.pow(GENERAL.multipleFactory, factoryCount - 1);
        const wallSpeedModifier = item.rules.wall ? 1 / GENERAL.wallBuildSpeedCoefficient : 1;
        const speedMul = p.production.buildSpeedModifier * multipleFactoryPenalty * wallSpeedModifier;

        const baseTicks = Math.max(1, (item.rules.time ?? 0) * GENERAL.baseTicksPerSecond);
        const buildTime = Math.max(1, Math.round(baseTicks / Math.max(0.05, speedMul)));
        const remainingCost = item.creditsEach - item.creditsSpent;
        const affordable = Math.min(
            p.credits,
            item.creditsEach / buildTime + item.creditsSpentLeftover,
            remainingCost,
        );

        let hasProgress = false;
        if (affordable > 0) {
            const spend = Math.floor(affordable);
            item.creditsSpentLeftover = affordable - spend;
            if (spend) {
                item.creditsSpent += spend;
                item.progress = item.creditsSpent / Math.max(1, item.creditsEach);
                p.credits -= spend;
                hasProgress = true;
            }
        } else if (!item.creditsEach) {
            const increment = item.progress * buildTime;
            item.progress = Math.min(1, (1 + increment) / buildTime);
            hasProgress = true;
        }

        if (hasProgress && item.progress >= 1) {
            item.progress = 1;
            queue.status = QueueStatus.Ready;
            this.onQueueReady(p, queue);
        }
        if (hasProgress) queue.notifyUpdated();
    }

    /** the queue just finished an item — the owner may act on it immediately */
    private onQueueReady(p: PlayerState, queue: ProductionQueue): void {
        const item = queue.getFirst();
        if (!item) return;
        if (queue.type === QueueType.Structures || queue.type === QueueType.Armory) {
            if (p.isHuman) {
                this.events.onMessage?.(`${item.rules.name} 建造完成 · 点击卡片放置`, 'good');
                this.events.onSfx?.('ready');
            } else if (p.ai?.placeStructure(item.defId)) {
                queue.shift(item.rules, 1);
            }
            return;
        }
        // Units are delivered by FactoryTrait, not here. Acknowledge the ready
        // item so the player hears the cue on the same frame it completes.
        if (p.isHuman) this.events.onSfx?.('unitready');
    }

    private updateBuildings(dt: number) {
        for (const b of this.buildings) {
            if (b.dead) continue;
            const p = this.players[b.owner];
            b.pulse += dt;

            /*
             * C4 ticks on the *structure*, not on the placer, and it keeps
             * ticking while the building is being sold or is still rising —
             * a satchel charge does not care what the target is doing.
             *
             * The tick itself runs from the 15 Hz loop (`tickBuildingTraits`),
             * never from here: `C4ChargeTrait` counts *ticks*, so driving it
             * once per frame would make the fuse four times shorter on a 60 fps
             * device than on a 15 fps one.
             */
            if (b.status === BuildStatus.BuildDown) {
                b.buildT -= dt;
                b.progress = Math.max(0.02, Math.min(1, b.buildT / Math.max(0.01, b.buildDur)));
                if (b.buildT <= 0) {
                    b.progress = 0;
                    b.setBuildStatus(BuildStatus.Ready);
                    this.finishSell(b);
                }
                continue;
            }

            if (b.status === BuildStatus.BuildUp) {
                // rise animation only — the structure is already complete
                b.buildT -= dt;
                b.progress = b.buildDur > 0 ? clamp(1 - b.buildT / b.buildDur, 0, 1) : 1;
                if (b.buildT <= 0) {
                    b.progress = 1;
                    // reference WaitForBuildUpTask: BuildUp -> Ready is what
                    // unlocks the weapon and the factory queue
                    const wasStatus = b.status;
                    b.setBuildStatus(BuildStatus.Ready);
                    this.pushFx(b.x, b.y, 'spawn', 0.6, b.size);
                    // reference FreeUnitTrait[NotifyBuildStatus.onStatusChange]
                    b.freeUnitTrait?.onStatusChange(wasStatus, b, this.freeUnitWorld, BuildStatus.Ready, BuildStatus.BuildUp);
                    if (p.isHuman) {
                        this.events.onMessage?.(`${b.def.name} 部署完成`, 'good');
                        this.events.onSfx?.('ready');
                    }
                }
                continue;
            }

            /* ---- reference trait ticks ---- */
            if (b.factoryTrait) (b.factoryTrait as any).onTick(b, this.factoryWorld);
            if (b.dockTrait) b.dockTrait.onTick();

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

            // defensive weapon — reference Building.update disables it unless
            // the structure is Ready and powered
            if (b.def.weapon && b.status === BuildStatus.Ready && (!b.poweredTrait || b.poweredTrait.isPoweredOn())) {
                b.cd -= dt;
                if (b.cd <= 0) {
                    const tgt = this.findTargetFor(b, b.def.weapon, b.x, b.y, b.def.weapon.range);
                    if (tgt) {
                        /* TurretTrait: rotate one step per tick, fire when aligned */
                        if (b.turretTrait) {
                            b.turretTrait.setDesiredFacing(radToFacing(Math.atan2(tgt.y - b.y, tgt.x - b.x)));
                            b.turretTrait.onTick(b);
                            if (b.turretTrait.isRotating()) continue;
                        }
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

            // terrain multiplier sampled under the unit (dust / visuals)
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

            if (u.isHarvester) this.updateHarvester(u, dt);
            else if (u.isCrashing) { /* falling: no orders, no shooting */ }
            else if (u.isAir) this.updateAircraft(u, dt);
            else this.updateCombatant(u, dt);

            /*
             * Reference: every NotifyTick trait runs after the order logic.
             * For infantry that is SuppressionTrait (30-tick prone timer),
             * IdleActionTrait (fraidycat scatter + idle sequence trigger) and
             * CrashableTrait (falling aircraft).
             */
            u.suppressionTrait?.onTick();
            u.idleActionTrait?.onTick(u, this.infantryWorld);
            u.spawnLinkTrait?.onTick(u, this.spawnLinkWorld);
            u.unlandableTrait?.onTick(u, this.unlandableWorld);

            // the order above decided what the turret is interested in; swing it
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
            if (!u.isAir && u.def.kind !== 'infantry' && u.speedCur > 26 && u.moveTrait?.isMoving()) {
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
        }
    }

    /* ------------------------------------------------------------ */
    /* reference movement tick                                       */
    /* ------------------------------------------------------------ */

    /**
     * Fixed 60 Hz movement loop.
     *
     * The reference runs tasks at a fixed tick rate; the render loop does not.
     * Running MoveTask in fixed steps is what makes the collision decisions
     * frame-rate independent (and reproducible in the probe scripts).
     */
    private tickMovement(dt: number) {
        this.simAcc += dt;
        let steps = 0;
        while (this.simAcc >= TICK && steps < 6) {
            this.simAcc -= TICK;
            steps++;
            this.simWorld.currentTick++;
            // building traits that count in ticks run on the same clock as units
            this.tickBuildingTraits();
            for (const u of this.units) {
                if (u.dead) continue;
                // a crashing aircraft is pure falling physics — fixed 60 Hz, so
                // the fall takes the same wall-clock time at any frame rate
                if (u.isCrashing) {
                    u.crashableTrait?.onTick(u, this.crashWorld);
                    continue;
                }
                // cosmetic traits that count in ticks, not seconds
                u.rockingTrait?.update();
                if (u.hoverBobTrait) u.hoverBobTrait.onTick(u, this.hoverWorld());
                u.orders.tick(u);
                // Idle bookkeeping — reference MoveTrait[NotifyTick.onTick]
                if (u.moveTrait.moveState !== MoveState.Idle && u.moveTrait.collisionState === 1 && !u.orders.hasTasks()) {
                    u.moveTrait.resetIdle();
                    if (!u.focus && u.hasTurret) u.turretAim = null;
                }
            }
        }
        // one visual sync per frame: hull heading in radians, speed for the view
        for (const u of this.units) {
            if (u.dead) continue;
            u.face = facingToRad(u.direction);
            u.speedCur = u.moveTrait.velocity.length() * 60;
        }
    }

    /**
     * 15 Hz tick for building traits.
     *
     * These four all count *ticks* in the reference (`Timer` / `cooldownTicks` /
     * `blackoutFrames`), so they have to be driven from the fixed-step loop, not
     * from `updateBuildings(dt)` — a per-frame drive would make every one of
     * them frame-rate dependent.
     */
    private tickBuildingTraits(): void {
        for (const b of this.buildings) {
            if (b.dead) continue;
            b.c4ChargeTrait?.onTick(b, this.c4World);
            if (b.unitReloadTrait) b.unitReloadTrait.onTick(b, this.reloadWorld);
            // reference UnitRepairTrait: the pad heals what it is reloading
            if (b.unitRepairTrait) b.unitRepairTrait.onTick(b, this.repairWorld);
            if (b.overpoweredTrait) b.overpoweredTrait.onTick(b, this.overpoweredWorld);
        }
    }

    /** tile entry hook — reference MoveTrait.handleTileChange crush pass */
    private onUnitTileChange(u: Unit, _oldTile: any, newTile: any): void {
        if (u.dead || !newTile) return;
        if (!u.canCrush) return;
        for (const other of this.occupancy.getGroundObjectsOnTile(newTile)) {
            if (other === u || (other as any).dead) continue;
            if (!(other as any).isInfantry?.()) continue;
            if ((other as any).owner === u.owner) continue;
            this.crush(other as Unit, u);
        }
    }

    private updateCombatant(u: Unit, dt: number) {
        const w = u.def.weapon;
        const o = u.order;

        if (o.k === 'attack') {
            const t = o.target;
            if (!t || t.dead) { this.advanceOrder(u); return; }
            if (u.isEngineer) { this.advanceOrder(u); return; }
            u.attackTarget = t;
            const d = dist(u.x, u.y, t.x, t.y);
            const range = (w ? w.range : 90) * 0.92 + (t.isBuilding ? t.radius * 0.7 : t.radius);
            if (d > range) {
                if (!u.orders.hasTasks()) this.pathToEntity(u, t);
            } else {
                u.stop();
                u.focus = t;
                u.aimAt(t.x, t.y);
                u.aimTurret(dt, u.turretAim);
                if (w && u.cd <= 0 && u.aimReady()) { this.fire(u, w, t); u.cd = w.cd * u.rofMul; }
            }
            return;
        }

        if (o.k === 'capture') {
            const t = o.target as Building;
            if (!t || t.dead || !u.isEngineer) { this.advanceOrder(u); return; }
            const d = dist(u.x, u.y, t.x, t.y);
            /*
             * The engineer walks to a cell on the ring around the footprint, so
             * "close enough to capture" has to be measured from the FOOTPRINT,
             * not from the sprite radius: a 2x2 structure's ring cell centre is
             * 48px out, which is further than radius + 22 and used to leave the
             * engineer standing next to the wall forever, re-issuing the same
             * one-cell move task.
             */
            if (d > t.radius + TILE) {
                if (!u.orders.hasTasks()) this.pathToEntity(u, t);
            } else {
                u.stop();
                this.resolveEngineer(u, t);
            }
            return;
        }

        if (o.k === 'demolish') {
            const t = o.target as Building;
            if (!t || t.dead || !u.c4) { this.advanceOrder(u); return; }
            const d = dist(u.x, u.y, t.x, t.y);
            if (d > t.radius + TILE) {
                if (!u.orders.hasTasks()) this.pathToEntity(u, t);
            } else {
                u.stop();
                this.plantC4(u, t);
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
            if (!u.orders.hasTasks()) this.advanceOrder(u);
            return;
        }

        if (o.k === 'move') {
            if (!u.orders.hasTasks()) this.advanceOrder(u);
            return;
        }

        // idle: stance decides how far a unit will pick fights on its own
        u.attackTarget = u.focus;
        if (w && u.stance !== 'hold' && u.scan <= 0) {
            u.scan = 0.22 + Math.random() * 0.12;
            const acq = w.range * (u.stance === 'aggressive' ? 1.4 : 0.98);
            const t = this.findTargetFor(u, w, u.x, u.y, acq);
            if (t) {
                u.focus = t;
                u.attackTarget = t;
                const d = dist(u.x, u.y, t.x, t.y);
                if (u.cd <= 0 && d <= w.range * 1.02) { this.fire(u, w, t); u.cd = w.cd * u.rofMul; }
                if (u.stance === 'aggressive' && d > w.range * 0.85 && !u.orders.hasTasks()) {
                    this.pathToEntity(u, t);
                }
            } else if (u.focus && Math.hypot(u.focus.x - u.x, u.focus.y - u.y) > w.range * 1.35) {
                u.focus = null;
            }
        }
    }

    /**
     * Harvester per-tick work.
     *
     * The old hand-written seek/toMine/mining/toBase/unload machine is gone:
     * the truck now runs the reference task chain (GatherOreTask ->
     * ReturnOreTask -> GatherOreTask), and all this method does is tick the
     * trait's retry timers. Combat still runs underneath so a harvester that is
     * shot at can shoot back while it works.
     */
    private updateHarvester(u: Unit, dt: number) {
        u.harvesterTrait?.onTick(u, this.harvestWorld);
        this.updateCombatant(u, dt);
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
        // reference AmmoTrait: every shot spends a round; at zero the aircraft
        // has to go home (updateAircraft sends it)
        if (u && u.isAir && u.ammoTrait && u.ammoTrait.ammo <= 0) return;
        if (u && u.isAir && u.ammoTrait) u.ammoTrait.ammo = u.ammoTrait.ammo - 1;
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
        /*
         * Reference PowerTrait[NotifyHealthChange.onChange]: a damaged power
         * plant produces proportionally less. This is why shelling the reactor
         * browns out the base before it dies.
         */
        if (target instanceof Building && target.def.power > 0 && !target.dead) {
            this.players[target.owner].powerTrait.updateFrom(target, 'update', this.powerWorld);
        }
        if (target instanceof Unit && !target.dead) this.onWarheadHitInfantry(target);
        /*
         * Reference Warhead `Rocker=yes`: an explosive hit rocks a tank on its
         * suspension. Amplitude follows the damage, capped so a light shell
         * does not send it flying.
         */
        if (target instanceof Unit && !target.dead && target.rockingTrait && type === 'explosive') {
            const facing = Math.round((Math.atan2(target.x - (source?.x ?? target.x), target.y - (source?.y ?? target.y)) * 180) / Math.PI) & 0xff;
            target.rockingTrait.applyRocking(target, facing, Math.min(2, Math.max(0.4, amount / 40)));
        }
        if (target.hp <= 0) {
            // reference CrashableTrait: an aircraft with a crash trait does not
            // simply vanish, it falls and explodes where it lands
            if (target instanceof Unit && target.isAir && target.crashableTrait && !target.isCrashing) {
                this.startCrash(target, owner, source);
                return;
            }
            this.kill(target, owner, source);
        }
    }

    /** Reference `CrashableTrait.crash()` — hand the aircraft over to gravity */
    private startCrash(u: Unit, killer: PlayerId, source: Unit | null): void {
        u.hp = 0;
        u.crashAltitude = u.altitude;
        u.crashableTrait!.crash({ player: killer, obj: source ?? undefined });
        u.attackTarget = null;
        u.focus = null;
        u.engage = null;
        u.orders?.clear(u);
        this.events.onSfx?.('crash', u.x, u.y);
    }

    /**
     * Reference `Warhead.suppressOrScatterTarget`.
     *
     * Two very different reactions to being shot at:
     *   - a `fraidycat` civilian panics and runs (once — the scatter task is
     *     only queued while it has no orders);
     *   - a soldier only goes prone if he was standing still (or was already
     *     suppressed). A running infantryman keeps running, which is why
     *     charging a machine gun position works at all.
     */
    private onWarheadHitInfantry(target: Unit): void {
        if (!target.isInfantry()) return;
        if ((target.def as any).fraidycat) {
            if (!target.orders?.hasTasks()) {
                target.isPanicked = true;
                this.scatterUnit(target);
                this.afterTick(() => { target.isPanicked = false; });
            }
            return;
        }
        const idle = !target.isMoving && !target.orders?.hasTasks();
        if ((idle || target.suppressionTrait?.isSuppressed()) && target.suppressionTrait) {
            target.suppressionTrait.suppress();
        }
    }

    kill(e: Entity, killer: PlayerId, source: Unit | null = null) {
        if (e.dead) return;
        e.dead = true;
        if (e instanceof Unit) {
            this.occupancy.unoccupySingleTile(e.tile, e);
            if (e.harvesterTrait) e.harvesterTrait.status = 0;
            if (e.dockableTrait?.reservedDock?.dockTrait) {
                e.dockableTrait.reservedDock.dockTrait.unreserveDockForUnit(e);
            }
        }
        e.hp = 0;
        this.players[e.owner].lost++;
        if (killer !== e.owner) this.players[killer].kills++;
        const big = e.isBuilding;
        if (big) {
            if (this.selectedBuilding === (e as Building)) this.selectedBuilding = null;
            const victim = e as Building;
            /*
             * Reference NotifyDestroy.onDestroy fan-out: crew bail out *before*
             * the structure is unregistered, so the survivors can still read the
             * footprint they are climbing out of.
             */
            victim.crewedTrait?.onDestroy(victim, this.crewWorld, this.damageInfoFor(killer, source), false);
            this.unregisterBuilding(victim);
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
     * Crush — reference: MoveTrait.handleTileChange.
     *
     * Called the moment a crusher's hull enters a cell: every hostile infantry
     * on it dies. There is no speed test in the reference and there is none
     * here; a tank crawling through a crowd flattens it just the same.
     */
    private crush(victim: Unit, by: Unit) {
        if (victim.dead) return;
        victim.hp = 0;
        this.kill(victim, by.owner, by);
        this.pushFx(victim.x, victim.y, 'dust', 0.55, 1.1);
        this.events.onSfx?.('scatter', victim.x, victim.y);
        if (this.players[by.owner].isHuman) this.events.onMessage?.(`${by.def.name} 碾过 ${victim.def.name}`, 'info');
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
