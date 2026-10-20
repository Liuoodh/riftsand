/**
 * Entity model: units, buildings, projectiles, resource nodes.
 * These are plain data objects — all simulation logic lives in game/Game.ts,
 * rendering lives in render/Views.ts. Keeping data and behaviour apart makes
 * the simulation easy to test and cheap to step.
 */
import {
    BuildingDef, UnitDef, Stance, TILE, HALF, MAP_TILES,
    unitMass, unitTurn, unitAccel, unitCrushes, PROJ_PHYSICS,
} from '../core/Core';
import type { CrystalNode } from '../world/Terrain';
import { MoveTrait, MoveState } from '../sim/MoveTrait';
import { UnitOrders } from '../sim/Task';
import { Position } from '../sim/Position';
import { rulesFor, UnitRules } from '../sim/World';
import { Tile } from '../sim/map/TileCollection';
import { HarvesterTrait } from '../sim/traits/HarvesterTrait';
import { TurretTrait } from '../sim/traits/TurretTrait';
import { PoweredTrait } from '../sim/traits/PoweredTrait';
import { DockTrait } from '../sim/traits/DockTrait';
import { StanceType } from '../sim/gameobject/StanceType';
import { InfDeathType } from '../sim/gameobject/InfDeathType';
import { SuppressionTrait } from '../sim/traits/SuppressionTrait';
import { IdleActionTrait } from '../sim/traits/IdleActionTrait';
import { AgentTrait } from '../sim/traits/AgentTrait';
import { CrashableTrait } from '../sim/traits/CrashableTrait';
import { AirportBoundTrait } from '../sim/traits/AirportBoundTrait';
import { HoverBobTrait } from '../sim/traits/HoverBobTrait';
import { RockingTrait } from '../sim/traits/RockingTrait';
import { SpawnLinkTrait } from '../sim/traits/SpawnLinkTrait';
import { MissileSpawnTrait } from '../sim/traits/MissileSpawnTrait';
import { UnlandableTrait } from '../sim/traits/UnlandableTrait';
import { C4ChargeTrait } from '../sim/traits/C4ChargeTrait';
import { CrewedTrait } from '../sim/traits/CrewedTrait';
import { FreeUnitTrait } from '../sim/traits/FreeUnitTrait';
import { SuperWeaponTrait } from '../sim/traits/SuperWeaponTrait';
import { OverpoweredTrait } from '../sim/traits/OverpoweredTrait';
import { UnitRepairTrait } from '../sim/traits/UnitRepairTrait';
import { WallTrait } from '../sim/traits/WallTrait';
import { DeathType } from '../sim/gameobject/DeathType';

export type PlayerId = number;

export type HarvestPhase = 'seek' | 'toMine' | 'mining' | 'toBase' | 'unload';

export type Order =
    | { k: 'idle' }
    | { k: 'move'; x: number; y: number }
    | { k: 'attackmove'; x: number; y: number }
    | { k: 'attack'; target: Entity }
    | { k: 'harvest'; node: CrystalNode | null; phase: HarvestPhase; timer: number }
    | { k: 'capture'; target: Entity }
    | { k: 'demolish'; target: Entity }
    | { k: 'deploy' };

let nextId = 1;

export class Entity {
    id = nextId++;
    owner: PlayerId = 0;
    x = 0;
    y = 0;
    hp = 1;
    maxHp = 1;
    dead = false;
    armor: UnitDef['armor'] = 'light';
    view: any = null;
    /** last time this entity took damage (for hp bar fade) */
    lastHit = -99;
    /** true when the enemy can currently see this entity */
    visible = true;
    hitFlash = 0;
    /**
     * Reference `object.deathType` — which death animation family to play.
     * `Demolish` is what C4 sets, so the structure collapses instead of
     * exploding.
     */
    deathType: DeathType = DeathType.Normal;

    /** collision footprint; subclasses refine this */
    get radius(): number { return this.isBuilding() ? 16 : 8; }

    /**
     * Reference HealthTrait: health as a 0..100 percentage.
     *
     * PowerTrait scales a plant's output by this value, so it has to be an
     * integer percentage — `hp / maxHp * 100` computes the same number the
     * reference stores in `_computedHealth`.
     */
    get healthTrait() {
        const self = this;
        return {
            get health() { return self.maxHp > 0 ? (self.hp / self.maxHp) * 100 : 0; },
            getHitPoints() { return self.hp; },
            getMaxHitPoints() { return self.maxHp; },
        };
    }

    /** map position in leptons (= world px + HALF), reference ObjectPosition API */
    getMapPosition() {
        return { x: this.x + HALF, y: this.y + HALF };
    }

