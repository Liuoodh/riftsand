/**
 * Port of redalert2/src/game/gameobject/trait/AgentTrait.ts.
 *
 * The spy's infiltration payload. Every effect is gated on a flag of the
 * building that was entered, which is why a spy can walk into a Tesla Reactor
 * (power > 0 → blackout) but learns nothing from a Sandbag.
 *
 * The reference also resets `mapShroudTrait` when the victim owns a radar —
 * shroud is not part of this project, so that branch is kept as a documented
 * no-op rather than silently dropped.
 */
import { clamp } from '../Math2';

/** `[General] SpyPowerBlackout` — seconds the victim's base stays dark */
export const SPY_POWER_BLACKOUT = 60;
/** `[General] SpyMoneyStealPercent` */
export const SPY_MONEY_STEAL_PERCENT = 0.5;

export interface AgentWorld {
    rules: {
        general: {
            spyPowerBlackout: number;
            spyMoneyStealPercent: number;
        };
    };
    /** buildings owned by a player, used by the radar branch */
    buildingsOf(owner: any): any[];
    /** clears the victim's shroud (no-op in this project) */
    resetShroud?(owner: any): void;
}

export class AgentTrait {
    infiltrate(agent: any, target: any, world: AgentWorld): void {
        // radar: reveal the map (shroud is not simulated here)
        if (target.rules?.radar && !world.buildingsOf(target.owner).some((b: any) => b.rules?.spySat)) {
            world.resetShroud?.(target.owner);
        }

        // power: black the base out for SpyPowerBlackout seconds
        if ((target.rules?.power ?? 0) > 0) {
            const blackoutTime = world.rules.general.spyPowerBlackout;
            target.owner.powerTrait?.setBlackoutFor?.(blackoutTime, world);
        }

        // super weapon: reset the charge
        if (target.superWeaponTrait) {
            target.superWeaponTrait.getSuperWeapon?.(target)?.resetTimer?.();
        }

        // storage (refinery / silo): steal cash
        if ((target.rules?.storage ?? 0) > 0) {
            const stealPercent = clamp(world.rules.general.spyMoneyStealPercent, 0, 1);
            const stolenAmount = Math.floor(target.owner.credits * stealPercent);
            target.owner.credits -= stolenAmount;
            agent.owner.credits += stolenAmount;
        }

        // battle lab: steal tech
        if (target.rules?.aiBasePlanningSide !== undefined && target.def?.isTechLab) {
            agent.owner.production?.addStolenTech?.(target.rules.aiBasePlanningSide);
        }

        // barracks / war factory: veteran units from now on
        if (target.factoryTrait && (target.factoryTrait.type === 1 || target.factoryTrait.type === 0)) {
            agent.owner.production?.addVeteranType?.(target.factoryTrait.type);
        }
    }
}
