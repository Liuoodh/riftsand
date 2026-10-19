/**
 * Faction sides.
 *
 * Reference: redalert2/src/game/SideType.ts
 *
 * In this project the *names* are ours (the roster is original) but the enum
 * exists so rules data can carry the same `AIBasePlanningSide` / house-side
 * semantics the reference uses. Values are positional, so never renumber them.
 */
export enum SideType {
    /** side 0 — the reference's GDI slot */
    GDI = 0,
    /** side 1 — the reference's Nod slot */
    Nod = 1,
    Civilian = 2,
    Mutant = 3,
    /** side 2 — the reference's third-faction slot */
    Yuri = 4,
}
