/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifySell.ts. */
export const NotifySell = {
    onSell: Symbol(),
};

export interface NotifySell {
    [key: symbol]: (...args: any[]) => void;
}