    /*
     * Reference GameObject predicates. Every object in the world answers all of
     * them, so a filter can ask any occupant "are you infantry?" without first
     * knowing its concrete class.
     */
    isUnit(): boolean { return false; }
    isVehicle(): boolean { return false; }
    isInfantry(): boolean { return false; }
    isAircraft(): boolean { return false; }
    isTerrain(): boolean { return false; }
    isOverlay(): boolean { return false; }
    isBuilding(): boolean { return false; }
    /**
     * Reference `GameObject.isTechno()` — true for everything that walks, drives,
     * flies or stands: the whole of `Entity` minus smudges and placeholders,
     * neither of which is an Entity here.
     */
    isTechno(): boolean { return true; }
    /*
     * Overlay-family predicates. Nothing outside `Overlay` answers true, but
     * every object must *have* the method: the ported `Terrain.isBlockerObject`
     * and `TileOccupation.computeTileLandType` ask any occupant these questions
     * without first checking its class.
     */
    isSmudge(): boolean { return false; }
    isTiberium(): boolean { return false; }
    isBridge(): boolean { return false; }
    isHighBridge(): boolean { return false; }
    isLowBridge(): boolean { return false; }
    isXBridge(): boolean { return false; }
    isBridgePlaceholder(): boolean { return false; }
    /** reference `GameObject.getFoundation()` — footprint in cells */
    getFoundation(): { width: number; height: number } {
        const art = (this as any).art;
        return art?.foundation ?? { width: 1, height: 1 };
    }
    get cost(): number { return 0; }
}

/**
 * Wrap an angle in radians into (-pi, pi].
 *
 * Every heading in the engine has to live in one period. The shortest-arc test
 * `target - current` is only meaningful when both ends are wrapped: an unwrapped
 * hull at +3.28 rad chasing a target at -3.10 sees a +0.18 arc, steps past pi,
 * and the next frame sees -0.18 and steps back — an oscillation that never
 * settles. (See sim/Locomotor.ts.)
 */
export function wrapAngle(a: number) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a <= -Math.PI) a += Math.PI * 2;
    return a;
}

export class Unit extends Entity {
    def: UnitDef;
    /**
     * The owning PlayerState — the same alias `Building.player` carries.
     *
     * The reference keeps a player *object* on every object; this project stores
     * a numeric id on `Entity` so saves stay small. Ported traits that say
     * `unit.owner.credits` read this instead.
     */
    player?: any;
    order: Order = { k: 'idle' };
    /** queued waypoint orders, executed one after another */
    orderQueue: Order[] = [];

    /* ------------------------------------------------------------------ */
    /* Reference-style movement state                                      */
    /* ------------------------------------------------------------------ */
    /** cell the unit stands on (sim/Tiles) */
    tile!: Tile;
    /**
     * Reference `GameObject.onBridge`: false on the ground layer, true while on
     * a bridge deck. Defaulted here rather than left `undefined` because
     * `Terrain.findObstacles` compares it with `===` against the path node's
     * flag, and `undefined === false` would make every unit look like it is on
     * a different layer from every other unit.
     */
    onBridge = false;
    /** heading in degrees, reference convention (0 = north, 90 = west) */
    direction = 0;
    /** degrees per tick, only used by TurnTask for the banking visual */
    spinVelocity = 0;
    /** sub-cell inside the tile (0..4); infantry use 2/3/4 */
    subCell = 0;
    desiredSubCell = 0;
    moveTrait!: MoveTrait;
    orders!: UnitOrders;
    position!: Position;
    rules!: UnitRules;
    /** vehicle with a rotating turret (everything except infantry / air) */
    hasTurret = false;
    /** this hull runs infantry over */
    crusher = false;
    /** current target, mirrors AttackTrait.currentTarget (survives between scans) */
    attackTarget: Entity | null = null;

    /* ---- reference traits ---- */
    /**
     * HarvesterTrait, present only on `kind === 'harvester'`. The task chain
     * (GatherOreTask / ReturnOreTask) lives in sim/task/harvester.
     */
    harvesterTrait?: HarvesterTrait;
    /** rotating turret — everything with a turret flag (reference TurretTrait) */
    turretTrait?: TurretTrait;
    /** aircraft parked at an airfield: ammo + reload state */
    airportBoundTrait?: AirportBoundTrait;
    /** bombs / rockets left before a rearm cycle */
    ammoTrait?: { ammo: number; maxAmmo: number; isFull(): boolean };
    /** set while docked/reserved at a building (reference DockableTrait) */
    dockableTrait?: { dock?: any; reservedDock?: any };
    /** hover vehicle bob (reference HoverBobTrait) */
    hoverBobTrait?: HoverBobTrait;
    /** suspension rocking after an explosive hit (reference Vehicle.rocking) */
    rockingTrait?: RockingTrait;
    /** absolute hover elevation in px, includes the bob */
    hoverElevation?: number;

