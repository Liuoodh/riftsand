/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyDamage.ts. */
export const NotifyDamage = {
    onDamage: Symbol(),
};

export interface NotifyDamage {
    [key: symbol]: (...args: any[]) => void;
}
