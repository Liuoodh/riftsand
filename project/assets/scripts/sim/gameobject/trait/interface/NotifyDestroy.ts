/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyDestroy.ts. */
export const NotifyDestroy = {
    onDestroy: Symbol('onDestroy'),
};

export interface NotifyDestroy {
    [key: symbol]: (...args: any[]) => void;
}
