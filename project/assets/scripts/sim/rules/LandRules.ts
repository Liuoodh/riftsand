/**
 * One land-type section (`[Clear]`, `[Road]`, `[Rough]`, ...).
 *
 * Reference: redalert2/src/game/rules/LandRules.ts
 *
 * `getSpeedModifier` collapses a whole column of percentages into the few values
 * the movement code consumes, and its three early-outs each change behaviour:
 *   - a tile with `Track=0` is impassable on foot too (a wall is a wall);
 *   - a missing column means 1 (passable at normal speed), not 0;
 *   - for anything that is not Track or Wheel, a *positive* modifier is clamped to
 *     exactly 1 — which is why hover skirts never take the ore slowdown, while a
 *     0 still blocks them. Note this catches **Foot** as well: an infantry column of
 *     0.8 becomes 1, so only tanks and wheeled vehicles ever move at a partial speed.
 *
 * `[Cliff]` has no section of its own in retail; `Rules.getLandRules` maps it onto
 * `[Rock]`, so the `Buildable` flag there governs cliffs as well.
 */
import { SpeedType } from '../type/SpeedType';

export interface LandRulesData {
    buildable?: boolean;
    /** keyed by SpeedType; a missing column means "1" at read time */
    speed?: Partial<Record<SpeedType, number>>;
}

export class LandRules {
    speedModifiers: Map<SpeedType, number>;
    buildable: boolean;

    constructor(data: LandRulesData = {}) {
        this.speedModifiers = new Map();
        this.buildable = false;
        this.read(data);
    }

    read(data: LandRulesData = {}): this {
        this.buildable = data.buildable ?? false;
        this.speedModifiers = new Map();
        const speed = data.speed ?? {};
        for (const key of Object.keys(speed)) {
            const speedType = Number(key) as SpeedType;
            if (SpeedType[speedType] !== undefined) {
                this.speedModifiers.set(speedType, speed[key] as number);
            }
        }
        return this;
    }

    getSpeedModifier(speedType: SpeedType): number {
        if (speedType === SpeedType.Foot &&
            this.speedModifiers.get(SpeedType.Track) === 0) {
            return 0;
        }
        let modifier = this.speedModifiers.get(speedType);
        if (modifier === undefined) {
            modifier = 1;
        }
        if (speedType !== SpeedType.Track &&
            speedType !== SpeedType.Wheel &&
            modifier > 0) {
            modifier = 1;
        }
        return modifier;
    }
}
