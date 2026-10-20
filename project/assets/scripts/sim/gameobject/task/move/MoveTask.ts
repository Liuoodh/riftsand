/**
 * Port of redalert2/src/game/gameobject/task/move/MoveTask.ts (1,037 lines).
 *
 * This is the *whole* collision and movement system. There is no shoving, no
 * separation pass, no steering force: a moving unit looks at its own path each
 * tick and decides, in this order, what to do about whatever is in the way.
 *
 *   ── per tick, state machine ────────────────────────────────────────────────
 *   ReachedNextWaypoint  pop the waypoint we just reached, then either finish
 *                        (canStopAtTile) or pick the next one from the locomotor
 *   PlanMove             walk the remaining path *backwards from the waypoint*
 *                        and classify every obstacle (see below); may re-plan,
 *                        wait, push, or bail
 *   Moving               hand control to the locomotor, apply the returned
 *                        delta, and handle tile/elevation/teleport bookkeeping
 *
 *   ── obstacle cascade inside PlanMove (the order matters) ───────────────────
 *   1. bridge destroyed / wrong layer      → re-plan
 *   2. terrain not passable any more       → re-plan (or `CloseEnough` on the
 *                                            designated `stopOnBlocker`)
 *   3. crate spawning a unit on the path    → pick it up, re-plan
 *   4. static obstacle                      → re-plan
 *   5. crushable, and we are a crusher      → ignore (drive over it)
 *   6. terrain obstacle (tree/rock)         → infantry: shift sub-cell; else throw
 *   7. unit blocker:
 *        a. it is moving faster, same heading, and we are one node away
 *                                          → `break` (follow it, do not stall)
 *        b. it is a building / idle / mid-collision
 *             → wait, push, or find an alternate path; may attack it
 *        c. infantry vs infantry           → shift sub-cell
 *        d. we are not moving              → keep returning false (stall)
 *        e. head-on (180°)                 → full stop, `Waiting`
 *        f. same heading, it is slower     → back off up to 5 nodes
 *        g. otherwise                      → full stop, `Waiting`
 *
 * Everything that used to make this project feel "off" — units being nudged,
 * hulls grinding, tanks turning on the spot — came from adding geometry on top
 * of this. The geometry is gone; the cascade is the behaviour.
 *
 * Two cooldowns keep it from spinning:
 *   - `inPlanningForTicks > MAX_PLANNING_TICKS (200)` → re-plan with
 *     `allObstaclesAreBlockers`, which stops the pathfinder from routing around
 *     anything and forces a real decision;
 *   - `unreachableTargets` remembers failed destinations (max 5) so it does not
 *     try the same dead end forever.
 *
 * `path` is ordered **goal first, current cell last**, which is why arrival does
 * `splice(index)` (drop the tail) and the lookahead does `.reverse()`.
 */
import { Task } from '../system/Task';
import { TaskStatus } from '../system/TaskStatus';
import { WaitTicksTask } from '../system/WaitTicksTask';
import { MoveAsideTask } from './MoveAsideTask';
import { Infantry } from '../../Infantry';
import { MovementZone } from '../../../type/MovementZone';
import { findIndexReverse, findReverse } from '../../../util/array';
import { SpeedType } from '../../../type/SpeedType';
import { CollisionState, MoveResult, MoveState, MoveTrait } from '../../trait/MoveTrait';
import { MovePositionHelper } from '../../unit/MovePositionHelper';
import { RadialTileFinder } from '../../../map/tileFinder/RadialTileFinder';
import { RangeHelper } from '../../unit/RangeHelper';
import { Coords } from '../../../Coords';
import { getZoneType, ZoneType } from '../../unit/ZoneType';
import { LocomotorFactory } from '../../locomotor/LocomotorFactory';
import { RandomTileFinder } from '../../../map/tileFinder/RandomTileFinder';
import { ObjectTeleportEvent } from '../../../event/ObjectTeleportEvent';
import { NotifyTeleport } from '../../trait/interface/NotifyTeleport';
import { PowerupType } from '../../../type/PowerupType';
import { ScatterTask } from '../ScatterTask';
import { VeteranAbility } from '../../unit/VeteranAbility';
import { Vector2 } from '../../../math/Vector2';
import { Target } from '../../../Target';
import { AppLogger } from '../../../util/logger';
import type { Tile } from '../../../map/TileCollection';

const VELOCITY_FACTOR = 1.5;
const MAX_PLANNING_TICKS = 200;
const WAIT_TICKS = 40;
const MAX_UNREACHABLE_TARGETS = 5;

export interface MoveOptions {
    targetOffset?: Vector2;
    allowOutOfBoundsTarget?: boolean;
    forceMove?: boolean;
    strictCloseEnough?: boolean;
    closeEnoughTiles?: number;
    ignoredBlockers?: any[];
    pathFinderIgnoredBlockers?: any[];
    maxExpandedPathNodes?: number;
    stopOnBlocker?: any;
    forceWaitOnPathBlocked?: boolean;
}

interface PathNode {
    tile: Tile;
    onBridge?: any;
}

interface BlockedPathNode {
    node: PathNode;
    obj: any;
}

interface GroundPathPlan {
    path: PathNode[];
    ignoredBlockers: any[];
    blockedPathNodes: BlockedPathNode[];
}

interface TargetLinesConfig {
    pathNodes: PathNode[];
    isRecalc?: boolean;
}

interface UnreachableTarget {
    tile: Tile;
    toBridge: boolean;
}

export class MoveTask extends Task {
    protected game: any;
    protected targetTile: Tile;
    protected toBridge: boolean;
    protected options?: MoveOptions;
    public preventOpportunityFire = false;

    private logger: any;
    private destinationLeptons: Vector2;
    private currentWaypointLeptons: Vector2;
    private needsPathUpdate = false;
    private targetChangeRequested = false;
    private allObstaclesAreBlockers = false;
    private blockedPathNodes: BlockedPathNode[] = [];
    private unreachableTargets: UnreachableTarget[] = [];
    private pushTried = false;
    private cancelProcessed = false;
    private cancelRepositionPending = false;
    private targetLinesConfig: TargetLinesConfig;
    private path?: PathNode[];
    private groundPathPlan?: GroundPathPlan;
    private targetOffset?: Vector2;
    private inPlanningForTicks?: number;

    constructor(game: any, targetTile: Tile, toBridge: boolean, options?: MoveOptions) {
        super();
        this.game = game;
        this.targetTile = targetTile;
        this.toBridge = toBridge;
        this.options = options;
        this.logger = AppLogger.get('move');
        this.destinationLeptons = new Vector2();
        this.currentWaypointLeptons = new Vector2();
        this.targetLinesConfig = { pathNodes: [] };
    }

    duplicate(): MoveTask {
        return new MoveTask(this.game, this.targetTile, this.toBridge, this.options);
    }

    setForceMove(force: boolean): void {
        if (force) {
            this.options ??= {};
            this.options.forceMove = true;
        } else if (this.options?.forceMove) {
            this.options.forceMove = undefined;
        }
    }

