/**
 * Port of redalert2/src/game/gameobject/trait/SuppressionTrait.ts.
 *
 * A suppressed infantryman is *automatically* prone: `Infantry.stance` reads
 * `StanceType.Prone` whenever the trait is suppressed, without ever writing
 * `_stance`. The unit stands back up the instant the 30-tick timer expires —
 * that is what makes a dog rush feel like it scatters a squad instead of
 * permanently crippling it.
 *
 * 30 ticks at the reference's 15 ticks/s = 2 s.
 */
export const SUPPRESSION_TICKS = 30;

export class SuppressionTrait {
    private suppressionTicks = 0;
    private enabled = true;

    /** `rules.fearless` infantry never get this trait at all; disabling is the runtime equivalent */
    disable(): void {
        this.enabled = false;
    }

    isSuppressed(): boolean {
        return this.enabled && this.suppressionTicks > 0;
    }

    suppress(): void {
        if (this.enabled) this.suppressionTicks = SUPPRESSION_TICKS;
    }

    /** NotifyTick.onTick */
    onTick(): void {
        if (this.suppressionTicks > 0) this.suppressionTicks--;
    }

    debugGetState() {
        return { suppressionTicks: this.suppressionTicks, enabled: this.enabled };
    }
}
