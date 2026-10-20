/**
 * Port of redalert2/src/game/gameobject/trait/MoveTrait.ts (301 lines).
 *
 * The movement half of a unit. `MoveTask` is the driver; this is the state it
 * drives and the bookkeeping that must happen whenever the unit changes cell,
 * layer or altitude.
 *
 *   1. **The four-state machine.** `Idle → ReachedNextWaypoint → PlanMove →
 *      Moving`. Collision is *planned* in `PlanMove` and the unit simply drives
 *      in `Moving`; nothing here pushes or separates objects.
 *
 *   2. **`onTick` is a watchdog, not a driver.** It only does something when the
 *      state says "moving" but the order queue no longer holds a `MoveTask` —
 *      the order was replaced mid-drive. Then it zeroes the velocity and drops
 *      back to `Idle`, which also frees the locomotor. Without that, an
 *      interrupted unit keeps its last velocity for ever and slides.
 *
 *   3. **`handleTileChange` is the single choke point** for everything that must
 *      happen when a cell changes: occupation bookkeeping, zone (land/water/air)
 *      transition, bridge-layer elevation delta, crushing, crate pickup, the two
 *      `NotifyTileChange` broadcasts (object-level and global), and
 *      `EnterTileEvent`. Every other subsystem hooks in from here, so a missed
 *      call is very visible: units walk through walls and never trigger mines.
 *
 *   4. **`teleportUnitToTile` vs `handleTileChange(..., teleporting)`.**
 *      `teleporting` suppresses friendly-fire crushing — a chrono jump onto your
 *      own infantry is not a ram. Note it does **not** suppress enemy crushing.
 *
 * `baseSpeed` is the one place where three multipliers meet: veteran speed,
 * crate bonus, and the 25 % damage for a vehicle under half health. The last one
 * is skipped for hover units (`Locomotor=Hover`), which is why a damaged
 * hovercraft does not slow down.
 *
 * ---
 * **Deviation (reference inconsistency):** `teleportUnitToTile` dispatches
 * `new ObjectTeleportEvent(gameObject, fromTile, oldTile)`, but the event's
 * signature is `(target, isChronoshift: boolean, prevTile)` and `MoveTask`
 * dispatches `(unit, true, oldTile)`. Passing a tile into a boolean slot is a
 * transcription artefact, so this passes `true`. See REFERENCE-PARITY §29.
 */
import { MoveTask } from '../task/move/MoveTask';
import { NotifyTick } from './interface/NotifyTick';
import { NotifyDestroy } from './interface/NotifyDestroy';
import { ZoneType, getZoneType } from '../unit/ZoneType';
import { InfDeathType } from '../InfDeathType';
import { ObjectTeleportEvent } from '../../event/ObjectTeleportEvent';
import { DeathType } from '../DeathType';
import { NotifyTeleport } from './interface/NotifyTeleport';
import { LocomotorType } from '../../type/LocomotorType';
import { JumpjetLocomotor } from '../locomotor/JumpjetLocomotor';
import { SpeedType } from '../../type/SpeedType';
import { WingedLocomotor } from '../locomotor/WingedLocomotor';
import { StanceType } from '../StanceType';
import { NotifyTileChange as GlobalNotifyTileChange } from '../../trait/interface/NotifyTileChange';
import { NotifyTileChange } from './interface/NotifyTileChange';
import { EnterTileEvent } from '../../event/EnterTileEvent';
import { Vector3 } from '../../math/Vector3';
import { NotifyElevationChange } from '../../trait/interface/NotifyElevationChange';
import { Target } from '../../Target';
import type { GameObject } from '../GameObject';
import type { Tile } from '../../map/TileCollection';

interface TileOccupation {
    unoccupyTileRange(tile: any, obj: any): void;
    occupyTileRange(tile: any, obj: any): void;
    getBridgeOnTile(tile: any): any;
    getGroundObjectsOnTile(tile: any): any[];
    unoccupySingleTile(tile: any, obj: any): void;
}

