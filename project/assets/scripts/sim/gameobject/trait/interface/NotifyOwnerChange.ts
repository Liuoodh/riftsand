/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyOwnerChange.ts. */
export const NotifyOwnerChange = {
    onChange: Symbol('onChange'),
};

export interface NotifyOwnerChange {
    [key: symbol]: (...args: any[]) => void;
}
