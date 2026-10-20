/**
 * Port of redalert2/src/game/gameobject/locomotor/JumpjetLocomotor.ts (323 lines).
 *
 * Vertical take-off. Three behaviours live here:
 *
 * 1. **`tickStationary` — the parked state machine.** A jumpjet on the ground is
 *    not simply idle: each tick it re-tests whether it *may* land
 *    (`!balloonHover`, no task with `preventLanding` unless it can hover-attack,
 *    passable ground, not water, nothing in the way) and then climbs to either
 *    the ground height (landing) or `maxObstacleHeight + jumpjetHeight` (hovering
 *    over a crowded cell). The `else if (canLand)` branch — only reached when the
 *    height already *is* the target — is what actually flips `zone` to Ground and
 *    fires `ObjectLandEvent`; the height converges over several ticks, so landing
 *    is an animation, not a teleport.
 *
 * 2. **`tick` — the flying state machine.** It climbs to `clearHeight` before it
 *    will move horizontally (`currentHorizSpeed = 0` while below it), and only
 *    then starts turning and accelerating. The `lastClearZ` / `extraHeight = 4`
 *    hysteresis makes the jet climb *before* the obstacle is under it rather than
 *    clipping through: any rise of more than 2 units since the last clearance
 *    triggers an extra 4 units of clearance, so a cliff edge is cleared once
 *    instead of re-tested every tick.
 *
 * 3. **`tickCrash`.** Rotate 6° per tick and fall at `2 × jumpjetCrash`. No
 *    randomisation here (unlike `WingedLocomotor`), because a jet that lost lift
 *    falls predictably.
 *
 * `computeCancelDest` snaps the destination to the *cell the unit is over* but
 * keeps the fractional offset — a cancelled jet settles onto its own cell
 * instead of flying back to the cell it originally aimed at.
 */
import { Coords } from '../../Coords';
import { FacingUtil } from '../unit/FacingUtil';
import { TargetUtil } from '../unit/TargetUtil';
import * as geometry from '../../util/geometry';
import { ZoneType } from '../unit/ZoneType';
import { ObjectLiftOffEvent } from '../../event/ObjectLiftOffEvent';
import { ObjectLandEvent } from '../../event/ObjectLandEvent';
import { SpeedType } from '../../type/SpeedType';
import { StanceType } from '../StanceType';
import { Vector2 } from '../../math/Vector2';
import { Vector3 } from '../../math/Vector3';

interface TickResult {
    distance: Vector3;
    done: boolean;
}

export class JumpjetLocomotor {
    private game: any;
    private allowOutOfBounds: boolean = true;
    private currentMoveDir: Vector2;
    private currentHorizSpeed: number = 0;
    private cancelDestLeptons?: Vector2;
    private lastClearZ?: number;

    constructor(game: any) {
        this.game = game;
        this.currentMoveDir = new Vector2();
    }

    static tickStationary(gameObject: any, game: any): void {
        if (gameObject.zone === ZoneType.Air) {
            const bridge = gameObject.tile.onBridgeLandType
                ? game.map.tileOccupation.getBridgeOnTile(gameObject.tile)
                : undefined;

            const canLand =
                !gameObject.rules.balloonHover &&
                (!gameObject.unitOrderTrait.getCurrentTask()?.preventLanding || !gameObject.rules.hoverAttack) &&
                (game.map
                    .getGroundObjectsOnTile(gameObject.tile)
                    .find((obj: any) => obj.isBuilding() && obj.dockTrait?.isDocked(gameObject)) ||
                    (game.map.getTileZone(gameObject.tile) !== ZoneType.Water &&
                        0 <
                            game.map.terrain.getPassableSpeed(
                                gameObject.tile,
                                SpeedType.Foot,
                                true,
                                !!gameObject.tile.onBridgeLandType,
                            ) &&
                        0 === game.map.terrain.findObstacles({ tile: gameObject.tile, onBridge: bridge }, gameObject).length));

            let targetHeight: number;
            if (canLand) {
                const tileHeight = gameObject.tile.z + (bridge?.tileElevation ?? 0);
                targetHeight = Coords.tileHeightToWorld(tileHeight);
            } else {
                const maxObjectHeight =
                    gameObject.tile.z +
                    game.map
                        .getGroundObjectsOnTile(gameObject.tile)
                        .filter((obj: any) => !(obj.isInfantry() && obj.stance === StanceType.Paradrop))
                        .reduce((max: number, obj: any) => Math.max(max, obj.tileElevation + obj.art.height), 0);
                targetHeight = Coords.tileHeightToWorld(maxObjectHeight) + gameObject.rules.jumpjetHeight;
            }

            const currentHeight = gameObject.position.worldPosition.y;
            if (targetHeight !== currentHeight) {
                const climbRate = gameObject.rules.jumpjetClimb;
                const heightDiff = Math.abs(targetHeight - currentHeight);
                const climbAmount = Math.sign(targetHeight - currentHeight) * Math.min(climbRate, heightDiff);
                const oldElevation = gameObject.tileElevation;
                gameObject.position.moveByLeptons3(new Vector3(0, climbAmount, 0));
                gameObject.moveTrait.handleElevationChange(oldElevation, game);
            } else if (canLand) {
                gameObject.zone = ZoneType.Ground;
                gameObject.onBridge = !!bridge;
                game.events.dispatch(new ObjectLandEvent(gameObject));
                const crate = game.map.tileOccupation
                    .getGroundObjectsOnTile(gameObject.tile)
                    .find((obj: any) => obj.isOverlay() && obj.rules.crate);
                if (crate) {
                    game.crateGeneratorTrait.pickupCrate(gameObject, crate, game);
                }
            }
        }
    }

