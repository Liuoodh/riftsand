/**
 * MoveTask — a line-by-line port of
 *   redalert2/src/game/gameobject/task/move/MoveTask.ts
 *
 * This is the *whole* collision system of the reference. There is no shoving,
 * no separation pass, no steering: a moving unit looks at its own path each
 * tick and decides, in this order:
 *
 *   1. path blocked by terrain / a structure      -> re-plan (blocked node memo)
 *   2. blocked by a unit that is itself waiting   -> recursively ask it to move
 *   3. blocked by a busy unit                     -> wait 40 ticks (0.67 s)
 *   4. blocked head-on                           -> back off (backtrack search)
 *   5. destination cell full                     -> relocate to a nearby cell
 *   6. no reachable cell at all                  -> CloseEnough / Fail
 *
 * Everything that used to make this project feel "off" (units being nudged,
 * hulls grinding along each other, tanks turning on the spot) came from adding
 * geometry on top of this. Here the geometry is gone.
 *
 * Deliberate omissions (features this game does not have): bridges, disguises,
 * crates, veteran scatter, teleport, attack-while-blocked. Every such branch is
 * marked `// no <feature> in this game`.
 */
import { Task, TaskStatus, WaitTicksTask } from './Task';
import { MoveAsideTask } from './MoveAsideTask';
import { MoveTrait, MoveResult, MoveState, CollisionState, TICK } from './MoveTrait';
import { DriveLocomotor, FootLocomotor } from './Locomotor';
import { MovementZone } from './type/MovementZone';
import { SpeedType } from './type/SpeedType';
import type { PathNode } from './map/Terrain';
import type { MapBounds } from './map/MapBounds';
import type { Tile } from './map/TileCollection';
import { RadialTileFinder } from './map/tileFinder/RadialTileFinder';
import { RandomTileFinder } from './map/tileFinder/RandomTileFinder';
import { Vec2, FacingUtil } from './Math2';
import { SimWorld } from './World';
import { SPEED, isBuildingObject } from './Constants';

const VELOCITY_FACTOR = 1.5;
const MAX_PLANNING_TICKS = 200;
const WAIT_TICKS = 40;
const MAX_UNREACHABLE_TARGETS = 5;

export interface MoveOptions {
    targetOffset?: Vec2;
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

interface BlockedPathNode {
    node: PathNode;
    obj: any;
}

interface GroundPathPlan {
    path: PathNode[];
    ignoredBlockers: any[];
    blockedPathNodes: BlockedPathNode[];
}

interface UnreachableTarget {
    tile: Tile;
    toBridge: boolean;
}

/** Infantry.SUB_CELLS — three men per cell, on these sub-cells only */
const SUB_CELLS = [2, 4, 3];

function findIndexReverse<T>(array: T[], predicate: (value: T, index: number) => boolean): number {
    for (let i = array.length - 1; i >= 0; i--) {
        if (predicate(array[i], i)) return i;
    }
    return -1;
}

export class MoveTask extends Task {
    preventOpportunityFire = false;

    private destinationLeptons = new Vec2();
    private currentWaypointLeptons = new Vec2();
    private needsPathUpdate = false;
    private targetChangeRequested = false;
    private allObstaclesAreBlockers = false;
    private blockedPathNodes: BlockedPathNode[] = [];
    private unreachableTargets: UnreachableTarget[] = [];
    private pushTried = false;
    private cancelProcessed = false;
    private cancelRepositionPending = false;
    private path?: PathNode[];
    private groundPathPlan?: GroundPathPlan;
    private targetOffset?: Vec2;
    private inPlanningForTicks?: number;

    constructor(
        protected world: SimWorld,
        protected targetTile: Tile,
        protected toBridge: boolean,
        protected options?: MoveOptions,
    ) {
        super();
    }

    setForceMove(force: boolean): void {
        if (force) {
            this.options = this.options ?? {};
            this.options.forceMove = true;
        } else if (this.options?.forceMove) {
            this.options.forceMove = undefined;
        }
    }

