/**
 * Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyTeleport.ts.
 *
 * Note the name: `onBeforeTeleport`, not `onTeleport`. The trait gets the chance
 * to veto or rewrite the destination *before* the position is written — that is
 * how `ChronoLocomotor` refuses to drop a tank into a cell it cannot occupy.
 */
export const NotifyTeleport = {
    onBeforeTeleport: Symbol(),
};

export interface NotifyTeleport {
    [key: symbol]: (...args: any[]) => void;
}
