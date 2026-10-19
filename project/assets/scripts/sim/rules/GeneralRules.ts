/**
 * `[General]` rules that the ported systems read.
 *
 * Reference: redalert2/src/game/rules/GeneralRules.ts (the fields below are
 * copied with their retail defaults; the INI is not present in this project).
 *
 * These are deliberately *not* spread across the code as magic numbers: the
 * production tick, the power penalty and the harvester/refinery logic all read
 * them from here, so tuning one value changes every dependent system the same
 * way it does in retail.
 */
export const GENERAL = {
    /** BaseTicksPerSecond — the simulation runs at 15 logic ticks per second. */
    baseTicksPerSecond: 15,

    /** BuildSpeed (rules.ini 1.0): credits per tick scale. */
    buildSpeed: 1,
    /** Minimum time slice for a 1-credit production item, in milliseconds. */
    buildTimeFloorMs: 54,
    /** MultipleFactory=0.8: each extra factory divides build time by 0.8. */
    multipleFactory: 0.8,
    /** Walls build 10x slower than their nominal cost. */
    wallBuildSpeedCoefficient: 0.1,
    /** MaximumQueuedObjects (retail 6) — the queue holds max+1. */
    maximumQueuedObjects: 6,
    /** Low power: -30% at a 15% deficit, clamped to [0.5, 1]. */
    lowPowerPenaltyModifier: 1,
    minLowPowerProductionSpeed: 0.5,
    maxLowPowerProductionSpeed: 1,

    /** BuildupTime=0.07 *minutes* — how long the raise animation runs. */
    buildupTime: 0.07,
    /** CloseEnough=2 cells: a move order may stop this far from its target. */
    closeEnough: 2,
    /** HarvesterTooFarDistance=5 cells before it re-picks a refinery. */
    harvesterTooFarDistance: 5,
    /** RefundPercent=0.5 of the purchase value when selling. */
    refundPercent: 0.5,
    /** PurifierBonus=0.25 per ore purifier. */
    purifierBonus: 0.25,
    /** Ore value per bail, by TiberiumType. */
    oreValue: 25,
    gemValue: 50,
    /** Storage of a standard harvester (one bail = one unit). */
    harvesterStorage: 20,
    /**
     * `[General] ReloadRate` — minutes of pad time per ammunition round.
     * Retail ships 1 (a full minute per round); our aircraft carry only 2-8
     * rounds, so it is tuned to one second per round to keep a sortie cycle
     * near 20 s instead of several minutes.
     */
    reloadRate: 1 / 60,

    /**
     * `[General] Crew` block — who climbs out of a wrecked structure.
     *
     * `survivorDivisor` converts a building's refund value into a head count, so
     * a 2600-credit super weapon coughs up five men while a 420-credit tent
     * coughs up one. The divisor is scaled to *this* project's cost curve
     * (400-2600 credits) rather than retail's, otherwise every structure would
     * hit the five-man cap. `CrewEscape` / `SurvivorRate` are read by the
     * reference but never used by `CrewedTrait`, so they are not carried over.
     */
    crew: {
        alliedCrew: 'pebble',
        alliedSurvivorDivisor: 260,
        sovietCrew: 'sandfly',
        sovietSurvivorDivisor: 260,
        alliedEngineer: 'sapper',
        sovietEngineer: 'wire',
    },

    /**
     * `[CombatDamage] C4Delay` — minutes between the charge being planted and
     * the structure collapsing (`PlantC4Task.onEnter` scales it by 60 * 15).
     * Retail's value is very short; 0.05 keeps the 3-second fuse.
     */
    c4Delay: 0.05,

    /**
     * `[General] Repair` block — the service depot.
     *
     * `repairPercent` is the *total* cost of a repair from zero to full,
     * expressed as a fraction of the unit's purchase value (retail 0.2), which
     * is why the per-HP cost is `repairPercent * purchaseValue / maxHitPoints`.
     * `uRepairRate` is minutes per repair step.
     */
    repair: {
        reloadRate: 1 / 60,
        repairPercent: 0.2,
        repairRate: 1,
        repairStep: 12,
        uRepairRate: 0.016,
        iRepairRate: 0.016,
        iRepairStep: 6,
    },
} as const;

/** `floorTo` from the reference's util/math. */
export function floorTo(value: number, step: number): number {
    return Math.floor(value / step) * step;
}

export function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}
