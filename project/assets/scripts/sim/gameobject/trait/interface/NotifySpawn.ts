/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifySpawn.ts. */
export const NotifySpawn = {
    onSpawn: Symbol(),
};

export interface NotifySpawn {
    [key: symbol]: (...args: any[]) => void;
}
