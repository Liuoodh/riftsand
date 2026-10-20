import { Timer } from '../../Timer';
import { NotifyTick } from './interface/NotifyTick';

/**
 * Verbatim from redalert2/src/game/gameobject/trait/InvulnerableTrait.ts.
 *
 * `setActiveFor` passes the *world* as the timer's timestamp argument. That is
 * a reference bug and it is kept on purpose: `Timer.tick` then computes
 * `currentTick - <object>` = NaN, `NaN > activeFor` is false, so the timer only
 * ever expires by tick count. Passing a real timestamp would make it expire
 * early whenever `world.currentTick` had advanced before activation.
 */
export class InvulnerableTrait {
    private timer: Timer;

    constructor() {
        this.timer = new Timer();
    }

    isActive(): boolean {
        return this.timer.isActive();
    }

    setActiveFor(duration: number, world: any): void {
        this.timer.setActiveFor(duration, world as any);
    }

    [NotifyTick.onTick](gameObject: any, world: any): void {
        this.timer.tick(world.currentTick);
    }
}
