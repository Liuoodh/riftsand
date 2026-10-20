/**
 * Port of redalert2/src/game/gameobject/locomotor/DriveLocomotor.ts (190 lines).
 *
 * Wheeled/tracked movement. Three mechanisms, none of which exist for infantry:
 *
 * **1. Momentum steering over a Bézier path.** When a unit is already moving and
 * the next waypoint continues roughly in the same direction, the reference does
 * not turn in place: it builds a path of `line → quadratic → line` through the
 * two last waypoints and drives along it. That is why a tank rounding a corner
 * cuts it smoothly instead of stopping to rotate. The trigger is
 * `|facing(toLast) - unit.direction| === 0 && 0 < angleDiff < 90` — note the
 * *strict* zero: any residual facing difference disables the curve, so a unit
 * that is mid-turn never smooths.
 *
 * **2. Acceleration profile** (`Accelerates=yes`). Speed ramps up by
 * `accelerationFactor * baseSpeed` per tick to `baseSpeed`; on the last leg it
 * lerps back down over the remaining distance. A single-waypoint order is driven
 * at exactly `baseSpeed / 2` (retail's "short hop" rule).
 *
 * **3. Turret pre-aim.** `pointTurretToTarget` writes `turretTrait.desiredFacing`
 * every tick while driving, so the turret tracks the target independently of the
 * hull. This is the only place `desiredFacing` is written outside combat.
 *
 * Terrain speed is read with `skipBlockerCheck = true` (the `true` 6th argument):
 * the unit is already *on* the tile, its own occupancy must not block it.
 */
import { FacingUtil } from '../unit/FacingUtil';
import { Coords } from '../../Coords';
import * as geometry from '../../math/geometry';
import { Vector2 } from '../../math/Vector2';
import { Vector3 } from '../../math/Vector3';
import { CurvePath } from '../../math/CurvePath';
import { LineCurve } from '../../math/LineCurve';
import { QuadraticBezierCurve } from '../../math/QuadraticBezierCurve';
import * as math from '../../util/math';
import { TurnTask } from '../../task/TurnTask';

enum WaypointType {
    None = 0,
    Start = 1,
    Normal = 2,
    End = 3,
    Single = 4,
}

export class DriveLocomotor {
    private game: any;
    private hasMomentum: boolean = false;
    private moveOnCurve: boolean = false;
    private currentSpeed: number = 0;
    private distanceTravelled: number = 0;
    private carryOverDistance: number = 0;
    private currentWaypointType: WaypointType = WaypointType.None;
    private initialPosition!: Vector2;
    private steerCurve!: CurvePath<Vector2>;
    private lastPosition!: Vector2;
    private totalDistanceToTravel!: number;

    constructor(game: any) {
        this.game = game;
    }

    selectNextWaypoint(unit: any, waypoints: any[]): any {
        this.currentWaypointType =
            this.currentWaypointType && this.currentWaypointType !== WaypointType.End
                ? WaypointType.Normal
                : WaypointType.Start;
        this.initialPosition = unit.position.getMapPosition();
        if (this.currentWaypointType !== WaypointType.Start) {
            // Continuing a journey resets the accumulated penalty; starting one
            // resets the accumulated speed.
            unit.moveTrait.speedPenalty = 0;
        } else {
            this.currentSpeed = 0;
        }

        if (waypoints.length > 1) {
            const lastWaypoint = waypoints[waypoints.length - 1];
            const secondLastWaypoint = waypoints[waypoints.length - 2];
            const directionToLast = new Vector2(
                lastWaypoint.tile.rx - unit.tile.rx,
                lastWaypoint.tile.ry - unit.tile.ry,
            );
            const angleDifference = Math.abs(
                geometry.angleDegFromVec2(directionToLast) -
                    geometry.angleDegFromVec2(
                        new Vector2(
                            secondLastWaypoint.tile.rx - lastWaypoint.tile.rx,
                            secondLastWaypoint.tile.ry - lastWaypoint.tile.ry,
                        ),
                    ),
            );
            if (
                !Math.abs(FacingUtil.fromMapCoords(directionToLast) - unit.direction) &&
                angleDifference > 0 &&
                angleDifference < 90 &&
                this.hasMomentum
            ) {
                this.moveOnCurve = true;
                this.currentWaypointType =
                    waypoints.length === 2
                        ? this.currentWaypointType === WaypointType.Start
                            ? WaypointType.Single
                            : WaypointType.End
                        : WaypointType.Normal;

                const startPos = this.initialPosition;
                const midPos = new Vector2(lastWaypoint.tile.rx + 0.5, lastWaypoint.tile.ry + 0.5).multiplyScalar(
                    Coords.LEPTONS_PER_TILE,
                );
                const endPos = new Vector2(
                    secondLastWaypoint.tile.rx + 0.5,
                    secondLastWaypoint.tile.ry + 0.5,
                ).multiplyScalar(Coords.LEPTONS_PER_TILE);

                const controlPoint1 = startPos.clone().lerp(midPos, 0.5);
                const controlPoint2 = endPos.clone().lerp(midPos, 0.5);
                this.steerCurve = new CurvePath<Vector2>();
                this.steerCurve.add(new LineCurve(startPos, controlPoint1));
                this.steerCurve.add(new QuadraticBezierCurve(controlPoint1, midPos, controlPoint2));
                this.steerCurve.add(new LineCurve(controlPoint2, endPos));
                this.lastPosition = startPos;
                return secondLastWaypoint;
            }
        } else {
            this.currentWaypointType =
                this.currentWaypointType === WaypointType.Start ? WaypointType.Single : WaypointType.End;
        }

        this.hasMomentum = true;
        this.moveOnCurve = false;
        return waypoints[waypoints.length - 1];
    }

