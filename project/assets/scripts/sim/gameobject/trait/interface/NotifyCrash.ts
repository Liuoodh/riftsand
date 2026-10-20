/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyCrash.ts. */
export const NotifyCrash = {
    onCrash: Symbol(),
};

export interface NotifyCrash {
    [key: symbol]: (...args: any[]) => void;
}
