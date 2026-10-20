/**
 * Port of redalert2/src/game/gameobject/task/WaitForBuildUpTask.ts.
 *
 * A group of exactly two tasks: wait `buildTime` minutes, then flip the
 * building to `Ready`. Retail shows the "building" animation for that long and
 * the structure is a sitting duck meanwhile — a factory that is still building
 * up cannot produce, and a defence that is still building up cannot fire.
 *
 * `cancellable = false` because selling or destroying the building is what
 * interrupts it; a stray order must not.
 */
import { TaskGroup } from '../Task';
import { CallbackTask, WaitMinutesTask } from '../Task';
import { BuildStatus } from '../gameobject/Building';

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
