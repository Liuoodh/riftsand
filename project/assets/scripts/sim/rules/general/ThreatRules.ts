/**
 * `[General]` threat-evaluation coefficients, read by the AI when scoring targets.
 *
 * Reference: redalert2/src/game/rules/general/ThreatRules.ts
 */
export interface ThreatRulesData {
    myEffectivenessCoefficientDefault?: number;
    targetEffectivenessCoefficientDefault?: number;
    targetSpecialThreatCoefficientDefault?: number;
    targetStrengthCoefficientDefault?: number;
    targetDistanceCoefficientDefault?: number;
}

export class ThreatRules {
    myEffectivenessCoefficientDefault = 0;
    targetEffectivenessCoefficientDefault = 0;
    targetSpecialThreatCoefficientDefault = 0;
    targetStrengthCoefficientDefault = 0;
    targetDistanceCoefficientDefault = 0;

    read(data: ThreatRulesData = {}): ThreatRules {
        this.myEffectivenessCoefficientDefault = data.myEffectivenessCoefficientDefault ?? 0;
        this.targetEffectivenessCoefficientDefault = data.targetEffectivenessCoefficientDefault ?? 0;
        this.targetSpecialThreatCoefficientDefault = data.targetSpecialThreatCoefficientDefault ?? 0;
        this.targetStrengthCoefficientDefault = data.targetStrengthCoefficientDefault ?? 0;
        this.targetDistanceCoefficientDefault = data.targetDistanceCoefficientDefault ?? 0;
        return this;
    }
}
