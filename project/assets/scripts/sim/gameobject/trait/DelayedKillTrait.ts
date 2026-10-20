import { Timer } from '../../Timer';
import { NotifyTick } from './interface/NotifyTick';

/**
 * Verbatim from redalert2/src/game/gameobject/trait/DelayedKillTrait.ts.
 *
 * The "structure burns down" mechanic. `Warhead.detonate` clamps the killing
 * blow to `hp - 1` and arms this timer, so the building keeps standing for a few
 * seconds (with smoke and fire) before collapsing. Two guards at expiry:
 *  - `!invulnerableTrait.isActive()` — an Iron Curtain applied mid-burn cancels
 *    the collapse, and the timer is *not* re-armed.
 *  - `!(isBuilding() && cabHutTrait)` — a CAB hut (the little structure a G.I.
 *    builds) is exempt, because destroying it would leave the deployed infantry
 *    with nowhere to go.
 *
 * `activate` is a no-op while already active, matching `Timer.setActiveFor`'s
 * "first C4 wins" behaviour.
 */
export class DelayedKillTrait {
    private timer: Timer;
    private attackerInfo: any;

    constructor() {
        this.timer = new Timer();
    }

    isActive(): boolean {
        return this.timer.isActive();
    }

    activate(ticks: number, attackerInfo: any): void {
        if (!this.isActive()) {
            this.timer.setActiveFor(ticks);
            this.attackerInfo = attackerInfo;
        }
    }

    [NotifyTick.onTick](target: any, context: any): void {
        if (this.timer.isActive() && this.timer.tick(context.currentTick) === true) {
            if (!target.invulnerableTrait.isActive() && !(target.isBuilding() && target.cabHutTrait)) {
                context.destroyObject(target, this.attackerInfo, true, true);
            }
        }
    }
}
