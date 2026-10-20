/**
 * Port of redalert2/src/game/art/SequenceType.ts (37 lines).
 *
 * The 35 animation slots every `[art]` entry may define. The order is the
 * reference's, and it matters for exactly one reason: the enum's numeric value
 * is used as an index into the per-object sequence table, so re-ordering it
 * silently re-skins every infantry in the game (`Ready` would start pointing at
 * the cheer animation).
 *
 * Only a handful of call sites name a sequence directly. `CheerTask` asks for
 * `Cheer`; everything else goes through `SequenceType.Ready` / `Walk` in the
 * renderable layer (not part of this port — the canvas/PNG pipeline builds its
 * own sprite table from the same names).
 */
export enum SequenceType {
    Ready = 0,
    Guard = 1,
    Prone = 2,
    Walk = 3,
    FireUp = 4,
    Down = 5,
    Crawl = 6,
    Up = 7,
    FireProne = 8,
    Idle1 = 9,
    Idle2 = 10,
    Die1 = 11,
    Die2 = 12,
    Hover = 13,
    Fly = 14,
    FireFly = 15,
    Tumble = 16,
    AirDeathStart = 17,
    AirDeathFalling = 18,
    AirDeathFinish = 19,
    Tread = 20,
    Swim = 21,
    WetAttack = 22,
    WetIdle1 = 23,
    WetIdle2 = 24,
    WetDie1 = 25,
    WetDie2 = 26,
    Deploy = 27,
    Deployed = 28,
    DeployedFire = 29,
    DeployedIdle = 30,
    Undeploy = 31,
    Paradrop = 32,
    Cheer = 33,
    Panic = 34,
}
