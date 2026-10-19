/**
 * Port of redalert2/src/game/gameobject/trait/HoverBobTrait.ts.
 *
 * A hover vehicle rides at `HoverHeight` above the ground and bobs:
 *
 *   y = 0.1 * HoverHeight * sin(2π * t / (60 * HoverBob))
 *
 * where `t` is seconds since spawn. The trait keeps the *delta* between ticks
 * and applies it to the hull elevation, so it never fights the terrain height
 * (a hover unit driving up a ramp still tracks the ramp).
 */
import { GENERAL } from '../rules/GeneralRules';

export interface HoverWorld {
    /** reference `rules.general.hover.height`, in leptons (px) */
    hoverHeight: number;
    /** reference `rules.general.hover.bob`, period multiplier (retail 0.6) */
    hoverBob: number;
    /** spawn tick of the unit */
    currentTick: number;
    /** bridge elevation under the unit, 0 when not on a bridge */
    bridgeElevation(unit: any): number;
}

export class HoverBobTrait {
    private prevHoverBobLeptons = 0;
    private spawnTick = 0;

    /** NotifySpawn */
    onSpawn(unit: any, world: HoverWorld): void {
        this.spawnTick = world.currentTick;
        unit.hoverElevation = this.baseElevation(unit, world);
        this.prevHoverBobLeptons = 0;
    }

    /** NotifyTileChange (teleport only: reset the phase) */
    onTileChange(unit: any, world: HoverWorld, isTeleport: boolean): void {
        if (!isTeleport) return;
        this.prevHoverBobLeptons = 0;
        unit.hoverElevation = this.baseElevation(unit, world);
    }

    private baseElevation(unit: any, world: HoverWorld): number {
        const bridge = world.bridgeElevation(unit);
        return bridge + world.hoverHeight;
    }

    /** NotifyTick */
    onTick(unit: any, world: HoverWorld): void {
        const bob = this.computeHoverBobLeptons(world.currentTick, world.hoverBob);
        const delta = bob - this.prevHoverBobLeptons;
        this.prevHoverBobLeptons = bob;
        unit.hoverElevation = (unit.hoverElevation ?? world.hoverHeight) + delta;
    }

    private computeHoverBobLeptons(currentTick: number, bob: number): number {
        const timeInSeconds =
            (currentTick - this.spawnTick) / GENERAL.baseTicksPerSecond / (60 * Math.max(0.0001, bob));
        return 0.1 * Math.sin(2 * timeInSeconds * Math.PI);
    }

    debugGetState() {
        return { prevHoverBobLeptons: this.prevHoverBobLeptons, spawnTick: this.spawnTick };
    }
}