    /** renderer heading (radians, atan2 convention) — derived from `direction` */
    face = 0;
    /** turret heading, decoupled from the hull (reference: TurretTrait) */
    turretFace = 0;
    /**
     * Bearing the turret should hold, or null when nothing is being tracked.
     *
     * Reference: TurretTrait.desiredFacing is written every tick by whoever
     * owns the unit's attention. There is no timer.
     */
    turretAim: number | null = null;
    /** the thing this unit is currently watching */
    focus: Entity | null = null;

    cd = 0;
    vx = 0;
    vy = 0;
    cargo = 0;
    /** cached "engaged" target for attack-move */
    engage: Entity | null = null;
    bob = Math.random() * Math.PI * 2;
    /** assigned harvester slot, prevents all harvesters piling on one node */
    mineNode: CrystalNode | null = null;
    /** 0 = uncapped; otherwise the group march speed (keeps formations together) */
    speedCap = 0;
    /** current scalar speed in px/s, mirrored from moveTrait.velocity for the view */
    speedCur = 0;

    /* ---- veterancy ---- */
    xp = 0;
    level = 0;              // 0 rookie, 1 veteran, 2 elite

    /* ---- combat behaviour ---- */
    stance: Stance = 'guard';
    /**
     * Pose (reference `Infantry.stance`).
     *
     * `stance` above is the *aggression* setting (aggressive/guard/hold);
     * `pose` is what the body is doing (standing, prone, deployed, cheering).
     * The reference keeps both — `AttackTrait.guardMode` and `StanceType`.
     */
    pose: StanceType = StanceType.None;
    /** 30-tick suppression timer; a suppressed infantryman is automatically prone */
    suppressionTrait?: SuppressionTrait;
    /** fraidycat scatter + idle animation trigger */
    idleActionTrait?: IdleActionTrait;
    /** spy infiltration payload */
    agentTrait?: AgentTrait;
    /** plays a crash fall when shot down (aircraft / jumpjet) */
    crashableTrait?: CrashableTrait;
    /** leash for a unit launched by a `spawner` weapon (reference SpawnLinkTrait) */
    spawnLinkTrait?: SpawnLinkTrait;
    /** warhead the spawned missile carries; detonates when it dies (MissileSpawnTrait) */
    missileSpawnTrait?: MissileSpawnTrait;
    /** must fly off the map instead of stopping (UnlandableTrait) */
    unlandableTrait?: UnlandableTrait;
    /** this unit can plant a demolition charge (reference `object.c4`) */
    c4 = false;
    /** death animation family, set by whatever killed the unit */
    infDeathType: InfDeathType = InfDeathType.Gunfire;
    /** mid-burst flag, the view swaps to the firing sequence */
    isFiring = false;
    /** running away after a near miss (fraidycat) */
    isPanicked = false;

    /* ---- aircraft attitude (reference Aircraft.pitch/yaw/roll) ---- */
    /** nose-up angle in degrees, driven by the climb rate */
    pitch = 0;
    /** bank angle in degrees, driven by the turn rate */
    roll = 0;
    /** set by CrashableTrait.crash(); the unit stops taking orders and falls */
    isCrashing = false;
    /** absolute altitude in px while crashing (normally `def.altitude`) */
    crashAltitude?: number;
    /**
     * Parked on a pad. Reference WingedLocomotor switches `zone` to Ground and
     * lowers the hull; ammo can only be reloaded while landed.
     */
    landed = false;
    /** pad this aircraft is currently parked on */
    dockedAt?: any;
    /** time since this unit last fired, used for cloak re-activation */
    cloakT = 99;
    cloaked = false;
    /** game-time until which the unit is slowed by a sandstorm */
    slowUntil = -1;
    /** game-time until which the unit is invulnerable (force shield) */
    invulnUntil = -1;
    /** game-time until which the unit is force-cloaked by a mirage field */
    mirageUntil = -1;
    /** time since last damage, drives elite self-healing */
    calm = 99;
    /** throttles target scanning so 100 idle units do not scan every frame */
    scan = 0;

    /* ---- physics / visuals ---- */
    /** terrain multiplier sampled under the unit each frame */
    terrainMul = 1;
    /** last valid position, used by the spawn resolver */
    prevX = 0;
    prevY = 0;
    /** muzzle recoil timer, the view offsets the hull by this */
    recoil = 0;
    /** dust kick-up timer */
    dustT = 0;
    /** angular velocity of the hull this frame, for banking */
    turnDelta = 0;

