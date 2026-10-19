/**
 * Port of redalert2/src/game/gameobject/task/harvester/ReturnOreTask.ts.
 *
 * Full docking handshake: choose a refinery -> reserve a pad -> drive to the
 * queueing cell if the pad is taken -> drive onto the pad -> dock -> wait two
 * ticks -> unload -> restart gathering.
 *
 * Adaptations:
 *   - `owner.credits += oreValue` lives in `world.deliverOre` so the purifier
 *     bonus and the "AI extra purifiers" rule stay in Game;
 *   - the 270-degree TurnTask before docking is skipped (our MoveTask already
 *     leaves the hull facing the pad, and a slow turn there reads as a stall);
 *   - `unit.orders.getTasks().length === 1` is the reference's "this is my last
 *     task" test, so unloading automatically chains back into gathering.
 */
import { CallbackTask, Task, WaitTicksTask } from '../../Task';
import { MoveTask } from '../../MoveTask';
import { MoveResult } from '../../MoveTrait';
import { RadialTileFinder } from '../../Tiles';
import { HarvestWorld } from './HarvestWorld';
import { HarvesterStatus } from '../../traits/HarvesterTrait';
import { RULES } from '../../rules';

export class ReturnOreTask extends Task {
    private world: HarvestWorld;
    private forceTarget: any;
    private resetLastOreSite: boolean;
    private explicitOrder: boolean;
    private target: any;
    private reservedDockNumber: number | undefined;

    constructor(world: HarvestWorld, forceTarget?: any, resetLastOreSite = false, explicitOrder = false) {
        super();
        this.world = world;
        this.forceTarget = forceTarget;
        this.resetLastOreSite = resetLastOreSite;
        this.explicitOrder = explicitOrder;
    }

    onStart(unit: any): void {
        if (!unit.harvesterTrait) throw new Error(`Unit ${unit.def?.id} is not a harvester.`);
        unit.harvesterTrait.status = HarvesterStatus.MovingToRefinery;
        if (this.resetLastOreSite) unit.harvesterTrait.lastOreSite = undefined;
    }

    onEnd(unit: any): void {
        if (this.target && !this.target.dead && this.target.dockTrait) {
            this.target.dockTrait.undockUnit(unit);
            this.target.dockTrait.unreserveDockForUnit(unit);
        }
        if (unit.harvesterTrait.status !== HarvesterStatus.LookingForRefinery) {
            unit.harvesterTrait.status = HarvesterStatus.Idle;
        }
    }

    onTick(unit: any): boolean {
        if (this.isCancelling()) return true;
        const harvester = unit.harvesterTrait;
        if (harvester.status === HarvesterStatus.LookingForRefinery) return true;

        if (harvester.status === HarvesterStatus.MovingToRefinery) {
            if (!this.target || !this.isValidTargetRefinery(this.target, unit) || unit.tile !== this.world.refineryDockTile(this.target)) {
                const refinery = this.forceTarget ?? this.world.findRefinery(unit);
                if (!refinery) {
                    harvester.status = HarvesterStatus.LookingForRefinery;
                    return true;
                }
                if (this.target && this.target !== refinery && this.target.dockTrait?.hasReservedDockForUnit(unit)) {
                    this.target.dockTrait.unreserveDockForUnit(unit);
                }
                this.target = refinery;
            }

            let dockNumber = this.target.dockTrait.getFirstAvailableDockNumber();
            let needsReservation = false;
            if (dockNumber === undefined) {
                dockNumber = this.target.dockTrait.getFirstEmptyDockNumber();
                if (dockNumber !== undefined) needsReservation = !this.target.dockTrait.hasReservedDockForUnit(unit);
            }

            const dockingTile = this.world.refineryDockTile(this.target);
            if (!dockingTile) {
                harvester.status = HarvesterStatus.LookingForRefinery;
                return true;
            }
            const distance = this.world.tileDistance(unit.tile, dockingTile);
            if (
                dockNumber === undefined ||
                needsReservation ||
                (distance > RULES.general.harvesterTooFarDistance && !this.explicitOrder)
            ) {
                const queueingTile = this.findReachableQueueingTile(unit);
                if (!queueingTile) return true;
                if (unit.tile !== queueingTile) {
                    this.children.push(
                        new MoveTask(this.world as any, queueingTile, false),
                        new CallbackTask((u2: any) => {
                            if (u2.moveTrait.lastMoveResult === MoveResult.Fail) {
                                harvester.status = HarvesterStatus.LookingForRefinery;
                            } else if (u2.moveTrait.lastMoveResult === MoveResult.CloseEnough) {
                                this.children.push(new WaitTicksTask(5));
                            } else if (u2.moveTrait.lastMoveResult === MoveResult.Success) {
                                this.children.push(new WaitTicksTask(2));
                            }
                        }),
                    );
                    return false;
                }
            }

            if (!this.target.dockTrait.hasReservedDockForUnit(unit)) {
                this.target.dockTrait.reserveDockAt(unit, dockNumber ?? 0);
            }
            if (this.reservedDockNumber === undefined) {
                this.reservedDockNumber = this.target.dockTrait.getReservedDockForUnit(unit);
            }
            if (unit.tile !== dockingTile) {
                this.children.push(
                    new MoveTask(this.world as any, dockingTile, false, {
                        closeEnoughTiles: 0,
                        strictCloseEnough: true,
                    }),
                    new CallbackTask((u2: any) => {
                        if (u2.moveTrait.lastMoveResult === MoveResult.Fail) {
                            harvester.status = HarvesterStatus.LookingForRefinery;
                        }
                    }),
                );
                return false;
            }
            harvester.status = HarvesterStatus.Docking;
        }

        if (!this.isValidTargetRefinery(this.target, unit)) {
            harvester.status = HarvesterStatus.MovingToRefinery;
            this.forceTarget = undefined;
            return this.onTick(unit);
        }

        if (harvester.status === HarvesterStatus.Docking) {
            this.target.dockTrait.dockUnitAt(unit, this.reservedDockNumber ?? 0);
            this.reservedDockNumber = undefined;
            harvester.status = HarvesterStatus.PreparingToUnload;
        }

        if (harvester.status === HarvesterStatus.PreparingToUnload) {
            this.preventOpportunityFire = true;
            this.children.push(new WaitTicksTask(2));
            harvester.status = HarvesterStatus.Unloading;
            return false;
        }

        if (harvester.status !== HarvesterStatus.Unloading) return false;

        this.world.deliverOre(unit, this.target);
        harvester.ore = 0;
        harvester.gems = 0;
        if (unit.orders.getTasks().length === 1) {
            unit.orders.addTask(this.world.createGatherTask(unit));
        }
        return true;
    }

    private isValidTargetRefinery(refinery: any, unit: any): boolean {
        return !!refinery && !refinery.dead && refinery.owner === unit.owner;
    }

    /** ring around the refinery footprint, one cell out */
    private findReachableQueueingTile(unit: any): any {
        const refinery = this.target;
        const finder = new RadialTileFinder(
            this.world.tiles,
            this.world.mapBounds,
            refinery.tile,
            { width: refinery.size, height: refinery.size },
            1,
            1,
            (tile: any) =>
                this.world.terrain.getPassableSpeed(tile, unit.rules.speedType, unit.isInfantry(), false) > 0 &&
                Math.abs(tile.z - refinery.tile.z) < 2,
        );
        return finder.getNextTile();
    }
}
