/**
 * `[Projectiles]` section — how a fired shell behaves in flight.
 *
 * Reference: redalert2/src/game/rules/ProjectileRules.ts
 *
 * The three-line `acceleration` derivation is preserved exactly because each line
 * matters:
 *   - `ROT === 1` (instant turn) with no acceleration means the projectile may
 *     steer arbitrarily hard, i.e. `Infinity` — not 0;
 *   - everything else without acceleration falls back to 3;
 *   - `acceleration || 3` runs *after* the Infinity assignment, and `Infinity || 3`
 *     is still `Infinity`, so the instant-turn case survives.
 *
 * `AG` (anti-ground) defaults to **true** while `AA` defaults to false: a
 * projectile is assumed to be able to hit the ground.
 */
import { ObjectRules, ObjectRulesData } from './ObjectRules';
import type { ObjectType } from '../type/ObjectType';

export interface ProjectileRulesData extends ObjectRulesData {
    acceleration?: number;
    arcing?: boolean;
    courseLockDuration?: number;
    detonationAltitude?: number;
    firersPalette?: boolean;
    flakScatter?: boolean;
    inaccurate?: boolean;
    inviso?: boolean;
    /** ini key `AA` */
    isAntiAir?: boolean;
    /** ini key `AG` */
    isAntiGround?: boolean;
    level?: boolean;
    /** raw ini `ROT` */
    rot?: number;
    shadow?: boolean;
    shrapnelWeapon?: string;
    shrapnelCount?: number;
    subjectToCliffs?: boolean;
    subjectToElevation?: boolean;
    subjectToWalls?: boolean;
    vertical?: boolean;
}

export class ProjectileRules extends ObjectRules {
    acceleration = 0;
    arcing = false;
    courseLockDuration = 0;
    detonationAltitude = 0;
    firersPalette = false;
    flakScatter = false;
    inaccurate = false;
    inviso = false;
    isAntiAir = false;
    isAntiGround = true;
    level = false;
    /** degrees per tick */
    rot = 0;
    /** raw ini value, kept for round-tripping */
    iniRot = 0;
    shadow = true;
    shrapnelWeapon?: string;
    shrapnelCount = 0;
    subjectToCliffs = false;
    subjectToElevation = false;
    subjectToWalls = false;
    vertical = false;

    constructor(type: ObjectType, data: ProjectileRulesData, generalRules: unknown = {}, index = -1) {
        super(data, type, index);
        this.parse(data);
    }

    protected parse(data: ProjectileRulesData): void {
        super.parse(data);
        const rot = data.rot ?? 0;
        let acceleration = data.acceleration ?? 0;
        if (rot === 1 && !acceleration) {
            acceleration = Number.POSITIVE_INFINITY;
        }
        acceleration = acceleration || 3;
        this.acceleration = acceleration;
        this.arcing = !!data.arcing;
        this.courseLockDuration = data.courseLockDuration ?? 0;
        this.detonationAltitude = data.detonationAltitude ?? 0;
        this.firersPalette = !!data.firersPalette;
        this.flakScatter = !!data.flakScatter;
        this.inaccurate = !!data.inaccurate;
        this.inviso = !!data.inviso;
        this.isAntiAir = !!data.isAntiAir;
        this.isAntiGround = data.isAntiGround ?? true;
        this.level = !!data.level;
        this.rot = ObjectRules.iniRotToDegsPerTick(rot);
        this.iniRot = rot;
        this.shadow = data.shadow ?? true;
        this.shrapnelWeapon = data.shrapnelWeapon || undefined;
        this.shrapnelCount = data.shrapnelCount ?? 0;
        this.subjectToCliffs = !!data.subjectToCliffs;
        this.subjectToElevation = !!data.subjectToElevation;
        this.subjectToWalls = !!data.subjectToWalls;
        this.vertical = !!data.vertical;
    }
}
