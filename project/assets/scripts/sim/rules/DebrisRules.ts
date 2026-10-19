/**
 * `[VoxelAnims]` section — the flying chunk that comes off a destroyed object.
 *
 * Reference: redalert2/src/game/rules/DebrisRules.ts
 *
 * `elasticity` is clamped to [0, 1] on read — a bounce coefficient above 1 would
 * gain energy every impact and never settle.
 *
 * `trailerSeparation` keeps the reference's misspelling of the ini key
 * (`TrailerSeperation`); renaming it would silently drop the value.
 */
import { ObjectRules, ObjectRulesData } from './ObjectRules';
import { clamp } from '../util/math';
import type { ObjectType } from '../type/ObjectType';

export interface DebrisRulesData extends ObjectRulesData {
    damage?: number;
    damageRadius?: number;
    duration?: number;
    elasticity?: number;
    expireAnim?: string;
    minAngularVelocity?: number;
    maxAngularVelocity?: number;
    maxXYVel?: number;
    minZVel?: number;
    maxZVel?: number;
    shareTurretData?: boolean;
    shareBodyData?: boolean;
    shareBarrelData?: boolean;
    shareSource?: string;
    trailerAnim?: string;
    /** ini key is misspelled `TrailerSeperation` */
    trailerSeparation?: number;
    warhead?: string;
}

export class DebrisRules extends ObjectRules {
    damage = 0;
    damageRadius = 0;
    duration = 0;
    elasticity = 0.75;
    expireAnim?: string;
    minAngularVelocity = 0;
    maxAngularVelocity = 0;
    maxXYVel = 0;
    minZVel = 0;
    maxZVel = 0;
    shareTurretData = false;
    shareBodyData = false;
    shareBarrelData = false;
    shareSource?: string;
    trailerAnim?: string;
    trailerSeparation = 0;
    warhead?: string;

    constructor(type: ObjectType, data: DebrisRulesData, generalRules: unknown = {}, index = -1) {
        super(data, type, index);
        this.parse(data);
    }

    protected parse(data: DebrisRulesData): void {
        super.parse(data);
        this.damage = data.damage ?? 0;
        this.damageRadius = data.damageRadius ?? 0;
        this.duration = data.duration ?? 0;
        this.elasticity = clamp(data.elasticity ?? 0.75, 0, 1);
        this.expireAnim = data.expireAnim || undefined;
        this.minAngularVelocity = data.minAngularVelocity ?? 0;
        this.maxAngularVelocity = data.maxAngularVelocity ?? 0;
        this.maxXYVel = data.maxXYVel ?? 0;
        this.minZVel = data.minZVel ?? 0;
        this.maxZVel = data.maxZVel ?? 0;
        this.shareTurretData = !!data.shareTurretData;
        this.shareBodyData = !!data.shareBodyData;
        this.shareBarrelData = !!data.shareBarrelData;
        this.shareSource = data.shareSource || undefined;
        this.trailerAnim = data.trailerAnim || undefined;
        this.trailerSeparation = data.trailerSeparation ?? 0;
        this.warhead = data.warhead || undefined;
    }
}
