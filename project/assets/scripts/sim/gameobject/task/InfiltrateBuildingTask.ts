/**
 * Port of redalert2/src/game/gameobject/task/InfiltrateBuildingTask.ts (17 lines).
 *
 * Spy infiltration. The spy is **unspawned**, not destroyed: he is gone from
 * the map (so no wreck, no death animation, no kill credit) but the object
 * survives long enough for `agentTrait.infiltrate` to read his veteran level —
 * which is what decides whether the infiltration also steals tech.
 *
 * `buildStatus !== BuildDown` rather than `=== Ready`: a spy may infiltrate a
 * structure that is still building up. That is a real retail behaviour and the
 * reason a rushed spy can shut down a power plant before it ever finishes.
 */
import { BuildStatus } from '../Building';
import { BuildingInfiltrationEvent } from '../../event/BuildingInfiltrationEvent';
import { EnterBuildingTask } from './EnterBuildingTask';

export class InfiltrateBuildingTask extends EnterBuildingTask {
    isAllowed(e: any): boolean {
        return (
            e.rules.infiltrate &&
            this.target.rules.spyable &&
            !this.target.isDestroyed &&
            this.target.buildStatus !== BuildStatus.BuildDown &&
            !this.game.areFriendly(e, this.target)
        );
    }

    onEnter(e: any): void {
        this.game.unspawnObject(e);
        e.agentTrait?.infiltrate(e, this.target, this.game);
        this.game.events.dispatch(new BuildingInfiltrationEvent(this.target, e));
    }
}