    onStart(unit: any): void {
        if (unit.moveTrait.locomotor === undefined) {
            unit.moveTrait.locomotor = unit.rules.locomotor === 'foot' ? new FootLocomotor(this.world) : new DriveLocomotor(this.world);
        }
        if (unit.moveTrait.lastTargetOffset) this.targetOffset = unit.moveTrait.lastTargetOffset;
        else this.targetOffset = this.computeTargetOffset(unit);

        if (unit.moveTrait.lastVelocity) unit.moveTrait.velocity.copy(unit.moveTrait.lastVelocity);

        if (!this.path) {
            if (this.groundPathPlan) {
                if (this.groundPathPlan.path[this.groundPathPlan.path.length - 1].tile === unit.tile) {
                    this.path = this.applyGroundPathPlan(this.groundPathPlan);
                } else {
                    this.computePath(unit);
                }
                this.groundPathPlan = undefined;
            } else {
                this.computePath(unit);
            }
        }
        this.updateDestination(this.path!, this.targetOffset);
        unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
        unit.moveTrait.lastMoveResult = undefined;
        unit.moveTrait.lastTargetOffset = undefined;
        unit.moveTrait.lastVelocity = undefined;
    }

    private computeTargetOffset(unit: any): Vec2 {
        if (this.options?.targetOffset) return this.options.targetOffset;
        if (unit.isInfantry()) return unit.position.getTileOffset();
        return unit.position.computeSubCellOffset(0);
    }

    private computePath(unit: any): void {
        let path: PathNode[];
        if (!this.options?.allowOutOfBoundsTarget && !this.world.mapBounds.isWithinBounds(this.targetTile)) {
            path = [];
        } else if (unit.rules.movementZone === MovementZone.Fly) {
            path = this.computeAirPath(unit);
        } else {
            const plan = this.computeGroundPath(unit);
            path = this.applyGroundPathPlan(plan);
        }
        this.path = path;
    }

    private computeAirPath(unit: any): PathNode[] {
        return [
            { tile: this.targetTile, onBridge: undefined },
            { tile: unit.tile, onBridge: undefined },
        ];
    }

    private computeGroundPath(unit: any): GroundPathPlan {
        let startTile: Tile = unit.tile;
        /*
         * Re-planning while moving starts from the waypoint the unit is
         * currently driving to, not from the cell it visually overlaps — that
         * is what stops a mid-cell re-path from cutting the corner it is
         * already committed to.
         */
        if (unit.moveTrait.moveState === MoveState.Moving && unit.moveTrait.currentWaypoint) {
            startTile = unit.moveTrait.currentWaypoint.tile;
        }
        const plan: GroundPathPlan = { path: [], ignoredBlockers: [], blockedPathNodes: [] };

        const startBuilding = this.world.tileOccupation
            .getObjectsOnTile(startTile)
            .find((obj: any) => isBuildingObject(obj));
        if (startBuilding && !this.world.terrain.getPassableSpeed(startTile, unit.rules.speedType, unit.isInfantry(), false)) {
            const isIgnored = this.isIgnored(startBuilding);
            if (!isIgnored) plan.ignoredBlockers.push(startBuilding);
        }

        const allIgnoredBlockers: any[] = [];
        const pushIgnored = (list?: any[]) => {
            if (!list) return;
            for (const obj of list) {
                if (allIgnoredBlockers.indexOf(obj) === -1) allIgnoredBlockers.push(obj);
            }
        };
        pushIgnored(this.options?.ignoredBlockers);
        pushIgnored(this.options?.pathFinderIgnoredBlockers);
        pushIgnored(plan.ignoredBlockers);

        const allBlockedNodes = this.blockedPathNodes.concat(plan.blockedPathNodes);
        const hasExcludedNodes = this.allObstaclesAreBlockers || !!allBlockedNodes.length;

        const path = this.world.terrain.computePath(
            unit.rules.speedType,
            unit.isInfantry(),
            startTile,
            false,
            this.targetTile,
            false,
            {
                maxExpandedNodes: this.allObstaclesAreBlockers
                    ? Math.min(300, this.options?.maxExpandedPathNodes ?? Number.POSITIVE_INFINITY)
                    : this.options?.maxExpandedPathNodes,
                bestEffort: !this.options?.strictCloseEnough,
                ignoredBlockers: allIgnoredBlockers,
                excludeTiles: hasExcludedNodes
                    ? (node: PathNode) => this.nodeIsBlockedForPathfinding(node, unit, allIgnoredBlockers, allBlockedNodes)
                    : undefined,
            },
        );
        plan.path = path;
        return plan;
    }

