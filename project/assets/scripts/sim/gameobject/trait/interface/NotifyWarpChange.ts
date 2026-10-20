/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyWarpChange.ts. */
export const NotifyWarpChange = {
    onChange: Symbol(),
};

export interface NotifyWarpChange {
    [key: symbol]: (...args: any[]) => void;
}
