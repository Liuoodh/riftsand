/** Verbatim from redalert2/src/game/gameobject/trait/interface/NotifyBuildStatus.ts. */
export interface NotifyBuildStatus {
    [key: symbol]: (...args: any[]) => void;
}

export const NotifyBuildStatus = {
    onStatusChange: Symbol(),
};