    constructor(def: UnitDef, owner: PlayerId, x: number, y: number) {
        super();
        this.def = def;
        this.owner = owner;
        this.x = x;
        this.y = y;
        this.hp = def.hp;
        this.maxHp = def.hp;
        this.armor = def.armor;
        this.prevX = x;
        this.prevY = y;
        this.hasTurret = def.kind !== 'infantry' && def.kind !== 'air';
        this.crusher = !!unitCrushes(def);
        this.c4 = !!def.c4;
        this.rules = rulesFor(def, unitTurn(def));
    }

    get radius() { return this.def.radius; }
    get speed() { return this.def.speed; }
    get mass() { return unitMass(this.def); }
    get turnRate() { return unitTurn(this.def); }
    get accel() { return unitAccel(this.def); }
    get altitude() { return this.crashAltitude ?? (this.landed ? 0 : this.def.altitude ?? 0); }
    /** true while the aircraft is off the ground (reference `zone === Air`) */
    get isAirborne() { return this.def.kind === 'air' ? !this.landed : false; }
    get isHover() { return !!this.def.hover; }
    get canCrush() { return this.crusher; }
    get isAir() { return this.def.kind === 'air'; }
    get isHarvester() { return this.def.kind === 'harvester'; }
    get isMcv() { return this.def.kind === 'mcv'; }
    get isEngineer() { return !!this.def.engineer; }
    get cost() { return this.def.cost; }
    /** reference `object.name` — the rules id, used by WallTrait adjacency */
    get name() { return this.def.id; }

    /* --- type predicates the sim layer expects (reference GameObject API) --- */
    isUnit() { return true; }
    isVehicle() { return this.def.kind !== 'infantry' && this.def.kind !== 'air'; }
    isInfantry() { return this.def.kind === 'infantry'; }
    isAircraft() { return this.def.kind === 'air'; }
    isTerrain() { return false; }
    isOverlay() { return false; }

    /** 1.0 / 1.2 / 1.45 damage multiplier */
    get damageMul() { return this.level === 2 ? 1.45 : this.level === 1 ? 1.2 : 1; }
    /** incoming damage multiplier (lower is tougher) */
    get armorMul() { return this.level === 2 ? 0.66 : this.level === 1 ? 0.82 : 1; }
    /** cooldown multiplier */
    get rofMul() { return this.level === 2 ? 0.76 : this.level === 1 ? 0.88 : 1; }
    get sightBonus() { return this.level === 2 ? 2 : this.level === 1 ? 1 : 0; }

    /**
     * The pose the body is actually in.
     *
     * Reference `Infantry.stance` getter: a suppressed soldier reads as Prone
     * without ever writing the field, so he stands up the moment the 30-tick
     * timer expires instead of needing a separate "stand up" transition.
     */
    get poseNow(): StanceType {
        return this.pose === StanceType.None && this.suppressionTrait?.isSuppressed()
            ? StanceType.Prone
            : this.pose;
    }

    /** Reference `Infantry.stance` setter — the pose itself gates movement. */
    setPose(value: StanceType): void {
        this.pose = value;
        const immobile = value === StanceType.Deployed || value === StanceType.Cheer;
        this.moveTrait?.setDisabled(immobile);
    }

    /** true while the soldier is hugging the ground and cannot walk */
    get isProne(): boolean {
        return this.poseNow === StanceType.Prone;
    }

    get slowed() { return this.slowUntil > -1; }
    get invulnerable() { return this.invulnUntil > -1; }

    get isMoving() { return this.moveTrait?.moveState === MoveState.Moving; }

    /*
     * Read-only views kept for the probe scripts (tools/*.mjs) and for the HUD.
     * They expose the *live* MoveTask state rather than a second copy of it.
     */
    get path(): any[] {
        const task: any = this.orders?.getCurrentTask();
        return task && task.path ? task.path : [];
    }
    get cellX() { return this.tile ? this.tile.rx : -1; }
    get cellY() { return this.tile ? this.tile.ry : -1; }
    /** true while the reference MoveTask has flagged this unit as blocked */
    get blockedNow() { return this.moveTrait?.collisionState === 0; }

    /**
     * Cancel everything this unit is doing.
     *
     * Reference: a new order replaces the task queue; `MoveTask.onEnd` restores
     * the collision state. There is no "coast to a halt" step — the retail hull
     * stops the moment the task is gone, which is why a stop order reads as
     * crisp instead of sliding.
     */
    stop() {
        const task = this.orders?.getCurrentTask();
        if (task) (task as any).forceCancel?.(this);
        this.orders?.clear(this);
        this.moveTrait?.unreservePathNodes();
        this.moveTrait?.resetIdle();
        this.moveTrait.collisionState = 1 as any;
        this.vx = 0;
        this.vy = 0;
        this.speedCur = 0;
    }

