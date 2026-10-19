/**
 * `[General]` veteran block.
 *
 * Reference: redalert2/src/game/rules/general/VeteranRules.ts
 *
 * `veteranRatio=3` means "three kills per promotion"; `veteranSight` is floored
 * at 1 because a 0 would blind a promoted unit.
 */
export interface VeteranRulesData {
    veteranRatio?: number;
    veteranCombat?: number;
    veteranSpeed?: number;
    veteranSight?: number;
    veteranArmor?: number;
    veteranROF?: number;
    veteranCap?: number;
    initialVeteran?: boolean;
}

export class VeteranRules {
    veteranRatio = 3;
    veteranCombat = 1;
    veteranSpeed = 1;
    veteranSight = 1;
    veteranArmor = 1;
    veteranROF = 1;
    veteranCap = 2;
    initialVeteran = false;

    read(data: VeteranRulesData = {}): VeteranRules {
        this.veteranRatio = data.veteranRatio ?? 3;
        this.veteranCombat = data.veteranCombat ?? 1;
        this.veteranSpeed = data.veteranSpeed ?? 1;
        this.veteranSight = Math.max(1, data.veteranSight ?? 1);
        this.veteranArmor = data.veteranArmor ?? 1;
        this.veteranROF = data.veteranROF ?? 1;
        this.veteranCap = data.veteranCap ?? 2;
        this.initialVeteran = data.initialVeteran ?? false;
        return this;
    }
}
