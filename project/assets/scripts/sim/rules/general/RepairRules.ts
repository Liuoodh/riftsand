/**
 * `[General]` repair block — the service depot and the air pad.
 *
 * Reference: redalert2/src/game/rules/general/RepairRules.ts
 *
 * Note `reloadRate` lives here, not in `[General]` proper. It is the pad's
 * minutes-per-round clock that `UnitReloadTrait` consumes.
 */
export interface RepairRulesData {
    reloadRate?: number;
    repairPercent?: number;
    repairRate?: number;
    repairStep?: number;
    uRepairRate?: number;
    iRepairRate?: number;
    iRepairStep?: number;
}

export class RepairRules {
    reloadRate = 0;
    repairPercent = 0;
    repairRate = 0;
    repairStep = 0;
    uRepairRate = 0;
    iRepairRate = 0;
    iRepairStep = 0;

    read(data: RepairRulesData = {}): RepairRules {
        this.reloadRate = data.reloadRate ?? 0;
        this.repairPercent = data.repairPercent ?? 0;
        this.repairRate = data.repairRate ?? 0;
        this.repairStep = data.repairStep ?? 0;
        this.uRepairRate = data.uRepairRate ?? 0;
        this.iRepairRate = data.iRepairRate ?? 0;
        this.iRepairStep = data.iRepairStep ?? 0;
        return this;
    }
}
