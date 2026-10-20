/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyOrder.ts. */
export const NotifyOrder = {
    onPush: Symbol(),
};

export interface NotifyOrder {
    [key: symbol]: (...args: any[]) => void;
}
