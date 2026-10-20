/**
 * Port of redalert2/src/game/gameobject/task/move/ExitFactoryTask.ts (95 lines).
 *
 * A freshly built unit driving out of its factory. It is a `MoveTask` because
 * that is exactly what it is — plus three factory-specific behaviours:
 *
 * 1. **The factory is an ignored blocker.** `ignoredBlockers: [factory]` plus
 *    `canStopAtTile` refusing any tile the factory still occupies means the unit
 *    is allowed to *emerge from* the building but may never come to rest inside
 *    it. Without the `canStopAtTile` override the unit would call "arrived" while
 *    still overlapping the footprint and the factory would stay `Delivering`.
 * 2. **Ramp clearing.** A vehicle factory whose exit ramp is occupied would
 *    deadlock forever, so `onStart` computes the ramp tiles and `onTick` pushes
 *    whatever is standing there out of the way — by *duplicating* its current
 *    task (`duplicate()` then `cancel()` then `addTaskNext`) rather than
 *    cancelling it, so an interrupted mover resumes its move. One exception: the
 *    exiting unit itself is skipped, because it spawns ON the ramp and would
 *    otherwise wait for itself to move.
 * 3. **The rally point handover.** Once the unit has reached its first waypoint
 *    and is clear of the factory, `ignoredBlockers` is cleared, the real rally
 *    point becomes the target, `cancellable` turns `true` and the close-enough
 *    tolerance relaxes to the retail `[General] CloseEnough`. Before that moment
 *    the task is uncancellable on purpose: a player clicking elsewhere must not
 *    leave a tank wedged in the factory door.
 *
 * `forceWaitOnPathBlocked` is set for everything except infantry factories. That
 * flag makes a blocked path *wait* instead of failing, which is right for a tank
 * queue and wrong for infantry, who can squeeze past and should never stall the
 * barracks.
 */
import { MoveTask } from './MoveTask';
import { MoveState } from '../../trait/MoveTrait';
import { FactoryType } from '../../../rules/TechnoRules';
import { ScatterTask } from '../ScatterTask';
import { AttackTask } from '../AttackTask';
import { AttackMoveTargetTask } from './AttackMoveTargetTask';
import { AttackMoveTask } from './AttackMoveTask';

export class ExitFactoryTask extends MoveTask {
    private factory: any;
    private rallyPoint: any;
    private rampBlockersPushed: boolean = false;
    private checkRampTiles?: any[];

    constructor(game: any, factory: any, targetTile: any, rallyPoint: any) {
        super(game, targetTile, false, {
            ignoredBlockers: [factory],
            closeEnoughTiles: 0,
            strictCloseEnough: true,
            forceWaitOnPathBlocked: factory.factoryTrait?.type !== FactoryType.InfantryType,
        });
        this.factory = factory;
        this.rallyPoint = rallyPoint;
        this.preventOpportunityFire = true;
        this.cancellable = false;
    }

    onStart(unit: any): void {
        super.onStart(unit);
        if (this.factory.factoryTrait?.type === FactoryType.UnitType) {
            this.checkRampTiles = this.game.map.tileOccupation
                .calculateTilesForGameObject(this.factory.tile, this.factory)
                .filter(
                    (tile: any) =>
                        this.game.map.terrain.getPassableSpeed(tile, unit.rules.speedType, unit.isInfantry(), false) >
                        0,
                );
        }
    }

    canStopAtTile(unit: any, tile: any, onBridge: any): boolean {
        return !this.game.map.tileOccupation.isTileOccupiedBy(tile, this.factory) && super.canStopAtTile(unit, tile, onBridge);
    }

    onTick(unit: any): boolean {
        if (this.checkRampTiles) {
            for (const tile of this.checkRampTiles) {
                for (const obj of this.game.map.tileOccupation.getGroundObjectsOnTile(tile)) {
                    // The exiting unit itself spawns ON the ramp (factory
                    // center) — counting it as a ramp blocker deadlocks the
                    // exit forever: the unit waits for itself to move, the
                    // factory stays Delivering and the whole vehicle queue
                    // freezes at "Ready".
                    if (obj === unit) {
                        continue;
                    }
                    if (obj.isUnit()) {
                        if (this.rampBlockersPushed) return false;
                        const scatterTask = new ScatterTask(this.game, undefined, {
                            excludedTiles: this.checkRampTiles,
                        });
                        scatterTask.setCancellable(false);
                        const currentTask = obj.unitOrderTrait.getCurrentTask();
                        if (currentTask) {
                            if (
                                currentTask.constructor === MoveTask ||
                                currentTask.constructor === AttackTask ||
                                currentTask.constructor === AttackMoveTask ||
                                currentTask.constructor === AttackMoveTargetTask
                            ) {
                                const duplicateTask = (currentTask as any).duplicate();
                                currentTask.cancel();
                                obj.unitOrderTrait.addTaskNext(duplicateTask);
                                obj.unitOrderTrait.addTaskNext(scatterTask);
                            }
                        } else {
                            obj.unitOrderTrait.addTask(scatterTask);
                        }
                    }
                }
            }
            if (!this.rampBlockersPushed) {
                this.rampBlockersPushed = true;
                return false;
            }
            this.checkRampTiles = undefined;
        }
        if (
            unit.moveTrait.moveState === MoveState.ReachedNextWaypoint &&
            this.options?.ignoredBlockers &&
            !this.game.map.terrain.isBlockerObject(this.factory, unit.tile, false, unit.rules.speedType, unit.isInfantry())
        ) {
            this.options.ignoredBlockers = undefined;
            this.preventOpportunityFire = false;
            if (this.rallyPoint) {
                this.updateTarget(this.rallyPoint.tile, !!this.rallyPoint.onBridge);
                this.cancellable = true;
                this.options.closeEnoughTiles = this.game.rules.general.closeEnough;
                this.options.strictCloseEnough = false;
                this.options.forceWaitOnPathBlocked = false;
            }
        }
        return super.onTick(unit);
    }
}
