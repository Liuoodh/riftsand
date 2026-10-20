/**
 * Port of redalert2/src/game/gameobject/task/move/AttackMoveTask.ts (57 lines).
 *
 * Attack-move: walk to a cell, but stop and shoot anything `AttackTrait` finds
 * on the way. The subtlety is *when* it is allowed to look:
 *
 *   - `passedFirstWaypoint` — not before the unit has actually moved. Otherwise
 *     a tank ordered to attack-move 2 cells would engage a target standing next
 *     to its spawn point and never advance.
 *   - `weapon.getCooldownTicks()` — a weapon still reloading is not a reason to
 *     stop. Without this the unit halts, waits out the reload standing still,
 *     then continues — visibly worse than firing on the move.
 *
 * After the engagement it restores `collisionState = Resolved` and re-issues the
 * original destination. Without that reset the unit stays in `Waiting` and
 * `MoveTask` will not start the next leg.
 *
 * The `!unit.isSpawned` branch exists for a unit killed during the engagement:
 * `forceCancel` can fail (children not cancellable), and silently returning
 * would leave a dead object's task running forever.
 */
import { MoveTask } from './MoveTask';
import { MoveState, CollisionState } from '../../trait/MoveTrait';
import { MovementZone } from '../../../type/MovementZone';

export class AttackMoveTask extends MoveTask {
    private attackPerformed: boolean = false;
    private passedFirstWaypoint: boolean = false;

    constructor(game: any, targetTile: any, toBridge: boolean, options?: any) {
        super(game, targetTile, toBridge, options);
        this.isAttackMove = true;
    }

    duplicate(): AttackMoveTask {
        return new AttackMoveTask(this.game, this.targetTile, this.toBridge, this.options);
    }

    onTick(unit: any): boolean {
        if (unit.moveTrait.moveState === MoveState.Moving) {
            this.passedFirstWaypoint = true;
        }
        if (
            unit.moveTrait.moveState === MoveState.ReachedNextWaypoint &&
            unit.attackTrait &&
            !unit.attackTrait.isDisabled() &&
            (unit.rules.movementZone !== MovementZone.Fly || !unit.rules.balloonHover) &&
            (!unit.ammoTrait || unit.ammoTrait.ammo || !unit.rules.manualReload) &&
            !this.isCancelling()
        ) {
            const weapon = unit.attackTrait.selectDefaultWeapon(unit);
            if (weapon && (this.passedFirstWaypoint || !weapon.getCooldownTicks())) {
                const scanResult = unit.attackTrait.scanForTarget(unit, weapon, this.game);
                if (scanResult.target) {
                    const { target, weapon: targetWeapon } = scanResult;
                    if (!targetWeapon.getCooldownTicks()) {
                        const attackTask = unit.attackTrait.createAttackTask(
                            this.game,
                            target,
                            target.tile,
                            targetWeapon,
                            { holdGround: true, passive: true },
                        );
                        this.children.push(attackTask);
                        this.useChildTargetLines = true;
                        this.attackPerformed = true;
                        unit.moveTrait.velocity.set(0, 0, 0);
                        unit.moveTrait.currentWaypoint = undefined;
                        unit.moveTrait.collisionState = CollisionState.Waiting;
                        return false;
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
                this.useChildTargetLines = false;
                unit.moveTrait.collisionState = CollisionState.Resolved;
                this.updateTarget(this.targetTile, this.toBridge);
            }
        }
        return super.onTick(unit);
    }
}
