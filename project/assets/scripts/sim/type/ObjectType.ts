/**
 * Engine-level object classification.
 *
 * Reference: redalert2/src/engine/type/ObjectType.ts — copied verbatim.
 * Not part of `game/`, but every rules table keys off it, so it lives here.
 */
export enum ObjectType {
    None = 0,
    Aircraft = 1,
    Building = 2,
    Infantry = 3,
    Overlay = 4,
    Smudge = 5,
    Terrain = 6,
    Vehicle = 7,
    Animation = 8,
    Projectile = 9,
    VoxelAnim = 10,
    Debris = 11,
}
