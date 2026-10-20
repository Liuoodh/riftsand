/**
 * Verbatim from redalert2/src/engine/type/TiberiumType.ts.
 *
 * Same aliasing as `OverlayTibType`: Ore is Riparius, Gems is Cruentus. Anything
 * that pays out money switches on the *semantic* name, everything that reads a
 * map overlay switches on the *species* name.
 */
export enum TiberiumType {
    Riparius = 0,
    Cruentus = 1,
    Vinifera = 2,
    Aboreus = 3,
    Ore = 0,
    Gems = 1,
}
