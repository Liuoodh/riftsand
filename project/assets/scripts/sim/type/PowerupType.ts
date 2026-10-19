export enum PowerupType {
    Armor = 0,
    Firepower = 1,
    HealBase = 2,
    Money = 3,
    Reveal = 4,
    Speed = 5,
    Veteran = 6,
    Unit = 7,
    Invulnerability = 8,
    IonStorm = 9,
    Gas = 10,
    Tiberium = 11,
    Pod = 12,
    Cloak = 13,
    Darkness = 14,
    Explosion = 15,
    ICBM = 16,
    Napalm = 17,
    Squad = 18
}

/**
 * Payouts that exist in the rules vocabulary but are never handed out.
 *
 * Reference: redalert2/src/game/trait/CrateGeneratorTrait.ts (declared there, next
 * to its only consumer). They live here so `PowerupsRules` can filter at read time
 * without importing a trait — a trait importing rules is fine, the reverse is not.
 */
export const UNSUPPORTED_POWERUP_TYPES = [
    PowerupType.IonStorm,
    PowerupType.Gas,
    PowerupType.Pod,
    PowerupType.Squad,
];
