/**
 * Entity model: units, buildings, projectiles, resource nodes.
 * These are plain data objects — all simulation logic lives in game/Game.ts,
 * rendering lives in render/Views.ts. Keeping data and behaviour apart makes
 * the simulation easy to test and cheap to step.
 */
import { BuildingDef, UnitDef, Stance, TILE, HALF, MAP_TILES } from '../core/Core';
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
    cd = 0;
    vx = 0;
    vy = 0;
    cargo = 0;
    repath = 0;
    stuck = 0;
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

    constructor(def: UnitDef, owner: PlayerId, x: number, y: number) {
        super();
        this.def = def;
        this.owner = owner;
        this.x = x;
        this.y = y;
        this.hp = def.hp;
        this.maxHp = def.hp;
        this.armor = def.armor;
    }

    get radius() { return this.def.radius; }
    get speed() { return this.def.speed; }
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
        if (this.path.length === 0) {
            this.speedCur *= Math.max(0, 1 - dt * 6);
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

        // vehicles pivot smoothly; sharp turns also bleed off speed so heavy
        // hulls feel like they have mass instead of strafing around corners
        const turnRate = this.def.kind === 'infantry' ? 9 : 3.6;
        this.face += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
        const align = Math.max(0.18, Math.cos(diff));

        let top = this.speed * speedMul * align;
        if (this.speedCap > 0) top = Math.min(top, this.speedCap);
        if (this.slowed) top *= 0.55;
        this.speedCur += (top - this.speedCur) * Math.min(1, dt * 5.5);
        const step = Math.min(d, Math.max(6, this.speedCur) * dt);
        this.x += (dx / d) * step;
        this.y += (dy / d) * step;
        return true;
    }

    stop() {
        this.path.length = 0;
        this.vx = 0;
        this.vy = 0;
        this.speedCur = 0;
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
    sx: number;
    sy: number;
    tx: number;
    ty: number;
    t = 0;
    dur: number;
    kind: 'bullet' | 'shell' | 'rocket' | 'bomb';
    owner: PlayerId;
    dmg: number;
    dmgType: 'small' | 'ap' | 'explosive';
    splash = 0;
    target: Entity | null;
    /** firing unit, used to award veterancy */
    source: Unit | null = null;
    dead = false;
    arc = 0;

    constructor(o: {
        x: number; y: number; tx: number; ty: number; dur: number; kind: 'bullet' | 'shell' | 'rocket' | 'bomb';
        owner: PlayerId; dmg: number; dmgType: 'small' | 'ap' | 'explosive'; splash?: number; target: Entity | null;
    }) {
        this.x = o.x; this.y = o.y; this.sx = o.x; this.sy = o.y;
        this.tx = o.tx; this.ty = o.ty;
        this.dur = o.dur; this.kind = o.kind;
        this.owner = o.owner; this.dmg = o.dmg; this.dmgType = o.dmgType;
        this.splash = o.splash || 0;
        this.target = o.target;
        this.arc = o.kind === 'shell' || o.kind === 'bomb' ? 26 : 0;
    }

    step(dt: number) {
        this.t += dt;
        const k = Math.min(1, this.t / this.dur);
        if (this.target && !this.target.dead) {
            this.tx = this.target.x;
            this.ty = this.target.y;
        }
        this.x = this.sx + (this.tx - this.sx) * k;
        this.y = this.sy + (this.ty - this.sy) * k;
        if (k >= 1) this.dead = true;
    }

    get height() {
        const k = Math.min(1, this.t / this.dur);
        return Math.sin(k * Math.PI) * this.arc;
    }
}

export class Fx {
    x: number;
    y: number;
    t = 0;
    life: number;
    kind: 'boom' | 'muzzle' | 'spark' | 'dust' | 'build' | 'spawn' | 'promote' | 'shield' | 'target';
    scale: number;
    dead = false;
    constructor(x: number, y: number, kind: Fx['kind'], life = 0.45, scale = 1) {
        this.x = x; this.y = y; this.kind = kind; this.life = life; this.scale = scale;
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