    /**
     * Is the turret pointed close enough to fire?
     *
     * The reference's AttackTask blocks on the turret finishing its rotation; we
     * approximate with an angular tolerance. Without it a tank fires sideways the
     * instant it acquires a target, while the barrel is still swinging.
     */
    aimReady(tolerance = 0.22) {
        if (this.def.kind === 'infantry' || this.def.kind === 'air') return true;
        if (this.turretAim === null) return true;
        let d = this.turretAim - this.turretFace;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return Math.abs(d) <= tolerance;
    }

    /** Lock the turret onto a bearing for this tick. */
    aimAt(x: number, y: number) {
        this.turretAim = Math.atan2(y - this.y, x - this.x);
    }

    /**
     * Advance the turret toward `want` (default: the hull heading).
     *
     * FacingUtil.tick semantics: snap when the remainder is under one step,
     * otherwise rotate by exactly one step.
     */
    aimTurret(dt: number, want?: number | null) {
        if (this.def.kind === 'air') return;
        const target = wrapAngle(want === undefined || want === null ? this.face : want);
        let d = target - this.turretFace;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const rate = (this.def.kind === 'infantry' ? 12 : 3.6) * dt;
        if (Math.abs(d) <= rate) this.turretFace = target;
        else this.turretFace += Math.sign(d) * rate;
        this.turretFace = wrapAngle(this.turretFace);
    }

    canShoot() {
        return !!this.def.weapon && this.cd <= 0;
    }
}

/**
 * BuildStatus, mirroring redalert2/src/game/gameobject/Building.ts:32-36.
 *
 * Numeric on purpose: the renderer compares status in a hot loop and the
 * reference's ordering (BuildUp < Ready < BuildDown) is meaningful — a unit may
 * not fire while the structure is still rising or already coming down.
 */
export { BuildStatus } from '../sim/rules/BuildStatus';
import { BuildStatus as BuildStatusEnum } from '../sim/rules/BuildStatus';

export class Building extends Entity {
    isBuilding(): boolean { return true; }
    def: BuildingDef;
    /**
     * The owning PlayerState.
     *
     * The reference stores `owner` as the player object; this project keeps a
     * numeric id on `Entity` for cheap serialisation. Ported code that says
     * `building.owner.powerTrait` reads this alias instead, so it stays 1:1.
     */
    player?: any;
    /** top-left cell, used by the sim's tile occupation */
    tile!: Tile;
    /** reference-compatible rule bag (structures are never crushable) */
    rules!: {
        /** rules id, used by WallTrait to match neighbouring segments */
        name: string;
        crushable: boolean;
        invisibleInGame: boolean;
        gate: boolean;
        power: number;
        needsEngineer: boolean;
        naval: boolean;
        leaveRubble: boolean;
        refinery: boolean;
        weaponsFactory: boolean;
        constructionYard: boolean;
        unitReload: boolean;
        wall: boolean;
        numberImpassableRows: number;
        occupantPowerBonus: number;
    };
    /** foundation in cells + art height, the two values Terrain/Factor read */
    get art() {
        return {
            foundation: { width: this.size, height: this.size },
            height: this.size * 0.5,
            /*
             * Reference `DockingOffset0` for a refinery is `3,1,0` on a 3x3
             * foundation — i.e. one cell PAST the right edge, not the last
             * column. Parking on `size - 1` would put the pad inside the
             * building and no harvester could ever reach it.
             */
            dockingOffsets: [{ x: this.size, z: Math.floor(this.size / 2) }],
        };
    }

    /** injected by Game.place so dock cells can be resolved without Game */
    tileLookup?: (rx: number, ry: number) => Tile | undefined;

