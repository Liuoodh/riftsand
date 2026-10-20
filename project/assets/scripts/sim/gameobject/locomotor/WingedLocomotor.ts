/**
 * Port of redalert2/src/game/gameobject/locomotor/WingedLocomotor.ts (336 lines).
 *
 * Fixed-wing / helicopter flight. The reference source for this file arrived
 * with single-letter identifiers (`e, t, i, r, s, a, n, o, l, h, u, d, g, p, m,
 * f, y, T, v, b, S, w, C`); they have been restored to names here. The control
 * flow is unchanged and the branch comments name the variable each one came
 * from where it matters.
 *
 * Four behaviours are worth understanding before touching this:
 *
 * 1. **Three maneuver modes.** `None` flies straight at the destination,
 *    `CircleStrafe` orbits it at full speed, `HoverStrafe` points the nose at
 *    the target (or at 270°/0° for a dock) while the hull slides sideways.
 *    `HoverStrafe` is the default whenever the aircraft is hovering or close
 *    (`n <= one cell`), which is why helicopters look like they are strafing
 *    rather than circling.
 *
 * 2. **Two facings, not one.** `direction` is the hull, `thrustFacing` is where
 *    the engine pushes. They diverge on purpose: the hull can point at the
 *    target while the thrust vector is still swinging around, and the gap is
 *    what produces the visible bank (`roll = sign(facingDelta) * pitchAngle`).
 *
 * 3. **The turn-circle test.** When the destination is *inside* the circle the
 *    aircraft would trace at its current speed, it cannot reach it without
 *    overshooting, so it decelerates by 2 per tick (`deceleratingToTurn`).
 *    When the destination is outside, it keeps its speed. Reading the reference's
 *    empty `if` body literally gives exactly that, so the chain below is the
 *    same logic written out.
 *
 * 4. **Landing is a height animation.** `tickStationary` walks the hull down to
 *    ground height over several ticks; only when it is already at the target
 *    height does `zone` flip to `Ground` and `ObjectLandEvent` fire.
 *
 * `speedLimit` uses `lerp(1, speed / 2, sqrt(n / cell))` for the last cell, so
 * the final approach eases in instead of stopping dead — and `lerp` from 1 (not
 * 0) means a helicopter never quite reaches zero horizontal speed.
 */
import { Coords } from '../../Coords';
import { FacingUtil } from '../unit/FacingUtil';
import { TargetUtil } from '../unit/TargetUtil';
import { circleContainsPoint } from '../../util/geometry';
import { ZoneType } from '../unit/ZoneType';
import { ObjectLiftOffEvent } from '../../event/ObjectLiftOffEvent';
import { ObjectLandEvent } from '../../event/ObjectLandEvent';
import { SpeedType } from '../../type/SpeedType';
import { MoveToDockTask } from '../task/MoveToDockTask';
import { NotifyTick } from '../trait/interface/NotifyTick';
import { Vector2 } from '../../math/Vector2';
import { Vector3 } from '../../math/Vector3';
import { lerp } from '../../util/math';
import { GameMath } from '../../math/GameMath';

enum ManeuverType {
    None = 0,
    CircleStrafe = 1,
    HoverStrafe = 2,
}

interface CrashState {
    rollDelta?: number;
    pitchDelta?: number;
}

export class WingedLocomotor {
    private game: any;
    private allowOutOfBounds: boolean = true;
    private lastDestLeptons: Vector2;
    private currentMoveDir: Vector2;
    private currentHorizSpeed: number = 0;
    private maneuverType: ManeuverType = ManeuverType.None;
    private deceleratingToTurn: boolean = false;
    private cancelDestLeptons?: Vector2;
    private thrustFacing?: number;

