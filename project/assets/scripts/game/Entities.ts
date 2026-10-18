/**
 * Entity model: units, buildings, projectiles, resource nodes.
 * These are plain data objects — all simulation logic lives in game/Game.ts,
 * rendering lives in render/Views.ts. Keeping data and behaviour apart makes
 * the simulation easy to test and cheap to step.
 */
import {
    BuildingDef, UnitDef, Stance, TILE, HALF, MAP_TILES,
    unitMass, unitTurn, unitAccel, PROJ_PHYSICS,
} from '../core/Core';
import type { CrystalNode } from '../world/Terrain';

export type PlayerId = number;

export type HarvestPhase = 'seek' | 'toMine' | 'mining' | 'toBase' | 'unload';

export type Order =
    | { k: 'idle' }
    | { k: 'move'; x: number; y: number }
    | { k: 'attackmove'; x: number; y: number }
    | { k: 'attack'; target: Entity }
    | { k: 'harvest'; node: CrystalNode | null; phase: HarvestPhase; timer: number }
    | { k: 'capture'; target: Entity }
    | { k: 'deploy' };

let nextId = 1;

/**
 * Terrain/building occupancy probe, injected once by Game.
 *
 * The reference engine never resolves a collision by teleporting a unit: a
 * blocked move is *refused* (the unit waits or picks another cell). To behave the
 * same way the unit needs to know what the world looks like, but `Entities.ts`
 * must not import `Game.ts` (circular), so it asks through this hook.
 *
 *   (x, y, radius) -> true when a hull of `radius` cannot occupy that point
 */
let worldBlockedFn: ((x: number, y: number, r: number) => boolean) | null = null;

export function setWorldBlocked(fn: ((x: number, y: number, r: number) => boolean) | null) {
    worldBlockedFn = fn;
}

/**
 * Unit-vs-unit occupancy probe, injected by Game.
 *
 * The reference never resolves a unit collision by moving both units apart: a
 * cell holds at most one vehicle, or three infantry on distinct sub-cells
 * (MoveTask.canStopAtTile). A unit that would violate that simply does not step
 * — it waits, the blocker is asked to move aside, or the path is recomputed.
 * That is what stops a walking soldier from shoving a standing one across the
 * map, and what stops enemies walking through each other.
 */
let unitBlockedFn: ((u: Unit, x: number, y: number) => boolean) | null = null;
/** cell-capacity test only, no interpenetration — the reference canStopAtTile */
let roomFn: ((u: Unit, x: number, y: number) => boolean) | null = null;

export function setUnitBlocked(fn: ((u: Unit, x: number, y: number) => boolean) | null) {
    unitBlockedFn = fn;
}

/**
 * Injected "does this cell have room for me" test.
 *
 * Needed by the CloseEnough rule: when the final waypoint sits in a cell that is
 * already full, the order must complete with the unit standing next to it
 * (reference: MoveTask.canStopAtTile fails → isCloseEnoughToDest → MoveResult.
 * CloseEnough). Without it the unit slides along the neighbour's edge forever at
 * full speed — full throttle, zero net movement.
 */
export function setRoomCheck(fn: ((u: Unit, x: number, y: number) => boolean) | null) {
    roomFn = fn;
}

export class Entity {
    id = nextId++;
    owner: PlayerId = 0;
    x = 0;
    y = 0;
    hp = 1;
    maxHp = 1;
    dead = false;
    isBuilding = false;
    armor: UnitDef['armor'] = 'light';
    view: any = null;
    /** last time this entity took damage (for hp bar fade) */
    lastHit = -99;
    /** true when the enemy can currently see this entity */
    visible = true;
    hitFlash = 0;

    /** collision footprint; subclasses refine this */
    get radius(): number { return this.isBuilding ? 16 : 8; }
    get cost(): number { return 0; }
}

