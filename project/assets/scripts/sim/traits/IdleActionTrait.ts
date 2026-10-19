/**
 * Port of redalert2/src/game/gameobject/trait/IdleActionTrait.ts.
 *
 * Two jobs, both retail-accurate:
 *   1. A `fraidycat` infantryman standing still occasionally scatters on its
 *      own (civilians, conscripts). The 50 % roll happens once per cooldown
 *      expiry, not per tick.
 *   2. `actionDueThisTick()` is the hook the render layer reads to play the
 *      idle animation (scratching, looking around). It is true for exactly one
 *      tick, which is why the reference returns a boolean instead of an event.
 *
 * Cooldown: `IdleActionFrequency` seconds ± a random half-window, so a crowd of
 * idle infantry does not act in lockstep.
 */
import { TICKS_PER_SECOND } from '../Constants';

export interface IdleActionWorld {
    /** reference `world.rules.audioVisual.idleActionFrequency` */
    idleActionFrequency: number;
    /** uniform [0,1) — reference `world.generateRandom()` */
    random(): number;
    /** the reference's ScatterTask; the project's Game owns the implementation */
    scatterUnit(unit: any): void;
}

export class IdleActionTrait {
    private cooldownTicks = Number.POSITIVE_INFINITY;
    private _actionDueThisTick = false;
    private idle = false;

    /** NotifyTick.onTick */
    onTick(unit: any, world: IdleActionWorld): void {
        this._actionDueThisTick = false;
        const isIdle = !unit.orders?.hasTasks?.();
        if (isIdle && !this.idle) {
            this.resetCooldown(world);
        } else if (isIdle) {
            if (this.cooldownTicks === 0) {
                this.doIdleAction(unit, world);
                this.resetCooldown(world);
            } else {
                this.cooldownTicks--;
            }
        } else {
            this.cooldownTicks = Number.POSITIVE_INFINITY;
        }
        this.idle = isIdle;
    }

    doIdleAction(unit: any, world: IdleActionWorld): void {
        if (!unit.isInfantry?.()) return;
        if (unit.rules?.fraidycat) {
            if (world.random() > 0.5) {
                world.scatterUnit(unit);
                return;
            }
        }
        // infantry always "have something to do" when idle — the renderer uses
        // this to pick the idle sequence instead of the standing frame
        this._actionDueThisTick = true;
    }

    actionDueThisTick(): boolean {
        return this._actionDueThisTick;
    }

    private resetCooldown(world: IdleActionWorld): void {
        const baseFrequency = world.idleActionFrequency;
        const randomOffset = world.random() * baseFrequency * 0.5;
        const frequency = Math.max(0, baseFrequency - randomOffset);
        this.cooldownTicks = Math.floor(frequency * TICKS_PER_SECOND);
    }

    debugGetState() {
        return { cooldownTicks: this.cooldownTicks, idle: this.idle, actionDue: this._actionDueThisTick };
    }
}
