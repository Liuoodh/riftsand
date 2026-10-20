/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyHealthChange.ts. */
export const NotifyHealthChange = {
    onChange: Symbol(),
};

export interface NotifyHealthChange {
    [key: symbol]: (...args: any[]) => void;
}
