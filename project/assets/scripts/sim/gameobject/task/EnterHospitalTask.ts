/**
 * Port of redalert2/src/game/gameobject/task/EnterHospitalTask.ts (134 lines).
 *
 * Driving a wounded infantryman into a hospital. Five states, and unlike
 * `MoveToDockTask` this is *not* a dock reservation system — the hospital keeps
 * its own heal queue and the task simply obeys it:
 *
 *   MoveToQueueingTile → WaitForTurn → MoveToTarget → EnterTarget → ClearTarget
 *
 * Three things are load-bearing:
 *
 * 1. **`addToHealQueue` returns the number of units ahead of us**, so it decides
 *    the entry state. Zero ahead → walk straight in (MoveToTarget). Anything
 *    else → park on a queueing tile one cell away and wait, which is why a
 *    hospital under siege looks like an orderly line instead of a pile.
 * 2. **`WaitForTurn` only advances when `unitIsFirstInHealQueue`** — the queue
 *    is re-ordered by distance/arrival elsewhere, so the task must re-ask every
 *    tick rather than remember its position. `queueingTile` is cleared at that
 *    moment so `getTargetLinesConfig` stops drawing the queue marker.
 * 3. **`onEnd` unregisters from the queue only if the unit still exists**
 *    (`unit.isSpawned`). A unit that died on the way must not leave a ghost in
 *    the queue, and a hospital that was destroyed must not be poked at all.
 *
 * The `MoveInsideTask(...).setBlocking(false)` is the same shape as
 * `EnterBuildingTask`: the approach must not stall the order queue, because the
 * parent is what decides completion. `closeEnoughTiles: 5` on the queueing move
 * is generous on purpose — a queueing tile that is five cells off still reads
 * as "waiting by the door", and demanding exact arrival makes groups jam.
 *
 * Unlike `EnterBuildingTask` there is no `MoveOutsideTask` unless entry is
 * refused, and `ClearTarget` exists purely to let that retreat finish before
 * the task reports done.
 */
import { Task } from './system/Task';
import { MoveOutsideTask } from './move/MoveOutsideTask';
import { MoveInsideTask } from './move/MoveInsideTask';
import { MovementZone } from '../../type/MovementZone';
import { MovePositionHelper } from '../unit/MovePositionHelper';
import { RadialTileFinder } from '../../map/tileFinder/RadialTileFinder';
import { MoveTask } from './move/MoveTask';
import { CallbackTask } from './system/CallbackTask';
import { MoveResult } from '../trait/MoveTrait';
import { EnterObjectEvent } from '../../event/EnterObjectEvent';

enum EnterHospitalState {
    MoveToQueueingTile = 0,
    WaitForTurn = 1,
    MoveToTarget = 2,
    EnterTarget = 3,
    ClearTarget = 4,
}

export class EnterHospitalTask extends Task {
    private game: any;
    private target: any;
    private movePerformed: boolean = false;
    private state!: EnterHospitalState;
    private queueingTile: any;
    private lastOutsideTile: any;

    constructor(game: any, target: any) {
        super();
        this.game = game;
        this.target = target;
    }

    isAllowed(unit: any): boolean {
        return (
            unit.rules.movementZone !== MovementZone.Fly &&
            unit.healthTrait.health < 100 &&
            this.target.hospitalTrait &&
            !this.target.isDestroyed &&
            !this.target.warpedOutTrait.isActive() &&
            this.game.areFriendly(unit, this.target) &&
            (!this.target.ammoTrait || this.target.ammoTrait.ammo > 0)
        );
    }

    onStart(unit: any): void {
        if (!this.target.hospitalTrait) {
            throw new Error(`Target ${this.target.name} is not a valid hospital`);
        }
        if (this.target.hospitalTrait.addToHealQueue(unit) > 0) {
            this.state = EnterHospitalState.MoveToQueueingTile;
        } else {
            this.state = EnterHospitalState.MoveToTarget;
        }
    }

    onEnd(unit: any): void {
        if (!this.target.isDestroyed && unit.isSpawned) {
            this.target.hospitalTrait.removeFromHealQueue(unit);
        }
    }

    onTick(unit: any): boolean {
        if (
            (this.isCancelling() && this.state !== EnterHospitalState.EnterTarget) ||
            this.state === EnterHospitalState.ClearTarget ||
            unit.moveTrait.isDisabled()
        ) {
            return true;
        }
        if (this.state === EnterHospitalState.MoveToQueueingTile) {
            const movePositionHelper = new MovePositionHelper(this.game.map);
            const tileFinder = new RadialTileFinder(
                this.game.map.tiles,
                this.game.map.mapBounds,
                this.target.tile,
                this.target.getFoundation(),
                1,
                1,
                (tile: any) =>
                    this.game.map.terrain.getPassableSpeed(tile, unit.rules.speedType, unit.isInfantry(), false) > 0 &&
                    movePositionHelper.isEligibleTile(tile, undefined, undefined, this.target.tile),
            );
            const nextTile = tileFinder.getNextTile();
            if (!nextTile) {
                return true;
            }
            this.children.push(new MoveTask(this.game, nextTile, false, { closeEnoughTiles: 5 }));
            this.children.push(
                new CallbackTask(() => {
                    if (![MoveResult.Success, MoveResult.CloseEnough].includes(unit.moveTrait.lastMoveResult)) {
                        this.cancel();
                    }
                }),
            );
            this.state = EnterHospitalState.WaitForTurn;
            this.queueingTile = nextTile;
            return false;
        }
        if (this.state === EnterHospitalState.WaitForTurn) {
            if (!this.target.hospitalTrait.unitIsFirstInHealQueue(unit)) {
                return false;
            }
            this.queueingTile = undefined;
            this.state = EnterHospitalState.MoveToTarget;
        }
        if (this.state === EnterHospitalState.MoveToTarget) {
            if (this.movePerformed && this.children.length) {
                if (
                    unit.tile !== this.lastOutsideTile &&
                    !this.game.map.tileOccupation.isTileOccupiedBy(unit.tile, this.target)
                ) {
                    this.lastOutsideTile = unit.tile;
                }
                return false;
            }
            if (!this.isAllowed(unit)) {
                return true;
            }
            if (!this.game.map.tileOccupation.isTileOccupiedBy(unit.tile, this.target)) {
                if (this.movePerformed) {
                    return true;
                }
                this.children.push(new MoveInsideTask(this.game, this.target).setBlocking(false));
                this.movePerformed = true;
                return false;
            }
            this.state = EnterHospitalState.EnterTarget;
        }
        if (this.state === EnterHospitalState.EnterTarget) {
            if (!this.isAllowed(unit) || this.isCancelling()) {
                this.children.push(new MoveOutsideTask(this.game, this.target, this.lastOutsideTile));
                this.state = EnterHospitalState.ClearTarget;
                return false;
            }
            this.game.limboObject(unit, {
                selected: false,
                controlGroup: this.game.getUnitSelection().getOrCreateSelectionModel(unit).getControlGroupNumber(),
            });
            this.target.hospitalTrait.startHealing(unit);
            this.game.events.dispatch(new EnterObjectEvent(this.target, unit));
            return true;
        }
        return false;
    }

    getTargetLinesConfig(unit: any): any {
        return {
            target: this.queueingTile ? undefined : this.target,
            pathNodes: this.queueingTile ? [{ tile: this.queueingTile, onBridge: undefined }] : [],
        };
    }
}