interface GameState {
    currentTick: number;
    map: any;
    rules: any;
    events: any;
    traits: any[];
    crateGeneratorTrait: any;
    areFriendly(a: any, b: any): boolean;
    destroyObject(obj: any, source: any): void;
}

interface Task {
    children: Task[];
}

interface PathNode {
    tile: any;
}

export enum MoveState {
    Idle = 0,
    ReachedNextWaypoint = 1,
    PlanMove = 2,
    Moving = 3,
}

export enum MoveResult {
    Success = 0,
    Cancel = 1,
    CloseEnough = 2,
    Fail = 3,
}

export enum CollisionState {
    Waiting = 0,
    Resolved = 1,
}

/**
 * "Is this task, or the first child of this task, a MoveTask?" — the order queue
 * nests move tasks inside `TaskGroup`, `MoveToBlockTask`, `ScatterTask` and
 * friends, so a plain `instanceof` on the current task is not enough.
 */
const isMoveTask = (task: Task): boolean => {
    return task instanceof MoveTask || (task.children[0] && isMoveTask(task.children[0]));
};

export class MoveTrait {
    private gameObject: GameObject;
    private tileOccupation: TileOccupation;
    private disabled: boolean = false;
    private speedPenalty: number = 0;
    private velocity: Vector3 = new Vector3();
    private reservedPathNodes: PathNode[] = [];
    private moveState: MoveState = MoveState.Idle;
    private collisionState: CollisionState = CollisionState.Resolved;
    private locomotor?: any;
    private currentWaypoint?: any;
    private lastTargetOffset?: any;
    private lastVelocity?: Vector3;
    private lastMoveResult?: MoveResult;
    private lastTeleportTick?: number;

    /*
     * Warhead / balance multipliers. `crateBonuses.speed` defaults to 1 but a
     * speed crate multiplies it, and `speedPenalty` is set by terrain and by
     * `ChronoLocomotor`'s post-jump sluggishness.
     */
    get baseSpeed(): number {
        return (
            this.gameObject.rules.speed *
            (this.gameObject.veteranTrait?.getVeteranSpeedMultiplier() ?? 1) *
            this.gameObject.crateBonuses.speed *
            (this.gameObject.isVehicle() &&
            this.gameObject.healthTrait.health <= 50 &&
            this.gameObject.rules.locomotor !== LocomotorType.Hover
                ? 0.75
                : 1) *
            (1 - this.speedPenalty)
        );
    }

    constructor(gameObject: GameObject, tileOccupation: TileOccupation) {
        this.gameObject = gameObject;
        this.tileOccupation = tileOccupation;
    }

    isDisabled(): boolean {
        return this.disabled;
    }

    setDisabled(disabled: boolean): void {
        this.disabled = disabled;
    }

    isMoving(): boolean {
        return this.moveState === MoveState.Moving;
    }

    isIdle(): boolean {
        return this.moveState === MoveState.Idle;
    }

    isWaiting(): boolean {
        return this.collisionState === CollisionState.Waiting;
    }

    [NotifyTick.onTick](gameObject: GameObject, gameState: GameState): void {
        if (this.moveState !== MoveState.Idle && this.collisionState === CollisionState.Resolved) {
            const currentTask = gameObject.unitOrderTrait.getCurrentTask();
            if (!(currentTask && isMoveTask(currentTask))) {
                this.velocity.set(0, 0, 0);
                this.moveState = MoveState.Idle;
                this.locomotor = undefined;
                /*
                 * A vehicle that stops because its move was interrupted should
                 * also stop pointing its turret at wherever it was going.
                 */
                if (
                    !currentTask &&
                    !gameObject.attackTrait?.currentTarget &&
                    gameObject.isVehicle() &&
                    gameObject.turretTrait
                ) {
                    gameObject.turretTrait.desiredFacing = gameObject.direction;
                }
            }
        }

        /*
         * Idle aircraft keep ticking their locomotor: that is what lands a
         * helicopter and what makes a jumpjet bob over obstacles. Ground units
         * have nothing to do when idle, which is why this is not a general
         * `update`.
         */
        if (this.moveState === MoveState.Idle) {
            if (gameObject.rules.locomotor === LocomotorType.Jumpjet) {
                JumpjetLocomotor.tickStationary(gameObject, gameState);
            } else if (gameObject.isAircraft() && gameObject.rules.locomotor === LocomotorType.Aircraft) {
                WingedLocomotor.tickStationary(gameObject, gameState);
            }
        }
    }

