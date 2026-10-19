/**
 * Port of redalert2/src/game/gameobject/trait/UnitReloadTrait.ts.
 *
 * Lives on the *pad*, not on the aircraft: every `reloadRate` minutes a docked,
 * landed aircraft gains one round. Only `ManualReload` units reload this way,
 * and only when they are actually on the ground — a plane hovering over the pad
 * counts as "still flying" and gets nothing.
 *
 * Retail gates the cooldown on "some docked unit can still take ammo", so a pad
 * full of full aircraft burns no timer at all.
 */
import { TICKS_PER_SECOND } from '../Constants';

export interface ReloadWorld {
    /** `[General] ReloadRate`, in minutes, per round */
    reloadRateMinutes: number;
    currentTick: number;
}

export class UnitReloadTrait {
    private cooldownTicks?: number;

    /** NotifyTick */
    onTick(building: any, world: ReloadWorld): void {
        const dock = building.dockTrait;
        if (!dock || !dock.hasDockedUnits()) {
            this.cooldownTicks = undefined;
            return;
        }
        const docked: any[] = dock.getDockedUnits();
        if (docked.every((unit) => !this.canReloadUnit(unit))) {
            this.cooldownTicks = undefined;
            return;
        }
        if (this.cooldownTicks === undefined) {
            this.cooldownTicks = Math.max(1, Math.round(TICKS_PER_SECOND * world.reloadRateMinutes * 60));
        }
        if (this.cooldownTicks <= 0) {
            this.cooldownTicks = Math.max(1, Math.round(TICKS_PER_SECOND * world.reloadRateMinutes * 60));
            const unitsToReload = docked[0].ammoTrait?.ammo === 0 ? docked.slice(0, 1) : docked;
            for (const unit of unitsToReload) {
                if (this.canReloadUnit(unit)) unit.ammoTrait!.ammo++;
            }
        } else {
            this.cooldownTicks--;
        }
    }

    canReloadUnit(unit: any): boolean {
        return !!(
            unit.ammoTrait &&
            unit.rules?.manualReload !== false &&
            unit.def?.manualReload &&
            !unit.ammoTrait.isFull() &&
            !unit.isAirborne
        );
    }

    debugGetState() {
        return { cooldownTicks: this.cooldownTicks };
    }
}
