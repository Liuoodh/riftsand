/**
 * Port of redalert2/src/game/gameobject/locomotor/MissileLocomotor.ts (189 lines).
 *
 * Guided missiles fly in three phases:
 *
 *   Boost      climb vertically to `cruiseAltitude`
 *   Midcourse  cruise, turning towards the target; the transition to terminal
 *              is `horizontalDistance / heightAboveTarget < 1` — i.e. the
 *              missile starts diving when it is closer horizontally than it is
 *              high, a 45° cone
 *   Terminal   dive onto the target, stopping `bodyLength` short so the nose
 *              (not the origin) touches the impact point
 *
 * `lazyCurve` selects the retail "V3-style" arc: instead of steering towards the
 * target it builds a cubic Bézier for the dive and walks it by arc length. The
 * `controlPoint2 = target.lerp(current, 0.15)` is what pulls the curve's tail
 * down towards the ground 15% short of the aim point.
 *
 * `tick` returns the *displacement*, not the new position: the caller applies it
 * so that bridge/elevation bookkeeping happens in one place.
 */
import { Coords } from '../../Coords';
import { ZoneType } from '../unit/ZoneType';
import { ObjectLiftOffEvent } from '../../event/ObjectLiftOffEvent';
import * as geometry from '../../math/geometry';
import { FacingUtil } from '../unit/FacingUtil';
import { Vector3 } from '../../math/Vector3';
import { Vector2 } from '../../math/Vector2';
import { CubicBezierCurve3 } from '../../math/CubicBezierCurve3';
import { GameMath } from '../../math/GameMath';

enum FlightPhase {
    Boost = 0,
    Midcourse = 1,
    Terminal = 2,
}

interface MissileRules {
    altitude: number;
    acceleration: number;
    lazyCurve: boolean;
    bodyLength: number;
}

export class MissileLocomotor {
    private game: any;
    private missileRules: MissileRules;
    private flightPhase: FlightPhase;
    private targetPosition?: Vector3;
    private cruiseAltitude?: number;
    private currentVelocity?: Vector3;
    private descentCurve?: CubicBezierCurve3;
    private descentTravelled?: number;

    constructor(game: any, missileRules: MissileRules) {
        this.game = game;
        this.missileRules = missileRules;
        this.flightPhase = FlightPhase.Boost;
    }

    selectNextWaypoint(gameObject: any, waypoints: any[]): any {
        const lastWaypoint = waypoints[waypoints.length - 1];
        const bridge = this.game.map.tileOccupation.getBridgeOnTile(lastWaypoint.tile);
        const tileZ = lastWaypoint.tile.z + (bridge?.tileElevation ?? 0);
        this.targetPosition = Coords.tile3dToWorld(lastWaypoint.tile.rx + 0.5, lastWaypoint.tile.ry + 0.5, tileZ);
        this.cruiseAltitude = Coords.tileHeightToWorld(tileZ) + this.missileRules.altitude;
        return lastWaypoint;
    }

    onNewWaypoint(gameObject: any, waypoint: any, waypointIndex: number): void {}

