import { NotifyWarpChange } from './interface/NotifyWarpChange';
import { NotifyTick } from './interface/NotifyTick';

/**
 * Verbatim from redalert2/src/game/gameobject/trait/WarpedOutTrait.ts.
 *
 * "Warped out" is the state a chrono unit is in *during* teleport: it exists,
 * it occupies a tile, but nothing can touch it. Two separate flags:
 *  - `remainingTicks > 0` — is the unit currently warped out at all
 *  - `invulnerable` — and is that state protective (a chrono *attack* on an
 *    enemy is warped-out but still damageable afterwards)
 *
 * `setActive(true, ...)` uses `Infinity`, so a permanently warped-out object
 * never decrements in `onTick` (`Infinity--` is still `Infinity`).
 */
export class WarpedOutTrait {
    private gameObject: any;
    private ticksWhenWarpedOut: boolean = true;
    private remainingTicks: number = 0;
    private invulnerable: boolean = false;

    constructor(gameObject: any) {
        this.gameObject = gameObject;
    }

    isActive(): boolean {
        return this.remainingTicks > 0;
    }

    setActive(active: boolean, invulnerable: boolean, context: any): void {
        this.remainingTicks = active ? Number.POSITIVE_INFINITY : 0;
        this.invulnerable = invulnerable;
        this.notifyChange(active, context);
    }

    setTimed(ticks: number, invulnerable: boolean, context: any): void {
        this.remainingTicks = ticks;
        this.invulnerable = invulnerable;
        this.notifyChange(true, context);
    }

    debugSetActive(active: boolean): void {
        this.remainingTicks = active ? Number.POSITIVE_INFINITY : 0;
    }

    private notifyChange(isWarpedOut: boolean, context: any): void {
        context.traits.filter(NotifyWarpChange).forEach((trait: any) => {
            trait[NotifyWarpChange.onChange](this.gameObject, context, isWarpedOut);
        });
        this.gameObject.traits.filter(NotifyWarpChange).forEach((trait: any) => {
            trait[NotifyWarpChange.onChange](this.gameObject, context, isWarpedOut);
        });
    }

    expire(context: any): void {
        this.remainingTicks = 0;
        this.notifyChange(false, context);
    }

    isInvulnerable(): boolean {
        return this.isActive() && this.invulnerable;
    }

    [NotifyTick.onTick](gameObject: any, context: any): void {
        if (this.remainingTicks > 0) {
            this.remainingTicks--;
            if (this.remainingTicks <= 0) {
                this.notifyChange(false, context);
            }
        }
    }

    dispose(): void {
        this.gameObject = undefined;
    }
}
