/**
 * Port of redalert2/src/game/gameobject/task/move/MoveTargetTask.ts (47 lines).
 *
 * Follow a *moving* object. The important part is that this is not a per-tick
 * repath — that would thrash the pathfinder and make the chaser stutter every
 * time the target nudged a waypoint. The target is only re-read when
 *
 *   - we arrived at the cell it used to be on and it has since left, or
 *   - ten ticks have passed (`tilesSinceTargetUpdate++ > 10`, so eleven ticks),
 *
 * and even then it aims at the target's *current waypoint*, not its current
 * cell — chasing a cell the target has already vacated is what "units following
 * a tank cut corners" looks like.
 *
 * `forceMove` is set because a guard-mode unit would otherwise refuse to leave
 * its post to follow.
 */
import { MoveTask } from './MoveTask';
import { MoveState } from '../../trait/MoveTrait';

export class MoveTargetTask extends MoveTask {
    private target: any;
    private tilesSinceTargetUpdate: number = 0;

    constructor(game: any, target: any) {
        super(game, target.tile, target.onBridge, {
            forceMove: true,
            pathFinderIgnoredBlockers: [target],
        });
        this.target = target;
    }

    onTick(unit: any): boolean {
        if (
            !this.isCancelling() &&
            unit.moveTrait.moveState === MoveState.ReachedNextWaypoint &&
            !(
                this.target.tile === this.targetTile &&
                this.target.onBridge === this.toBridge &&
                this.target.moveTrait.isIdle()
            )
        ) {
            let shouldUpdate = false;
            let waypoint;
            if (
                (unit.tile === this.targetTile && this.target.tile !== this.targetTile) ||
                this.tilesSinceTargetUpdate++ > 10
            ) {
                shouldUpdate = true;
            }
            if (shouldUpdate) {
                this.tilesSinceTargetUpdate = 0;
                waypoint = this.target.moveTrait.currentWaypoint;
                if (waypoint) {
                    this.updateTarget(waypoint.tile, !!waypoint.onBridge);
                } else {
                    this.updateTarget(this.target.tile, this.target.onBridge);
                }
            }
        }
        return super.onTick(unit);
    }

    forceCancel(unit: any): boolean {
        return super.forceCancel(unit);
    }

    getTargetLinesConfig(unit: any): { target: any; pathNodes: any[] } {
        return { target: this.target, pathNodes: [] };
    }
}
