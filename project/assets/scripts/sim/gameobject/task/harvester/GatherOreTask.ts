/**
 * Port of redalert2/src/game/gameobject/task/harvester/GatherOreTask.ts (244 lines).
 *
 * The harvesting half of the harvester loop (`ReturnOreTask` is the other).
 * Status is owned by `harvesterTrait`, not by the task: the trait survives
 * between tasks, which is how a miner that gets re-tasked mid-field resumes
 * instead of restarting.
 *
 * `MovingToOreSite` is the only state with real logic, and it is written as a
 * cascade of *retargeting* decisions rather than a single pathfind:
 *
 * 1. Pick the closest reachable ore tile (`findClosestReachableOreSite`).
 *    `farScan` is true here — the initial sweep looks across the whole field.
 * 2. If no ore is reachable at all, give up (`LookingForOreSite`) and, if we
 *    happen to be sitting on a refinery's footprint, step off to a free tile
 *    within 5 cells. That "step off the pad" is why a miner that arrives at an
 *    empty field does not park on the refinery and block other miners.
 * 3. Otherwise drive to it. `closeEnough` is the retail `[General]` value, and
 *    a cell that is *already* ore and within `closeEnough` of the target counts
 *    as arrived — that is the whole point of `closeEnoughTiles`, and it is why
 *    miners do not all converge on one cell.
 * 4. The `forceMoveTried` latch: if we are close to the target but standing on
 *    non-ore ground, first try one `strictCloseEnough` move (must land exactly
 *    on the tile). If that fails, look for *any* nearby ore; failing that, go
 *    unload. Without the latch this path would loop forever between two
 *    equally-unreachable cells.
 *
 * `findClosestReachableOreSite` is where the retail feel lives:
 *
 *   - island filtering via `getIslandIdMap` so a miner never targets ore across
 *     water. Note the guard: the island map is only built when the *unit's own*
 *     tile is passable, otherwise `unitIslandId` is `undefined` and every tile
 *     compares unequal — deliberately, because a miner dropped on an island of
 *     one has no valid targets.
 *   - the one-ring fast path uses an explicit distance sort with
 *     `1000 * valueDiff + (priorityB - priorityA)`. The `1000` makes ore value
 *     dominate, and the `PRIORITY_MATRIX` term breaks ties in a fixed spatial
 *     order so a truck sweeps a field in a consistent pattern instead of
 *     oscillating between two equal cells.
 *
 * `Harvesting` is trivial by comparison: one bail per tick, an overlay with no
 * bails left is unspawned, and the truck stops when full. The
 * `!hasRefinery && !explicitOrder` check is the "don't hoard" rule — a miner
 * with nowhere to deliver and no explicit player order stops after one load.
 */
import { Task } from '../system/Task';
import { RadialTileFinder } from '../../../map/tileFinder/RadialTileFinder';
import { HarvesterStatus } from '../../../traits/HarvesterTrait';
import { LandType } from '../../../type/LandType';
import { MoveTask } from '../move/MoveTask';
import { TiberiumTrait } from '../../trait/TiberiumTrait';
import { TiberiumType } from '../../../type/TiberiumType';
import { WaitMinutesTask } from '../system/WaitMinutesTask';
import { ReturnOreTask } from './ReturnOreTask';
import { RangeHelper } from '../../unit/RangeHelper';
import { CallbackTask } from '../system/CallbackTask';
import { MoveResult } from '../../trait/MoveTrait';
import { MovementZone } from '../../../type/MovementZone';

/**
 * Neighbour priority when several ore tiles are the same distance away.
 * Verbatim from the reference: the harvester prefers the tile below-left of its
 * current position, which is why trucks sweep a field in a consistent pattern
 * instead of oscillating between two equal cells.
 */
const PRIORITY_MATRIX = [
    [8, 5, 6],
    [3, 0, 2],
    [7, 4, 1],
];

export class GatherOreTask extends Task {
    private game: any;
    private initialTarget: any;
    private explicitOrder: boolean;
    private forceMoveTried: boolean = false;
    private rangeHelper: RangeHelper;
    private scanNearRadius: number;
    private scanFarRadius: number;
    private target?: any;
    public useChildTargetLines: boolean = true;
    public preventOpportunityFire: boolean = false;

    constructor(game: any, initialTarget?: any, explicitOrder: boolean = false) {
        super();
        this.game = game;
        this.initialTarget = initialTarget;
        this.explicitOrder = explicitOrder;
        this.rangeHelper = new RangeHelper(game.map.tileOccupation);
        this.scanNearRadius = game.rules.ai.tiberiumNearScan;
        this.scanFarRadius = game.rules.ai.tiberiumFarScan;
    }