    [NotifyDestroy.onDestroy](gameObject: GameObject, gameState: GameState): void {
        this.unreservePathNodes();
    }

    teleportUnitToTile(
        targetTile: Tile,
        bridge: any,
        fromTile: Tile,
        preserveMovement: boolean,
        gameState: GameState,
    ): void {
        const gameObject = this.gameObject;
        const oldTile = gameObject.tile;

        gameObject.traits.filter(NotifyTeleport).forEach((trait: any) => {
            trait[NotifyTeleport.onBeforeTeleport](gameObject, gameState, fromTile, preserveMovement);
        });

        /*
         * Write the elevation *before* the tile: `ObjectPosition.tile`'s setter
         * recomputes `worldPosition` from the current elevation, so doing it the
         * other way round flashes the object at the old height for one frame.
         */
        gameObject.position.tileElevation = gameObject.tileElevation;
        gameObject.position.tile = targetTile;
        gameObject.position.subCell = gameObject.position.desiredSubCell;

        this.handleTileChange(oldTile, bridge, true, gameState, true);

        if (!preserveMovement) {
            this.unreservePathNodes();
            this.speedPenalty = 0;
            this.velocity.set(0, 0, 0);
            this.moveState = MoveState.Idle;
            this.collisionState = CollisionState.Resolved;
            this.locomotor = undefined;
            this.currentWaypoint = undefined;
            this.lastTargetOffset = undefined;
            this.lastVelocity = undefined;
            this.lastMoveResult = MoveResult.Cancel;
            if (gameObject.isVehicle()) {
                gameObject.spinVelocity = 0;
                if (gameObject.turretTrait) {
                    gameObject.turretTrait.desiredFacing = gameObject.direction;
                }
            }
        }

        this.lastTeleportTick = gameState.currentTick;
        gameState.events.dispatch(new ObjectTeleportEvent(gameObject, true, oldTile));
    }

