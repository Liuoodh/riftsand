/**
 * Terrain type of a single tile — a *tile-art* property, not a land class.
 *
 * Reference: redalert2/src/engine/type/TerrainType.ts (verbatim).
 *
 * `engine/` is on the exemption list as a whole (it is the renderer), but this
 * file is a plain enum with no renderer dependency, and `getLandType` — the
 * whole reason `LandType` exists — is keyed by it. Copying the enum keeps the
 * mapping table byte-identical to the reference instead of inventing a second
 * vocabulary.
 *
 * The values are the retail `.map`/`theater.ini` ids, not ordinals: `Clear` is
 * 13 and `Cliff` is 15 because that is what the tile sets say. Never renumber.
 */
export enum TerrainType {
    Default = 0,
    Tunnel = 5,
    Railroad = 6,
    Rock1 = 7,
    Rock2 = 8,
    Water = 9,
    Shore = 10,
    Pavement = 11,
    Dirt = 12,
    Clear = 13,
    Rough = 14,
    Cliff = 15,
}