    static tickCrash(gameObject: any, param2: any, param3: any): Vector3 {
        const crashRate = 2 * gameObject.rules.jumpjetCrash;
        gameObject.direction = (gameObject.direction - 6 + 360) % 360;
        return new Vector3(0, -crashRate, 0);
    }

    onNewWaypoint(gameObject: any, param2: any, param3: any): void {
        this.currentMoveDir = FacingUtil.toMapCoords(gameObject.direction);
        this.cancelDestLeptons = undefined;
    }

    tick(gameObject: any, param2: any, destination: Vector2, isCancel: boolean): TickResult {
        if (gameObject.zone !== ZoneType.Air) {
            gameObject.onBridge = false;
            gameObject.zone = ZoneType.Air;
            this.game.events.dispatch(new ObjectLiftOffEvent(gameObject));
        }

        if (isCancel) {
            if (!this.cancelDestLeptons) {
                let tile = gameObject.tile;
                if (!this.game.map.isWithinBounds(tile)) {
                    tile = this.game.map.clampWithinBounds(tile);
                }
                this.cancelDestLeptons = this.computeCancelDest(tile, destination);
            }
            destination = this.cancelDestLeptons;
        }

        const currentPos = gameObject.position.getMapPosition();
        const deltaToTarget = destination.clone().sub(currentPos);
        const tilesToCheck = this.findTilesToCheckForBlockers(
            gameObject.tile,
            currentPos,
            this.currentMoveDir,
            deltaToTarget.length(),
        );
        const maxObstacleHeight = tilesToCheck
            .map(
                (tile) =>
                    tile.z +
                    this.game.map
                        .getGroundObjectsOnTile(tile)
                        .filter(
                            (obj: any) => !(obj.isDestroyed || (obj.isInfantry() && obj.stance === StanceType.Paradrop)),
                        )
                        .reduce((max: number, obj: any) => Math.max(max, obj.tileElevation + obj.art.height), 0),
            )
            .reduce((max, height) => Math.max(max, height), 0);

        let extraHeight = 0;
        if (this.lastClearZ === undefined || 2 < maxObstacleHeight - this.lastClearZ) {
            extraHeight = 4;
        }

        const minHeight = Coords.tileHeightToWorld(maxObstacleHeight);
        const clearHeight = Coords.tileHeightToWorld(maxObstacleHeight + extraHeight);
        const currentHeight = gameObject.position.worldPosition.y;
        const targetFacing = FacingUtil.fromMapCoords(deltaToTarget);
        const nearTarget = deltaToTarget.length() < gameObject.rules.jumpjetSpeed;

        let turnDelta = 0;
        if (minHeight <= currentHeight && !nearTarget) {
            const { facing: newFacing, delta } = FacingUtil.tick(
                gameObject.direction,
                targetFacing,
                gameObject.rules.jumpjetTurnRate,
            );
            turnDelta = delta;
            gameObject.direction = newFacing;
            this.currentMoveDir.copy(FacingUtil.toMapCoords(gameObject.direction));
        }
        if (gameObject.isVehicle()) {
            gameObject.spinVelocity = turnDelta;
        }

        let atCruiseHeight = false;
        let isDone = false;
        let verticalSpeed = 0;
        let horizontalSpeed = 0;
        const climbRate = gameObject.rules.jumpjetClimb;

        if (currentHeight < clearHeight) {
            verticalSpeed = Math.min(climbRate, clearHeight - currentHeight);
            atCruiseHeight = false;
            this.currentHorizSpeed = 0;
        } else {
            this.lastClearZ = maxObstacleHeight;
            const cruiseHeight = minHeight + gameObject.rules.jumpjetHeight;
            atCruiseHeight = true;
            if (cruiseHeight !== currentHeight) {
                const heightDiff = Math.abs(cruiseHeight - currentHeight);
                verticalSpeed = Math.sign(cruiseHeight - currentHeight) * Math.min(climbRate, heightDiff);
                atCruiseHeight = heightDiff <= climbRate;
            }

            const oldHorizSpeed = this.currentHorizSpeed;
            this.currentHorizSpeed = Math.min(this.currentHorizSpeed + 2, gameObject.rules.jumpjetSpeed);

            if (targetFacing === gameObject.direction) {
                horizontalSpeed = Math.min(oldHorizSpeed, deltaToTarget.length());
                isDone = oldHorizSpeed >= deltaToTarget.length();
            } else {
                const turnCircle =
                    oldHorizSpeed || turnDelta
                        ? TargetUtil.computeTurnCircle(
                              currentPos,
                              this.currentMoveDir,
                              Math.sign(turnDelta) * gameObject.rules.jumpjetTurnRate,
                              oldHorizSpeed,
                          )
                        : undefined;
                if (turnCircle && geometry.circleContainsPoint(turnCircle, destination)) {
                    horizontalSpeed = 0;
                    this.currentHorizSpeed = 0;
                } else {
                    horizontalSpeed = oldHorizSpeed;
                }
                isDone = false;
            }
        }

        let moveVector: Vector2;
        if (nearTarget) {
            isDone = true;
            moveVector = deltaToTarget;
        } else {
            moveVector = this.currentMoveDir.clone().setLength(horizontalSpeed);
        }

        const movement = new Vector3(moveVector.x, verticalSpeed, moveVector.y);
        const velocity = movement.clone();
        gameObject.moveTrait.velocity.copy(velocity);
        return { distance: movement, done: isDone && atCruiseHeight };
    }