    /** reference `building.dockTileFor(i)` */
    dockTileFor(index: number): Tile | undefined {
        const offset = this.art.dockingOffsets[index] ?? this.art.dockingOffsets[0];
        if (!offset || !this.tileLookup) return undefined;
        return this.tileLookup(this.tx + offset.x, this.ty + offset.z);
    }
    /* ---- reference traits ---- */
    poweredTrait?: PoweredTrait;
    turretTrait?: TurretTrait;
    factoryTrait?: { type: number; status: number; deliveringUnit?: any; produceGroundUnitAt?: any };
    dockTrait?: DockTrait;
    /** aircraft factory: clears `preferredAirport` when a pad is sold or captured */
    helipadTrait?: any;
    /** aircraft factory: one ammunition round per ReloadRate while parked */
    unitReloadTrait?: any;
    /** satchel charge planted by a C4 unit (reference C4ChargeTrait) */
    c4ChargeTrait?: C4ChargeTrait;
    /** survivors that run out when this structure dies (CrewedTrait) */
    crewedTrait?: CrewedTrait;
    /** free unit handed over when the buildup finishes (FreeUnitTrait) */
    freeUnitTrait?: FreeUnitTrait;
    /** provider half of a super weapon (SuperWeaponTrait) */
    superWeaponTrait?: SuperWeaponTrait;
    /** overcharge from friendly chargers (OverpoweredTrait) */
    overpoweredTrait?: OverpoweredTrait;
    /** service depot / airfield repair clock (UnitRepairTrait) */
    unitRepairTrait?: UnitRepairTrait;
    /** wall autotiling + linked damage (WallTrait) */
    wallTrait?: WallTrait;
    rallyTrait?: { rallyPoint?: any; getRallyPoint?: any; changeRallyPoint?: any };
    /** buildings answer "I have no orders" to MoveTask */
    moveTrait = {
        moveState: 0,
        collisionState: 1,
        velocity: { length: () => 0 },
        currentWaypoint: undefined as any,
        reservedPathNodes: [] as any[],
    };
    orders = { hasTasks: () => false, isIdle: () => true, addTask: () => {}, getTasks: () => [] };
    isBuildingUnit() { return true; }
    isUnit() { return false; }
    isInfantry() { return false; }
    isVehicle() { return false; }
    isAircraft() { return false; }
    isTerrain() { return false; }
    isOverlay() { return false; }
    isBuildingType() { return true; }
    tx: number;
    ty: number;
    size: number;
    /** 0..1 construction progress, 1 = finished */
    progress = 1;
    /**
     * Retail raises a structure over `BuildupTime` and then plays the same art
     * backwards when it is sold. Both phases are driven by this clock *and* by
     * `buildStatus`, which is what gates weapons and production.
     */
    status: BuildStatusEnum = BuildStatusEnum.Ready;
    /** seconds left in the current buildup / builddown */
    buildT = 0;
    buildDur = 1.2;
    /** credits owed when the builddown completes (retail: refund on unspawn) */
    refund = 0;
    rally: { x: number; y: number } | null = null;
    cd = 0;
    pulse = 0;
    /** repair mode drains credits to restore hp over time */
    repairing = false;
    /** number of times this structure changed hands (capture feedback) */
    captured = 0;

    constructor(def: BuildingDef, owner: PlayerId, tx: number, ty: number, progress = 1) {
        super();
        this.def = def;
        this.owner = owner;
        this.tx = tx;
        this.ty = ty;
        this.size = def.size;
        this.progress = progress;
        this.hp = def.hp * (progress >= 1 ? 1 : Math.max(0.12, progress));
        this.maxHp = def.hp;
        /*
         * Structure armour class by bulk, mirroring the retail rules where
         * walls are ArmorType.Concrete, big tech buildings Steel and light
         * structures Wood. Small arms bounce off a 4x4 command core (0.04x) while
         * high explosive still hurts it (0.55x) — which is what makes artillery
         * and bombing runs the answer to a turtled base instead of riflemen.
         */
        this.armor = def.size >= 4 ? 'concrete' : def.size >= 3 ? 'steel' : 'wood';
        this.x = tx * TILE + (def.size * TILE) / 2 - HALF;
        this.y = ty * TILE + (def.size * TILE) / 2 - HALF;
        this.rules = {
            name: def.id,
            crushable: false,
            invisibleInGame: false,
            gate: false,
            power: def.power,
            needsEngineer: !!def.needsEngineer,
            naval: false,
            leaveRubble: false,
            refinery: !!def.dropoff,
            weaponsFactory: def.factory === 'vehicle',
            constructionYard: !!def.isCore,
            unitReload: def.factory === 'aircraft',
            wall: !!def.wall,
            numberImpassableRows: 0,
            occupantPowerBonus: 0,
        };
    }

    /** reference `object.name` */
    get name() { return this.def.id; }

    /** reference Building.update: a rising structure queues WaitForBuildUpTask */
    get buildStatus(): BuildStatusEnum {
        return this.status;
    }

    setBuildStatus(status: BuildStatusEnum): void {
        this.status = status;
        if (status === BuildStatusEnum.Ready) this.progress = 1;
    }

    get done() { return this.progress >= 1 && this.status === BuildStatusEnum.Ready; }
    get centerTile() {
        return { tx: this.tx + this.size / 2, ty: this.ty + this.size / 2 };
    }
    get radius() { return (this.size * TILE) / 2; }
    get cost() { return this.def.cost; }

    occupies(tx: number, ty: number) {
        return tx >= this.tx && tx < this.tx + this.size && ty >= this.ty && ty < this.ty + this.size;
    }

    queueValue() {
        return 0;
    }
}

