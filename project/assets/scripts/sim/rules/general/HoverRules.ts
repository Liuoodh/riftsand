/**
 * `[General]` hover block — the hover locomotor's spring.
 *
 * Reference: redalert2/src/game/rules/general/HoverRules.ts
 */
export interface HoverRulesData {
    height?: number;
    dampen?: number;
    bob?: number;
    boost?: number;
    acceleration?: number;
    brake?: number;
}

export class HoverRules {
    height = 0;
    dampen = 0;
    bob = 0;
    boost = 0;
    acceleration = 0;
    brake = 0;

    read(data: HoverRulesData = {}): HoverRules {
        this.height = data.height ?? 0;
        this.dampen = data.dampen ?? 0;
        this.bob = data.bob ?? 0;
        this.boost = data.boost ?? 0;
        this.acceleration = data.acceleration ?? 0;
        this.brake = data.brake ?? 0;
        return this;
    }
}
