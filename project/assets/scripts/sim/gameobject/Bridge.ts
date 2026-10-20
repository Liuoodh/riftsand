/**
 * Port of redalert2/src/game/gameobject/Bridge.ts (3 lines).
 *
 * The reference models a bridge as an *overlay* (`Overlay.isHighBridge()` etc.),
 * not as a class. This interface is the structural contract the map layer uses
 * when it wants "something with a deck" without importing `Overlay` — which
 * matters because `Bridges` (map layer) is built before any game object exists.
 */
export interface Bridge {
    isHighBridge?(): boolean;
    isLowBridge?(): boolean;
    isXBridge?(): boolean;
    tileElevation?: number;
    tile?: any;
    [key: string]: any;
}
