/**
 * Verbatim from redalert2/src/game/gameobject/infantry/StanceType.ts.
 *
 * Stance is not cosmetic: `Deployed` and `Cheer` disable the MoveTrait and
 * `Paradrop` / `Cheer` disable the attack trait, which is how a G.I. in its
 * sandbag emplacement stops walking and a cheering civilian stops shooting.
 */
export enum StanceType {
    None = 0,
    Guard = 1,
    Prone = 2,
    Deployed = 3,
    Paradrop = 4,
    Cheer = 5,
}
