/** Verbatim from redalert2/src/game/trait/interface/NotifyElevationChange.ts. */
export const NotifyElevationChange = {
    onElevationChange: Symbol(),
};

export interface NotifyElevationChange {
    [key: symbol]: (...args: any[]) => void;
}
