/**
 * `[CombatDamage]` — the shared damage constants.
 *
 * Reference: redalert2/src/game/rules/CombatDamageRules.ts
 *
 * `openToppedRangeBonus` lives here rather than in `[General]` because retail
 * rulesmd.ini keeps it in this section; the reference comments on that and so
 * does this file, because it is the kind of thing a future cleanup "fixes" and
 * then wonders why open-topped transports lost their range bonus.
 */
export interface CombatDamageRulesData {
    ballisticScatter?: number;
    bridgeStrength?: number;
    c4Delay?: number;
    c4Warhead?: string;
    deathWeapon?: string;
    dMislEliteWarhead?: string;
    dMislWarhead?: string;
    flameDamage?: string;
    ironCurtainDuration?: number;
    ivanDamage?: number;
    ivanIconFlickerRate?: number;
    ivanTimedDelay?: number;
    ivanWarhead?: string;
    openToppedRangeBonus?: number;
    splashList?: string[];
    v3EliteWarhead?: string;
    v3Warhead?: string;
}

export class CombatDamageRules {
    ballisticScatter = 0;
    bridgeStrength = 0;
    c4Delay = 0;
    c4Warhead = '';
    deathWeapon = '';
    dMislEliteWarhead = '';
    dMislWarhead = '';
    flameDamage = '';
    ironCurtainDuration = 0;
    ivanDamage = 0;
    ivanIconFlickerRate = 0;
    ivanTimedDelay = 0;
    ivanWarhead = '';
    openToppedRangeBonus = 1;
    splashList: string[] = [];
    v3EliteWarhead = '';
    v3Warhead = '';

    constructor(data: CombatDamageRulesData = {}) {
        this.read(data);
    }

    read(data: CombatDamageRulesData): this {
        this.ballisticScatter = data.ballisticScatter ?? 0;
        this.bridgeStrength = data.bridgeStrength ?? 0;
        this.c4Delay = data.c4Delay ?? 0;
        this.c4Warhead = data.c4Warhead ?? '';
        this.deathWeapon = data.deathWeapon ?? '';
        this.dMislEliteWarhead = data.dMislEliteWarhead ?? '';
        this.dMislWarhead = data.dMislWarhead ?? '';
        this.flameDamage = data.flameDamage ?? '';
        this.ironCurtainDuration = data.ironCurtainDuration ?? 0;
        this.ivanDamage = data.ivanDamage ?? 0;
        this.ivanIconFlickerRate = data.ivanIconFlickerRate ?? 0;
        this.ivanTimedDelay = data.ivanTimedDelay ?? 0;
        this.ivanWarhead = data.ivanWarhead ?? '';
        this.openToppedRangeBonus = data.openToppedRangeBonus ?? 1;
        this.splashList = data.splashList ?? [];
        this.v3EliteWarhead = data.v3EliteWarhead ?? '';
        this.v3Warhead = data.v3Warhead ?? '';
        return this;
    }
}