    tick(gameObject: any, deltaTime: number, tickCount: number): { distance: Vector3; done: boolean } {
        const currentPosition = gameObject.position.worldPosition.clone();
        const targetDirection = this.targetPosition!.clone().sub(currentPosition);

        if (gameObject.zone !== ZoneType.Air) {
            gameObject.onBridge = false;
            gameObject.zone = ZoneType.Air;
            this.game.events.dispatch(new ObjectLiftOffEvent(gameObject));
        }

        let speed: number;
        if (this.currentVelocity) {
            const maxSpeed = gameObject.rules.speed;
            speed = Math.min(this.currentVelocity.length() + this.missileRules.acceleration, maxSpeed);
        } else {
            speed = this.missileRules.acceleration;
            if (this.missileRules.lazyCurve) {
                this.currentVelocity = new Vector3(targetDirection.x, 0, targetDirection.z);
            } else {
                this.currentVelocity = Coords.vecGroundToWorld(FacingUtil.toMapCoords(gameObject.direction));
            }
            geometry.rotateVec3Towards(
                this.currentVelocity,
                new Vector3(this.currentVelocity.x, 1e8, this.currentVelocity.z),
                gameObject.pitch,
            );
        }
        this.currentVelocity.setLength(speed);

        let done = false;
        switch (this.flightPhase) {
            case FlightPhase.Boost:
                if (gameObject.position.worldPosition.y >= this.cruiseAltitude!) {
                    this.flightPhase = FlightPhase.Midcourse;
                } else {
                    done = false;
                    break;
                }
            // falls through
            case FlightPhase.Midcourse: {
                const horizontalDistance = new Vector2(targetDirection.x, targetDirection.z).length();
                if (!this.missileRules.lazyCurve) {
                    geometry.rotateVec3Towards(
                        this.currentVelocity,
                        new Vector3(this.currentVelocity.x, 0, this.currentVelocity.z),
                        gameObject.rules.rot,
                    );
                    if (this.currentVelocity.y < 1) {
                        const length = this.currentVelocity.length();
                        this.currentVelocity.y = 0;
                        this.currentVelocity.setLength(length);
                    }
                    geometry.rotateVec3Towards(
                        this.currentVelocity,
                        new Vector3(targetDirection.x, this.currentVelocity.y, targetDirection.z),
                        gameObject.rules.rot,
                    );
                    gameObject.direction = FacingUtil.fromMapCoords(Coords.vecWorldToGround(this.currentVelocity));
                    gameObject.pitch =
                        Math.sign(this.currentVelocity.y) *
                        geometry.angleDegBetweenVec3(
                            this.currentVelocity,
                            new Vector3(this.currentVelocity.x, 0, this.currentVelocity.z),
                        );
                    if (horizontalDistance / (currentPosition.y - this.targetPosition!.y) < 1) {
                        this.flightPhase = FlightPhase.Terminal;
                    }
                    break;
                }

                this.flightPhase = FlightPhase.Terminal;
                const controlPoint1 = currentPosition
                    .clone()
                    .add(
                        this.currentVelocity
                            .clone()
                            .setLength(
                                horizontalDistance / 3 / GameMath.cos(geometry.degToRad(gameObject.pitch)),
                            ),
                    );
                const controlPoint2 = this.targetPosition!.clone().lerp(currentPosition, 0.15).setY(controlPoint1.y);
                this.descentCurve = new CubicBezierCurve3(
                    currentPosition,
                    controlPoint1,
                    controlPoint2,
                    this.targetPosition!,
                );
            }
            // falls through — the lazy curve begins already in Terminal
            case FlightPhase.Terminal: {
                const bodyLength = this.missileRules.bodyLength;
                if (this.missileRules.lazyCurve) {
                    const curveLength = this.descentCurve!.getLength();
                    this.descentTravelled = this.descentTravelled ?? 0;
                    this.descentTravelled += Math.min(speed, curveLength - bodyLength - this.descentTravelled);
                    const t = this.descentTravelled / curveLength;
                    const pointOnCurve = this.descentCurve!.getPointAt(t);
                    const tangent = this.descentCurve!.getTangentAt(t);
                    this.currentVelocity.copy(pointOnCurve.sub(currentPosition));
                    const horizontalTangent = tangent.clone().setY(0);
                    gameObject.pitch =
                        Math.sign(tangent.y - horizontalTangent.y) *
                        geometry.angleDegBetweenVec3(horizontalTangent, tangent);
                    done = (this.descentTravelled + bodyLength) / curveLength >= 1;
                } else {
                    geometry.rotateVec3Towards(this.currentVelocity, targetDirection, gameObject.rules.rot);
                    gameObject.direction = FacingUtil.fromMapCoords(Coords.vecWorldToGround(this.currentVelocity));
                    gameObject.pitch =
                        Math.sign(this.currentVelocity.y) *
                        geometry.angleDegBetweenVec3(
                            this.currentVelocity,
                            new Vector3(this.currentVelocity.x, 0, this.currentVelocity.z),
                        );
                    const distanceToTarget = targetDirection.length() - bodyLength;
                    if (distanceToTarget < speed || distanceToTarget < 1) {
                        this.currentVelocity.copy(targetDirection.clone().addScalar(-bodyLength));
                        done = true;
                    }
                }
                break;
            }
            default:
                throw new Error(`Unhandled flight phase "${this.flightPhase}"`);
        }

        const newPosition = currentPosition.clone().add(this.currentVelocity);
        if (this.game.map.isWithinHardBounds(newPosition)) {
            gameObject.moveTrait.velocity.copy(this.currentVelocity);
            return { distance: this.currentVelocity, done };
        } else {
            // Leaving the hard bounds is not a collision: the missile is
            // despawned and reports done so the queued task unwinds normally.
            this.game.destroyObject(gameObject);
            return { done: true, distance: new Vector3() };
        }
    }
}