    private findTilesToCheckForBlockers(
        currentTile: any,
        currentPos: Vector2,
        moveDir: Vector2,
        distance: number,
    ): any[] {
        const nextPos = moveDir
            .clone()
            .setLength(Math.min(distance, Coords.LEPTONS_PER_TILE))
            .add(currentPos)
            .multiplyScalar(1 / Coords.LEPTONS_PER_TILE)
            .floor();
        const nextTile = this.game.map.tiles.getByMapCoords(nextPos.x, nextPos.y);
        if (!nextTile || nextTile === currentTile) {
            return [currentTile];
        }
        const dx = Math.sign(nextTile.rx - currentTile.rx);
        const dy = Math.sign(nextTile.ry - currentTile.ry);
        const tiles = [currentTile];
        if (dx) {
            const tile = this.game.map.tiles.getByMapCoords(currentTile.rx + dx, currentTile.ry);
            if (tile) tiles.push(tile);
        }
        if (dy) {
            const tile = this.game.map.tiles.getByMapCoords(currentTile.rx, currentTile.ry + dy);
            if (tile) tiles.push(tile);
        }
        if (dx && dy) {
            const tile = this.game.map.tiles.getByMapCoords(currentTile.rx + dx, currentTile.ry + dy);
            if (tile) tiles.push(tile);
        }
        return tiles;
    }

    private computeCancelDest(tile: any, target: Vector2): Vector2 {
        const tilePos = target
            .clone()
            .multiplyScalar(1 / Coords.LEPTONS_PER_TILE)
            .floor()
            .multiplyScalar(Coords.LEPTONS_PER_TILE);
        const offset = target.clone().sub(tilePos);
        return new Vector2(tile.rx, tile.ry).multiplyScalar(Coords.LEPTONS_PER_TILE).add(offset);
    }
}