export class Unit extends Entity {
    def: UnitDef;
    order: Order = { k: 'idle' };
    /** queued waypoint orders, executed one after another */
    orderQueue: Order[] = [];
    path: Array<{ x: number; y: number }> = [];
    face = 0;
    /** turret heading, decoupled from the hull (reference: TurretTrait) */
    turretFace = 0;
    /** where the turret is pointed and for how much longer it stays there */
    turretAim = 0;
    turretHold = 0;
    cd = 0;
    vx = 0;
    vy = 0;
    cargo = 0;
    repath = 0;
    stuck = 0;
    /** consecutive failed approach attempts; resets as soon as the unit moves */
    retry = 0;
    /** >0 means "hold still and let the other one pass" (reference: WaitTicksTask) */
    waitT = 0;
    /** per-frame budget of separation shoves, so a crowd cannot pop a unit */
    pushAcc = 0;
    /** cell this unit is registered on in the occupation table */
    cellX = -1;
    cellY = -1;
    /** infantry sub-position inside its cell, 0..2 (reference: position.subCell) */
    subCell = 0;
    /** how long this unit has been unable to enter its next cell */
    blockT = 0;
    /** progress sampler: position at the last sample and time since it */
    progX = 0;
    progY = 0;
    progT = 0;
    /** distance to the current goal at the last sample (0 = not measured yet) */
    progGoalD = 0;
    /** how long we have been politely queued behind a moving unit */
    trafficT = 0;
    /** re-routes attempted for the current order, capped like MoveResult.Fail */
    repathTry = 0;
    /** cell this unit wanted to enter but could not */
    blockTx = -1;
    blockTy = -1;
    /** >0 means "do not ask for a new path" (avoids oscillating on failure) */
    repathHold = 0;
    /** how long a live move order has had an empty path (engine watchdog) */
    stallT = 0;
    /** >0 while this unit is moving aside for someone else */
    asideT = 0;
    /** cached "engaged" target for attack-move */
    engage: Entity | null = null;
    bob = Math.random() * Math.PI * 2;
    /** assigned harvester slot, prevents all harvesters piling on one node */
    mineNode: CrystalNode | null = null;
    /** 0 = uncapped; otherwise the group march speed (keeps formations together) */
    speedCap = 0;
    /** current scalar speed, ramps up so vehicles do not snap to full throttle */
    speedCur = 0;

    /* ---- veterancy ---- */
    xp = 0;
    level = 0;              // 0 rookie, 1 veteran, 2 elite

    /* ---- combat behaviour ---- */
    stance: Stance = 'guard';
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

