/**
 * `[CrateRules]` section — crate spawn rate, radius and art.
 *
 * Reference: redalert2/src/game/rules/CrateRules.ts
 *
 * One preserved quirk: `unitCrateType` is kept only when the string is not the
 * literal `"none"` (case-insensitive) — retail spells the empty value that way
 * instead of leaving the key out.
 *
 * `crateRegen` is *minutes*; `CrateGeneratorTrait` multiplies it by
 * `60 * BASE_TICKS_PER_SECOND`, so it must stay in minutes here.
 */
export interface CrateRulesData {
    crateMaximum?: number;
    crateMinimum?: number;
    crateRadius?: number;
    crateRegen?: number;
    unitCrateType?: string;
    healCrateSound?: string;
    crateImg?: string;
    waterCrateImg?: string;
    freeMCV?: boolean;
}

export class CrateRules {
    crateMaximum = 0;
    crateMinimum = 0;
    crateRadius = 0;
    crateRegen = 0;
    unitCrateType?: string;
    healCrateSound = '';
    crateImg = '';
    waterCrateImg = '';
    freeMCV = false;

    read(data: CrateRulesData = {}): CrateRules {
        this.crateMaximum = data.crateMaximum ?? 0;
        this.crateMinimum = data.crateMinimum ?? 0;
        this.crateRadius = data.crateRadius ?? 0;
        this.crateRegen = data.crateRegen ?? 0;
        const unitCrateType = data.unitCrateType ?? '';
        this.unitCrateType = unitCrateType.toLowerCase() !== 'none' && unitCrateType !== ''
            ? unitCrateType
            : undefined;
        this.healCrateSound = data.healCrateSound ?? '';
        this.crateImg = data.crateImg ?? '';
        this.waterCrateImg = data.waterCrateImg ?? '';
        this.freeMCV = !!data.freeMCV;
        return this;
    }
}