    static tickStationary(unit: any, game: any): void {
        if (unit.zone === ZoneType.Air) {
            const bridge = unit.tile.onBridgeLandType
                ? game.map.tileOccupation.getBridgeOnTile(unit.tile)
                : undefined;

            /* reference: `e` */
            let canLand = unit.rules.landable && !unit.unitOrderTrait.getCurrentTask()?.preventLanding;
            /* reference: `i` */
            const parent = unit.spawnLinkTrait?.getParent();
            if (canLand && parent) {
                canLand = !((( !parent.isUnit() || !parent.onBridge) && bridge) || parent.tile !== unit.tile);
            } else if (canLand && !unit.airportBoundTrait) {
                canLand =
                    game.map.getTileZone(unit.tile) !== ZoneType.Water &&
                    0 <
                        game.map.terrain.getPassableSpeed(
                            unit.tile,
                            SpeedType.Foot,
                            true,
                            !!unit.tile.onBridgeLandType,
                        ) &&
                    0 === game.map.terrain.findObstacles({ tile: unit.tile, onBridge: bridge }, unit).length;
            }

            /* reference: `r` */
            let targetHeight: number;
            if (canLand) {
                const dockTrait = unit.airportBoundTrait?.preferredAirport?.dockTrait;
                /* reference: `o` */
                const isDocked = dockTrait?.isDocked(unit) || dockTrait?.hasReservedDockForUnit(unit);
                if (!unit.airportBoundTrait || isDocked) {
                    /* reference: `l` — parked aircraft face 270°, docked ones face 0° */
                    const targetFacing = isDocked ? 0 : 270;
                    if (unit.direction !== targetFacing) {
                        unit.direction = FacingUtil.tick(unit.direction, targetFacing, unit.rules.rot).facing;
                        return;
                    }
                }
                if (unit.airportBoundTrait) {
                    let airport = unit.airportBoundTrait.preferredAirport;
                    if (!airport?.dockTrait?.isDocked(unit)) {
                        if (!airport?.dockTrait?.getAvailableDockCount()) {
                            airport = unit.airportBoundTrait.findAvailableAirport(unit);
                            unit.airportBoundTrait.preferredAirport = airport;
                            if (airport) {
                                const dockNumber = airport.dockTrait.getFirstAvailableDockNumber();
                                airport.dockTrait.reserveDockAt(unit, dockNumber);
                            }
                        }
                        if (airport) {
                            unit.unitOrderTrait.addTask(new MoveToDockTask(game, airport));
                            /*
                             * Tick the order queue immediately instead of waiting
                             * for the next frame — the aircraft would otherwise
                             * hang one tick in the air between "I want to dock"
                             * and "I am taxiing", which reads as a stutter.
                             */
                            unit.unitOrderTrait[NotifyTick.onTick](unit, game);
                        } else {
                            unit.crashableTrait.crash(undefined);
                        }
                        return;
                    }
                }
                /* reference: `t` */
                const tileHeight = parent
                    ? parent.tile.z + parent.tileElevation
                    : unit.tile.z + (bridge?.tileElevation ?? 0);
                targetHeight = Coords.tileHeightToWorld(tileHeight);
            } else {
                const tileHeight = unit.tile.z + (bridge?.tileElevation ?? 0);
                const flightLevel = unit.rules.flightLevel ?? game.rules.general.flightLevel;
                targetHeight = Coords.tileHeightToWorld(tileHeight) + flightLevel;
            }

            const currentY = unit.position.worldPosition.y;
            if (targetHeight !== currentY) {
                const distance = Math.abs(targetHeight - currentY);
                const deltaY = Math.sign(targetHeight - currentY) * Math.min(30, distance);
                const oldElevation = unit.tileElevation;
                unit.position.moveByLeptons3(new Vector3(0, deltaY, 0));
                unit.moveTrait.handleElevationChange(oldElevation, game);
            } else if (canLand) {
                unit.zone = ZoneType.Ground;
                if (parent) {
                    parent.airSpawnTrait.storeAircraft(unit, game);
                } else {
                    unit.onBridge = !!bridge;
                }
                game.events.dispatch(new ObjectLandEvent(unit));
                const crate = game.map.tileOccupation
                    .getGroundObjectsOnTile(unit.tile)
                    .find((obj: any) => obj.isOverlay() && obj.rules.crate);
                if (crate) {
                    game.crateGeneratorTrait.pickupCrate(unit, crate, game);
                }
            }
        }
    }

    static tickCrash(unit: any, game: any, state: CrashState): Vector3 {
        if (state.rollDelta === undefined) {
            state.rollDelta = game.generateRandomInt(-15, 15);
        }
        if (state.pitchDelta === undefined) {
            state.pitchDelta = game.generateRandomInt(0, 15);
        }
        unit.roll += state.rollDelta;
        unit.pitch += state.pitchDelta;
        const groundVelocity = Coords.vecWorldToGround(unit.moveTrait.velocity);
        return new Vector3(groundVelocity.x, -30, groundVelocity.y);
    }

