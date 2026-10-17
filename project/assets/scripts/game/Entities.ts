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

    moveStep(dt: number, speedMul: number): boolean {
        this.prevX = this.x;
        this.prevY = this.y;
        if (this.waitT > 0) {
            // yielding to whoever is blocking us; do not consume path nodes
            this.waitT -= dt;
            this.speedCur = 0;
            this.vx = 0;
            this.vy = 0;
            return this.path.length > 0;
        }
        if (this.path.length === 0) {
            this.speedCur = Math.max(0, this.speedCur - this.accel * dt);
            this.vx = 0; this.vy = 0;
            return false;
        }
        const wp = this.path[0];
        const dx = wp.x - this.x;
        const dy = wp.y - this.y;
        const d = Math.hypot(dx, dy);
        if (d < 3) {
            this.path.shift();
            return this.path.length > 0;
        }

        const desired = Math.atan2(dy, dx);
        let diff = desired - this.face;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

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
        this.x += (dx / d) * step;
        this.y += (dy / d) * step;
        this.vx = (dx / d) * this.speedCur;
        this.vy = (dy / d) * this.speedCur;
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

export class Building extends Entity {
    isBuilding = true;
    def: BuildingDef;
    tx: number;
    ty: number;
    size: number;
    /** 0..1 construction progress, 1 = finished */
    progress = 1;
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
        this.armor = 'building';
        this.x = tx * TILE + (def.size * TILE) / 2 - HALF;
        this.y = ty * TILE + (def.size * TILE) / 2 - HALF;
    }

    get done() { return this.progress >= 1; }
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
