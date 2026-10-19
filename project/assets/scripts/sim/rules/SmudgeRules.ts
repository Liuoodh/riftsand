/**
 * `[Smudge]`-family section — the scorch/crater decals left on the ground.
 *
 * Reference: redalert2/src/game/rules/SmudgeRules.ts
 *
 * `width` / `height` default to 1 cell, not 0: a smudge with no size in the rules
 * still has to cover the cell it was placed on.
 */
import { ObjectRules, ObjectRulesData } from './ObjectRules';
import type { ObjectType } from '../type/ObjectType';

export interface SmudgeRulesData extends ObjectRulesData {
    burn?: boolean;
    crater?: boolean;
    width?: number;
    height?: number;
}

export class SmudgeRules extends ObjectRules {
    burn = false;
    crater = false;
    width = 1;
    height = 1;

    constructor(type: ObjectType, data: SmudgeRulesData, generalRules: unknown = {}, index = -1) {
        super(data, type, index);
        this.parse(data);
    }

    protected parse(data: SmudgeRulesData): void {
        super.parse(data);
        this.burn = !!data.burn;
        this.crater = !!data.crater;
        this.width = data.width ?? 1;
        this.height = data.height ?? 1;
    }
}