    onStart(unit: any): void {
        if (unit.moveTrait.currentWaypoint) {
            throw new Error('Nested move tasks are not supported');
        }
        if (unit.moveTrait.locomotor === undefined) {
            unit.moveTrait.locomotor = new LocomotorFactory(this.game).create(unit);
        }
        this.ensureGroundLayerUnderBridge(unit);
        if (unit.moveTrait.lastTargetOffset) {
            this.targetOffset = unit.moveTrait.lastTargetOffset;
        } else {
            this.targetOffset = this.computeTargetOffset(unit);
        }
        /*
         * Carry the velocity over from the previous task. Without this, a unit
         * that finishes one move order and immediately starts the next comes to
         * a dead stop for one tick — the "hesitation" at every waypoint chain.
         */
        if (unit.moveTrait.lastVelocity) {
            unit.moveTrait.velocity = unit.moveTrait.lastVelocity;
        }

        if (!this.path) {
            if (this.groundPathPlan) {
                if (this.groundPathPlan.path[this.groundPathPlan.path.length - 1].tile === unit.tile) {
                    this.path = this.applyGroundPathPlan(this.groundPathPlan);
                } else {
                    this.computePath(unit, unit.moveTrait.locomotor);
                }
                this.groundPathPlan = undefined;
            } else {
                this.computePath(unit, unit.moveTrait.locomotor);
            }
            this.targetLinesConfig.isRecalc = false;
        }

        this.updateDestination(this.path!, this.targetOffset!);
        unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
        unit.moveTrait.lastMoveResult = undefined;
        unit.moveTrait.lastTargetOffset = undefined;
        unit.moveTrait.lastVelocity = undefined;
    }

    private computeTargetOffset(unit: any): Vector2 {
        return (
            this.options?.targetOffset ??
            (unit.isInfantry() ? unit.position.getTileOffset() : unit.position.computeSubCellOffset(0))
        );
    }

    private computePath(unit: any, locomotor: any): void {
        let path: PathNode[];
        if (!this.options?.allowOutOfBoundsTarget && !this.game.map.mapBounds.isWithinBounds(this.targetTile)) {
            path = [];
        } else if (unit.rules.movementZone === MovementZone.Fly) {
            path = this.computeAirPath(unit);
        } else if (locomotor.ignoresTerrain) {
            path = this.computeDirectJumpPath(unit);
        } else {
            const plan = this.computeGroundPath(unit);
            path = this.applyGroundPathPlan(plan);
        }

        /*
         * Aircraft paths are stored reversed (target first) but their `onBridge`
         * flag is meaningless — they fly over bridges. The reference overwrites
         * node 0's flag with the *target* bridge so the target-lines renderer
         * draws the line at the right height.
         */
        if (unit.rules.movementZone === MovementZone.Fly) {
            this.targetLinesConfig.pathNodes = path.map(({ tile, onBridge }) => ({ tile, onBridge }));
            if (path.length) {
                this.targetLinesConfig.pathNodes[0].onBridge = this.toBridge
                    ? this.game.map.tileOccupation.getBridgeOnTile(this.targetTile)
                    : undefined;
            }
        } else {
            this.targetLinesConfig.pathNodes = path;
        }
        this.path = path;
    }

    private computeAirPath(unit: any): PathNode[] {
        return [
            { tile: this.targetTile, onBridge: undefined },
            { tile: unit.tile, onBridge: undefined },
        ];
    }

    private computeDirectJumpPath(unit: any): PathNode[] {
        const map = this.game.map;
        const canUseBridgeLayer = !Target.usesGroundLayerUnderBridge(unit);
        const unitBridge =
            canUseBridgeLayer && unit.onBridge ? map.tileOccupation.getBridgeOnTile(unit.tile) : undefined;
        let targetTile = this.targetTile;
        let targetBridge =
            canUseBridgeLayer && this.toBridge ? map.tileOccupation.getBridgeOnTile(this.targetTile) : undefined;
        const ignoredBlockers = this.options?.ignoredBlockers;

        /*
         * Chrono/jump units cannot path, so they look for the nearest cell that
         * is actually landable (radius 5) and jump there instead. That is why a
         * chrono legionnaire teleporting onto a cliff lands *next to* it.
         */
        const finder = new RadialTileFinder(
            map.tiles,
            map.mapBounds,
            targetTile,
            { width: 1, height: 1 },
            0,
            5,
            (tile: any) => {
                const bridge = canUseBridgeLayer ? map.tileOccupation.getBridgeOnTile(tile) : undefined;
                return (
                    map.terrain.getPassableSpeed(tile, unit.rules.speedType, unit.isInfantry(), !!bridge, ignoredBlockers) >
                        0 &&
                    !map.terrain
                        .findObstacles({ tile, onBridge: bridge }, unit)
                        .find((obstacle: any) => !ignoredBlockers?.includes(obstacle.obj))
                );
            },
        );
        const newTile = finder.getNextTile();
        if (!newTile) {
            return [];
        }
        if (newTile !== targetTile) {
            targetTile = newTile;
            targetBridge = canUseBridgeLayer ? map.tileOccupation.getBridgeOnTile(targetTile) : undefined;
        }
        return [
            { tile: targetTile, onBridge: targetBridge },
            { tile: unit.tile, onBridge: unitBridge },
        ];
    }

    private computeGroundPath(unit: any): GroundPathPlan {
        const forceGroundLayer = Target.usesGroundLayerUnderBridge(unit);
        let startTile = unit.tile;
        let startBridge =
            !forceGroundLayer && unit.onBridge ? this.game.map.tileOccupation.getBridgeOnTile(startTile) : undefined;

        /*
         * Mid-move re-plans start from the *waypoint*, not from the unit's cell.
         * Starting from the cell would make the new path begin behind the unit
         * and it would turn around for one frame.
         */
        if (unit.moveTrait.moveState === MoveState.Moving && unit.moveTrait.currentWaypoint) {
            startTile = unit.moveTrait.currentWaypoint.tile;
            startBridge = forceGroundLayer ? undefined : unit.moveTrait.currentWaypoint.onBridge;
        }

        const plan: GroundPathPlan = {
            path: [],
            ignoredBlockers: [],
            blockedPathNodes: [],
        };

        /*
         * A unit standing *inside* a building footprint (just exited a factory,
         * or a docked harvester) cannot path out: its own cell is impassable.
         * The building is temporarily ignored, and its non-dock cells are
         * recorded as blocked so the path does not cut through the rest of it.
         */
        const startBuilding = this.game.map.getObjectsOnTile(startTile).find((obj: any) => obj.isBuilding());
        if (
            startBuilding &&
            !this.game.map.terrain.getPassableSpeed(startTile, unit.rules.speedType, unit.isInfantry(), false)
        ) {
            const isIgnored = this.options?.ignoredBlockers?.includes(startBuilding);
            if (!isIgnored) {
                plan.ignoredBlockers.push(startBuilding);
            }
            if (!isIgnored && startBuilding.dockTrait) {
                const dockTiles = new Set(startBuilding.dockTrait?.getAllDockTiles());
                const buildingTiles = this.game.map.tileOccupation.calculateTilesForGameObject(
                    startBuilding.tile,
                    startBuilding,
                );
                buildingTiles
                    .filter((tile: any) => !dockTiles.has(tile))
                    .forEach((tile: any) =>
                        plan.blockedPathNodes.push({
                            node: { tile, onBridge: undefined },
                            obj: startBuilding,
                        }),
                    );
            }
        }

        /*
         * A disguised unit looks like terrain. You are not allowed to path onto
         * it — that would make the disguise obvious to the player who ordered
         * the move.
         */
        const disguisedUnit = this.game.map
            .getGroundObjectsOnTile(this.targetTile)
            .find(
                (obj: any) =>
                    (obj.isInfantry() || obj.isVehicle()) &&
                    obj.disguiseTrait?.hasTerrainDisguise() &&
                    !(
                        this.game.alliances.haveSharedIntel(unit.owner, obj.owner) ||
                        obj.owner.sharedDetectDisguiseTrait?.has(unit)
                    ),
            );
        if (disguisedUnit) {
            const bridge = this.toBridge ? this.game.map.tileOccupation.getBridgeOnTile(this.targetTile) : undefined;
            plan.blockedPathNodes.push({
                node: { tile: this.targetTile, onBridge: bridge },
                obj: disguisedUnit,
            });
        }

        const allIgnoredBlockers = [
            ...new Set([
                ...(this.options?.ignoredBlockers ?? []),
                ...(this.options?.pathFinderIgnoredBlockers ?? []),
                ...plan.ignoredBlockers,
            ]),
        ];
        const allBlockedNodes = [...this.blockedPathNodes, ...plan.blockedPathNodes];
        const hasExcludedNodes = forceGroundLayer || this.allObstaclesAreBlockers || !!allBlockedNodes.length;

        const path = this.game.map.terrain.computePath(
            unit.rules.speedType,
            unit.isInfantry(),
            startTile,
            !!startBridge,
            this.targetTile,
            forceGroundLayer ? false : this.toBridge,
            {
                /*
                 * When every obstacle is a blocker the node budget is clamped:
                 * an exhaustive search over a fully-blocked map can expand
                 * thousands of nodes for a result that is always "no path".
                 */
                maxExpandedNodes: this.allObstaclesAreBlockers
                    ? Math.min(300, this.options?.maxExpandedPathNodes ?? Number.POSITIVE_INFINITY)
                    : this.options?.maxExpandedPathNodes,
                bestEffort: !this.options?.strictCloseEnough,
                ignoredBlockers: allIgnoredBlockers,
                excludeTiles: hasExcludedNodes
                    ? (node: any) =>
                          (forceGroundLayer && !!node.onBridge) ||
                          ((this.allObstaclesAreBlockers || !!allBlockedNodes.length) &&
                              this.nodeIsBlockedForPathfinding(node, unit, allIgnoredBlockers, allBlockedNodes))
                    : undefined,
            },
        );
        plan.path = path;
        return plan;
    }