    /* ---- physics ---- */
    /** terrain multiplier sampled under the unit each frame */
    terrainMul = 1;
    /** last valid position, used to roll back out of walls */
    prevX = 0;
    prevY = 0;
    /** muzzle recoil timer, the view offsets the hull by this */
    recoil = 0;
    /** dust kick-up timer */
    dustT = 0;
    /** angular velocity of the hull this frame, for banking */
    turnDelta = 0;
    /** true when the unit was pushed out of terrain this frame */
    blockedNow = false;

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
    }

    get radius() { return this.def.radius; }

    /**
     * Radius used for *movement* tests.
     *
     * The drawn hull deliberately overhangs its cell (that is how a tank reads
     * as bigger than a tile). Using the full visual radius for collision made a
     * truck unable to drive along a cell row next to a building: the cell centre
     * is exactly 16px from the wall and the test needs 16px of clearance, so any
     * one-pixel drift was rejected and the unit ground to a halt. The retail
     * engine is cell-based here (`getPassableSpeed(tile)`) and lets the sprite
     * overhang; 0.45 reproduces that — the hull may graze a wall by a few pixels
     * but can never end up half-buried in it.
     */
    get steerRadius() { return this.def.radius * 0.45; }
    get speed() { return this.def.speed; }
    get mass() { return unitMass(this.def); }
    get turnRate() { return unitTurn(this.def); }
    get accel() { return unitAccel(this.def); }
    get altitude() { return this.def.altitude || 0; }
    get isHover() { return !!this.def.hover; }
    get canCrush() { return !!this.def.crush || this.def.kind === 'harvester' || this.def.kind === 'mcv'; }
    get isAir() { return this.def.kind === 'air'; }
    get isHarvester() { return this.def.kind === 'harvester'; }
    get isMcv() { return this.def.kind === 'mcv'; }
    get isEngineer() { return !!this.def.engineer; }
    get cost() { return this.def.cost; }

    /** 1.0 / 1.2 / 1.45 damage multiplier */
    get damageMul() { return this.level === 2 ? 1.45 : this.level === 1 ? 1.2 : 1; }
    /** incoming damage multiplier (lower is tougher) */
    get armorMul() { return this.level === 2 ? 0.66 : this.level === 1 ? 0.82 : 1; }
    /** cooldown multiplier */
    get rofMul() { return this.level === 2 ? 0.76 : this.level === 1 ? 0.88 : 1; }
    get sightBonus() { return this.level === 2 ? 2 : this.level === 1 ? 1 : 0; }

    get slowed() { return this.slowUntil > -1; }
    get invulnerable() { return this.invulnUntil > -1; }

    /** can a hull of this radius sit here (terrain + structures)? */
    canOccupy(x: number, y: number) {
        if (this.isAir) return true;
        if (!worldBlockedFn) return true;
        return !worldBlockedFn(x, y, this.radius);
    }

    /**
     * Can this unit take one step to (x, y)?
     *
     * Terrain first, then the occupancy table. The reference does the same two
     * checks in MoveTask.canStopAtTile before it lets a unit finish a move.
     */
    canStepTo(x: number, y: number) {
        if (this.isAir) return true;
        if (worldBlockedFn && worldBlockedFn(x, y, this.steerRadius)) return false;
        if (unitBlockedFn && unitBlockedFn(this, x, y)) return false;
        return true;
    }

    /** remember which cell we could not enter, for the blocker lookup */
    private noteBlocked(ux: number, uy: number) {
        const look = this.radius + 6;
        this.blockTx = Math.floor((this.x + ux * look + HALF) / TILE);
        this.blockTy = Math.floor((this.y + uy * look + HALF) / TILE);
    }

    moveStep(dt: number, speedMul: number): boolean {
        this.prevX = this.x;
        this.prevY = this.y;
        if (this.waitT > 0) {
            // yielding to whoever is blocking us; do not consume path nodes
            this.waitT -= dt;
            this.speedCur = 0;
            this.vx = 0;
            this.vy = 0;
            this.blockedNow = false;
            return this.path.length > 0;
        }
        if (this.path.length === 0) {
            this.speedCur = Math.max(0, this.speedCur - this.accel * dt);
            this.vx = 0; this.vy = 0;
            this.blockedNow = false;
            return false;
        }
        const wp = this.path[0];
        const dx = wp.x - this.x;
        const dy = wp.y - this.y;
        const d = Math.hypot(dx, dy);
        if (d < 3) {
            this.path.shift();
            // reaching a waypoint resets the planning counter (reference:
            // inPlanningForTicks is cleared on ReachedNextWaypoint)
            this.blockedNow = false;
            return this.path.length > 0;
        }

        const desired = Math.atan2(dy, dx);
        let diff = desired - this.face;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        /*
         * CloseEnough: the last waypoint is a cell that is already full.
         *
         * Three riflemen can share a cell, the fourth cannot. Five men ordered to
         * one point put two of them against a neighbour's edge, where they keep
         * full speed and gain nothing — measured as a permanent stall with
         * `blockT == 0` because every tick technically moved them a fraction of
         * a pixel along the free axis. The retail engine ends the order here
         * (canStopAtTile → CloseEnough), so the unit parks beside the crowd.
         */
        if (this.path.length === 1 && d < TILE * 1.5 && roomFn && !roomFn(this, wp.x, wp.y)) {
            this.path.length = 0;
            this.speedCur = 0;
            this.vx = 0;
            this.vy = 0;
            this.blockedNow = false;
            return false;
        }

        // Reference behaviour: a hull must face its path before it drives
        // (DriveLocomotor returns a TurnTask and zero velocity otherwise).
        // Infantry pivot instantly (FootLocomotor just assigns direction).
        if (this.def.kind === 'infantry') {
            this.face = desired;
            this.turnDelta = 0;
        } else {
            const turn = this.turnRate;
            const applied = Math.max(-turn * dt, Math.min(turn * dt, diff));
            this.face += applied;
            this.turnDelta = applied / Math.max(0.001, dt);
            const remaining = Math.abs(diff - applied);
            // Only a real about-face stops the hull. Waiting on every waypoint
            // kink turned harvesters into traffic jams (measured in battletest).
            if (remaining > 0.85) {
                this.speedCur = Math.max(0, this.speedCur - this.accel * 2 * dt);
                this.vx = 0;
                this.vy = 0;
                /*
                 * Turning is not being blocked. Leaving the flag untouched let a
                 * stale `true` from the previous tick survive a long turn, which
                 * fed the blocked-unit chain and cancelled perfectly good orders.
                 */
                this.blockedNow = false;
                return true;
            }
        }
        const align = Math.max(0.15, Math.cos(diff));

        let top = this.speed * speedMul * align * this.terrainMul;
        if (this.speedCap > 0) top = Math.min(top, this.speedCap);
        if (this.slowed) top *= 0.55;
        // accelerate / brake toward the target speed instead of snapping
        const delta = top - this.speedCur;
        const maxDelta = this.accel * dt;
        this.speedCur += Math.max(-maxDelta, Math.min(maxDelta, delta));
        if (this.speedCur < 0) this.speedCur = 0;
        const step = Math.min(d, this.speedCur * dt);
        const ux = dx / d, uy = dy / d;
        const ax = ux * step;
        const ay = uy * step;

        /*
         * One step, three candidates: straight, then either axis alone.
         *
         * The straight step is refused when the destination cell has no room
         * (one vehicle per cell, three infantry per cell — MoveTask.canStopAtTile)
         * or when the hull would overlap solid ground. Sliding along an axis is
         * what lets a column hug a wall instead of grinding to a halt; when all
         * three are refused the unit stops and reports the cell it wanted, which
         * is what drives the aside / re-path / give-up chain in Game.
         */
        const beforeD = d;
        let moved = false;
        if (this.canStepTo(this.x + ax, this.y + ay)) {
            this.x += ax;
            this.y += ay;
            this.vx = ux * this.speedCur;
            this.vy = uy * this.speedCur;
            moved = true;
        } else if (this.canStepTo(this.x + ax, this.y)) {
            // partial progress along one axis: keep going
            this.x += ax;
            this.vx = ux * this.speedCur;
            this.vy = 0;
            moved = true;
        } else if (this.canStepTo(this.x, this.y + ay)) {
            this.y += ay;
            this.vx = 0;
            this.vy = uy * this.speedCur;
            moved = true;
        }

        /*
         * "Blocked" means *no progress toward the waypoint*, not "the straight
         * step was refused". A unit pressed square against a parked hull can
         * still slide a hundredth of a pixel sideways, and treating that as
         * movement left it standing there forever with blockedNow = false — the
         * aside / re-route chain never ran. Measuring the actual gain fixes both
         * that and the wall-hugging case in one rule.
         */
        if (!moved) {
            this.speedCur = 0;
            this.vx = 0;
            this.vy = 0;
            this.blockedNow = true;
            this.noteBlocked(ux, uy);
            return true;
        }
        const gained = beforeD - Math.hypot(wp.x - this.x, wp.y - this.y);
        this.blockedNow = gained < Math.min(step, 9) * 0.4;
        if (this.blockedNow) this.noteBlocked(ux, uy);
        return true;
    }

    stop() {
        this.path.length = 0;
        this.vx = 0;
        this.vy = 0;
        this.speedCur = 0;
    }

    /**
     * Turret tracks a target when there is one, otherwise drifts back to the
     * hull heading. Air units have no turret, so their body simply follows.
     */
    /**
     * Is the turret pointed close enough to fire?
     *
     * The reference's AttackTask blocks on the turret finishing its rotation; we
     * approximate with an angular tolerance. Without it a tank fires sideways the
     * instant it acquires a target, while the barrel is still swinging.
     */
    aimReady(tolerance = 0.22) {
        if (this.def.kind === 'infantry' || this.def.kind === 'air') return true;
        let d = this.turretAim - this.turretFace;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return Math.abs(d) <= tolerance;
    }

    /** called when a target is acquired: swing the turret onto it, never snap */
    aimAt(x: number, y: number) {
        this.turretAim = Math.atan2(y - this.y, x - this.x);
        this.turretHold = 2.2;
    }

    aimTurret(dt: number, targetAngle?: number) {
        if (this.def.kind === 'air') return;
        const want = targetAngle === undefined ? this.face : targetAngle;
        let d = want - this.turretFace;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const rate = (this.def.kind === 'infantry' ? 12 : 3.6) * dt;
        this.turretFace += Math.max(-rate, Math.min(rate, d));
    }

    canShoot() {
        return !!this.def.weapon && this.cd <= 0;
    }
}

/** BuildStatus, mirroring redalert2/src/game/gameobject/Building.ts:32-36 */
export type BuildStatus = 'buildup' | 'ready' | 'builddown';

export class Building extends Entity {
    isBuilding = true;
    def: BuildingDef;
    tx: number;
    ty: number;
    size: number;
    /** 0..1 construction progress, 1 = finished */
    progress = 1;
    /**
     * Retail raises a structure over `BuildupTime` and then plays the same art
     * backwards when it is sold. Both phases are driven by this clock.
     */
    status: BuildStatus = 'ready';
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
    }

    get done() { return this.progress >= 1 && this.status === 'ready'; }
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
