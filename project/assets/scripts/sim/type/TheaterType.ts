/**
 * Theater vocabulary.
 *
 * Reference: redalert2/src/engine/TheaterType.ts (enum only — `TheaterSettings`
 * belongs to the asset loader, which is a later batch).
 *
 * The values are a bitmask, not an index: `All = 63` and `TheaterType.Snow` is 4.
 * `TerrainRules.getOccupationBits` compares against `Snow` by identity, so the
 * numbers must not be renumbered.
 */
export enum TheaterType {
    None = 0,
    Temperate = 1,
    Urban = 2,
    Snow = 4,
    Lunar = 8,
    Desert = 16,
    NewUrban = 32,
    All = 63
}
