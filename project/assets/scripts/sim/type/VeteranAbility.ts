/**
 * Veteran / elite promotion abilities.
 *
 * Reference: redalert2/src/game/gameobject/unit/VeteranAbility.ts and
 * VeteranLevel.ts — verbatim. `VeteranTrait` grants one ability per level from
 * these sets, and `AttackTrait` / `HealthTrait` read the level again for the
 * rate-of-fire and strength multipliers in `[General] Veteran` rules.
 */
export enum VeteranAbility {
    FASTER = 0,
    STRONGER = 1,
    FIREPOWER = 2,
    SCATTER = 3,
    ROF = 4,
    SIGHT = 5,
    SELF_HEAL = 6,
    CLOAK = 7,
    EXPLODES = 8,
    RADAR_INVISIBLE = 9,
    SENSORS = 10,
    FEARLESS = 11,
    C4 = 12,
    GUARD_AREA = 13,
    CRUSHER = 14,
}

export enum VeteranLevel {
    None = 0,
    Veteran = 1,
    Elite = 2,
}
