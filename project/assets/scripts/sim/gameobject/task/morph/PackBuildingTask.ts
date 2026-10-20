/**
 * Port of redalert2/src/game/gameobject/task/morph/PackBuildingTask.ts (18 lines).
 *
 * Folds a building down before it becomes a vehicle. It runs as a *child* of
 * `MorphIntoTask`, which means the swap cannot happen until this reports done —
 * that is the whole mechanism for "the MCV only appears once the yard has
 * folded".
 *
 * The `!unit.rules.wall` escape matters: walls have no build-down animation and
 * `setBuildStatus` on a wall would fire `NotifyBuildStatus` handlers that assume
 * a real structure (`healthTrait` regenerating, power grid updates). Walls also
 * skip `BuildDown` entirely so they cannot be sold mid-fight.
 *
 * Note the status check is `=== BuildDown` → done, not `!== BuildUp`. A building
 * that is `Ready` and gets packed goes `BuildDown` and waits; a building already
 * `BuildDown` (sold but not yet removed) finishes immediately.
 */
import { Task } from '../system/Task';
import { BuildStatus } from '../../Building';
import { WaitMinutesTask } from '../system/WaitMinutesTask';

export class PackBuildingTask extends Task {
    private game: any;

    constructor(game: any) {
        super();
        this.game = game;
    }

    onTick(unit: any): boolean {
        if (unit.buildStatus !== BuildStatus.BuildDown && !unit.rules.wall) {
            unit.setBuildStatus(BuildStatus.BuildDown, this.game);
            this.children.push(new WaitMinutesTask(this.game.rules.general.buildupTime));
            return false;
        }
        return true;
    }
}
