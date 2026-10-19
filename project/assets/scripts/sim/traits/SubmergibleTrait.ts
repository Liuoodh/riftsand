/**
 * Port of redalert2/src/game/gameobject/trait/SubmergibleTrait.ts.
 *
 * A submarine dives when it has been out of combat for `CloakDelay` minutes and
 * surfaces the instant it takes damage. While submerged it cannot be shot at by
 * anything that is not a detector, and it cannot fire.
 *
 * The timing rule in the reference is subtle and worth keeping exactly:
 *   - firing while standing still *resets* the timer to at least 5 s, so a sub
 *     that keeps shooting never dives;
 *   - moving does not reset it, so a repositioning sub still dives on schedule.
 *
 * No naval unit exists in this roster yet; the trait is ported intact.
 */
import { GENERAL } from '../rules/GeneralRules';

export interface SubmergeWorld {
    /** `[General] CloakDelay`, in minutes */
    cloakDelay: number;
    /** is the unit currently attacking? (reference AttackTrait.attackState) */
    isAttacking(unit: any): boolean;
    isMoving(unit: any): boolean;
    /** the sub's parasite state blocks diving (reference ParasiteableTrait) */
    isInfested(unit: any): boolean;
    onSubmergeChange(unit: any): void;
}

export class SubmergibleTrait {
    private isActive = false;
    private cooldownTicks?: number;

    isSubmerged(): boolean {
        return this.isActive;
    }

    setCooldown(ticks: number): void {
        this.cooldownTicks = ticks;
    }

    /** NotifyTick */
    onTick(unit: any, world: SubmergeWorld): void {
        if (this.isActive || world.isInfested(unit)) return;
        if (world.isAttacking(unit) && !world.isMoving(unit)) {
            this.cooldownTicks = Math.max(
                this.cooldownTicks ?? 0,
                5 * GENERAL.baseTicksPerSecond,
            );
        } else {
            this.cooldownTicks ??= Math.floor(60 * world.cloakDelay * GENERAL.baseTicksPerSecond);
        }
        if (this.cooldownTicks > 0) this.cooldownTicks--;
        if (this.cooldownTicks <= 0) {
            this.isActive = true;
            world.onSubmergeChange(unit);
        }
    }

    /** NotifyDamage.onDamage — any hit forces it up */
    onDamage(unit: any, world: SubmergeWorld): void {
        this.emerge(unit, world);
    }

    emerge(unit: any, world: SubmergeWorld): void {
        if (!this.isActive) return;
        this.isActive = false;
        this.cooldownTicks = undefined;
        world.onSubmergeChange(unit);
    }

    debugGetState() {
        return { isActive: this.isActive, cooldownTicks: this.cooldownTicks };
    }
}
