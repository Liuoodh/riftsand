import { clamp } from '../../util/math';
import { NotifyDamage } from './interface/NotifyDamage';
import { NotifyHealthChange } from './interface/NotifyHealthChange';
import { InflictDamageEvent } from '../../event/InflictDamageEvent';
import { NotifyHeal } from './interface/NotifyHeal';
import { HealthLevel } from '../unit/HealthLevel';
import { NotifyTick } from './interface/NotifyTick';
import { HealthChangeEvent } from '../../event/HealthChangeEvent';

/**
 * Verbatim from redalert2/src/game/gameobject/trait/HealthTrait.ts.
 *
 * The whole game speaks in *percentage* health (`0..100`) but stores hit points,
 * and the conversion is deliberately lossy in one direction:
 *
 *   `health = hitPoints / maxHitPoints * 100`   ← floating point, never rounded
 *   `health = v` → `max(1, floor(v * maxHitPoints / 100))`   ← so it can go *up*
 *
 * That `max(1, ...)` is why a 1%-health building still has 1 HP instead of 0:
 * setting health to a positive value can never kill. Only `setHitPoints(0)` can.
 *
 * `projectedHitPoints` is the "damage forecast" used by the health bar preview.
 * It clamps at `-30`, not 0, so an overkill of 30 HP still renders as a full red
 * bar rather than wrapping around.
 */
export class HealthTrait {
    private maxHitPoints: number;
    private hitPoints: number;
    private _computedHealth: number;
    private projectedHitPoints: number;
    private gameObject: any;
    private conditionYellow: number;
    private conditionRed: number;

    get health(): number {
        return this._computedHealth;
    }

    set health(value: number) {
        this.setHitPoints(value > 0 ? Math.max(1, Math.floor((value * this.maxHitPoints) / 100)) : 0);
        this.projectedHitPoints = this.hitPoints;
    }

    get level(): HealthLevel {
        return this.health > 100 * this.conditionYellow
            ? HealthLevel.Green
            : this.health > 100 * this.conditionRed
            ? HealthLevel.Yellow
            : HealthLevel.Red;
    }

    constructor(maxHitPoints: number, gameObject: any, conditionYellow: number, conditionRed: number) {
        this.maxHitPoints = maxHitPoints;
        this.gameObject = gameObject;
        this.conditionYellow = conditionYellow;
        this.conditionRed = conditionRed;
        this.setHitPoints(maxHitPoints);
        this.projectedHitPoints = this.hitPoints;
    }

    setHitPoints(value: number): void {
        if (value !== Math.floor(value)) {
            throw new Error(`Value ${value} is not an integer`);
        }
        this.hitPoints = clamp(value, 0, this.maxHitPoints);
        this._computedHealth = (this.hitPoints / this.maxHitPoints) * 100;
    }

    getHitPoints(): number {
        return this.hitPoints;
    }

    getProjectedHitPoints(): number {
        return this.projectedHitPoints;
    }

    inflictDamage(amount: number, source: any, world: any): void {
        const oldHitPoints = this.hitPoints;
        const oldHealth = this.health;
        this.applyHitPoints(oldHitPoints - amount, world);

        // Healing goes through `healBy`; a negative `amount` here would silently
        // fire a damage notification for a heal.
        if (oldHitPoints !== this.hitPoints && amount > 0) {
            this.gameObject.traits.filter(NotifyDamage).forEach((trait: any) => {
                trait[NotifyDamage.onDamage](this.gameObject, world, amount, source);
            });
            world.events.dispatch(new InflictDamageEvent(this.gameObject, source, amount, this.health, oldHealth));
        }
    }

    healBy(amount: number, source: any, world: any): void {
        if (amount < 0) {
            throw new Error("Can't heal by negative value " + amount);
        }
        if (this.hitPoints < this.maxHitPoints) {
            const oldHitPoints = this.hitPoints;
            this.applyHitPoints(this.hitPoints + amount, world);
            this.projectedHitPoints = this.hitPoints;
            const healedAmount = this.hitPoints - oldHitPoints;
            this.gameObject.traits.filter(NotifyHeal).forEach((trait: any) => {
                trait[NotifyHeal.onHeal]?.(this.gameObject, world, healedAmount, source);
            });
        }
    }

    healToFull(source: any, world: any): void {
        if (this.hitPoints < this.maxHitPoints) {
            const oldHitPoints = this.hitPoints;
            this.applyHitPoints(this.maxHitPoints, world);
            this.projectedHitPoints = this.hitPoints;
            const healedAmount = this.hitPoints - oldHitPoints;
            this.gameObject.traits.filter(NotifyHeal).forEach((trait: any) => {
                trait[NotifyHeal.onHeal]?.(this.gameObject, world, healedAmount, source);
            });
        }
    }

    applyHitPoints(value: number, world: any): void {
        const oldHealth = this.health;
        this.setHitPoints(value);
        if (oldHealth !== this.health) {
            // Both the world-wide listeners and the object's own listeners fire,
            // in that order. A world listener sees the change before the object
            // has reacted to it.
            world.traits.filter(NotifyHealthChange).forEach((trait: any) => {
                trait[NotifyHealthChange.onChange](this.gameObject, world, oldHealth);
            });
            this.gameObject.traits.filter(NotifyHealthChange).forEach((trait: any) => {
                trait[NotifyHealthChange.onChange](this.gameObject, world, oldHealth);
            });
            world.events.dispatch(new HealthChangeEvent(this.gameObject, this.health, oldHealth));
        }
    }

    projectDamage(amount: number): void {
        if (amount < 0) {
            throw new Error('Projected damage must be positive');
        }
        this.projectedHitPoints = Math.max(-30, this.projectedHitPoints - amount);
    }

    [NotifyTick.onTick](gameObject: any, world: any): void {
        // The forecast recovers 1 HP every 4 ticks until it catches up with
        // reality — that is the "ghost bar drains back" animation.
        if (world.currentTick % 4 === 0) {
            this.projectedHitPoints = Math.min(this.projectedHitPoints + 1, this.hitPoints);
        }
    }

    getHash(): number {
        return this.hitPoints;
    }

    debugGetState(): { hitPoints: number } {
        return { hitPoints: this.hitPoints };
    }

    dispose(): void {
        this.gameObject = undefined;
    }
}