    private nodeIsBlockedForPathfinding(node: PathNode, unit: any, ignoredBlockers: any[], blockedNodes: BlockedPathNode[]): boolean {
        if (this.allObstaclesAreBlockers) {
            return !!this.world.terrain.findObstacles(node, unit).find((obstacle) => ignoredBlockers.indexOf(obstacle.obj) === -1);
        }
        return !!blockedNodes.find(({ node: blockedNode }) => blockedNode.tile === node.tile && blockedNode.onBridge === node.onBridge);
    }

    private applyGroundPathPlan(plan: GroundPathPlan): PathNode[] {
        this.blockedPathNodes = this.blockedPathNodes.filter(
            (blocked) => !blocked.obj.dead && blocked.node.tile === blocked.obj.tile,
        );
        if (plan.ignoredBlockers.length) {
            this.options = this.options ?? {};
            this.options.ignoredBlockers = this.options.ignoredBlockers ?? [];
            for (const obj of plan.ignoredBlockers) this.options.ignoredBlockers.push(obj);
        }
        for (const node of plan.blockedPathNodes) this.blockedPathNodes.push(node);
        return plan.path;
    }

    private updateDestination(path: PathNode[], offset: Vec2): void {
        const tile = path.length ? path[0].tile : this.targetTile;
        this.destinationLeptons
            .set(tile.rx * SPEED.LEPTONS_PER_TILE, tile.ry * SPEED.LEPTONS_PER_TILE)
            .add(offset);
    }

