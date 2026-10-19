/**
 * Port of redalert2/src/game/gameobject/trait/C4ChargeTrait.ts.
 *
 * A satchel charge planted on a structure. The trait lives on the *target*, not
 * on the engineer: `setCharge(duration, attacker)` arms a wall-clock, and when
 * the timer expires the object is destroyed with `DeathType.Demolish` (the
 * collapse animation) rather than the usual explosion.
 *
 * `setCharge` deliberately refuses to re-arm while a charge is already ticking
 * — dropping four engineers on one building must not stack four timers, and it
 * must not extend the first one either.
 *
 * The reference reaches `invulnerableTrait.isActive()` directly; here the target
 * is any member of this project's `Entity` hierarchy, so the check goes through
 * `invulnUntil > -1` (`Entity.get invulnerable`), which is the same predicate.
 */
import { DeathType } from '../gameobject/DeathType';
import { Timer } from '../Timer';

/** How the world executes the demolition. */
export interface C4World {
    currentTick: number;
    /** reference `context.destroyObject(target, attackerInfo, true)` */
    destroyObject(target: any, attackerInfo: any, isDemolish: boolean): void;
    /** bridges blow their span instead of collapsing; absent for normal buildings */
    demolishBridge?(target: any, attackerInfo: any): void;
}

export class C4ChargeTrait {
    private timer: Timer;
    private attackerInfo: any;

    constructor() {
        this.timer = new Timer();
    }

    hasCharge(): boolean {
        return this.timer.isActive();
    }

    /** ticks left, for the HUD / probe scripts */
    getTicksLeft(): number {
        return this.timer.getTicksLeft();
    }

    setCharge(duration: number, attacker: any): void {
        if (!this.hasCharge()) {
            this.timer.setActiveFor(duration);
            this.attackerInfo = attacker;
        }
    }

    /** NotifyTick.onTick */
    onTick(target: any, world: C4World): void {
        if (this.timer.isActive() && this.timer.tick(world.currentTick) === true) {
            if (!target.invulnerable) {
                if (!!target.isBuilding && target.cabHutTrait && world.demolishBridge) {
                    world.demolishBridge(target, this.attackerInfo);
                } else {
                    target.deathType = DeathType.Demolish;
                    world.destroyObject(target, this.attackerInfo, true);
                }
            }
        }
    }
}
