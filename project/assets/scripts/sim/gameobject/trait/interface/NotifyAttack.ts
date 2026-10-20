/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyAttack.ts. */
export const NotifyAttack = {
    onAttack: Symbol(),
};

export interface NotifyAttack {
    [key: symbol]: (...args: any[]) => void;
}
