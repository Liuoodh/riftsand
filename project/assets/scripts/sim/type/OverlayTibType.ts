/**
 * Verbatim from redalert2/src/engine/type/OverlayTibType.ts.
 *
 * The aliases are not a mistake: `Ore === Riparius` and `Gems === Cruentus`,
 * `All === 15`. Retail uses the bitmask form for `Tiberium=Ore,Gems` style
 * filter strings, so the values have to stay bit-compatible.
 */
export enum OverlayTibType {
    NotSpecial = 0,
    Riparius = 1,
    Cruentus = 2,
    Vinifera = 4,
    Aboreus = 8,
    Ore = 1,
    Gems = 2,
    All = 15,
}
