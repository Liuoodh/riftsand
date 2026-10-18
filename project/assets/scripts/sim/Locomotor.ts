/**
 * Locomotors — port of
 *   redalert2/src/game/gameobject/locomotor/DriveLocomotor.ts
 *   redalert2/src/game/gameobject/locomotor/FootLocomotor.ts
 *
 * DriveLocomotor is where the "natural" hull motion comes from:
 *   - the heading for a leg is derived ONCE, in onNewWaypoint, and the unit is
 *     handed a TurnTask that freezes it until the hull faces the leg;
 *   - tick() never touches the direction while driving a straight leg, so a
 *     straight road cannot produce any rotation at all;
 *   - momentum + a shallow turn at the end of a path produces the wide arc.
 *
 * Unit-scale note: the reference works in leptons/tick with integer floors. We
 * run in px/s and convert to px/tick (`* TICK`); the shape of every decision
 * (turn before driving, finish a leg exactly, carry the remainder over) is
 * unchanged.
 */
import { CurvePath, LineCurve, QuadraticBezierCurve } from './Curves';
import { FacingUtil, facingToRad, Vec2 } from './Math2';
import { SPEED } from './World';
import { MoveTrait, TICK } from './MoveTrait';

export enum WaypointType {
    None = 0,
    Start = 1,
    Normal = 2,
    End = 3,
    Single = 4,
}

export interface TickResult {
    distance: Vec2;
    done: boolean;
    isTeleport?: boolean;
}

export class DriveLocomotor {
    private hasMomentum = false;
    private moveOnCurve = false;
    private currentSpeed = 0;
    private distanceTravelled = 0;
    private carryOverDistance = 0;
    private currentWaypointType: WaypointType = WaypointType.None;
    private initialPosition: Vec2 = new Vec2();
    private steerCurve?: CurvePath;
    private lastPosition: Vec2 = new Vec2();
    private totalDistanceToTravel = 0;

    constructor(private world: any) {}

