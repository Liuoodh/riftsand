/**
 * Verbatim from redalert2/src/game/gameobject/infantry/InfDeathType.ts.
 *
 * Picks the death animation (and the death sound) for an infantryman:
 * `Gunfire` falls over, `Explode` is gibbed, `Fire` runs around burning,
 * `Nuke` is the skeleton.
 */
export enum InfDeathType {
    None = 0,
    Gunfire = 1,
    Explode = 2,
    ExplodeAlt = 3,
    Fire = 4,
    Electro = 5,
    HeadExplode = 6,
    Nuke = 7,
}
