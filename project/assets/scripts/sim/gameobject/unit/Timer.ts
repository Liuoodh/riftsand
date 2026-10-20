/**
 * Port of redalert2/src/game/gameobject/unit/Timer.ts (40 lines).
 *
 * A countdown that can be driven two ways at once: by tick count **or** by
 * wall-clock timestamp. That redundancy is deliberate — the sim is not
 * guaranteed to receive exactly one tick per frame during a hitch, so a
 * timestamp lets a timer still expire on schedule while the tick counter is
 * behind. Whichever fires first wins.
 */
export class Timer {
    private activeTicks: number = 0;
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
        if (this.activeTicks <= 0 || (this.activeSince !== undefined && timestamp - this.activeSince > this.activeFor!)) {
            this.reset();
            return true;
        }
        return false;
    }
}
