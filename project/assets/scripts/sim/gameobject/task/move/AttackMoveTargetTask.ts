/**
 * Port of redalert2/src/game/gameobject/task/move/AttackMoveTargetTask.ts (107 lines).
 *
 * Attack-move, phase two: the unit is walking to a destination but will stop and
 * shoot anything it meets. It is an `AttackTask` whose target is *replaced* by
 * whatever the scan finds, then restored afterwards.
 *
 * Four pieces of bookkeeping make that work:
 *
 * 1. **`passedFirstWaypoint`.** No shooting before the unit has actually moved.
 *    Without it an attack-move would open fire from the staging position and
 *    never arrive — the whole point of attack-move is that it advances.
 * 2. **`internalTargetUpdateRequested`.** Distinguishes "the scan chose this
 *    target" from "someone outside re-targeted us". Only the latter may retire
 *    the original destination (`initialTarget`), because the former is
 *    temporary.
 * 3. **`requestedTarget` vs `initialTarget`.** When they differ, we are shooting
 *    something on the way and `attackPerformed` records that. Once the engagement
 *    is over, the original weapon and target are restored and the walk resumes.
 * 4. **`scanCooldownTicks`** is reset to `normalTargetingDelay` every time the
 *    unit changes tile, and it *suppresses* scanning while it is non-zero. That
 *    is the "look around once per tile, not once per tick" rule.
 *
 * The `!weapon.getCooldownTicks()` guard on acquisition is subtle: a weapon that
 * is reloading may still be *selected* (so the unit faces the right way) but the
 * scan will not start an engagement it cannot follow up on. The same check in
 * `passedFirstWaypoint || !weapon.getCooldownTicks()` decides whether the scan
 * may run at all before the first waypoint.
 *
 * If the unit dies while engaging (`!unit.isSpawned`), `forceCancel` is the only
 * legal exit — a plain `cancel()` would leave the move child pointing at a
 * half-destroyed unit — and failing that the reference throws rather than
 * silently leaking the task.
 */
import { AttackTask } from '../AttackTask';
import { MoveState } from '../../trait/MoveTrait';

export class AttackMoveTargetTask extends AttackTask {
    private attackPerformed: boolean = false;
    private passedFirstWaypoint: boolean = false;
    private internalTargetUpdateRequested: boolean = false;
    private scanCooldownTicks: number = 0;
    private initialTarget: any;
    private initialWeapon: any;
    private requestedTarget: any;
    private lastScanTile: any;

    constructor(game: any, target: any, weapon: any) {
        super(game, target, weapon);
        if (!target.obj?.isTechno()) {
            throw new Error('Target must be a techno object');
        }
        this.initialTarget = target;
        this.initialWeapon = weapon;
        this.requestedTarget = target;
        this.isAttackMove = true;
    }

    duplicate(): AttackMoveTargetTask {
        return new AttackMoveTargetTask(this.game, this.initialTarget, this.initialWeapon);
    }

    requestTargetUpdate(target: any): void {
        if (this.internalTargetUpdateRequested) {
            this.requestedTarget = target;
            this.internalTargetUpdateRequested = false;
        } else {
            if (this.requestedTarget === this.initialTarget) {
                this.requestedTarget = target;
            } else {
                this.attackPerformed = true;
            }
            this.initialTarget = target;
        }
        super.requestTargetUpdate(target);
    }

    onTargetChange(unit: any): void {
        super.onTargetChange(unit);
        const currentTarget = unit.attackTrait.currentTarget;
        if (
            currentTarget &&
            currentTarget.obj !== this.initialTarget.obj &&
            currentTarget.obj !== this.requestedTarget.obj
        ) {
            if (this.requestedTarget === this.initialTarget) {
                this.requestedTarget = currentTarget;
            }
            this.initialTarget = currentTarget;
        }
    }

    onTick(unit: any): boolean {
        if (unit.moveTrait.moveState === MoveState.Moving) {
            this.passedFirstWaypoint = true;
        }
        this.scanCooldownTicks = Math.max(0, this.scanCooldownTicks - 1);
        if (
            unit.attackTrait &&
            !unit.attackTrait.isDisabled() &&
            !this.isCancelling() &&
            (this.requestedTarget === this.initialTarget || this.attackPerformed)
        ) {
            if (!(unit.moveTrait.isIdle() || (unit.tile === this.lastScanTile && this.scanCooldownTicks))) {
                this.lastScanTile = unit.tile;
                this.scanCooldownTicks = this.game.rules.general.normalTargetingDelay;
                const weapon = unit.attackTrait.selectDefaultWeapon(unit);
                if (weapon && (this.passedFirstWaypoint || !weapon.getCooldownTicks())) {
                    const scanResult = unit.attackTrait.scanForTarget(unit, weapon, this.game);
                    if (scanResult.target) {
                        const { target, weapon: scannedWeapon } = scanResult;
                        if (!scannedWeapon.getCooldownTicks()) {
                            this.options.holdGround = true;
                            this.options.passive = true;
                            this.setWeapon(scannedWeapon);
                            const newTarget = this.game.createTarget(target, target.tile);
                            this.internalTargetUpdateRequested = true;
                            this.requestTargetUpdate(newTarget);
                            this.attackPerformed = false;
                            return false;
                        }
                    }
                }
            }
            if (this.attackPerformed) {
                if (!unit.isSpawned) {
                    if (!this.forceCancel(unit)) {
                        throw new Error('Force cancel failed');
                    }
                    return true;
                }
                this.attackPerformed = false;
                this.passedFirstWaypoint = false;
                this.options.holdGround = false;
                this.options.passive = false;
                this.setWeapon(this.initialWeapon);
                this.internalTargetUpdateRequested = true;
                this.requestTargetUpdate(this.initialTarget);
            }
        }
        const result = super.onTick(unit);
        if (result && this.requestedTarget !== this.initialTarget) {
            this.attackPerformed = true;
            return this.isCancelling() || unit.attackTrait.isDisabled();
        }
        return result;
    }
}
