/**
 * Port of redalert2/src/game/gameobject/locomotor/FootLocomotor.ts (70 lines).
 *
 * The simplest locomotor: walk straight at the waypoint at `baseSpeed` scaled by
 * the terrain. Four multipliers, in this exact order, because each one floors to
 * an integer and the floor is not associative:
 *
 *   prone  ×0.5 when `Crawls=yes`, ×2 otherwise (a prone soldier that cannot
 *          crawl *hops* forward, which is why retail infantry without `Crawls`
 *          looks faster when suppressed)
 *   panic  ×2
 *   terrain tile speed
 *
 * `endPauseFrames` is a one-tick pause when the waypoint is reached. Without it
 * a soldier ordered one cell away arrives, reports done, and the next task
 * re-targets the same cell — a visible jitter.
 */
import { FacingUtil } from '../unit/FacingUtil';
import { StanceType } from '../StanceType';
import { Vector2 } from '../../math/Vector2';
import { Vector3 } from '../../math/Vector3';

export class FootLocomotor {
    private game: any;
    private currentMoveDirection: Vector2;
    private distanceToWaypoint: Vector2;
    private endPauseFrames: number;

    constructor(game: any) {
        this.game = game;
        this.currentMoveDirection = new Vector2();
        this.distanceToWaypoint = new Vector2();
        this.endPauseFrames = 0;
    }

    onNewWaypoint(obj: any, target: Vector2): void {
        this.currentMoveDirection.copy(target).sub(obj.position.getMapPosition());
        const facing = FacingUtil.fromMapCoords(this.currentMoveDirection);
        if (facing !== obj.direction) {
            obj.direction = facing;
        }
        this.endPauseFrames = 1;
    }

    onWaypointUpdate(obj: any, target: Vector2): void {
        this.onNewWaypoint(obj, target);
    }

    tick(obj: any, target: Vector2, currentPos: Vector2): { distance: Vector3; done: boolean } {
        let speed = obj.moveTrait.baseSpeed;
        speed = Math.floor(speed);

        if (obj.stance === StanceType.Prone) {
            speed *= obj.art.crawls ? 0.5 : 2;
        }
        if (obj.isPanicked) {
            speed *= 2;
        }

        let tileSpeed = this.game.map.terrain.getPassableSpeed(
            obj.tile,
            obj.rules.speedType,
            obj.isInfantry(),
            obj.onBridge,
            undefined,
            true,
        );
        if (tileSpeed) {
            obj.moveTrait.lastTileSpeed = tileSpeed;
        } else {
            tileSpeed = obj.moveTrait.lastTileSpeed || 1;
        }
        speed *= tileSpeed;
        speed = Math.floor(speed);

        this.distanceToWaypoint.copy(target).sub(obj.position.getMapPosition());
        const moveVector = this.distanceToWaypoint.clone().setLength(speed);
        if (moveVector.length() || target.equals(currentPos)) {
            obj.moveTrait.velocity.set(moveVector.x, 0, moveVector.y);
        }

        const distance = Math.min(this.distanceToWaypoint.length(), speed);
        const isPaused = !distance && this.endPauseFrames > 0;
        if (isPaused) {
            this.endPauseFrames--;
        }
        this.distanceToWaypoint.setLength(distance);

        return {
            distance: new Vector3(this.distanceToWaypoint.x, 0, this.distanceToWaypoint.y),
            done: !this.distanceToWaypoint.length() && !isPaused,
        };
    }
}