    private ensureGroundLayerUnderBridge(unit: any): void {
        if (!Target.usesGroundLayerUnderBridge(unit) || !unit.onBridge) {
            return;
        }
        unit.onBridge = false;
        unit.position.tileElevation = 0;
        unit.zone = getZoneType(unit.tile.landType);
    }

    private nodeIsBlockedForPathfinding(
        node: PathNode,
        unit: any,
        ignoredBlockers: any[],
        blockedNodes: BlockedPathNode[],
    ): boolean {
        if (this.allObstaclesAreBlockers) {
            return !!this.game.map.terrain
                .findObstacles(node, unit)
                .find((obstacle: any) => !ignoredBlockers?.includes(obstacle.obj));
        }
        return !!blockedNodes.find(
            ({ node: blockedNode }) => blockedNode.tile === node.tile && blockedNode.onBridge === node.onBridge,
        );
    }

    private applyGroundPathPlan(plan: GroundPathPlan): PathNode[] {
        /*
         * Drop memoised blocked nodes whose object has died or moved away. This
         * is the *only* cleanup: a blocker that merely drove off is re-tested by
         * `terrain.findObstacles` anyway, so this exists purely to keep the memo
         * from growing without bound.
         */
        this.blockedPathNodes = this.blockedPathNodes.filter(
            (blocked) => blocked.obj.isSpawned && blocked.node.tile === blocked.obj.tile,
        );
        if (plan.ignoredBlockers.length) {
            this.options ??= {};
            this.options.ignoredBlockers ??= [];
            this.options.ignoredBlockers.push(...plan.ignoredBlockers);
        }
        this.blockedPathNodes.push(...plan.blockedPathNodes);
        return plan.path;
    }

    private updateDestination(path: PathNode[], offset: Vector2): void {
        const tile = path.length ? path[0].tile : this.targetTile;
        this.destinationLeptons
            .set(tile.rx * Coords.LEPTONS_PER_TILE, tile.ry * Coords.LEPTONS_PER_TILE)
            .add(offset);
    }

    protected canStopAtTile(unit: any, tile: Tile, onBridge: boolean): boolean {
        if (unit.zone === ZoneType.Air) {
            /*
             * Air units may only stop where they can land, unless they are
             * balloons/siege choppers holding station (`balloonHover` without
             * `hoverAttack`), which are allowed to sit over anything.
             */
            if (
                (!unit.isAircraft() || !unit.airportBoundTrait) &&
                !unit.rules.spawned &&
                (!this.options?.forceMove || !unit.rules.balloonHover || unit.rules.hoverAttack) &&
                (!this.game.map.terrain.getPassableSpeed(tile, SpeedType.Amphibious, false, onBridge) ||
                    this.game.map
                        .getObjectsOnTile(tile)
                        .filter(
                            (obj: any) =>
                                (obj.isBuilding() &&
                                    !obj.isDestroyed &&
                                    !obj.dockTrait?.hasReservedDockForUnit(unit) &&
                                    !unit.rules.dock.includes(obj.name)) ||
                                (obj.isUnit() &&
                                    obj.tile === tile &&
                                    obj.moveTrait.moveState !== MoveState.Moving &&
                                    obj !== unit),
                        ).length)
            ) {
                return false;
            }
        } else if (unit.isInfantry()) {
            /*
             * Three men per cell, and no two on the same sub-cell. Note the
             * `> 2`, not `>= 2`: two infantry in a cell is legal, three is full.
             */
            const infantryOnTile = this.game.map
                .getGroundObjectsOnTile(tile)
                .filter(
                    (obj: any) =>
                        obj.isInfantry() &&
                        obj.tile === tile &&
                        obj.onBridge === onBridge &&
                        obj.moveTrait.moveState !== MoveState.Moving &&
                        obj !== unit,
                );
            if (
                infantryOnTile.length > 2 ||
                infantryOnTile.find((inf: any) => inf.position.subCell === unit.position.subCell)
            ) {
                return false;
            }
        }

        if (
            unit.zone !== ZoneType.Air &&
            unit.rules.tooBigToFitUnderBridge &&
            !onBridge &&
            tile.onBridgeLandType &&
            this.game.map.tileOccupation.getBridgeOnTile(tile)?.isHighBridge()
        ) {
            return false;
        }

        if (
            !this.isCancelling() &&
            this.options?.strictCloseEnough &&
            this.options?.closeEnoughTiles !== undefined &&
            !this.isCloseEnoughToDest(unit, tile, this.options.closeEnoughTiles)
        ) {
            return false;
        }
        return true;
    }

    protected isCloseEnoughToDest(unit: any, tile: Tile, maxDistance?: number): boolean {
        if (maxDistance === undefined) {
            return true;
        }
        const rangeHelper = new RangeHelper(this.game.map.tileOccupation);
        return rangeHelper.tileDistance(this.targetTile, tile) <= maxDistance;
    }

    protected hasReachedDestination(unit: any): boolean {
        return !this.path!.length;
    }

    updateTarget(tile: Tile, toBridge: boolean): void {
        this.targetTile = tile;
        this.toBridge = toBridge;
        this.needsPathUpdate = true;
        this.targetChangeRequested = true;
    }