    protected canStopAtTile(unit: any, tile: Tile, onBridge: boolean): boolean {
        /*
         * Aircraft: the reference runs the Amphibious table here because it has
         * a water layer. This game's aircraft simply hover over everything, so
         * they may stop anywhere (a structure still counts as "full").
         */
        if (unit.isAircraft()) {
            return !this.world.tileOccupation
                .getObjectsOnTile(tile)
                .some((obj: any) => isBuildingObject(obj) && !obj.dead);
        }
        if (unit.isInfantry()) {
            const infantryOnTile = this.world.tileOccupation
                .getGroundObjectsOnTile(tile)
                .filter(
                    (obj: any) =>
                        obj.isInfantry() &&
                        obj.tile === tile &&
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
            !this.isCancelling() &&
            this.options?.strictCloseEnough &&
            this.options?.closeEnoughTiles !== undefined &&
            !this.isCloseEnoughToDest(unit, tile, this.options.closeEnoughTiles)
        ) {
            return false;
        }
        return true;
    }

    protected isCloseEnoughToDest(_unit: any, tile: Tile, maxDistance?: number): boolean {
        if (maxDistance === undefined) return true;
        const dx = tile.rx - this.targetTile.rx;
        const dy = tile.ry - this.targetTile.ry;
        return Math.sqrt(dx * dx + dy * dy) <= maxDistance;
    }

    protected hasReachedDestination(_unit: any): boolean {
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
         * `targetOffset` is only computed in onStart. A task that is cancelled
         * before its first tick (a new order arriving in the same frame) has no
         * offset yet — the reference cannot hit this because it starts a task
         * inside the order handler, but we can, so the guard is required.
         */
        if (this.targetOffset && !this.targetOffset.equals(this.computeTargetOffset(unit))) {
            unit.moveTrait.lastTargetOffset = this.targetOffset;
        }
    }

    forceCancel(unit: any): boolean {
        if (!this.cancellable || this.children.some((child) => !child.cancellable)) return false;
        if (!this.options?.allowOutOfBoundsTarget && !this.world.mapBounds.isWithinBounds(unit.tile)) return false;
        unit.moveTrait.unreservePathNodes();
        unit.moveTrait.lastMoveResult = MoveResult.Cancel;
        this.onEnd(unit);
        unit.moveTrait.lastTargetOffset = this.targetOffset;
        unit.moveTrait.lastVelocity = unit.moveTrait.velocity.clone();
        this.status = TaskStatus.Cancelled;
        return true;
    }

    onTick(unit: any): boolean {
        const map = this.world;

        if (this.needsPathUpdate) {
            if (unit.moveTrait.moveState === MoveState.PlanMove) {
                this.inPlanningForTicks = undefined;
                unit.moveTrait.currentWaypoint = undefined;
                unit.moveTrait.collisionState = CollisionState.Resolved;
                unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                unit.moveTrait.velocity.set(0, 0);
            }
            this.computePath(unit);
            if (!this.path!.length) {
                this.unreachableTargets.push({ tile: this.targetTile, toBridge: this.toBridge });
            }
            this.updateDestination(this.path!, this.targetOffset!);
            this.targetChangeRequested = false;
            this.needsPathUpdate = false;
            this.allObstaclesAreBlockers = false;
        }

        if (unit.moveTrait.moveState === MoveState.ReachedNextWaypoint) {
            unit.moveTrait.unreservePathNodes();
            const waypointIndex = this.path!.indexOf(unit.moveTrait.currentWaypoint);
            if (waypointIndex !== -1) this.path!.splice(waypointIndex);
            else this.path!.pop();
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
                    return true;
                }
                let relocTile: Tile = unit.tile;
                if (notCloseEnough) relocTile = this.targetTile;
                const newTile = this.findRelocationTile(relocTile, unit);
                if (!newTile) {
                    unit.moveTrait.lastMoveResult = notCloseEnough ? MoveResult.Fail : MoveResult.CloseEnough;
                    return true;
                }
                this.updateTarget(newTile, false);
                if (this.isCancelling()) {
                    this.cancelProcessed = true;
                    this.cancelRepositionPending = true;
                }
                return false;
            }
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
                .set(
                    unit.moveTrait.currentWaypoint.tile.rx * SPEED.LEPTONS_PER_TILE,
                    unit.moveTrait.currentWaypoint.tile.ry * SPEED.LEPTONS_PER_TILE,
                )
                .add(this.targetOffset!);
            const newWaypointTasks = locomotor.onNewWaypoint(unit, this.currentWaypointLeptons, this.destinationLeptons);
            if (newWaypointTasks) {
                for (const task of newWaypointTasks) this.children.push(task);
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
                unit.moveTrait.velocity.set(0, 0);
                return false;
            }

            if (unit.rules.movementZone !== MovementZone.Fly) {
                const pathToCheck = this.path!
                    .slice(this.path!.indexOf(unit.moveTrait.currentWaypoint!))
                    .reverse();
                const currentVelocity = unit.moveTrait.velocity.length();

                for (const node of pathToCheck) {
                    if (node.onBridge?.isDestroyed) node.onBridge = undefined;
                }

                for (const node of pathToCheck) {
                    if (!map.terrain.getPassableSpeed(node.tile, unit.rules.speedType, unit.isInfantry(), !!node.onBridge, this.options?.ignoredBlockers)) {
                        if (
                            this.options?.stopOnBlocker &&
                            map.terrain.findObstacles(node, unit).some((obstacle) => obstacle.obj === this.options!.stopOnBlocker)
                        ) {
                            unit.moveTrait.lastMoveResult = MoveResult.CloseEnough;
                            return true;
                        }
                        this.needsPathUpdate = true;
                        unit.moveTrait.currentWaypoint = undefined;
                        unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                        return this.onTick(unit);
                    }

                    const obstacles = map.terrain
                        .findObstacles(node, unit)
                        .filter((obstacle) => !this.isIgnored(obstacle.obj));

                    for (const obstacle of obstacles) {
                        if (obstacle.static) {
                            this.needsPathUpdate = true;
                            unit.moveTrait.currentWaypoint = undefined;
                            unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                            return this.onTick(unit);
                        }
                        if (obstacle.obj.rules?.crushable) {
                            if (
                                (unit.rules.speedType === SpeedType.Track || unit.rules.speedType === SpeedType.Hover) &&
                                unit.crusher &&
                                (!this.isTechno(obstacle.obj) || !map.areFriendly(obstacle.obj, unit))
                            ) {
                                continue;
                            }
                            if (!this.isTechno(obstacle.obj)) {
                                this.needsPathUpdate = true;
                                unit.moveTrait.currentWaypoint = undefined;
                                unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                                return this.onTick(unit);
                            }
                        }
                        if (!this.isTechno(obstacle.obj)) {
                            // no terrain / overlay objects that block in this game
                            continue;
                        }

                        const blocker = obstacle.obj;
                        const blockerVelocity = blocker.isUnit() ? blocker.moveTrait.velocity.length() : 0;

                        /*
                         * Convoy rule: if I am the last node before the blocker,
                         * I am moving no faster than he is, we face the same way
                         * and he has already left this cell — just keep rolling.
                         * Without this a column tailgates itself into a jam.
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
                            isBuildingObject(blocker) ||
                            blocker.moveTrait.moveState === MoveState.Idle ||
                            blocker.moveTrait.collisionState !== CollisionState.Resolved
                        ) {
                            if (
                                !currentVelocity &&
                                unit.moveTrait.collisionState !== CollisionState.Resolved &&
                                blocker.isUnit() &&
                                blocker.moveTrait.collisionState !== CollisionState.Resolved
                            ) {
                                if (this.inPlanningForTicks! + 1 > MAX_PLANNING_TICKS) {
                                    this.needsPathUpdate = true;
                                    this.allObstaclesAreBlockers = true;
                                    unit.moveTrait.velocity.set(0, 0);
                                }
                                return false;
                            }
                            if (blocker.isInfantry() && unit.isInfantry() && blocker.moveTrait.collisionState === CollisionState.Resolved) {
                                const freeSubCell = this.findFreeSubCell(unit, node);
                                if (freeSubCell !== undefined) {
                                    this.relocateToSubCell(unit, freeSubCell);
                                    return this.onTick(unit);
                                }
                            }

                            const freeWaypointIndex = findIndexReverse(this.path!.slice(0, this.path!.indexOf(node)), (waypoint) => {
                                return (
                                    !map.terrain
                                        .findObstacles(waypoint, unit)
                                        .filter((obstacle) => !this.isIgnored(obstacle.obj)).length
                                );
                            });

                            if (freeWaypointIndex === -1) {
                                if (
                                    this.canStopAtTile(unit, unit.tile, unit.onBridge) &&
                                    this.isCloseEnoughToDest(unit, unit.tile, this.options?.closeEnoughTiles)
                                ) {
                                    unit.moveTrait.lastMoveResult = MoveResult.CloseEnough;
                                    return true;
                                }
                                if (
                                    !(
                                        this.options?.closeEnoughTiles === 0 ||
                                        (Math.abs(unit.tile.rx - this.targetTile.rx) <= 1 &&
                                            Math.abs(unit.tile.ry - this.targetTile.ry) <= 1)
                                    )
                                ) {
                                    this.needsPathUpdate = true;
                                    const blocked = this.path!.slice(0, this.path!.indexOf(node) + 1);
                                    for (const waypoint of blocked) {
                                        const first = map.terrain.findObstacles(waypoint, unit)[0];
                                        if (first) this.blockedPathNodes.push({ node: waypoint, obj: first.obj });
                                    }
                                    unit.moveTrait.velocity.set(0, 0);
                                    return false;
                                }
                            }

                            let alternatePath: PathNode[] = [];
                            if (freeWaypointIndex !== -1) {
                                const targetWaypoint = this.path![freeWaypointIndex];
                                alternatePath = map.terrain.computePath(
                                    unit.rules.speedType,
                                    unit.isInfantry(),
                                    unit.tile,
                                    false,
                                    targetWaypoint.tile,
                                    false,
                                    {
                                        maxExpandedNodes: 15,
                                        bestEffort: false,
                                        excludeTiles: (testNode: PathNode) =>
                                            !!map.terrain
                                                .findObstacles(testNode, unit)
                                                .filter((obstacle) => !this.isIgnored(obstacle.obj)).length,
                                        ignoredBlockers: this.options?.ignoredBlockers,
                                    },
                                );
                            }

                            if (!alternatePath.length && blocker.owner === unit.owner && pathToCheck.length === 1) {
                                // reference has an empty branch here: friendly blocker
                                // one node away — fall through to wait / push below
                            } else if (alternatePath.length) {
                                this.path!.splice.apply(this.path!, [freeWaypointIndex, this.path!.length].concat(alternatePath as any) as any);
                                unit.moveTrait.currentWaypoint = undefined;
                                unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                                return this.onTick(unit);
                            } else {
                                if (this.options?.forceWaitOnPathBlocked) {
                                    this.children.push(new WaitTicksTask(WAIT_TICKS));
                                    this.inPlanningForTicks = 0;
                                    unit.moveTrait.velocity.set(0, 0);
                                    unit.moveTrait.collisionState = CollisionState.Waiting;
                                } else {
                                    this.needsPathUpdate = true;
                                    this.blockedPathNodes.push({ node, obj: blocker });
                                    if (isBuildingObject(blocker)) this.allObstaclesAreBlockers = true;
                                    unit.moveTrait.velocity.set(0, 0);
                                }
                                return false;
                            }

                            const blockerHasTasks = blocker.orders.hasTasks();
                            if (
                                this.pushTried ||
                                isBuildingObject(blocker) ||
                                blocker.moveTrait.collisionState === CollisionState.Waiting ||
                                blockerHasTasks
                            ) {
                                if (
                                    !this.options?.forceWaitOnPathBlocked &&
                                    (isBuildingObject(blocker) ||
                                        (blockerHasTasks && blocker.moveTrait.moveState === MoveState.Idle) ||
                                        this.inPlanningForTicks! + WAIT_TICKS > MAX_PLANNING_TICKS)
                                ) {
                                    this.needsPathUpdate = true;
                                    this.allObstaclesAreBlockers = true;
                                    unit.moveTrait.velocity.set(0, 0);
                                } else {
                                    this.children.push(new WaitTicksTask(WAIT_TICKS));
                                    if (this.options?.forceWaitOnPathBlocked) this.inPlanningForTicks = 0;
                                    else this.inPlanningForTicks! += WAIT_TICKS;
                                    unit.moveTrait.velocity.set(0, 0);
                                    unit.moveTrait.collisionState = CollisionState.Waiting;
                                }
                                return false;
                            }

                            /*
                             * Nobody has a task, nobody is waiting: ask the blocker
                             * to step aside (this recurses one level deep in the
                             * reference — MoveAsideTask may itself push).
                             */
                            const pushDirection = new Vec2(blocker.tile.rx - unit.tile.rx, blocker.tile.ry - unit.tile.ry);
                            this.pushTried = true;
                            blocker.orders.addTask(new MoveAsideTask(this.world, pushDirection));
                            this.children.push(new WaitTicksTask(1));
                            unit.moveTrait.velocity.set(0, 0);
                            unit.moveTrait.collisionState = CollisionState.Waiting;
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
                            if (this.inPlanningForTicks! > WAIT_TICKS) unit.moveTrait.collisionState = CollisionState.Waiting;
                            return false;
                        }
                        if (Math.abs(unit.direction - blocker.direction) === 180) {
                            unit.moveTrait.velocity.set(0, 0);
                            unit.moveTrait.collisionState = CollisionState.Waiting;
                            return false;
                        }
                        if (
                            Math.abs(unit.direction - blocker.direction) <= 45 &&
                            blockerVelocity * VELOCITY_FACTOR < currentVelocity
                        ) {
                            const nodeIndex = this.path!.indexOf(node);
                            if (nodeIndex >= 5) {
                                const backtrackIndex = findIndexReverse(
                                    this.path!.slice(0, nodeIndex - 5),
                                    (waypoint) => !map.terrain.findObstacles(waypoint, unit).length,
                                );
                                if (backtrackIndex !== -1) {
                                    const backtrackTarget = this.path![backtrackIndex];
                                    const backtrackPath = map.terrain.computePath(
                                        unit.rules.speedType,
                                        unit.isInfantry(),
                                        unit.tile,
                                        false,
                                        backtrackTarget.tile,
                                        false,
                                        {
                                            maxExpandedNodes: 15,
                                            bestEffort: false,
                                            excludeTiles: (testNode: PathNode) =>
                                                !!map.terrain.findObstacles(testNode, unit).length ||
                                                this.path!.findIndex(
                                                    (waypoint) =>
                                                        waypoint.tile === testNode.tile && waypoint.onBridge === testNode.onBridge,
                                                ) > backtrackIndex,
                                        },
                                    );
                                    if (backtrackPath.length) {
                                        this.path!.splice.apply(
                                            this.path!,
                                            [backtrackIndex, this.path!.length].concat(backtrackPath as any) as any,
                                        );
                                        unit.moveTrait.currentWaypoint = undefined;
                                        unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                                        return this.onTick(unit);
                                    }
                                }
                            }
                            unit.moveTrait.collisionState = CollisionState.Waiting;
                            unit.moveTrait.velocity.set(0, 0);
                            return false;
                        }
                        unit.moveTrait.velocity.set(0, 0);
                        unit.moveTrait.collisionState = CollisionState.Waiting;
                        return false;
                    }
                }

                if (!unit.moveTrait.reservedPathNodes.length) {
                    for (const node of pathToCheck) unit.moveTrait.reservedPathNodes.push(node);
                    for (const node of pathToCheck) map.tileOccupation.occupySingleTile(node.tile, unit);
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
            const { distance, done } = locomotor.tick(
                unit,
                this.currentWaypointLeptons,
                this.destinationLeptons,
                (this.isCancelling() || !this.path!.length) && !this.cancelRepositionPending,
            );
            if (distance.length()) {
                unit.position.moveByLeptons(distance.x, distance.y, locomotor.allowOutOfBounds);
            }
            if (done) {
                unit.moveTrait.moveState = MoveState.ReachedNextWaypoint;
                return this.onTick(unit);
            }
        }
        return false;
    }

