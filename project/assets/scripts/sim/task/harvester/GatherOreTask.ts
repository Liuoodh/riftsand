/**
 * Port of redalert2/src/game/gameobject/task/harvester/GatherOreTask.ts.
 *
 * The state machine is copied 1:1 (MovingToOreSite -> Harvesting -> full ->
 * ReturnOreTask). The two things that differ are mechanical:
 *   - ore is stored per *node* (a 3x3 crystal patch) rather than as one overlay
 *     object per tile, so `collectBail(tile)` is a world call rather than
 *     `tiberiumTrait.collectBail()` on an overlay;
 *   - the reference's `WaitMinutesTask(1/60)` is one logic tick, which our
 *     `WaitTicksTask(1)` expresses directly.
 */
import { CallbackTask, Task, WaitTicksTask } from '../../Task';
import { MoveTask } from '../../MoveTask';
import { MoveResult } from '../../MoveTrait';
import { MoveTarget, HarvestWorld } from './HarvestWorld';
import { HarvesterStatus } from '../../traits/HarvesterTrait';
import { LandType } from '../../type/LandType';
import { RadialTileFinder } from '../../Tiles';

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
    private world: HarvestWorld;
    private initialTarget?: any;
    private explicitOrder: boolean;
    private forceMoveTried = false;
    /** recursion guard for the "no ore under me" re-entry below */
    private retriedThisTick = false;
    private target?: any;

    constructor(world: HarvestWorld, initialTarget?: any, explicitOrder = false) {
        super();
        this.world = world;
        this.initialTarget = initialTarget;
        this.explicitOrder = explicitOrder;
    }

    onStart(unit: any): void {
        if (!unit.harvesterTrait) throw new Error(`Unit ${unit.def?.id} is not a harvester.`);
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
                this.target || (this.initialTarget?.landType !== LandType.Tiberium
                    ? (harvester.lastOreSite ?? unit.tile)
                    : this.initialTarget),
                true,
            );
            harvester.lastOreSite = this.target;
            if (!this.target) {
                harvester.status = HarvesterStatus.LookingForOreSite;
                return true;
            }
            const closeEnough = this.world.general.closeEnough;
            const wasCloseEnough =
                previousTarget && this.world.tileDistance(unit.tile, this.target) <= closeEnough;
            /*
             * The reference tests `unit.tile.landType === Tiberium` here. That
             * works because tiberium is an *object* on the cell: no overlay, no
             * Tiberium land type. Here the land type is static terrain, so a
             * mined-out node leaves a "Tiberium" cell with no ore — a state the
             * original cannot represent. Testing the ore itself keeps the two
             * branches consistent, which is what stops `status = Harvesting` on
             * an empty cell from bouncing straight back through
             * `status = MovingToOreSite` (an infinite onTick recursion).
             */
            const standingOnOre = this.world.isOreTile(unit.tile);
            if (!(unit.tile === this.target || (standingOnOre && wasCloseEnough))) {
                if (unit.tile !== this.target && wasCloseEnough && !standingOnOre) {
                    const nearbyOre = this.findClosestReachableOreSite(unit, unit.tile, false, true);
                    if (nearbyOre) {
                        this.target = nearbyOre;
                        harvester.lastOreSite = this.target;
                    } else {
                        if (!this.forceMoveTried) {
                            this.forceMoveTried = true;
                            this.children.push(new MoveTask(this.world as any, this.target!, false, {
                                closeEnoughTiles: 0,
                                strictCloseEnough: true,
                            }));
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
                    new MoveTask(this.world as any, this.target!, false, {
                        closeEnoughTiles: closeEnough,
                    }),
                    /*
                     * The reference waits 5 ticks after a failed drive before
                     * re-planning. Without the pause a truck whose ore cell is
                     * occupied by another truck rebuilds the same blocked path
                     * every frame and never lets the other one finish mining.
                     */
                    new CallbackTask((unit2: any) => {
                        if (![MoveResult.Success, MoveResult.CloseEnough, MoveResult.Cancel].includes(unit2.moveTrait.lastMoveResult)) {
                            this.children.push(new WaitTicksTask(5));
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

        if (harvester.status !== HarvesterStatus.Harvesting) return false;

        if (harvester.isFull()) {
            this.returnOreIfPossible(unit);
            return true;
        }

        if (!this.world.isOreTile(unit.tile)) {
            const hasNearbyOre = this.findClosestReachableOreSite(unit, harvester.lastOreSite ?? unit.tile, false);
            if (hasNearbyOre || harvester.isEmpty()) {
                harvester.status = HarvesterStatus.MovingToOreSite;
                /*
                 * The reference re-enters onTick directly. One guard: a map
                 * where the scan can never make progress must not turn a bad
                 * frame into a stack overflow, so a second pass in the same tick
                 * gives up and lets the LookingForOreSite timer retry.
                 */
                if (this.retriedThisTick) return true;
                this.retriedThisTick = true;
                try {
                    return this.onTick(unit);
                } finally {
                    this.retriedThisTick = false;
                }
            }
            this.returnOreIfPossible(unit);
            return true;
        }

        const collectedValue = this.world.collectBail(unit.tile);
        if (collectedValue > 0) {
            if (collectedValue >= this.world.gemValue) harvester.gems++;
            else harvester.ore++;
        }

        // No refinery and no explicit order: stop rather than fill up forever.
        if (!this.world.hasRefinery(unit) && !this.explicitOrder) return true;

        this.children.push(new WaitTicksTask(1));
        return false;
    }

    private findClosestReachableOreSite(
        unit: any,
        startTile: any,
        farScan: boolean,
        checkObstacles = false,
    ): any {
        const canFly = unit.rules.movementZone === 1;
        const speedType = unit.rules.speedType;
        const isInfantry = unit.isInfantry();
        const islandMap = !canFly && this.world.terrain.getPassableSpeed(unit.tile, speedType, isInfantry, false) > 0
            ? this.world.terrain.getIslandIdMap(speedType, isInfantry)
            : undefined;
        const unitIslandId = islandMap?.get(unit.tile, false);
        const isValidTile = (tile: any): boolean =>
            this.world.isOreTile(tile) &&
            islandMap?.get(tile, false) === unitIslandId &&
            (!checkObstacles || canFly || this.world.terrain.findObstacles({ tile, onBridge: undefined }, unit).length === 0);

        if (isValidTile(startTile)) return startTile;

        let startRadius = 1;
        if (!farScan) {
            const nearbyFinder = new RadialTileFinder(
                this.world.tiles,
                this.world.mapBounds,
                startTile,
                { width: 1, height: 1 },
                startRadius,
                startRadius,
                isValidTile,
            );
            const nearbyTiles: any[] = [];
            let tile: any;
            while ((tile = nearbyFinder.getNextTile())) nearbyTiles.push(tile);
            if (nearbyTiles.length) {
                const tilesWithOre = nearbyTiles.map((t) => ({ tile: t, value: this.world.oreValueAt(t) }));
                tilesWithOre.sort((a, b) => {
                    const valueDiff = b.value - a.value;
                    const priorityA = PRIORITY_MATRIX[1 + a.tile.ry - startTile.ry]?.[1 + a.tile.rx - startTile.rx] ?? 0;
                    const priorityB = PRIORITY_MATRIX[1 + b.tile.ry - startTile.ry]?.[1 + b.tile.rx - startTile.rx] ?? 0;
                    return 1000 * valueDiff + (priorityB - priorityA);
                });
                return tilesWithOre[0].tile;
            }
            startRadius = 2;
        }
        const maxRadius = farScan ? 12 : 6;
        const finder = new RadialTileFinder(
            this.world.tiles,
            this.world.mapBounds,
            startTile,
            { width: 1, height: 1 },
            startRadius,
            maxRadius,
            isValidTile,
        );
        return finder.getNextTile();
    }

    private returnOreIfPossible(unit: any): void {
        if (unit.orders.getTasks().length === 1) {
            unit.orders.addTask(this.world.createReturnTask(unit));
        }
    }
}