    onEnd(unit: any): void {
        unit.moveTrait.collisionState = CollisionState.Resolved;
        unit.moveTrait.currentWaypoint = undefined;
        /*
         * Only persist the offset if it differs from the default. A memory of
         * "sub-cell 0" for an infantryman is not the same as "no preference":
         * the old sub-cell is what lets a squad walk back into the same slots.
         */
        if (!this.targetOffset!.equals(this.computeTargetOffset(unit))) {
            unit.moveTrait.lastTargetOffset = this.targetOffset;
        }
    }

    forceCancel(unit: any): boolean {
        if (!this.cancellable || this.children.some((child: any) => !child.cancellable)) {
            return false;
        }
        if (!this.options?.allowOutOfBoundsTarget && !this.game.map.isWithinBounds(unit.tile)) {
            return false;
        }
        if (this.status === TaskStatus.Running || this.status === TaskStatus.Cancelling) {
            unit.moveTrait.unreservePathNodes();
            unit.moveTrait.lastMoveResult = MoveResult.Cancel;
            this.onEnd(unit);
            unit.moveTrait.lastTargetOffset = this.targetOffset;
            unit.moveTrait.lastVelocity = unit.moveTrait.velocity.clone();
        }
        this.status = TaskStatus.Cancelled;
        return true;
    }

