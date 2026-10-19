/**
 * Port of redalert2/src/game/gameobject/common/DeathType.ts.
 *
 * `Normal` is everything that dies to ordinary weapons; the rest are the
 * special animation families. Only `Demolish` is produced by a ported trait so
 * far (C4ChargeTrait), but the whole enum is kept because the renderer keys the
 * death sequence off it.
 */
export enum DeathType {
    None = 0,
    Normal = 1,
    Demolish = 2,
    Crush = 3,
    Temporal = 4,
    Sink = 5,
}