export class Projectile {
    x: number;
    y: number;
    z = 0;
    prevX: number;
    prevY: number;
    prevZ = 0;
    sx: number;
    sy: number;
    sz: number;
    vx = 0;
    vy = 0;
    vz = 0;
    t = 0;
    life = 6;
    kind: 'bullet' | 'shell' | 'rocket' | 'bomb';
    owner: PlayerId;
    dmg: number;
    dmgType: 'small' | 'ap' | 'explosive';
    splash = 0;
    falloff = 0.4;
    hitRadius = 8;
    ballistic = false;
    homing = false;
    turnRate = 0;
    gravity = 0;
    accel = 0;
    maxSpeed = 400;
    target: Entity | null;
    /** firing unit, used to award veterancy */
    source: Unit | null = null;
    dead = false;
    /** smoke trail timer */
    trailT = 0;

    constructor(o: {
        x: number; y: number; z?: number; kind: 'bullet' | 'shell' | 'rocket' | 'bomb';
        owner: PlayerId; dmg: number; dmgType: 'small' | 'ap' | 'explosive'; splash?: number;
        target: Entity | null; speed?: number; ballistic?: boolean; homing?: boolean;
        falloff?: number;
    }) {
        const phys = PROJ_PHYSICS[o.kind];
        this.x = o.x; this.y = o.y; this.z = o.z || 0;
        this.prevX = o.x; this.prevY = o.y; this.prevZ = this.z;
        this.sx = o.x; this.sy = o.y; this.sz = this.z;
        this.kind = o.kind;
        this.owner = o.owner; this.dmg = o.dmg; this.dmgType = o.dmgType;
        this.splash = o.splash || 0;
        this.target = o.target;
        this.maxSpeed = o.speed || phys.speed;
        this.ballistic = o.ballistic ?? phys.ballistic;
        this.homing = (o.homing ?? phys.homing) && !this.ballistic;
        this.turnRate = phys.turn;
        this.accel = phys.accel;
        this.gravity = this.ballistic ? phys.gravity : 0;
        this.hitRadius = phys.radius;
        this.falloff = o.falloff ?? phys.falloff;
        if (this.homing) {
            const dx = (o.target ? o.target.x : o.x) - o.x;
            const dy = (o.target ? o.target.y : o.y) - o.y;
            const d = Math.hypot(dx, dy) || 1;
            this.vx = (dx / d) * this.maxSpeed * 0.45;
            this.vy = (dy / d) * this.maxSpeed * 0.45;
        }
    }

    /** ballistic launch: solve the arc for a given flight time */
    launchArc(aimX: number, aimY: number, aimZ = 0) {
        const dx = aimX - this.x;
        const dy = aimY - this.y;
        const dist = Math.hypot(dx, dy);
        const T = Math.max(0.12, dist / Math.max(1, this.maxSpeed));
        this.vx = dx / T;
        this.vy = dy / T;
        this.vz = (aimZ - this.z + 0.5 * this.gravity * T * T) / T;
    }

    /** straight shot: aim point may lead the target */
    launchStraight(aimX: number, aimY: number) {
        const dx = aimX - this.x;
        const dy = aimY - this.y;
        const d = Math.hypot(dx, dy) || 1;
        this.vx = (dx / d) * this.maxSpeed;
        this.vy = (dy / d) * this.maxSpeed;
    }

    /** homing rockets: rotate the velocity toward the target and accelerate */
    steer(dt: number) {
        if (!this.homing) return;
        const goal = this.target && !this.target.dead ? this.target : null;
        if (!goal) return;
        const dx = goal.x - this.x;
        const dy = goal.y - this.y;
        const d = Math.hypot(dx, dy) || 1;
        const want = Math.atan2(dy, dx);
        let have = Math.atan2(this.vy, this.vx);
        let diff = want - have;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        have += Math.max(-this.turnRate * dt, Math.min(this.turnRate * dt, diff));
        this.maxSpeed = Math.min(this.maxSpeed + this.accel * dt, PROJ_PHYSICS[this.kind].speed * 1.5);
        const sp = this.maxSpeed;
        this.vx = Math.cos(have) * sp;
        this.vy = Math.sin(have) * sp;
        // climb / dive toward the target's altitude so AA actually connects
        if (goal instanceof Unit && goal.isAir) {
            const dz = goal.altitude - this.z;
            this.z += Math.max(-90 * dt, Math.min(90 * dt, dz));
        }
    }

    step(dt: number) {
        this.prevX = this.x;
        this.prevY = this.y;
        this.prevZ = this.z;
        this.t += dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.gravity) {
            this.vz -= this.gravity * dt;
            this.z += this.vz * dt;
        }
        if (this.t >= this.life) this.dead = true;
    }

    get speed() { return Math.hypot(this.vx, this.vy); }
    get height() { return this.z; }
    get heading() { return Math.atan2(this.vy, this.vx); }
    /** has the projectile come down to ground level (or started there)? */
    get grounded() { return this.z <= 0.5; }
}

