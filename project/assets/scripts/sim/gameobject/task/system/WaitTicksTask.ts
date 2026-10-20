/**
 * Verbatim from redalert2/src/game/gameobject/task/system/WaitTicksTask.ts (11 lines).
 *
 * `!(this.ticks-- > 0)` — the post-decrement is inside the comparison on
 * purpose. A task created with `n` finishes on its `n+1`-th tick, because
 * `onTick` is called *before* the count is tested on entry. Reproducing that
 * off-by-one exactly matters: `TurnTask` layers a `WaitTicksTask` on top of the
 * rotation and a one-tick drift there shows up as turret twitch.
 *
 * `isCancelling()` short-circuits so a cancelled wait ends immediately instead
 * of burning its remaining ticks.
 */
import { Task } from './Task';

export class WaitTicksTask extends Task {
    private ticks: number;

    constructor(ticks: number) {
        super();
        this.ticks = ticks;
    }

    onTick(): boolean {
        return this.isCancelling() || !(this.ticks-- > 0);
    }
}
