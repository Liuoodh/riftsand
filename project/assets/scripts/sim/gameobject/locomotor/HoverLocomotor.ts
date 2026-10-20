/**
 * Port of redalert2/src/game/gameobject/locomotor/HoverLocomotor.ts (132 lines).
 *
 * Hovercraft (and the Hover locomotor generally) move with a *speed profile*
 * instead of a fixed speed: they accelerate over `HoverRules.acceleration`
 * seconds and must start braking `computeBrakeDistance()` before the waypoint or
 * they overshoot.
 *
 * The deceleration formula is the classic constant-deceleration distance
 * `s = v*t - a*t²/2` with `t = v/a`, i.e. `s = v² / (2a)`. It is written out
 * long-hand because the reference does, and because `deceleration` comes from
 * the rules rather than from a solver.
 *
 * The `Normal` waypoint branch also *turns early*: if the remaining distance is
 * within the distance the unit would cover while rotating to the next leg's
 * facing, it starts facing the next leg now. That is what makes a hovercraft
 * drift through corners instead of taking them as two straight lines.
 */
import { Coords } from '../../Coords';
import { FacingUtil } from '../unit/FacingUtil';
import { TICKS_PER_SECOND } from '../../Constants';
import { angleDegBetweenVec2 } from '../../math/geometry';
import { Vector2 } from '../../math/Vector2';
import { Vector3 } from '../../math/Vector3';

enum WaypointType {
    None = 0,
    Start = 1,
    Normal = 2,
    End = 3,
    Single = 4,
}

interface HoverRules {
    acceleration: number;
    brake: number;
}

export class HoverLocomotor {
    private hoverRules: HoverRules;
    private currentSpeed: number;
    private distanceTravelled: number;
    private carryOverDistance: number;
    private currentWaypointType: WaypointType;
    private nextWaypointDir: Vector2;
    private initialPosition?: Vector2;
    private totalDistanceToTravel!: number;
    private maxSpeed!: number;
    private acceleration!: number;
    private deceleration!: number;

    constructor(hoverRules: HoverRules) {
        this.hoverRules = hoverRules;
        this.currentSpeed = 0;
        this.distanceTravelled = 0;
        this.carryOverDistance = 0;
        this.currentWaypointType = WaypointType.None;
        this.nextWaypointDir = new Vector2();
    }

    selectNextWaypoint(unit: any, waypoints: any[]): any {
        this.currentWaypointType =
            this.currentWaypointType && this.currentWaypointType !== WaypointType.End
                ? WaypointType.Normal
                : WaypointType.Start;
        this.initialPosition = unit.position.getMapPosition();
        if (this.currentWaypointType === WaypointType.Start) {
            this.currentSpeed = 0;
        }

        if (waypoints.length <= 1) {
            this.currentWaypointType =
                this.currentWaypointType === WaypointType.Start ? WaypointType.Single : WaypointType.End;
            const lastWaypoint = waypoints[waypoints.length - 1];
            if (lastWaypoint) {
                this.nextWaypointDir.set(
                    lastWaypoint.tile.rx - unit.tile.rx,
                    lastWaypoint.tile.ry - unit.tile.ry,
                );
            }
        } else {
            const lastWaypoint = waypoints[waypoints.length - 1];
            const secondLastWaypoint = waypoints[waypoints.length - 2];
            this.nextWaypointDir.set(
                secondLastWaypoint.tile.rx - lastWaypoint.tile.rx,
                secondLastWaypoint.tile.ry - lastWaypoint.tile.ry,
            );
        }

        return waypoints[waypoints.length - 1];
    }

    onNewWaypoint(unit: any, target: Vector2, waypoints: any[]): void {
        const direction = new Vector2().copy(target).sub(this.initialPosition!);
        this.distanceTravelled = 0;
        this.totalDistanceToTravel = direction.length();

        const maxSpeed = (this.maxSpeed = unit.moveTrait.baseSpeed);
        const accelerationTime = 60 * this.hoverRules.acceleration * TICKS_PER_SECOND;
        this.acceleration = maxSpeed / accelerationTime;
        const brakeTime = 60 * this.hoverRules.brake * TICKS_PER_SECOND;
        this.deceleration = maxSpeed / brakeTime;
    }

    tick(unit: any, target: Vector2): { distance: Vector3; done: boolean } {
        const currentPos = unit.position.getMapPosition();
        const direction = target.clone().sub(currentPos);
        const distance = direction.length();
        const maxSpeed = this.maxSpeed;

        if (this.currentWaypointType === WaypointType.Single) {
            this.currentSpeed = maxSpeed / 2;
        } else if (this.currentWaypointType === WaypointType.End) {
            const brakeDistance = this.computeBrakeDistance(this.currentSpeed, this.deceleration);
            if (this.totalDistanceToTravel - this.distanceTravelled <= brakeDistance) {
                this.currentSpeed = Math.max(0, this.currentSpeed - this.deceleration);
            }
        } else {
            this.currentSpeed = Math.min(this.currentSpeed + this.acceleration, maxSpeed);
        }

        const currentFacing = FacingUtil.fromMapCoords(direction);
        const targetFacing = FacingUtil.fromMapCoords(this.nextWaypointDir);
        let desiredFacing = currentFacing;
        const rotationSpeed = unit.rules.rot;
        if (this.currentWaypointType === WaypointType.Normal && currentFacing !== targetFacing) {
            const angleDiff = angleDegBetweenVec2(this.nextWaypointDir, FacingUtil.toMapCoords(unit.direction));
            const turnTime = angleDiff / rotationSpeed;
            const turnDistance = Math.max(this.currentSpeed * turnTime, this.totalDistanceToTravel);
            if (this.totalDistanceToTravel - this.distanceTravelled <= turnDistance) {
                desiredFacing = targetFacing;
            }
        }

        const newFacing = FacingUtil.tick(unit.direction, desiredFacing, rotationSpeed).facing;
        unit.direction = newFacing;

        let moveDistance = this.currentSpeed;
        if (this.carryOverDistance) {
            moveDistance = this.carryOverDistance;
        }
        const actualDistance = Math.min(moveDistance, distance);
        const moveVector = direction.clone().setLength(actualDistance);

        const finalMoveVector = moveVector.clone();
        if (this.carryOverDistance) {
            finalMoveVector.add(Coords.vecWorldToGround(unit.moveTrait.velocity));
        }
        unit.moveTrait.velocity.set(finalMoveVector.x, 0, finalMoveVector.y);

        this.distanceTravelled += actualDistance;
        this.carryOverDistance = Math.max(0, moveDistance - distance);

        return {
            distance: new Vector3(moveVector.x, 0, moveVector.y),
            done: !moveVector.length() || !!this.carryOverDistance,
        };
    }

    private computeBrakeDistance(speed: number, deceleration: number): number {
        const time = speed / deceleration;
        return Math.max(0, speed * time - (deceleration * time * time) / 2);
    }
}
