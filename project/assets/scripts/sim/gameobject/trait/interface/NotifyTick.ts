/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyTick.ts. */
export const NotifyTick = {
    onTick: Symbol(),
};

export interface NotifyTick {
    [key: symbol]: (...args: any[]) => void;
}
