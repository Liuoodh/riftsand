/**
 * `[General]` prism block — chained-beam support.
 *
 * Reference: redalert2/src/game/rules/general/PrismRules.ts
 */
export interface PrismRulesData {
    type?: string;
    supportHeight?: number;
    supportMax?: number;
    supportModifier?: number;
}

export class PrismRules {
    type = '';
    supportHeight = 0;
    supportMax = 0;
    supportModifier = 1;

    read(data: PrismRulesData = {}): PrismRules {
        this.type = data.type ?? '';
        this.supportHeight = data.supportHeight ?? 0;
        this.supportMax = data.supportMax ?? 0;
        this.supportModifier = data.supportModifier ?? 1;
        return this;
    }
}