    onTick(unit: any): boolean {
        if (unit.moveTrait.isDisabled() && unit.moveTrait.moveState === MoveState.ReachedNextWaypoint) {
            if (this.isCancelling()) {
                unit.moveTrait.lastMoveResult = MoveResult.Cancel;
                return true;
            }
            return false;
        }

        if (this.needsPathUpdate) {
            this.ensureGroundLayerUnderBridge(unit);
            /*
             * Re-planning while the locomotor was mid-plan leaves it holding a
             * waypoint that no longer exists; unwind it first.
             */
            if (unit.moveTrait.moveState === MoveState.PlanMove) {
                this.inPlanningForTicks = undefined;
                unit.moveTrait.currentWaypoint = undefined;
                unit.moveTrait.collisionState = CollisionState.Resolved;
                unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                unit.moveTrait.velocity.set(0, 0, 0);
            }
            this.computePath(unit, unit.moveTrait.locomotor);
            if (!this.path!.length) {
                this.unreachableTargets.push({
                    tile: this.targetTile,
                    toBridge: this.toBridge,
                });
            }
            this.updateDestination(this.path!, this.targetOffset!);
            this.targetLinesConfig.isRecalc = !this.targetChangeRequested;
            this.targetChangeRequested = false;
            this.needsPathUpdate = false;
            this.allObstaclesAreBlockers = false;
        }

        const map = this.game.map;

        if (unit.moveTrait.moveState === MoveState.ReachedNextWaypoint) {
            unit.moveTrait.unreservePathNodes();
            const waypointIndex = this.path!.findIndex((node) => node === unit.moveTrait.currentWaypoint);
            if (waypointIndex !== -1) {
                this.path!.splice(waypointIndex);
            } else {
                this.path!.pop();
            }
            unit.moveTrait.currentWaypoint = undefined;

            if (this.isCancelling() ? !this.cancelProcessed : this.hasReachedDestination(unit)) {
                const notCloseEnough =
                    !this.isCancelling() && !this.isCloseEnoughToDest(unit, unit.tile, this.options?.closeEnoughTiles);

                if (!notCloseEnough && this.canStopAtTile(unit, unit.tile, unit.onBridge)) {
                    unit.moveTrait.lastMoveResult = this.isCancelling() ? MoveResult.Cancel : MoveResult.Success;
                    return true;
                }

                if (this.unreachableTargets.length > MAX_UNREACHABLE_TARGETS) {
                    unit.moveTrait.lastMoveResult = MoveResult.Fail;
                    this.log(unit, 'bail_max_unreachable_dest');
                    return true;
                }

                /*
                 * The destination cell is full (or we are not close enough).
                 * Look for a cell we *can* stand on: our own first, the intended
                 * destination only if we still owe distance.
                 */
                let relocTile = unit.tile;
                let relocBridge =
                    !Target.usesGroundLayerUnderBridge(unit) && unit.onBridge
                        ? map.tileOccupation.getBridgeOnTile(relocTile)
                        : undefined;
                if (notCloseEnough) {
                    relocTile = this.targetTile;
                    relocBridge =
                        !Target.usesGroundLayerUnderBridge(unit) && this.toBridge
                            ? map.tileOccupation.getBridgeOnTile(relocTile)
                            : undefined;
                }

                const newTile = this.findRelocationTile(relocTile, relocBridge, unit);
                if (!newTile) {
                    unit.moveTrait.lastMoveResult = notCloseEnough ? MoveResult.Fail : MoveResult.CloseEnough;
                    this.log(unit, 'bail_no_free_dest');
                    return true;
                }

                const newBridge =
                    !Target.usesGroundLayerUnderBridge(unit) && (!relocBridge || relocBridge.isHighBridge())
                        ? map.tileOccupation.getBridgeOnTile(newTile)
                        : undefined;
                this.updateTarget(newTile, !!newBridge);
                if (this.isCancelling()) {
                    this.cancelProcessed = true;
                    this.cancelRepositionPending = true;
                }
                return false;
            }

            /*
             * A cancelled unit gets one reposition step: it walks off the cell
             * it is blocking, then stops. `cancelProcessed` guards the second
             * pass so it does not reposition forever.
             */
            if (this.cancelProcessed && !this.path!.length) {
                unit.moveTrait.lastMoveResult = MoveResult.Cancel;
                return true;
            }
            this.cancelProcessed = false;

            unit.moveTrait.moveState = MoveState.PlanMove;
            const locomotor = unit.moveTrait.locomotor;
            unit.moveTrait.currentWaypoint = locomotor.selectNextWaypoint
                ? locomotor.selectNextWaypoint(unit, this.path!)
                : this.path![this.path!.length - 1];

            this.currentWaypointLeptons
                .set(unit.moveTrait.currentWaypoint.tile.rx, unit.moveTrait.currentWaypoint.tile.ry)
                .multiplyScalar(Coords.LEPTONS_PER_TILE)
                .add(this.targetOffset!);

            const newWaypointTasks = locomotor.onNewWaypoint(
                unit,
                this.currentWaypointLeptons,
                this.destinationLeptons,
            );
            if (newWaypointTasks) {
                this.children.push(...newWaypointTasks);
                return false;
            }
        }

        if (unit.moveTrait.moveState === MoveState.PlanMove) {
            if (this.isCancelling() && !this.cancelRepositionPending) {
                unit.moveTrait.currentWaypoint = undefined;
                unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                return this.onTick(unit);
            }

            this.inPlanningForTicks = this.inPlanningForTicks === undefined ? 0 : this.inPlanningForTicks + 1;
            if (this.inPlanningForTicks > MAX_PLANNING_TICKS) {
                this.needsPathUpdate = true;
                this.allObstaclesAreBlockers = true;
                unit.moveTrait.velocity.set(0, 0, 0);
                this.log(unit, 'repath_plan_timeout');
                return false;
            }

            /*
             * The scan below only makes sense for ground movers. `pathToCheck`
             * runs from the current waypoint back to the goal (the path is
             * goal-first, so the slice is reversed to go "ahead of us" first).
             */
            if (unit.rules.movementZone !== MovementZone.Fly && !unit.moveTrait.locomotor.ignoresTerrain) {
                const pathToCheck = this.path!
                    .slice(this.path!.indexOf(unit.moveTrait.currentWaypoint!))
                    .reverse();
                const currentVelocity = unit.moveTrait.velocity.length();

                for (const node of pathToCheck) {
                    if (node.onBridge?.isDestroyed) {
                        node.onBridge = undefined;
                    }
                    if (Target.usesGroundLayerUnderBridge(unit) && node.onBridge) {
                        this.needsPathUpdate = true;
                        unit.moveTrait.currentWaypoint = undefined;
                        unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                        return this.onTick(unit);
                    }
                }

                for (const node of pathToCheck) {
                    if (
                        !map.terrain.getPassableSpeed(
                            node.tile,
                            unit.rules.speedType,
                            unit.isInfantry(),
                            !!node.onBridge,
                            this.options?.ignoredBlockers,
                        )
                    ) {
                        if (
                            this.options?.stopOnBlocker &&
                            map.terrain
                                .findObstacles(node, unit)
                                .some((obstacle: any) => obstacle.obj === this.options.stopOnBlocker)
                        ) {
                            unit.moveTrait.lastMoveResult = MoveResult.CloseEnough;
                            return true;
                        }
                        this.needsPathUpdate = true;
                        unit.moveTrait.currentWaypoint = undefined;
                        unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                        return this.onTick(unit);
                    }

                    if (!node.onBridge) {
                        const crate = map
                            .getGroundObjectsOnTile(node.tile)
                            .find((obj: any) => obj.isOverlay() && obj.rules.crate);
                        if (crate) {
                            if (this.game.crateGeneratorTrait.peekInsideCrate(crate) === PowerupType.Unit) {
                                this.game.crateGeneratorTrait.pickupCrate(unit, crate, this.game);
                                /*
                                 * A "unit" crate spawns a free soldier on the
                                 * cell we were about to drive through. It now
                                 * blocks the path, so memoise it and re-plan —
                                 * otherwise the tank drives through the new
                                 * unit and the two interpenetrate.
                                 */
                                const spawnedUnit = this.game.map
                                    .getGroundObjectsOnTile(node.tile)
                                    .find((obj: any) => obj.isUnit() && !obj.onBridge);
                                if (spawnedUnit) {
                                    this.needsPathUpdate = true;
                                    this.blockedPathNodes.push({ node, obj: spawnedUnit });
                                    unit.moveTrait.currentWaypoint = undefined;
                                    unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                                    return this.onTick(unit);
                                }
                            }
                        }
                    }

                    const obstacles = map.terrain
                        .findObstacles(node, unit)
                        .filter((obstacle: any) => !this.options?.ignoredBlockers?.includes(obstacle.obj));

                    for (const obstacle of obstacles) {
                        if (obstacle.static) {
                            this.needsPathUpdate = true;
                            unit.moveTrait.currentWaypoint = undefined;
                            unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                            return this.onTick(unit);
                        }

                        if (obstacle.obj.rules.crushable) {
                            /*
                             * Tracks and hovercraft *can* crush, but only when
                             * the driver asked for it (`crusher`) and the victim
                             * is not friendly. Anything else drives around.
                             */
                            if (
                                [SpeedType.Track, SpeedType.Hover].includes(unit.rules.speedType) &&
                                unit.crusher &&
                                (!obstacle.obj.isTechno() || !this.game.areFriendly(obstacle.obj, unit))
                            ) {
                                continue;
                            }
                            if (!obstacle.obj.isTechno()) {
                                this.needsPathUpdate = true;
                                unit.moveTrait.currentWaypoint = undefined;
                                unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                                return this.onTick(unit);
                            }
                        }

                        if (obstacle.obj.isTerrain()) {
                            /*
                             * A tree in a cell does not block infantry — it
                             * blocks *sub-cells*. Retail gives the infantryman a
                             * free sub-cell instead of stopping him, which is why
                             * squads filter through woods without orders.
                             */
                            if (!unit.isInfantry()) {
                                throw new Error(`Obstacle ${obstacle.obj.name} should be a blocker for non infantry`);
                            }
                            const freeSubCell = this.findFreeSubCell(unit, node);
                            if (freeSubCell !== undefined) {
                                this.relocateToSubCell(unit, freeSubCell);
                            } else {
                                this.needsPathUpdate = true;
                                this.blockedPathNodes.push({ node, obj: obstacle.obj });
                                unit.moveTrait.currentWaypoint = undefined;
                                unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                            }
                            return this.onTick(unit);
                        }

                        if (!obstacle.obj.isTechno()) {
                            throw new Error('Unexpected obstacle of type ' + obstacle.obj.type);
                        }

                        const blocker = obstacle.obj;
                        const blockerVelocity = blocker.isUnit() ? blocker.moveTrait.velocity.length() : 0;

                        /*
                         * A docked aircraft is not in the way: it is parked on
                         * its pad, and the pad is already an ignored blocker.
                         */
                        if (
                            blocker.isAircraft() &&
                            blocker.zone === ZoneType.Ground &&
                            this.options?.ignoredBlockers?.some(
                                (ignored: any) => ignored.isBuilding() && ignored.dockTrait?.isDocked(blocker),
                            )
                        ) {
                            continue;
                        }

                        /*
                         * "Do not brake for someone slower going the same way."
                         * This is the single rule that makes convoys flow: a tank
                         * behind another tank at the same heading with the same
                         * or lower speed keeps rolling instead of stopping.
                         */
                        if (
                            pathToCheck.length === 1 &&
                            blocker.isUnit() &&
                            blockerVelocity &&
                            currentVelocity &&
                            currentVelocity <= blockerVelocity &&
                            unit.direction === blocker.direction &&
                            blocker.tile === node.tile &&
                            blocker.moveTrait.currentWaypoint?.tile !== node.tile
                        ) {
                            break;
                        }

                        if (
                            blocker.isBuilding() ||
                            blocker.moveTrait.moveState === MoveState.Idle ||
                            blocker.moveTrait.collisionState !== CollisionState.Resolved
                        ) {
                            /*
                             * Two units that have both stopped dead and are both
                             * unresolved are in a deadlock. Waiting is right, but
                             * only for so long — after MAX_PLANNING_TICKS the
                             * pathfinder is forced to treat every obstacle as a
                             * blocker and find a way around.
                             */
                            if (
                                !currentVelocity &&
                                unit.moveTrait.collisionState !== CollisionState.Resolved &&
                                blocker.isUnit() &&
                                blocker.moveTrait.collisionState !== CollisionState.Resolved
                            ) {
                                if (this.inPlanningForTicks! + 1 > MAX_PLANNING_TICKS) {
                                    this.needsPathUpdate = true;
                                    this.allObstaclesAreBlockers = true;
                                    this.log(unit, 'repath_waited_too_long_blocker ' + blocker.id);
                                    unit.moveTrait.velocity.set(0, 0, 0);
                                }
                                return false;
                            }

                            if (
                                blocker.isInfantry() &&
                                unit.isInfantry() &&
                                blocker.moveTrait.collisionState === CollisionState.Resolved
                            ) {
                                const freeSubCell = this.findFreeSubCell(unit, node);
                                if (freeSubCell !== undefined) {
                                    this.relocateToSubCell(unit, freeSubCell);
                                    return this.onTick(unit);
                                }
                            }

                            const freeWaypointIndex = findIndexReverse(
                                this.path!.slice(0, this.path!.indexOf(node)),
                                (waypoint: any) =>
                                    !map.terrain
                                        .findObstacles(waypoint, unit)
                                        .filter((obstacle: any) => !this.options?.ignoredBlockers?.includes(obstacle.obj))
                                        .length,
                            );

                            if (freeWaypointIndex === -1) {
                                if (
                                    this.canStopAtTile(unit, unit.tile, unit.onBridge) &&
                                    this.isCloseEnoughToDest(unit, unit.tile, this.options?.closeEnoughTiles)
                                ) {
                                    unit.moveTrait.lastMoveResult = MoveResult.CloseEnough;
                                    this.log(unit, 'bail_waypoints_blocked_close_enough');
                                    return true;
                                }
                                /*
                                 * Already adjacent to the goal (within one cell on
                                 * both axes) or explicitly allowed to stop on the
                                 * neighbouring cell → do not thrash the pathfinder,
                                 * just give up on the exact cell.
                                 */
                                if (
                                    !(
                                        this.options?.closeEnoughTiles === 0 ||
                                        (Math.abs(unit.tile.rx - this.targetTile.rx) <= 1 &&
                                            Math.abs(unit.tile.ry - this.targetTile.ry) <= 1)
                                    )
                                ) {
                                    this.needsPathUpdate = true;
                                    this.blockedPathNodes.push(
                                        ...this.path!
                                            .slice(0, this.path!.indexOf(node) + 1)
                                            .map((waypoint) => ({
                                                node: waypoint,
                                                obj: map.terrain.findObstacles(waypoint, unit)[0].obj,
                                            })),
                                    );
                                    unit.moveTrait.velocity.set(0, 0, 0);
                                    this.log(unit, 'repath_waypoints_blocked_too_far');
                                    return false;
                                }
                            }

                            /*
                             * Try a short local detour around the blockage
                             * (15 nodes, no best-effort). Cheap and usually
                             * enough to slip past one parked unit.
                             */
                            let alternatePath: PathNode[] = [];
                            if (freeWaypointIndex !== -1) {
                                const targetWaypoint = this.path![freeWaypointIndex];
                                const forceGroundLayer = Target.usesGroundLayerUnderBridge(unit);
                                alternatePath = map.terrain.computePath(
                                    unit.rules.speedType,
                                    unit.isInfantry(),
                                    unit.tile,
                                    forceGroundLayer ? false : unit.onBridge,
                                    targetWaypoint.tile,
                                    forceGroundLayer ? false : !!targetWaypoint.onBridge,
                                    {
                                        maxExpandedNodes: 15,
                                        bestEffort: false,
                                        excludeTiles: (testNode: any) =>
                                            (forceGroundLayer && !!testNode.onBridge) ||
                                            !!map.terrain
                                                .findObstacles(testNode, unit)
                                                .filter(
                                                    (obstacle: any) =>
                                                        !this.options?.ignoredBlockers?.includes(obstacle.obj),
                                                ).length,
                                        ignoredBlockers: this.options?.ignoredBlockers,
                                    },
                                );
                            }

                            if (!alternatePath.length && blocker.owner === unit.owner && pathToCheck.length === 1) {
                                /* deliberately empty: fall through to the push logic below */
                            } else if (alternatePath.length) {
                                this.path!.splice(freeWaypointIndex, this.path!.length, ...alternatePath);
                                unit.moveTrait.currentWaypoint = undefined;
                                unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                                return this.onTick(unit);
                            } else {
                                /*
                                 * Last resort before waiting: shoot the thing in
                                 * the way. Only idle, enabled attackers do this,
                                 * and never with the death weapon, a parasite, or
                                 * a mind-control warhead — those would turn a
                                 * traffic jam into a diplomatic incident.
                                 */
                                const weapon = this.selectWeaponVsObstacle(unit, blocker);
                                if (weapon) {
                                    this.children.push(
                                        unit.attackTrait.createAttackTask(this.game, blocker, blocker.tile, weapon, {
                                            passive: true,
                                            holdGround: true,
                                        }),
                                    );
                                    unit.moveTrait.velocity.set(0, 0, 0);
                                } else if (this.options?.forceWaitOnPathBlocked) {
                                    this.children.push(new WaitTicksTask(WAIT_TICKS));
                                    this.inPlanningForTicks = 0;
                                    unit.moveTrait.velocity.set(0, 0, 0);
                                    unit.moveTrait.collisionState = CollisionState.Waiting;
                                } else {
                                    this.needsPathUpdate = true;
                                    this.blockedPathNodes.push({ node, obj: blocker });
                                    if (blocker.isBuilding()) {
                                        this.allObstaclesAreBlockers = true;
                                    }
                                    this.log(unit, 'repath_unavoidable_blocker ' + blocker.id);
                                    unit.moveTrait.velocity.set(0, 0, 0);
                                }
                                return false;
                            }

                            /*
                             * Push. The order of the guards is the escape hatch:
                             * a building, a unit that is already waiting, a unit
                             * that has orders of its own, or a missile-carrying
                             * aircraft are all un-pushable, so we wait instead.
                             * `pushTried` makes the push happen exactly once.
                             */
                            const blockerHasTasks = blocker.unitOrderTrait.hasTasks();
                            if (
                                this.pushTried ||
                                blocker.isBuilding() ||
                                blocker.moveTrait.collisionState === CollisionState.Waiting ||
                                blockerHasTasks ||
                                (blocker.isAircraft() && blocker.missileSpawnTrait)
                            ) {
                                if (
                                    !this.options?.forceWaitOnPathBlocked &&
                                    (blocker.isBuilding() ||
                                        (blockerHasTasks && blocker.moveTrait.moveState === MoveState.Idle) ||
                                        this.inPlanningForTicks! + WAIT_TICKS > MAX_PLANNING_TICKS)
                                ) {
                                    this.needsPathUpdate = true;
                                    this.allObstaclesAreBlockers = true;
                                    this.log(unit, 'repath_blocker_busy_wait_timeout ' + blocker.id);
                                    unit.moveTrait.velocity.set(0, 0, 0);
                                } else {
                                    this.children.push(new WaitTicksTask(WAIT_TICKS));
                                    if (this.options?.forceWaitOnPathBlocked) {
                                        this.inPlanningForTicks = 0;
                                    } else {
                                        this.inPlanningForTicks! += WAIT_TICKS;
                                    }
                                    unit.moveTrait.velocity.set(0, 0, 0);
                                    unit.moveTrait.collisionState = CollisionState.Waiting;
                                }
                                return false;
                            }

                            const pushDirection = new Vector2(
                                blocker.tile.rx - unit.tile.rx,
                                blocker.tile.ry - unit.tile.ry,
                            );
                            this.pushTried = true;
                            blocker.unitOrderTrait.addTask(new MoveAsideTask(this.game, pushDirection));
                            this.children.push(new WaitTicksTask(1));
                            unit.moveTrait.velocity.set(0, 0, 0);
                            unit.moveTrait.collisionState = CollisionState.Waiting;
                            this.log(unit, 'push ' + blocker.id);
                            return false;
                        }

                        if (blocker.isInfantry() && unit.isInfantry()) {
                            const freeSubCell = this.findFreeSubCell(unit, node);
                            if (freeSubCell !== undefined) {
                                this.relocateToSubCell(unit, freeSubCell);
                                return this.onTick(unit);
                            }
                        }

                        if (!currentVelocity) {
                            if (this.inPlanningForTicks! > WAIT_TICKS) {
                                unit.moveTrait.collisionState = CollisionState.Waiting;
                            }
                            return false;
                        }

                        /* Head-on: nobody yields, so stop and let the pusher work. */
                        if (Math.abs(unit.direction - blocker.direction) === 180) {
                            unit.moveTrait.velocity.set(0, 0, 0);
                            unit.moveTrait.collisionState = CollisionState.Waiting;
                            return false;
                        }

                        /*
                         * Same heading, we are closing on a slower unit. Instead
                         * of tailgating, back off to a cell at least 5 nodes
                         * behind the blockage and re-approach — this is what
                         * makes a queue of tanks settle into a line instead of
                         * bunching into one cell.
                         */
                        if (
                            Math.abs(unit.direction - blocker.direction) <= 45 &&
                            blockerVelocity * VELOCITY_FACTOR < currentVelocity
                        ) {
                            const nodeIndex = this.path!.indexOf(node);
                            if (nodeIndex >= 5) {
                                const backtrackIndex = findIndexReverse(
                                    this.path!.slice(0, nodeIndex - 5),
                                    (waypoint: any) => !map.terrain.findObstacles(waypoint, unit).length,
                                );
                                if (backtrackIndex !== -1) {
                                    const backtrackTarget = this.path![backtrackIndex];
                                    const forceGroundLayer = Target.usesGroundLayerUnderBridge(unit);
                                    const backtrackPath = map.terrain.computePath(
                                        unit.rules.speedType,
                                        unit.isInfantry(),
                                        unit.tile,
                                        forceGroundLayer ? false : unit.onBridge,
                                        backtrackTarget.tile,
                                        forceGroundLayer ? false : !!backtrackTarget.onBridge,
                                        {
                                            maxExpandedNodes: 15,
                                            bestEffort: false,
                                            excludeTiles: (testNode: any) =>
                                                (forceGroundLayer && !!testNode.onBridge) ||
                                                !!map.terrain.findObstacles(testNode, unit).length ||
                                                this.path!.findIndex(
                                                    (waypoint) =>
                                                        waypoint.tile === testNode.tile &&
                                                        waypoint.onBridge === testNode.onBridge,
                                                ) > backtrackIndex,
                                        },
                                    );
                                    if (backtrackPath.length) {
                                        this.path!.splice(backtrackIndex, this.path!.length, ...backtrackPath);
                                        unit.moveTrait.currentWaypoint = undefined;
                                        unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                                        return this.onTick(unit);
                                    }
                                }
                            }
                            unit.moveTrait.collisionState = CollisionState.Waiting;
                            unit.moveTrait.velocity.set(0, 0, 0);
                            return false;
                        }

                        unit.moveTrait.velocity.set(0, 0, 0);
                        unit.moveTrait.collisionState = CollisionState.Waiting;
                        return false;
                    }
                }

                /*
                 * A tracked unit about to drive over a crushable enemy with the
                 * SCATTER veteran ability: tell it to move first. Not a courtesy
                 * — a crushed veteran is worth full experience, and retail's
                 * "scatter" ability is what makes veteran infantry survivable.
                 */
                if (unit.rules.speedType === SpeedType.Track && currentVelocity) {
                    const currentIndex = this.path!.indexOf(unit.moveTrait.currentWaypoint!);
                    if (currentIndex > 0) {
                        const nextNode = this.path![currentIndex - 1];
                        for (const crushable of map
                            .getGroundObjectsOnTile(nextNode.tile)
                            .filter(
                                (obj: any) =>
                                    obj.isUnit() &&
                                    obj.onBridge === !!nextNode.onBridge &&
                                    obj.rules.crushable &&
                                    obj.veteranTrait?.hasVeteranAbility(VeteranAbility.SCATTER) &&
                                    !this.game.areFriendly(obj, unit),
                            )) {
                            if (!crushable.unitOrderTrait.hasTasks()) {
                                crushable.unitOrderTrait.addTask(new ScatterTask(this.game, undefined, undefined));
                            }
                        }
                    }
                }

                /*
                 * Claim every remaining cell on the path so other units' obstacle
                 * tests see us coming. Without the reservation two tanks moving
                 * toward each other both see a free path and only discover the
                 * conflict when they meet head-on.
                 */
                if (!unit.moveTrait.reservedPathNodes.length) {
                    unit.moveTrait.reservedPathNodes.push(...pathToCheck);
                    pathToCheck.forEach((node) => {
                        map.tileOccupation.occupySingleTile(node.tile, unit);
                    });
                }
            }

            unit.moveTrait.moveState = MoveState.Moving;
            this.inPlanningForTicks = undefined;
            this.unreachableTargets.length = 0;
            this.pushTried = false;
            if (unit.moveTrait.collisionState === CollisionState.Waiting) {
                unit.moveTrait.collisionState = CollisionState.Resolved;
            }
        }

        if (unit.moveTrait.moveState === MoveState.Moving) {
            const locomotor = unit.moveTrait.locomotor;
            const { distance, done, isTeleport } = locomotor.tick(
                unit,
                this.currentWaypointLeptons,
                this.destinationLeptons,
                (this.isCancelling() || !this.path!.length) && !this.cancelRepositionPending,
            );

            if (isTeleport) {
                unit.traits.filter(NotifyTeleport).forEach((trait: any) => {
                    trait[NotifyTeleport.onBeforeTeleport](unit, this.game, true, true);
                });
            }

            if (distance.length()) {
                const oldTile = unit.tile;
                const allowOutOfBounds = locomotor.allowOutOfBounds;
                /*
                 * `distance.y` non-zero means the locomotor is also changing
                 * altitude (aircraft, jumpjets). Only that path needs the 3-D
                 * mover *and* the elevation-change broadcast, which is what
                 * wakes `NotifyElevationChange` listeners (dust, shadows).
                 */
                if (distance.y) {
                    const oldElevation = unit.tileElevation;
                    unit.position.moveByLeptons3(distance, allowOutOfBounds);
                    unit.moveTrait.handleElevationChange(oldElevation, this.game);
                } else {
                    unit.position.moveByLeptons(distance.x, distance.z, allowOutOfBounds);
                }

                if (unit.tile !== oldTile) {
                    const canUseBridgeLayer = !Target.usesGroundLayerUnderBridge(unit);
                    const oldBridge =
                        canUseBridgeLayer && unit.onBridge
                            ? this.game.map.tileOccupation.getBridgeOnTile(oldTile)
                            : undefined;
                    /*
                     * Which bridge layer did we end up on? Prefer the path's own
                     * answer (it knows where it meant to go), then fall back to
                     * whichever layer we came from or were heading to, then ask
                     * the map.
                     */
                    const currentNode = findReverse(this.path!, (node) => node.tile === unit.tile);
                    const newBridge = canUseBridgeLayer
                        ? currentNode
                            ? currentNode.onBridge
                            : oldBridge || unit.moveTrait.currentWaypoint!.onBridge
                              ? this.game.map.tileOccupation.getBridgeOnTile(unit.tile)
                              : undefined
                        : undefined;

                    unit.moveTrait.handleTileChange(oldTile, newBridge, false, this.game, isTeleport);

                    if (isTeleport) {
                        unit.moveTrait.lastTeleportTick = this.game.currentTick;
                        this.game.events.dispatch(new ObjectTeleportEvent(unit, true, oldTile));
                    }

                    /* A teleport can land us on a mine; stop before ticking further. */
                    if (unit.isDestroyed) {
                        return true;
                    }
                }
            }

            if (done) {
                unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                return this.onTick(unit);
            }
        }

        return false;
    }

