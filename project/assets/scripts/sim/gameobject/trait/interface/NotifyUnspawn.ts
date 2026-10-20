/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyUnspawn.ts. */
export const NotifyUnspawn = {
    onUnspawn: Symbol(),
};

export interface NotifyUnspawn {
    [key: symbol]: (...args: any[]) => void;
}
