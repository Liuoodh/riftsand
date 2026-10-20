/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyTileChange.ts. */
export const NotifyTileChange = {
    onTileChange: Symbol(),
};

export interface NotifyTileChange {
    [key: symbol]: (...args: any[]) => void;
}