    private selectWeaponVsObstacle(unit: any, target: any): any {
        if (
            this.game.areFriendly(target, unit) ||
            !unit.attackTrait ||
            unit.attackTrait.isDisabled() ||
            !unit.attackTrait.isIdle()
        ) {
            return undefined;
        }
        const weapon = unit.attackTrait.selectWeaponVersus(unit, target, this.game, false, true);
        /*
         * Excluded on purpose: the death weapon (would detonate the attacker),
         * a parasite weapon (would take over the blocker), a mind-control
         * warhead (would capture it). None of those belong in path clearing.
         */
        if (
            !weapon ||
            weapon.name === unit.armedTrait?.deathWeapon?.name ||
            (weapon.rules.limboLaunch && weapon.warhead.rules.parasite) ||
            weapon.warhead.rules.mindControl
        ) {
            return undefined;
        }
        return weapon;
    }

    protected findRelocationTile(preferredTile: Tile, preferredBridge: any, unit: any): Tile | undefined {
        const map = this.game.map;
        if (unit.rules.movementZone === MovementZone.Fly) {
            /*
             * Aircraft cannot share a cell with a structure, terrain or a rock
             * overlay. `RandomTileFinder` first (so the parking spot looks
             * arbitrary), then a widening ring.
             */
            const isValidTile = (tile: Tile): boolean =>
                !map.tileOccupation
                    .getGroundObjectsOnTile(tile)
                    .some(
                        (obj: any) =>
                            (obj.isBuilding() && !obj.isDestroyed) ||
                            obj.isTerrain() ||
                            (obj.isOverlay() && obj.rules.isARock),
                    );
            const randomFinder = new RandomTileFinder(map.tiles, map.mapBounds, preferredTile, 1, this.game, isValidTile);
            let relocTile = randomFinder.getNextTile();
            if (!relocTile) {
                const radialFinder = new RadialTileFinder(
                    map.tiles,
                    map.mapBounds,
                    preferredTile,
                    unit.getFoundation(),
                    2,
                    15,
                    isValidTile,
                );
                relocTile = radialFinder.getNextTile();
            }
            return relocTile;
        } else {
            /*
             * Ground relocation must stay on the same island, or a tank told to
             * "park next door" would pick a cell across the river.
             */
            const forceGroundLayer = Target.usesGroundLayerUnderBridge(unit);
            const unitOnBridge = forceGroundLayer ? false : unit.onBridge;
            const islandMap =
                !this.options?.ignoredBlockers?.length &&
                map.terrain.getPassableSpeed(unit.tile, unit.rules.speedType, unit.isInfantry(), unitOnBridge)
                    ? this.game.map.terrain.getIslandIdMap(unit.rules.speedType, unit.isInfantry())
                    : undefined;
            const unitIslandId = islandMap?.get(unit.tile, unitOnBridge);
            const moveHelper = new MovePositionHelper(map);
            const finder = new RadialTileFinder(
                map.tiles,
                map.mapBounds,
                preferredTile,
                { width: 1, height: 1 },
                0,
                5,
                (tile: any) => {
                    const bridge =
                        !forceGroundLayer && (!preferredBridge || preferredBridge.isHighBridge())
                            ? map.tileOccupation.getBridgeOnTile(tile)
                            : undefined;
                    return (
                        !this.unreachableTargets.find(
                            (target) => target.tile === tile && target.toBridge === !!bridge,
                        ) &&
                        (unit.zone === ZoneType.Air ||
                            (islandMap?.get(tile, !!bridge) === unitIslandId &&
                                !map.terrain.findObstacles({ tile, onBridge: bridge }, unit).length &&
                                /*
                                 * `MovePositionHelper` keeps its own structural
                                 * `Tile` (`onBridgeLandType?: boolean`) from
                                 * before the B4 tile model existed; the
                                 * reference casts here for the same reason.
                                 */
                                moveHelper.isEligibleTile(
                                    tile as any,
                                    bridge as any,
                                    preferredBridge as any,
                                    preferredTile as any,
                                ))) &&
                        this.canStopAtTile(unit, tile, !!bridge)
                    );
                },
            );
            return finder.getNextTile();
        }
    }