    constructor(game: any) {
        this.game = game;
        this.allowOutOfBounds = true;
        this.lastDestLeptons = new Vector2();
        this.currentMoveDir = new Vector2();
        this.currentHorizSpeed = 0;
        this.maneuverType = ManeuverType.None;
        this.deceleratingToTurn = false;
    }

    onNewWaypoint(unit: any, waypoint: any, destLeptons: Vector2): void {
        this.currentHorizSpeed = Coords.vecWorldToGround(unit.moveTrait.velocity).length();
        this.cancelDestLeptons = undefined;
    }

    tick(unit: any, targetLeptons: any, destLeptons: Vector2, isCancel: boolean): { distance: Vector3; done: boolean } {
        if (isCancel) {
            if (!this.cancelDestLeptons) {
                let tile = unit.tile;
                if (!this.game.map.isWithinBounds(tile)) {
                    tile = this.game.map.clampWithinBounds(tile);
                }
                this.cancelDestLeptons = this.computeCancelDest(tile, destLeptons);
            }
            destLeptons = this.cancelDestLeptons;
        }

        const currentPos = unit.position.getMapPosition();
        /* reference: `a` — vector to the destination */
        const deltaToDest = destLeptons.clone().sub(currentPos);
        /* reference: `n` */
        const distToDest = deltaToDest.length();

        if (!this.lastDestLeptons.equals(destLeptons)) {
            this.lastDestLeptons.copy(destLeptons);
            if (isCancel) {
                this.maneuverType = ManeuverType.HoverStrafe;
            } else if (unit.zone === ZoneType.Air && this.currentHorizSpeed < 5) {
                this.maneuverType =
                    distToDest > Coords.LEPTONS_PER_TILE ? ManeuverType.CircleStrafe : ManeuverType.HoverStrafe;
            } else {
                this.maneuverType = ManeuverType.None;
            }
            this.deceleratingToTurn = false;
        }

        if (unit.zone !== ZoneType.Air) {
            unit.onBridge = false;
            unit.zone = ZoneType.Air;
            this.game.events.dispatch(new ObjectLiftOffEvent(unit));
        }

        const bridge = unit.tile.onBridgeLandType ? this.game.map.tileOccupation.getBridgeOnTile(unit.tile) : undefined;
        const tileHeight = unit.tile.z + (bridge?.tileElevation ?? 0);
        const flightLevel = unit.rules.flightLevel ?? this.game.rules.general.flightLevel;
        /* reference: `h` — cruise altitude in world units */
        const cruiseY = Coords.tileHeightToWorld(tileHeight) + flightLevel;
        const currentY = unit.position.worldPosition.y;

        /* reference: `u` — facing that points straight at the destination */
        const facingToDest = FacingUtil.fromMapCoords(deltaToDest);

        if (
            unit.direction === facingToDest &&
            this.maneuverType === ManeuverType.None &&
            distToDest <= Coords.LEPTONS_PER_TILE
        ) {
            this.maneuverType = ManeuverType.HoverStrafe;
        } else if (unit.direction === facingToDest && this.maneuverType === ManeuverType.CircleStrafe) {
            this.maneuverType = ManeuverType.None;
        }

        /* reference: `d` — facing the hull wants */
        let desiredFacing: number;
        switch (this.maneuverType) {
            case ManeuverType.HoverStrafe:
                if (unit.attackTrait?.currentTarget) {
                    const targetPos = Coords.vecWorldToGround(unit.attackTrait.currentTarget.getWorldCoords());
                    desiredFacing = FacingUtil.fromMapCoords(targetPos.sub(currentPos));
                } else {
                    desiredFacing = unit.airportBoundTrait?.preferredAirport?.dockTrait?.hasReservedDockForUnit(unit)
                        ? 0
                        : 270;
                }
                break;
            case ManeuverType.CircleStrafe:
            case ManeuverType.None:
                desiredFacing = facingToDest;
                break;
            default:
                throw new Error('Unknown maneuver type "' + this.maneuverType + '"');
        }

        const { facing: newFacing, delta: facingDelta } = FacingUtil.tick(
            unit.direction,
            desiredFacing,
            unit.rules.rot,
        );
        unit.direction = newFacing;
        unit.roll = Math.sign(facingDelta) * unit.rules.pitchAngle;

        /* reference: `m` — facing the thrust vector wants */
        let desiredThrustFacing: number;
        switch (this.maneuverType) {
            case ManeuverType.HoverStrafe:
                desiredThrustFacing = facingToDest;
                break;
            case ManeuverType.CircleStrafe:
                desiredThrustFacing = (newFacing - 90 * Math.sign(facingDelta) + 360) % 360;
                break;
            case ManeuverType.None:
                desiredThrustFacing = newFacing;
                break;
            default:
                throw new Error('Unknown maneuver type "' + this.maneuverType + '"');
        }

        if (this.thrustFacing === undefined) {
            this.thrustFacing = desiredThrustFacing;
        }
        /*
         * Above 5 units/tick the nozzle tracks the hull turn rate; below it the
         * vector snaps (`POSITIVE_INFINITY`) so a hovering aircraft does not
         * visibly rotate its exhaust while stationary.
         */
        const thrustRotSpeed = this.currentHorizSpeed > 5 ? unit.rules.rot : Number.POSITIVE_INFINITY;
        const { facing: newThrustFacing, delta: thrustDelta } = FacingUtil.tick(
            this.thrustFacing,
            desiredThrustFacing,
            thrustRotSpeed,
        );
        this.thrustFacing = newThrustFacing;
        this.currentMoveDir.copy(FacingUtil.toMapCoords(this.thrustFacing));

        let done = false;
        let verticalDelta = 0;
        let horizDistance = 0;
        let atCruiseHeight = true;

        if (cruiseY !== currentY) {
            const heightDiff = Math.abs(cruiseY - currentY);
            verticalDelta = Math.sign(cruiseY - currentY) * Math.min(30, heightDiff);
            atCruiseHeight = heightDiff <= 30;
        }

        let speedLimit = unit.rules.speed;
        if (distToDest <= Coords.LEPTONS_PER_TILE && this.maneuverType !== ManeuverType.CircleStrafe) {
            speedLimit = lerp(1, speedLimit / 2, GameMath.sqrt(distToDest / Coords.LEPTONS_PER_TILE));
        }

        if (this.deceleratingToTurn) {
            this.currentHorizSpeed = Math.max(0, this.currentHorizSpeed - 2);
        } else {
            this.currentHorizSpeed = Math.min(this.currentHorizSpeed + 2, speedLimit);
        }
        /* reference: `S` */
        const horizSpeed = this.currentHorizSpeed;
        this.deceleratingToTurn = false;

        if (thrustDelta) {
            const turnCircle =
                horizSpeed || thrustDelta
                    ? TargetUtil.computeTurnCircle(
                          currentPos,
                          this.currentMoveDir,
                          Math.sign(thrustDelta) * unit.rules.rot,
                          horizSpeed,
                      )
                    : undefined;

            /*
             * Reference writes this as an empty `if` whose condition carries the
             * side effects. Written out, it is: "if the destination is outside
             * the turn circle, keep the speed; otherwise slow for the turn, and
             * promote a straight run to a hover strafe".
             */
            if (horizSpeed !== 0 && !circleContainsPoint(turnCircle!, destLeptons)) {
                /* destination reachable at this speed — nothing to do */
            } else if (this.maneuverType === ManeuverType.HoverStrafe || distToDest > Coords.LEPTONS_PER_TILE) {
                this.deceleratingToTurn = true;
            } else if (this.maneuverType === ManeuverType.None) {
                this.maneuverType = ManeuverType.HoverStrafe;
            }

            horizDistance = horizSpeed;
            done = false;
        } else {
            horizDistance = Math.min(horizSpeed, distToDest);
            done = distToDest <= horizSpeed;
        }

        /* reference: `w` */
        let moveVector: Vector2;
        if (distToDest < 1) {
            done = true;
            moveVector = deltaToDest;
        } else if (done) {
            moveVector = deltaToDest;
        } else {
            moveVector = this.currentMoveDir.clone().setLength(horizDistance);
        }

        const movement = new Vector3(moveVector.x, verticalDelta, moveVector.y);
        const velocity = movement.clone();
        unit.moveTrait.velocity.copy(velocity);
        return { distance: movement, done: done && atCruiseHeight };
    }

    computeCancelDest(tile: any, destLeptons: Vector2): Vector2 {
        const tileAligned = destLeptons
            .clone()
            .multiplyScalar(1 / Coords.LEPTONS_PER_TILE)
            .floor()
            .multiplyScalar(Coords.LEPTONS_PER_TILE);
        const offset = destLeptons.clone().sub(tileAligned);
        return new Vector2(tile.rx, tile.ry).multiplyScalar(Coords.LEPTONS_PER_TILE).add(offset);
    }
}
