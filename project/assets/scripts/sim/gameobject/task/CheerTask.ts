/**
 * Port of redalert2/src/game/gameobject/task/CheerTask.ts (27 lines).
 *
 * The G.I. cheer on a building capture. Three-state by construction:
 *
 *   `executed === false` → check the preconditions; on success set
 *   `stance = Cheer`, push the one-tick wait, set `executed = true`;
 *   `executed === true`  → restore `stance = None` and finish.
 *
 * The children array is what makes the second tick happen: without the
 * `WaitMinutesTask(1/60)` the same `onTick` would run again in the same frame
 * and the cheer would last zero ticks. The wait is `cancellable = false` so an
 * order cannot cut the cheer short — the whole point is that it is a flourish.
 *
 * `art.sequences.has(SequenceType.Cheer)` is a capability check, not a style
 * choice: units whose art has no cheer frames (most vehicles, all buildings)
 * must return `false` and finish rather than sit in a stance with no animation.
 * Only `None` and `Guard` stances may be upgraded to `Cheer`; a prone or
 * deployed unit stays prone or deployed.
 */
import { Task } from './system/Task';
import { SequenceType } from '../../art/SequenceType';
import { StanceType } from '../StanceType';
import { WaitMinutesTask } from './system/WaitMinutesTask';

export class CheerTask extends Task {
    private executed: boolean = false;

    constructor() {
        super();
        this.cancellable = false;
    }

    onTick(gameObject: any): boolean {
        if (this.executed) {
            gameObject.stance = StanceType.None;
            return true;
        }
        if (
            !gameObject.isInfantry() ||
            !gameObject.art.sequences.has(SequenceType.Cheer) ||
            (gameObject.stance !== StanceType.None && gameObject.stance !== StanceType.Guard)
        ) {
            return false;
        }
        gameObject.stance = StanceType.Cheer;
        this.children.push(new WaitMinutesTask(1 / 60).setCancellable(false));
        this.executed = true;
        return false;
    }
}
