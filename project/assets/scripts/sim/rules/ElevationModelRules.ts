/**
 * `[ElevationModel]` section — the high-ground damage bonus.
 *
 * Reference: redalert2/src/game/rules/ElevationModelRules.ts
 *
 * `getBonus` is a step function, not a multiplier: every full `increment` of
 * height advantage is worth `incrementBonus` percent, capped at `bonusCap`
 * steps. Height disadvantage is worth exactly 0 (it is not a penalty).
 *
 * The division is a *floor*, so a half-step of height is worth nothing — this is
 * what keeps ridge fighting from being a continuous slope.
 */
export interface ElevationModelRulesData {
    elevationIncrement?: number;
    elevationIncrementBonus?: number;
    elevationBonusCap?: number;
}

export class ElevationModelRules {
    increment = 0;
    incrementBonus = 1;
    bonusCap = 0;

    read(data: ElevationModelRulesData = {}): ElevationModelRules {
        this.increment = data.elevationIncrement ?? 0;
        this.incrementBonus = data.elevationIncrementBonus ?? 1;
        this.bonusCap = data.elevationBonusCap ?? 0;
        return this;
    }

    getBonus(elevation: number, targetElevation: number): number {
        if (elevation <= targetElevation) {
            return 0;
        }
        return Math.min(this.bonusCap, Math.floor((elevation - targetElevation) / this.increment)) * this.incrementBonus;
    }
}