    /** reference: `!this.options?.ignoredBlockers?.includes(obj)` */
    private isIgnored(obj: any): boolean {
        return !!this.options?.ignoredBlockers && this.options.ignoredBlockers.indexOf(obj) !== -1;
    }

    private isTechno(obj: any): boolean {
        return !!obj && (obj.isUnit?.() || isBuildingObject(obj));
    }

    protected findRelocationTile(preferredTile: Tile, unit: any): Tile | undefined {
        const map = this.world;
        if (unit.rules.movementZone === MovementZone.Fly) {
            const isValidTile = (tile: Tile): boolean =>
                !map.tileOccupation.getGroundObjectsOnTile(tile).some((obj: any) => isBuildingObject(obj) && !obj.dead);
            const randomFinder = new RandomTileFinder(map.tiles, map.mapBounds, preferredTile, 1, { generateRandomInt: (min, max) => min + Math.floor(Math.random() * (max - min + 1)) }, isValidTile);
            let relocTile = randomFinder.getNextTile();
            if (!relocTile) {
                const radialFinder = new RadialTileFinder(
                    map.tiles,
                    map.mapBounds,
                    preferredTile,
                    { width: 1, height: 1 },
                    2,
                    15,
                    isValidTile,
                );
                relocTile = radialFinder.getNextTile();
            }
            return relocTile;
        }

        const islandMap =
            !this.options?.ignoredBlockers?.length &&
            map.terrain.getPassableSpeed(unit.tile, unit.rules.speedType, unit.isInfantry(), unit.onBridge)
                ? map.terrain.getIslandIdMap(unit.rules.speedType, unit.isInfantry())
                : undefined;
        const unitIslandId = islandMap?.get(unit.tile, unit.onBridge);
        const finder = new RadialTileFinder(
            map.tiles,
            map.mapBounds,
            preferredTile,
            { width: 1, height: 1 },
            0,
            5,
            (tile) =>
                !this.unreachableTargets.find((target) => target.tile === tile) &&
                islandMap?.get(tile, false) === unitIslandId &&
                !map.terrain.findObstacles({ tile, onBridge: undefined }, unit).length &&
                this.isEligibleTile(tile, preferredTile) &&
                this.canStopAtTile(unit, tile, false),
        );
        return finder.getNextTile();
    }