export class Fx {
    x: number;
    y: number;
    z = 0;
    vx = 0;
    vy = 0;
    vz = 0;
    g = 0;
    spin = 0;
    t = 0;
    life: number;
    kind: 'boom' | 'muzzle' | 'spark' | 'dust' | 'build' | 'spawn' | 'promote' | 'shield' | 'target' | 'debris' | 'smoke' | 'fire';
    scale: number;
    dead = false;
    constructor(x: number, y: number, kind: Fx['kind'], life = 0.45, scale = 1) {
        this.x = x; this.y = y; this.kind = kind; this.life = life; this.scale = scale;
    }
    step(dt: number) {
        this.t += dt;
        if (this.kind === 'debris' || this.kind === 'smoke' || this.kind === 'fire') {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            if (this.g) {
                this.vz -= this.g * dt;
                this.z += this.vz * dt;
                if (this.z < 0) { this.z = 0; this.vz *= -0.32; this.vx *= 0.72; this.vy *= 0.72; }
            } else {
                this.z += this.vz * dt;
            }
        }
        if (this.t >= this.life) this.dead = true;
    }
    get k() { return Math.min(1, this.t / this.life); }
}

/** persistent ground mark (shell crater / track) that fades very slowly */
export class Decal {
    x: number;
    y: number;
    r: number;
    alpha: number;
    kind: 'crater' | 'track';
    t = 0;
    life: number;
    dead = false;
    constructor(x: number, y: number, r: number, kind: Decal['kind'], life = 40) {
        this.x = x; this.y = y; this.r = r; this.kind = kind;
        this.life = life;
        this.alpha = kind === 'crater' ? 150 : 55;
    }
    step(dt: number) {
        this.t += dt;
        if (this.t >= this.life) this.dead = true;
    }
    get k() { return Math.min(1, this.t / this.life); }
}

/** persistent area effect created by a super weapon */
export class Zone {
    x: number;
    y: number;
    r: number;
    t = 0;
    dur: number;
    kind: 'sandstorm' | 'aegis' | 'mirage';
    owner: PlayerId;
    color: string;
    dead = false;
    /** damage per second for hostile zones */
    dps = 0;

    constructor(x: number, y: number, r: number, dur: number, kind: Zone['kind'], owner: PlayerId, color: string) {
        this.x = x; this.y = y; this.r = r; this.dur = dur; this.kind = kind; this.owner = owner; this.color = color;
    }

    step(dt: number) {
        this.t += dt;
        if (this.t >= this.dur) this.dead = true;
    }

    get k() { return Math.min(1, this.t / this.dur); }
    contains(x: number, y: number) {
        const dx = x - this.x, dy = y - this.y;
        return dx * dx + dy * dy <= this.r * this.r;
    }
}

/** pickup left on the battlefield (credits / repair / promotion) */
export class Crate {
    id = nextId++;
    x: number;
    y: number;
    kind: 'credits' | 'repair' | 'promote';
    t = 0;
    dead = false;
    constructor(x: number, y: number, kind: Crate['kind']) {
        this.x = x; this.y = y; this.kind = kind;
    }
}

/** Uniform-grid broad phase for neighbour queries. */
export class SpatialGrid {
    cell = 96;
    map = new Map<number, Entity[]>();

    clear() { this.map.clear(); }

    private key(cx: number, cy: number) { return (cx + 512) * 4096 + (cy + 512); }

    insert(e: Entity) {
        const cx = Math.floor((e.x + HALF) / this.cell);
        const cy = Math.floor((e.y + HALF) / this.cell);
        const k = this.key(cx, cy);
        let arr = this.map.get(k);
        if (!arr) { arr = []; this.map.set(k, arr); }
        arr.push(e);
    }

    query(x: number, y: number, r: number, out: Entity[]) {
        out.length = 0;
        const c0x = Math.floor((x - r + HALF) / this.cell);
        const c1x = Math.floor((x + r + HALF) / this.cell);
        const c0y = Math.floor((y - r + HALF) / this.cell);
        const c1y = Math.floor((y + r + HALF) / this.cell);
        for (let cy = c0y; cy <= c1y; cy++) {
            for (let cx = c0x; cx <= c1x; cx++) {
                const arr = this.map.get(this.key(cx, cy));
                if (!arr) continue;
                for (let i = 0; i < arr.length; i++) out.push(arr[i]);
            }
        }
        return out;
    }
}

export const clampToMap = (v: number) => Math.max(-HALF + TILE, Math.min(HALF - TILE, v));
export const tileOf = (v: number) => Math.floor((v + HALF) / TILE);
export const mapTiles = MAP_TILES;
