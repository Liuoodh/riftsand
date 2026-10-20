/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyHeal.ts. */
export const NotifyHeal = {
    onHeal: Symbol(),
};

export interface NotifyHeal {
    [key: symbol]: (...args: any[]) => void;
}