    selectNextWaypoint(unit: any, waypoints: any[]): any {
        this.currentWaypointType =
            this.currentWaypointType && this.currentWaypointType !== WaypointType.End ? WaypointType.Normal : WaypointType.Start;
        this.initialPosition = unit.position.getMapPosition();
        if (this.currentWaypointType !== WaypointType.Start) {
            unit.moveTrait.speedPenalty = 0;
        } else {
            this.currentSpeed = 0;
        }

        if (waypoints.length > 1) {
            const lastWaypoint = waypoints[waypoints.length - 1];
            const secondLastWaypoint = waypoints[waypoints.length - 2];
            const directionToLast = new Vec2(lastWaypoint.tile.rx - unit.tile.rx, lastWaypoint.tile.ry - unit.tile.ry);
            const angleDifference = Math.abs(
                Math.atan2(directionToLast.y, directionToLast.x) * (180 / Math.PI) -
                    Math.atan2(
                        secondLastWaypoint.tile.rx - lastWaypoint.tile.rx,
                        secondLastWaypoint.tile.ry - lastWaypoint.tile.ry,
                    ) *
                        (180 / Math.PI),
            );
            if (
                Math.abs(FacingUtil.fromMapCoords(directionToLast) - unit.direction) < 90 &&
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
                const midPos = new Vec2(lastWaypoint.tile.rx + 0.5, lastWaypoint.tile.ry + 0.5).multiplyScalar(SPEED.LEPTONS_PER_TILE);
                const endPos = new Vec2(secondLastWaypoint.tile.rx + 0.5, secondLastWaypoint.tile.ry + 0.5).multiplyScalar(
                    SPEED.LEPTONS_PER_TILE,
                );
                const controlPoint1 = startPos.clone().lerp(midPos, 0.5);
                const controlPoint2 = endPos.clone().lerp(midPos, 0.5);
                this.steerCurve = new CurvePath();
                this.steerCurve.add(new LineCurve(startPos, controlPoint1));
                this.steerCurve.add(new QuadraticBezierCurve(controlPoint1, midPos, controlPoint2));
                this.steerCurve.add(new LineCurve(controlPoint2, endPos));
                this.lastPosition = startPos.clone();
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

    onNewWaypoint(unit: any, targetPosition: Vec2, target: any): any[] | undefined {
        const direction = new Vec2().copy(targetPosition).sub(this.initialPosition);
        this.distanceTravelled = 0;
        this.totalDistanceToTravel = this.moveOnCurve ? this.steerCurve!.getLength() : direction.length();
        const facing = FacingUtil.fromMapCoords(direction);
        if (facing !== unit.direction) {
            this.pointTurretToTarget(unit, target);
            if (!this.moveOnCurve) {
                unit.moveTrait.velocity.set(0, 0);
                return [new TurnTask(facing)];
            }
        }
        return undefined;
    }

    tick(unit: any, targetPosition: Vec2, target: any): TickResult {
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

        let terrainSpeed = this.world.terrain.getPassableSpeed(unit.tile, unit.rules.speedType, unit.isInfantry(), unit.onBridge, undefined, true);
        if (terrainSpeed) unit.moveTrait.lastTileSpeed = terrainSpeed;
        else terrainSpeed = unit.moveTrait.lastTileSpeed || 1;
        speed *= terrainSpeed;

        let step = speed * TICK;
        if (this.carryOverDistance) step = this.carryOverDistance;

        const currentPosition = unit.position.getMapPosition();
        let movementDelta: Vec2;

        if (this.moveOnCurve) {
            const curve = this.steerCurve!;
            const curveLength = curve.getLength();
            const newDistance = Math.min(this.distanceTravelled + step, curveLength);
            this.carryOverDistance = Math.max(0, this.distanceTravelled + step - curveLength);
            this.distanceTravelled = newDistance;
            const u = curveLength > 0 ? this.distanceTravelled / curveLength : 1;
            const curvePoint = curve.getPointAt(u);
            const curveTangent = curve.getTangentAt(u);
            const velocityVector = curveTangent.clone().setLength(speed);
            unit.moveTrait.velocity.set(velocityVector.x, velocityVector.y);
            const rotationSpeed = unit.rules.rot;
            const { facing, delta } = FacingUtil.tick(unit.direction, FacingUtil.fromMapCoords(curveTangent), rotationSpeed);
            unit.direction = facing;
            unit.spinVelocity = delta;
            const previousPosition = this.lastPosition;
            this.lastPosition = curvePoint.clone();
            movementDelta = curvePoint.sub(previousPosition);
        } else {
            const directionToTarget = new Vec2().copy(targetPosition).sub(currentPosition);
            const actualDistance = Math.min(directionToTarget.length(), step);
            movementDelta = directionToTarget.clone().setLength(actualDistance);
            const velocityVector = movementDelta.clone();
            if (this.carryOverDistance) velocityVector.add(unit.moveTrait.velocity);
            unit.moveTrait.velocity.set(velocityVector.x, velocityVector.y);
            this.distanceTravelled += actualDistance;
            this.carryOverDistance = Math.max(0, step - directionToTarget.length());
        }

        return {
            distance: movementDelta,
            done: !movementDelta.length() || !!this.carryOverDistance,
        };
    }

    /**
     * Reference: pointTurretToTarget writes TurretTrait.desiredFacing. This
     * project's turret is driven in radians by Unit.aimTurret, so the same
     * bearing is written through the conversion helper — the *decision* (what
     * the barrel should point at, and that it never expires) is unchanged.
     */
    private pointTurretToTarget(unit: any, target: any): void {
        if (!unit.hasTurret) return;
        let targetPosition = target;
        if (unit.attackTarget && !unit.attackTarget.dead) {
            targetPosition = unit.attackTarget.getMapPosition();
        }
        const unitPosition = unit.position.getMapPosition();
        const directionToTarget = new Vec2().copy(targetPosition).sub(unitPosition);
        if (directionToTarget.length()) {
            unit.turretAim = facingToRad(FacingUtil.fromMapCoords(directionToTarget));
        }
    }

    private applyAcceleration(unit: any, currentSpeed: number, baseSpeed: number, progress: number): number {
        if (this.currentWaypointType === WaypointType.Single) return baseSpeed / 2;
        if (this.currentWaypointType !== WaypointType.End) {
            return Math.min(currentSpeed + unit.rules.accelerationFactor * baseSpeed, baseSpeed);
        }
        let adjustedProgress = progress;
        if (this.moveOnCurve && this.currentWaypointType === WaypointType.End) {
            adjustedProgress = progress <= 0.5 ? 0 : 2 * (progress - 0.5);
        }
        const t = 1 - adjustedProgress;
        return 1 + (baseSpeed - 1) * t;
    }
}

export class FootLocomotor {
    private currentMoveDirection = new Vec2();
    private distanceToWaypoint = new Vec2();
    private endPauseFrames = 0;

    constructor(private world: any) {}

    onNewWaypoint(obj: any, target: Vec2): void {
        this.currentMoveDirection.copy(target).sub(obj.position.getMapPosition());
        const facing = FacingUtil.fromMapCoords(this.currentMoveDirection);
        if (facing !== obj.direction) obj.direction = facing;
        this.endPauseFrames = 1;
    }

    onWaypointUpdate(obj: any, target: Vec2): void {
        this.onNewWaypoint(obj, target);
    }

    tick(obj: any, target: Vec2): TickResult {
        let speed = obj.moveTrait.baseSpeed * TICK;
        let tileSpeed = this.world.terrain.getPassableSpeed(obj.tile, obj.rules.speedType, obj.isInfantry(), obj.onBridge, undefined, true);
        if (tileSpeed) obj.moveTrait.lastTileSpeed = tileSpeed;
        else tileSpeed = obj.moveTrait.lastTileSpeed || 1;
        speed *= tileSpeed;

        this.distanceToWaypoint.copy(target).sub(obj.position.getMapPosition());
        const moveVector = this.distanceToWaypoint.clone().setLength(speed);
        if (moveVector.length() || target.equals(obj.position.getMapPosition())) {
            obj.moveTrait.velocity.set(moveVector.x, moveVector.y);
        }
        const distance = Math.min(this.distanceToWaypoint.length(), speed);
        const isPaused = !distance && this.endPauseFrames > 0;
        if (isPaused) this.endPauseFrames--;
        this.distanceToWaypoint.setLength(distance);
        return {
            distance: new Vec2(this.distanceToWaypoint.x, this.distanceToWaypoint.y),
            done: !this.distanceToWaypoint.length() && !isPaused,
        };
    }
}

/** TurnTask — reference: task/TurnTask.ts. Not cancellable, like the original. */
export class TurnTask {
    cancellable = false;
    status = 'running';
    private direction: number;

    constructor(direction: number) {
        this.direction = direction;
    }

    tick(entity: any): boolean {
        if (entity.direction === this.direction) {
            entity.spinVelocity = 0;
            return true;
        }
        const rotationSpeed = entity.rules.rot;
        const { facing, delta } = FacingUtil.tick(entity.direction, this.direction, rotationSpeed);
        entity.direction = facing;
        entity.spinVelocity = delta;
        return false;
    }

    cancel(): void {}
    isCancelling(): boolean {
        return false;
    }
}

export { MoveTrait, facingToRad };
