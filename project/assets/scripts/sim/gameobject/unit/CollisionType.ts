/**
 * Verbatim from redalert2/src/game/gameobject/unit/CollisionType.ts.
 *
 * Only two callers read this: `Warhead.detonate` filters overlays by layer, and
 * `Projectile` decides whether it stops on the bridge deck or under it. `None`
 * and `Ground` both mean "flat ground", which is why the overlay filter treats a
 * falsy collisionType as "not on a bridge".
 */
export enum CollisionType {
    None = 0,
    Ground = 1,
    Wall = 2,
    Cliff = 3,
    OnBridge = 4,
    UnderBridge = 5,
    Shore = 6,
}
