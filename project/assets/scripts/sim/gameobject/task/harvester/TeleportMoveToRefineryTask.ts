/**
 * Port of redalert2/src/game/gameobject/task/harvester/TeleportMoveToRefineryTask.ts (48 lines).
 *
 * A `MoveTask` with one extra trick: the chrono miner may blink to the pad once
 * it reaches its next waypoint. Everything else — pathfinding, blocking,
 * cancellation — is inherited unchanged, which is why this is a subclass and
 * not a state machine of its own.
 *
 * The `onTick` expression is dense but every term earns its place:
 *
 *   `moveState !== ReachedNextWaypoint` → not at a waypoint yet, nothing to do
 *   `unit.tile === teleportTile`        → already there, don't blink onto itself
 *   `!tryTeleportToRefinery(unit)`      → the blink was *attempted and refused*
 *                                          (obstacle, or the passed-in condition
 *                                          said no). Note the side effect: this
 *                                          call is the attempt, so the `||`
 *                                          chain must stay in this order.
 *
 * When the blink succeeds the branch is skipped and the task reports `true` —
 * a chrono jump *completes* the move, it does not continue it. When the blink
 * is refused, the task falls back to `super.onTick`, and the outer `&&`
 * re-tests "cancel / arrived / blink again" against the result: `super` may
 * have brought us onto the pad the slow way, in which case we are done; if it
 * returned `false` we are still driving and the whole dance repeats next tick.
 *
 * `moveTrait.isDisabled()` returns `false` rather than `true` on purpose — a
 * disabled mover is "waiting", and the miner must not be dropped from its order
 * queue just because it was momentarily immobilised.
 *
 * The zone scrub after the teleport is for a miner that jumps from the ground
 * to a pad: `teleportUnitToTile` leaves `zone` alone, and arriving on a pad from
 * the air leaves the miner flagged as an air unit, which would let it be
 * targeted by anti-air only and refuse to unload.
 */
import { MoveTask } from '../move/MoveTask';
import { LocomotorType } from '../../../type/LocomotorType';
import { ZoneType } from '../../unit/ZoneType';
import { MoveState } from '../../trait/MoveTrait';

export class TeleportMoveToRefineryTask extends MoveTask {
    private teleportTile: any;
    private teleportCondition: ((unit: any, tile: any) => boolean) | undefined;

    constructor(
        game: any,
        teleportTile: any,
        targetTile?: any,
        teleportCondition?: (unit: any, tile: any) => boolean,
    ) {
        super(game, targetTile ?? teleportTile, false, {
            closeEnoughTiles: targetTile ? undefined : 0,
            strictCloseEnough: !targetTile,
        });
        this.teleportTile = teleportTile;
        this.teleportCondition = teleportCondition;
    }

    onStart(unit: any): void {
        super.onStart(unit);
        if (!unit.harvesterTrait || unit.rules.locomotor !== LocomotorType.Chrono) {
            throw new Error(`Vehicle ${unit.name} is not a chrono miner`);
        }
    }

    onTick(unit: any): boolean {
        if (unit.moveTrait.isDisabled()) {
            return false;
        }
        if (
            this.isCancelling() ||
            unit.moveTrait.moveState !== MoveState.ReachedNextWaypoint ||
            unit.tile === this.teleportTile ||
            !this.tryTeleportToRefinery(unit)
        ) {
            return (
                super.onTick(unit) === true &&
                (this.isCancelling() || unit.tile === this.teleportTile || this.tryTeleportToRefinery(unit))
            );
        }
        return true;
    }

    private tryTeleportToRefinery(unit: any): boolean {
        if (
            (this.teleportCondition && this.teleportCondition(unit, this.teleportTile) === false) ||
            this.game.map.terrain.findObstacles({ tile: this.teleportTile, onBridge: undefined }, unit).length > 0
        ) {
            return false;
        }
        unit.moveTrait.teleportUnitToTile(this.teleportTile, undefined, true, true, this.game);
        if (unit.zone === ZoneType.Air) {
            unit.zone = ZoneType.Ground;
            unit.position.tileElevation = 0;
        }
        return true;
    }
}
