/**
 * Verbatim from redalert2/src/game/trait/interface/NotifyTileChange.ts.
 *
 * This is the **global** hook — every trait in `game.traits` (spy, crate
 * generator, radar) gets told that *some* object entered a cell. It is a
 * different `Symbol()` from `gameobject/trait/interface/NotifyTileChange`,
 * which is the per-object hook. Two symbols, two subscriber lists; a trait that
 * implements the wrong one simply never fires (see REFERENCE-PARITY §27).
 */
export const NotifyTileChange = {
    onTileChange: Symbol(),
};

export interface NotifyTileChange {
    [key: symbol]: (...args: any[]) => void;
}