    onStart(unit: any): void {
        // Harvesters are vehicles OR Yuri's slaves (infantry).
        if (!unit.harvesterTrait) {
            throw new Error(`Unit ${unit.name} is not a harvester.`);
        }
        unit.harvesterTrait.status = HarvesterStatus.MovingToOreSite;
        unit.harvesterTrait.lastGatherExplicit = this.explicitOrder;
    }

    onEnd(unit: any): void {
        if (unit.harvesterTrait.status !== HarvesterStatus.LookingForOreSite) {
            unit.harvesterTrait.status = HarvesterStatus.Idle;
        }
    }

    onTick(unit: any): boolean {
        if (this.isCancelling()) return true;
        const harvester = unit.harvesterTrait;
        if (harvester.status === HarvesterStatus.MovingToOreSite) {
            const previousTarget = this.target;
            this.target = this.findClosestReachableOreSite(
                unit,
                this.target ||
                    (this.initialTarget?.landType !== LandType.Tiberium
                        ? (harvester.lastOreSite ?? unit.tile)
                        : this.initialTarget),
                true,
            );
            harvester.lastOreSite = this.target;
            if (!this.target) {
                harvester.status = HarvesterStatus.LookingForOreSite;
                const refinery = this.getRefineryOnTile(unit.tile);
                if (refinery && unit.unitOrderTrait.getTasks().length === 1) {
                    const canFly = unit.rules.movementZone === MovementZone.Fly;
                    const finder = new RadialTileFinder(
                        this.game.map.tiles,
                        this.game.map.mapBounds,
                        refinery.tile,
                        refinery.getFoundation(),
                        1,
                        5,
                        (tile: any) =>
                            canFly ||
                            (this.game.map.terrain.getPassableSpeed(
                                tile,
                                unit.rules.speedType,
                                unit.isInfantry(),
                                false,
                            ) > 0 &&
                                Math.abs(tile.z - unit.tile.z) < 2 &&
                                !this.game.map.terrain.findObstacles({ tile, onBridge: undefined }, unit).length),
                    );
                    const waitTile = finder.getNextTile();
                    if (waitTile) {
                        unit.unitOrderTrait.addTasks(
                            new MoveTask(this.game, waitTile, false),
                            new CallbackTask(() => {
                                if (
                                    ![MoveResult.Success, MoveResult.CloseEnough, MoveResult.Cancel].includes(
                                        unit.moveTrait.lastMoveResult,
                                    )
                                ) {
                                    this.children.push(new WaitMinutesTask(1 / 60));
                                }
                            }),
                        );
                    }
                }
                return true;
            }
            const closeEnough = this.game.rules.general.closeEnough;
            const wasCloseEnough =
                previousTarget && this.rangeHelper.tileDistance(unit.tile, this.target) <= closeEnough;
            if (!(unit.tile === this.target || (unit.tile.landType === LandType.Tiberium && wasCloseEnough))) {
                if (unit.tile !== this.target && wasCloseEnough && unit.tile.landType !== LandType.Tiberium) {
                    const nearbyOre = this.findClosestReachableOreSite(unit, unit.tile, false, true);
                    if (nearbyOre) {
                        this.target = nearbyOre;
                        harvester.lastOreSite = this.target;
                    } else {
                        if (!this.forceMoveTried) {
                            this.forceMoveTried = true;
                            this.children.push(
                                new MoveTask(this.game, this.target, false, {
                                    closeEnoughTiles: 0,
                                    strictCloseEnough: true,
                                }),
                            );
                            return false;
                        }
                        this.forceMoveTried = false;
                        if (!harvester.isEmpty()) {
                            this.returnOreIfPossible(unit);
                            return true;
                        }
                        const alternativeTarget = this.findClosestReachableOreSite(unit, unit.tile, true, true);
                        if (!alternativeTarget) {
                            harvester.status = HarvesterStatus.LookingForOreSite;
                            return true;
                        }
                        this.target = alternativeTarget;
                        harvester.lastOreSite = this.target;
                    }
                }
                this.children.push(
                    new MoveTask(this.game, this.target, false, { closeEnoughTiles: closeEnough }),
                    new CallbackTask(() => {
                        if (
                            ![MoveResult.Success, MoveResult.CloseEnough, MoveResult.Cancel].includes(
                                unit.moveTrait.lastMoveResult,
                            )
                        ) {
                            this.children.push(new WaitMinutesTask(5 / 60));
                        }
                    }),
                );
                return false;
            }
            this.target = unit.tile;
            harvester.lastOreSite = this.target;
            harvester.status = HarvesterStatus.Harvesting;
            this.forceMoveTried = false;
        }
        if (harvester.status !== HarvesterStatus.Harvesting) {
            return false;
        }
        if (harvester.isFull()) {
            this.returnOreIfPossible(unit);
            return true;
        }
        const tiberiumOverlay = this.game.map
            .getObjectsOnTile(unit.tile)
            .find((obj: any) => obj.isOverlay() && obj.isTiberium());
        if (!tiberiumOverlay) {
            const hasNearbyOre = this.findClosestReachableOreSite(unit, harvester.lastOreSite ?? unit.tile, false);
            if (hasNearbyOre || harvester.isEmpty()) {
                harvester.status = HarvesterStatus.MovingToOreSite;
                return this.onTick(unit);
            } else {
                this.returnOreIfPossible(unit);
                return true;
            }
        }
        const tiberiumTrait = tiberiumOverlay.traits.get(TiberiumTrait);
        const collectedType = tiberiumTrait.collectBail();
        if (!tiberiumTrait.getBailCount()) {
            this.game.unspawnObject(tiberiumOverlay);
        }
        if (collectedType !== undefined) {
            if (collectedType === TiberiumType.Ore) {
                harvester.ore++;
            } else if (collectedType === TiberiumType.Gems) {
                harvester.gems++;
            } else {
                throw new Error('Unsupported tiberium type ' + collectedType);
            }
        }
        const hasRefinery = [...unit.owner.buildings].some((building: any) => building.rules.refinery);
        if (!hasRefinery && !this.explicitOrder) {
            return true;
        }
        this.children.push(new WaitMinutesTask(1 / 60));
        return false;
    }