    private findFreeSubCell(unit: any, node: PathNode): number | undefined {
        const groundObjects = this.game.map.getGroundObjectsOnTile(node.tile);
        const occupiedByInfantry = groundObjects
            .filter((obj: any) => obj.isInfantry() && obj.onBridge === !!node.onBridge && obj !== unit)
            .map((inf: any) => inf.position.desiredSubCell);
        /*
         * `desiredSubCell`, not `subCell`: an infantryman who is *walking* to
         * sub-cell 4 has still reserved it, and two men converging on the same
         * corner is exactly the case this avoids.
         */
        const occupiedByTerrain = groundObjects
            .filter((obj: any) => obj.isTerrain())
            .map((terrain: any) => terrain.rules.getOccupiedSubCells(this.game.map.getTheaterType()))
            .flat();
        const allOccupied = [...occupiedByInfantry, ...occupiedByTerrain];
        return Infantry.SUB_CELLS.find((subCell) => !allOccupied.includes(subCell));
    }

    private relocateToSubCell(unit: any, subCell: number): void {
        unit.position.desiredSubCell = subCell;
        const newOffset = unit.position.computeSubCellOffset(subCell);
        this.targetOffset = newOffset;
        this.currentWaypointLeptons
            .set(unit.moveTrait.currentWaypoint!.tile.rx, unit.moveTrait.currentWaypoint!.tile.ry)
            .multiplyScalar(Coords.LEPTONS_PER_TILE)
            .add(this.targetOffset);
        this.updateDestination(this.path!, this.targetOffset);
        unit.moveTrait.locomotor.onWaypointUpdate?.(unit, this.currentWaypointLeptons, this.destinationLeptons);
    }