    onNewWaypoint(unit: any, targetPosition: Vector2, target: any): any[] | undefined {
        const direction = new Vector2().copy(targetPosition).sub(this.initialPosition);
        this.distanceTravelled = 0;
        this.totalDistanceToTravel = this.moveOnCurve ? this.steerCurve.getLength() : direction.length();

        const facing = FacingUtil.fromMapCoords(direction);
        if (facing !== unit.direction) {
            this.pointTurretToTarget(unit, target);
            if (!this.moveOnCurve) {
                unit.moveTrait.velocity.set(0, 0, 0);
                // The driver pushes a TurnTask and stands still until it is done.
                return [new TurnTask(facing)];
            }
        }
        return undefined;
    }

    tick(unit: any, targetPosition: Vector2, target: any): { distance: Vector3; done: boolean } {
        this.pointTurretToTarget(unit, target);

        let speed = this.currentSpeed;
        if (unit.rules.accelerates) {
            const progress = this.distanceTravelled / this.totalDistanceToTravel;
            this.currentSpeed = this.applyAcceleration(unit, speed, unit.moveTrait.baseSpeed, progress);
            speed = this.currentSpeed;
        } else {
            this.currentSpeed = unit.moveTrait.baseSpeed;
            speed = this.currentSpeed;
        }
        if (speed > 1) {
            speed = Math.floor(speed);
        }

        let terrainSpeed = this.game.map.terrain.getPassableSpeed(
            unit.tile,
            unit.rules.speedType,
            unit.isInfantry(),
            unit.onBridge,
            undefined,
            true,
        );
        if (terrainSpeed) {
            unit.moveTrait.lastTileSpeed = terrainSpeed;
        } else {
            terrainSpeed = unit.moveTrait.lastTileSpeed || 1;
        }
        speed *= terrainSpeed;
        if (speed > 1) {
            speed = Math.floor(speed);
        }

        if (this.carryOverDistance) {
            speed = this.carryOverDistance;
        }

        const currentPosition = unit.position.getMapPosition();
        let movementDelta: Vector2;
        if (this.moveOnCurve) {
            const curveLength = this.steerCurve.getLength();
            const newDistance = Math.min(this.distanceTravelled + speed, curveLength);
            this.carryOverDistance = Math.max(0, this.distanceTravelled + speed - curveLength);
            this.distanceTravelled = newDistance;

            const u = this.distanceTravelled / curveLength;
            const curvePoint = this.steerCurve.getPointAt(u);
            const curveTangent = this.steerCurve.getTangentAt(u);

            const velocityVector = curveTangent.clone().setLength(speed);
            unit.moveTrait.velocity.set(velocityVector.x, 0, velocityVector.y);

            const rotationSpeed = unit.rules.rot;
            const { facing, delta } = FacingUtil.tick(
                unit.direction,
                FacingUtil.fromMapCoords(curveTangent as any),
                rotationSpeed,
            );
            unit.direction = facing;
            unit.spinVelocity = delta;

            const previousPosition = this.lastPosition;
            this.lastPosition = curvePoint.clone();
            movementDelta = curvePoint.sub(previousPosition);
        } else {
            const directionToTarget = new Vector2().copy(targetPosition).sub(currentPosition);
            const actualDistance = Math.min(directionToTarget.length(), speed);
            movementDelta = directionToTarget.clone().setLength(actualDistance);

            const velocityVector = movementDelta.clone();
            if (this.carryOverDistance) {
                velocityVector.add(Coords.vecWorldToGround(unit.moveTrait.velocity));
            }
            unit.moveTrait.velocity.set(velocityVector.x, 0, velocityVector.y);

            this.distanceTravelled += actualDistance;
            this.carryOverDistance = Math.max(0, speed - directionToTarget.length());
        }

        return {
            distance: new Vector3(movementDelta.x, 0, movementDelta.y),
            done: !movementDelta.length() || !!this.carryOverDistance,
        };
    }

    private pointTurretToTarget(unit: any, target: any): void {
        if (unit.turretTrait) {
            let targetPosition = target;
            if (unit.attackTrait?.currentTarget?.obj) {
                targetPosition = unit.attackTrait.currentTarget.obj.position.getMapPosition();
            }
            const unitPosition = unit.position.getMapPosition();
            const directionToTarget = new Vector2().copy(targetPosition).sub(unitPosition);
            if (directionToTarget.length()) {
                const facing = FacingUtil.fromMapCoords(directionToTarget);
                unit.turretTrait.desiredFacing = facing;
            }
        }
    }

    private applyAcceleration(unit: any, currentSpeed: number, baseSpeed: number, progress: number): number {
        if (this.currentWaypointType === WaypointType.Single) {
            return baseSpeed / 2;
        }
        if (this.currentWaypointType !== WaypointType.End) {
            return Math.min(currentSpeed + unit.rules.accelerationFactor * baseSpeed, baseSpeed);
        }
        let adjustedProgress = progress;
        if (this.moveOnCurve && this.currentWaypointType === WaypointType.End) {
            // On a steer curve only the second half of the path counts as
            // "braking distance", because the first half is still the corner.
            adjustedProgress = progress <= 0.5 ? 0 : 2 * (progress - 0.5);
        }
        return math.lerp(1, baseSpeed, 1 - adjustedProgress);
    }
}
