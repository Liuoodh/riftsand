/**
 * `[Radiation]` section — the desolator's radiation field.
 *
 * Reference: redalert2/src/game/rules/RadiationRules.ts
 *
 * Two clocks, both in *ticks*: `radLevelDelay` how often the field steps down
 * one level, `radLightDelay` how often the glow is recomputed. `radDurationMultiple`
 * scales a site's total lifetime. `radColor` is a 3-element RGB triple.
 */
export interface RadiationRulesData {
    radDurationMultiple?: number;
    radApplicationDelay?: number;
    radLevelMax?: number;
    radLevelDelay?: number;
    radLightDelay?: number;
    radLevelFactor?: number;
    radLightFactor?: number;
    radTintFactor?: number;
    radColor?: number[];
    radSiteWarhead?: string;
}

export class RadiationRules {
    radDurationMultiple = 0;
    radApplicationDelay = 0;
    radLevelMax = 0;
    radLevelDelay = 0;
    radLightDelay = 0;
    radLevelFactor = 0;
    radLightFactor = 0;
    radTintFactor = 0;
    radColor: number[] = [];
    radSiteWarhead = '';

    read(data: RadiationRulesData = {}): RadiationRules {
        this.radDurationMultiple = data.radDurationMultiple ?? 0;
        this.radApplicationDelay = data.radApplicationDelay ?? 0;
        this.radLevelMax = data.radLevelMax ?? 0;
        this.radLevelDelay = data.radLevelDelay ?? 0;
        this.radLightDelay = data.radLightDelay ?? 0;
        this.radLevelFactor = data.radLevelFactor ?? 0;
        this.radLightFactor = data.radLightFactor ?? 0;
        this.radTintFactor = data.radTintFactor ?? 0;
        this.radColor = data.radColor ?? [];
        this.radSiteWarhead = data.radSiteWarhead ?? '';
        return this;
    }
}
