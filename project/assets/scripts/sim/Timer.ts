/**
 * Port of redalert2/src/game/gameobject/unit/Timer.ts.
 *
 * A plain countdown in logic ticks. The reference uses one instance per
 * capability that needs a deadline (C4 charge, invulnerability, ...), so it is
 * kept as its own object rather than a bare number field: `setActiveFor` is
 * ignored while the timer is already running, which is exactly what makes a
 * second C4 charge on the same building a no-op instead of a reset.
 */
export class Timer {
    private activeTicks = 0;
    private activeFor?: number;
    private activeSince?: number;

    constructor() {
        this.activeTicks = 0;
    }

    isActive(): boolean {
        return this.activeTicks > 0;
    }

    setActiveFor(ticks: number, timestamp?: number): void {
        this.activeTicks = ticks;
        this.activeFor = ticks;
        this.activeSince = timestamp;
    }

    reset(): void {
        this.activeTicks = 0;
        this.activeSince = undefined;
        this.activeFor = undefined;
    }

    getTicksLeft(): number {
        return this.activeTicks;
    }

    getInitialTicks(): number {
        return this.activeFor ?? 0;
    }

    tick(timestamp: number): boolean {
        if (this.activeTicks <= 0) {
            return false;
        }
        this.activeTicks--;
        if (
            this.activeTicks <= 0 ||
            (this.activeSince !== undefined && timestamp - this.activeSince > this.activeFor!)
        ) {
            this.reset();
            return true;
        }
        return false;
    }
}
