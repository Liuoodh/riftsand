/**
 * Port of the rocking half of redalert2/src/game/gameobject/Vehicle.ts.
 *
 * Being hit by a warhead with `Rocker=yes` (and Terror Drone parasites) makes a
 * tank rock on its suspension for ROCKING_TICKS. The state is a countdown plus
 * a facing and a factor; the renderer turns it into a roll offset, and it is
 * purely cosmetic — no gameplay effect.
 */

/** Reference `Vehicle.ROCKING_TICKS` */
export const ROCKING_TICKS = 34;

export interface RockingState {
    ticksLeft: number;
    /** direction of the rocking, in the reference's 0-255 facing units */
    facing: number;
    /** amplitude multiplier */
    factor: number;
}

export class RockingTrait {
    rocking?: RockingState;

    /** `Vehicle.applyRocking` — ignored by aircraft */
    applyRocking(unit: any, facing: number, factor: number): void {
        if ((unit.def as any)?.consideredAircraft) return;
        this.rocking = {
            ticksLeft: this.rocking?.ticksLeft ?? ROCKING_TICKS,
            facing,
            factor,
        };
    }

    /** `Vehicle.update` */
    update(): void {
        if (!this.rocking) return;
        this.rocking.ticksLeft--;
        if (this.rocking.ticksLeft <= 0) this.rocking = undefined;
    }

    isRocking(): boolean {
        return !!this.rocking;
    }

    /** 0..1 envelope the renderer multiplies its roll by */
    getRoll(): number {
        if (!this.rocking) return 0;
        const p = this.rocking.ticksLeft / ROCKING_TICKS;
        return Math.sin(p * Math.PI * 4) * p * this.rocking.factor;
    }

    debugGetState() {
        return this.rocking ? { ...this.rocking } : undefined;
    }
}
