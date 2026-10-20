/**
 * Port of redalert2/src/game/gameobject/task/WaitForBuildUpTask.ts (12 lines).
 *
 * A group of exactly two tasks: wait `buildTime` minutes, then flip the
 * building to `Ready`. Retail shows the "building" animation for that long and
 * the structure is a sitting duck meanwhile — a factory that is still building
 * up cannot produce, and a defence that is still building up cannot fire.
 *
 * `cancellable = false` because selling or destroying the building is what
 * interrupts it; a stray order must not. `Building.update` re-adds the task
 * every tick while `buildStatus === BuildUp && !hasTasks()`, so the two halves
 * have to stay in lockstep: if this task finished without flipping the status,
 * the next tick would queue another one and the animation would loop forever.
 */
import { TaskGroup } from './system/TaskGroup';
import { CallbackTask } from './system/CallbackTask';
import { WaitMinutesTask } from './system/WaitMinutesTask';
import { BuildStatus } from '../Building';

export class WaitForBuildUpTask extends TaskGroup {
    public cancellable: boolean = false;

    constructor(buildTime: number, game: any) {
        super(
            new WaitMinutesTask(buildTime),
            new CallbackTask((building: any) => {
                building.setBuildStatus(BuildStatus.Ready, game);
            }),
        );
    }
}