    private findClosestReachableOreSite(
        unit: any,
        startTile: any,
        farScan: boolean,
        checkObstacles: boolean = false,
    ): any {
        const canFly = unit.rules.movementZone === MovementZone.Fly;
        const speedType = unit.rules.speedType;
        const isInfantry = unit.isInfantry();
        const islandMap =
            !canFly && this.game.map.terrain.getPassableSpeed(unit.tile, speedType, isInfantry, unit.onBridge)
                ? this.game.map.terrain.getIslandIdMap(speedType, isInfantry)
                : undefined;
        const unitIslandId = islandMap?.get(unit.tile, unit.onBridge);
        const isValidTile = (tile: any): boolean => {
            return (
                tile.landType === LandType.Tiberium &&
                islandMap?.get(tile, false) === unitIslandId &&
                (!checkObstacles ||
                    canFly ||
                    !this.game.map.terrain.findObstacles({ tile, onBridge: undefined }, unit).length)
            );
        };
        if (isValidTile(startTile)) {
            return startTile;
        }
        let startRadius = 1;
        if (!farScan) {
            const nearbyFinder = new RadialTileFinder(
                this.game.map.tiles,
                this.game.map.mapBounds,
                startTile,
                { width: 1, height: 1 },
                startRadius,
                startRadius,
                isValidTile,
            );
            const nearbyTiles: any[] = [];
            let tile;
            while ((tile = nearbyFinder.getNextTile())) {
                nearbyTiles.push(tile);
            }
            if (nearbyTiles.length) {
                const tilesWithOre = nearbyTiles.map((nearby) => {
                    const ore = this.game.map
                        .getObjectsOnTile(nearby)
                        .find((obj: any) => obj.isOverlay() && obj.isTiberium());
                    if (!ore) {
                        throw new Error(`Ore should exist on tile ${nearby.rx},${nearby.ry} b/c of landType`);
                    }
                    return { tile: nearby, ore };
                });
                tilesWithOre.sort((a, b) => {
                    const valueDiff = b.ore.value - a.ore.value;
                    const priorityA = PRIORITY_MATRIX[1 + a.tile.ry - startTile.ry][1 + a.tile.rx - startTile.rx];
                    const priorityB = PRIORITY_MATRIX[1 + b.tile.ry - startTile.ry][1 + b.tile.rx - startTile.rx];
                    return 1000 * valueDiff + (priorityB - priorityA);
                });
                return tilesWithOre[0].tile;
            }
            startRadius = 2;
        }
        const maxRadius = farScan ? this.scanFarRadius : this.scanNearRadius;
        const finder = new RadialTileFinder(
            this.game.map.tiles,
            this.game.map.mapBounds,
            startTile,
            { width: 1, height: 1 },
            startRadius,
            maxRadius,
            isValidTile,
        );
        return finder.getNextTile();
    }

    private getRefineryOnTile(tile: any): any {
        return this.game.map.getObjectsOnTile(tile).find((obj: any) => obj.isBuilding() && obj.rules.refinery);
    }

    private returnOreIfPossible(unit: any): void {
        if (unit.unitOrderTrait.getTasks().length === 1) {
            unit.unitOrderTrait.addTask(new ReturnOreTask(this.game));
        }
    }

    getTargetLinesConfig(unit: any): any {
        return {
            pathNodes: this.initialTarget ? [{ tile: this.initialTarget, onBridge: undefined }] : [],
        };
    }
}