    /** MovePositionHelper.isEligibleTile for the no-bridge case */
    private isEligibleTile(tile: Tile, targetTile: Tile): boolean {
        return Math.abs(tile.z - targetTile.z) < 2;
    }

    private findFreeSubCell(unit: any, node: PathNode): number | undefined {
        const groundObjects = this.world.tileOccupation.getGroundObjectsOnTile(node.tile);
        const occupiedByInfantry = groundObjects
            .filter((obj: any) => obj.isInfantry() && obj !== unit)
            .map((inf: any) => inf.position.desiredSubCell);
        return SUB_CELLS.find((subCell) => occupiedByInfantry.indexOf(subCell) === -1);
    }

    private relocateToSubCell(unit: any, subCell: number): void {
        unit.position.subCell = subCell;
        const newOffset = unit.position.computeSubCellOffset(subCell);
        this.targetOffset = newOffset;
        this.currentWaypointLeptons
            .set(
                unit.moveTrait.currentWaypoint!.tile.rx * SPEED.LEPTONS_PER_TILE,
                unit.moveTrait.currentWaypoint!.tile.ry * SPEED.LEPTONS_PER_TILE,
            )
            .add(this.targetOffset);
        this.updateDestination(this.path!, this.targetOffset);
        unit.moveTrait.locomotor.onWaypointUpdate?.(unit, this.currentWaypointLeptons, this.destinationLeptons);
    }
}