    handleTileChange(
        oldTile: any,
        bridge: any,
        teleporting: boolean,
        gameState: GameState,
        isTeleport: boolean = false,
    ): void {
        const gameObject = this.gameObject;

        /*
         * Units that must use the ground layer under a bridge (too tall to fit)
         * drop the bridge flag on every cell change, then the elevation and zone
         * are recomputed from the land type.
         */
        if (Target.usesGroundLayerUnderBridge(gameObject)) {
            bridge = undefined;
            if (gameObject.onBridge) {
                gameObject.onBridge = false;
                gameObject.position.tileElevation = 0;
                gameObject.zone = getZoneType(gameObject.tile.landType);
            }
        }

        gameState.map.tileOccupation.unoccupyTileRange(oldTile, gameObject);
        gameState.map.tileOccupation.occupyTileRange(gameObject.tile, gameObject);
        gameState.map.technosByTile.updateObject(gameObject);

        if (gameObject.zone !== ZoneType.Air) {
            const oldBridge = gameObject.onBridge ? gameState.map.tileOccupation.getBridgeOnTile(oldTile) : undefined;
            const oldLandType = gameObject.onBridge ? oldTile.onBridgeLandType : oldTile.landType;
            const newLandType = bridge ? gameObject.tile.onBridgeLandType : gameObject.tile.landType;

            /*
             * Zone only changes if the new land type is drivable. A unit that
             * drives into water (allowed for amphibious / teleporting) keeps its
             * old zone until it reaches something it can stand on.
             */
            if (oldLandType !== newLandType) {
                const speedModifier = gameState.rules
                    .getLandRules(newLandType)
                    .getSpeedModifier(gameObject.rules.speedType);
                if (speedModifier > 0 || gameObject.rules.speedType === SpeedType.Amphibious || isTeleport) {
                    gameObject.zone = getZoneType(newLandType);
                }
            }

            /*
             * Crossing a bridge ramp changes the world height by the bridge's
             * own elevation, relative to the ground under it. Doing this as a
             * delta (rather than an absolute) keeps a unit that is mid-ramp from
             * snapping.
             */
            if (bridge !== oldBridge) {
                gameObject.position.tileElevation += -(oldBridge?.tileElevation ?? 0) + (bridge?.tileElevation ?? 0);
                gameObject.onBridge = !!bridge;
            }

            const nodeIndex = gameObject.moveTrait.reservedPathNodes.findIndex(
                (node: any) => node.tile === gameObject.tile,
            );
            if (nodeIndex !== -1) {
                gameObject.moveTrait.reservedPathNodes.splice(nodeIndex, 1);
            }

            /*
             * Crushing. Note the `!(obj.isTechno() && !teleporting)` clause:
             * teleporting never crushes friendlies but does crush enemies, and
             * `InfDeathType.None` + `DeathType.Crush` is what makes the death
             * animation a splat rather than a corpse.
             */
            if (gameObject.crusher) {
                const crushableObjects = gameState.map
                    .getGroundObjectsOnTile(gameObject.tile)
                    .filter(
                        (obj: any) =>
                            (!obj.isUnit() || obj.onBridge === gameObject.onBridge) &&
                            obj.rules.crushable &&
                            !(obj.isInfantry() && obj.stance === StanceType.Paradrop) &&
                            (!(obj.isTechno() && !teleporting) || !gameState.areFriendly(obj, gameObject)),
                    );
                for (const crushable of crushableObjects) {
                    if (!crushable.isDestroyed) {
                        if (crushable.isInfantry()) {
                            crushable.infDeathType = InfDeathType.None;
                        }
                        if (gameObject.isVehicle() && crushable.isOverlay() && crushable.rules.wall) {
                            /* Hitting a wall rocks the hull; that is the only visual feedback. */
                            gameObject.applyRocking(0, 0.5);
                        }
                        crushable.deathType = DeathType.Crush;
                        gameState.destroyObject(crushable, { player: gameObject.owner, obj: gameObject });
                    }
                }
            }

            if (!gameObject.onBridge) {
                const crate = gameState.map.tileOccupation
                    .getGroundObjectsOnTile(gameObject.tile)
                    .find((obj: any) => obj.isOverlay() && obj.rules.crate);
                if (crate) {
                    gameState.crateGeneratorTrait.pickupCrate(gameObject, crate, gameState);
                }
            }
        }

        /*
         * Two different symbols with the same name. The global one is for game
         * traits (spy satellites, radar); the object-level one is for traits on
         * this object (mines, garrison). Both must fire.
         */
        (gameState.traits as any).filter(GlobalNotifyTileChange).forEach((trait: any) => {
            trait[GlobalNotifyTileChange.onTileChange](gameObject, gameState, oldTile, isTeleport);
        });
        gameObject.traits.filter(NotifyTileChange).forEach((trait: any) => {
            trait[NotifyTileChange.onTileChange](gameObject, gameState, oldTile, isTeleport);
        });

        gameState.events.dispatch(new EnterTileEvent(gameObject.tile, gameObject));
    }

    handleElevationChange(oldElevation: number, gameState: GameState): void {
        (gameState.traits as any).filter(NotifyElevationChange).forEach((trait: any) => {
            trait[NotifyElevationChange.onElevationChange](this.gameObject, gameState, oldElevation);
        });
    }

    unreservePathNodes(): void {
        this.reservedPathNodes.forEach((node) => {
            if (node.tile !== this.gameObject.tile) {
                this.tileOccupation.unoccupySingleTile(node.tile, this.gameObject);
            }
        });
        this.reservedPathNodes.length = 0;
    }

    dispose(): void {
        this.gameObject = undefined as any;
    }
}