    getTargetLinesConfig(unit: any): TargetLinesConfig {
        if (!this.path) {
            const locomotor = new LocomotorFactory(this.game).create(unit);
            /*
             * Drawing the move line for a *cancelled* order is a special case:
             * the path is computed for display only and cached in
             * `groundPathPlan`, then reused by `onStart` if the unit has not
             * moved. That is why `onStart` checks the plan's last node against
             * `unit.tile`.
             */
            if (
                (this.options?.allowOutOfBoundsTarget || this.game.map.mapBounds.isWithinBounds(this.targetTile)) &&
                unit.rules.movementZone !== MovementZone.Fly &&
                !locomotor.ignoresTerrain &&
                unit.unitOrderTrait.getCurrentTask()?.isCancelling()
            ) {
                if (!this.groundPathPlan) {
                    const plan = this.computeGroundPath(unit);
                    this.targetLinesConfig.pathNodes = plan.path;
                    if (plan.path.length) {
                        this.groundPathPlan = plan;
                    }
                }
            } else {
                unit.moveTrait.locomotor ??= locomotor;
                this.computePath(unit, unit.moveTrait.locomotor);
            }
            this.targetLinesConfig.isRecalc = false;
        }
        return this.targetLinesConfig;
    }

    private log(unit: any, message: string): void {
        this.logger.debug(`<${unit.id}>: ${message}`);
    }
}
