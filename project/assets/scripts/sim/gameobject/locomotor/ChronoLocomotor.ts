/**
 * Port of redalert2/src/game/gameobject/locomotor/ChronoLocomotor.ts (40 lines).
 *
 * Teleport movement. `ignoresTerrain = true` tells `MoveTrait` not to validate
 * the path — a chrono legionnaire crosses water and cliffs.
 *
 * The tick does **not** move the unit. It returns the whole displacement as
 * `distance` together with `isTeleport: true`, and the caller applies it
 * atomically. `done` is always true, so a chrono move is one tick per waypoint.
 *
 * The warp delay is proportional to distance, with a floor: below
 * `chronoRangeMinimum` the unit uses `chronoMinimumDelay` (retail 0.2 min),
 * above it `distance / chronoDistanceFactor` minutes. That floor is why a
 * one-cell chrono jump still takes a visible moment instead of being instant.
 */
import { Vector3 } from '../../math/Vector3';
import { Vector2 } from '../../math/Vector2';

export class ChronoLocomotor {
    private game: any;
    private ignoresTerrain: boolean;
    private distanceToWaypoint: Vector2;

    constructor(game: any) {
        this.game = game;
        this.ignoresTerrain = true;
        this.distanceToWaypoint = new Vector2();
    }

    onNewWaypoint(unit: any, waypoint: Vector2): void {}

    tick(
        unit: any,
        waypoint: Vector2,
        speed: number,
        isMoving: boolean,
    ): { distance: Vector3; done: boolean; isTeleport?: boolean } {
        if (isMoving) {
            // Refuse to shift while the hull is still decelerating: retail makes
            // you come to a stop first, and the warped-out animation would
            // otherwise start mid-motion.
            return { distance: new Vector3(), done: true };
        }

        this.distanceToWaypoint.copy(waypoint).sub(unit.position.getMapPosition());
        const distance = this.distanceToWaypoint.length();

        const generalRules = this.game.rules.general;
        if (generalRules.chronoTrigger) {
            const delay =
                distance < generalRules.chronoRangeMinimum
                    ? generalRules.chronoMinimumDelay
                    : distance / generalRules.chronoDistanceFactor;
            unit.warpedOutTrait.setTimed(delay, false, this.game);
        }

        return {
            distance: new Vector3(this.distanceToWaypoint.x, 0, this.distanceToWaypoint.y),
            done: true,
            isTeleport: true,
        };
    }
}
