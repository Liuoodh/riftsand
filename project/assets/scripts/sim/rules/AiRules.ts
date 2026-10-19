/**
 * `[AI]` section — the short lists the bot and the crate generator consult.
 *
 * Reference: redalert2/src/game/rules/AiRules.ts (fields are `private` in the
 * reference yet read from `GatherOreTask`, `AgentTrait` and `CrateGeneratorTrait`;
 * TS `private` never enforced it, so they are `public` here. Visibility only.)
 *
 * `tiberiumNearScan` / `tiberiumFarScan` are the harvester's widening search
 * radii in cells: it looks inside the near radius first and only falls back to
 * the far radius when nothing is found.
 */
export interface AiRulesData {
    buildPower?: string[];
    buildRefinery?: string[];
    buildTech?: string[];
    tiberiumFarScan?: number;
    tiberiumNearScan?: number;
}

export class AiRules {
    buildPower: string[] = [];
    buildRefinery: string[] = [];
    buildTech: string[] = [];
    tiberiumFarScan = 50;
    tiberiumNearScan = 5;

    read(data: AiRulesData = {}): AiRules {
        this.buildPower = data.buildPower ?? [];
        this.buildRefinery = data.buildRefinery ?? [];
        this.buildTech = data.buildTech ?? [];
        this.tiberiumFarScan = data.tiberiumFarScan ?? 50;
        this.tiberiumNearScan = data.tiberiumNearScan ?? 5;
        return this;
    }
}
