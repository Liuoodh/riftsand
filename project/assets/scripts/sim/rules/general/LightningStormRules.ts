/**
 * `[General]` lightning-storm super weapon.
 *
 * Reference: redalert2/src/game/rules/general/LightningStormRules.ts
 */
export interface LightningStormRulesData {
    deferment?: number;
    damage?: number;
    duration?: number;
    warhead?: string;
    hitDelay?: number;
    scatterDelay?: number;
    cellSpread?: number;
    separation?: number;
}

export class LightningStormRules {
    deferment = 0;
    damage = 0;
    duration = 0;
    warhead = '';
    hitDelay = 0;
    scatterDelay = 0;
    cellSpread = 0;
    separation = 0;

    read(data: LightningStormRulesData = {}): LightningStormRules {
        this.deferment = data.deferment ?? 0;
        this.damage = data.damage ?? 0;
        this.duration = data.duration ?? 0;
        this.warhead = data.warhead ?? '';
        this.hitDelay = data.hitDelay ?? 0;
        this.scatterDelay = data.scatterDelay ?? 0;
        this.cellSpread = data.cellSpread ?? 0;
        this.separation = data.separation ?? 0;
        return this;
    }
}
