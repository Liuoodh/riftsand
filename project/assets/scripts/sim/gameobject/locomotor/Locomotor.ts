/**
 * Port of redalert2/src/game/gameobject/locomotor/Locomotor.ts (3 lines).
 *
 * Empty in the reference — every concrete locomotor is a *structural* type, not
 * a subclass. They all answer some subset of
 *
 *     selectNextWaypoint(obj, waypoints)
 *     onNewWaypoint(obj, target, ...)
 *     onWaypointUpdate(obj, target)
 *     tick(obj, ...) -> { distance: Vector3, done: boolean }
 *     tickStationary(obj, game)          (aircraft only)
 *     tickCrash(obj, game, state)        (aircraft only)
 *
 * and `MoveTrait` calls whichever ones exist. Declaring the interface here keeps
 * that contract in one place without forcing a base class the reference does not
 * have.
 */
export interface Locomotor {
    /** how far this locomotor can be driven out of map bounds before it dies */
    readonly ignoresTerrain?: boolean;
    selectNextWaypoint?(obj: any, waypoints: any[]): any;
    onNewWaypoint?(obj: any, target: any, ...rest: any[]): any;
    onWaypointUpdate?(obj: any, target: any): void;
    tick?(obj: any, ...args: any[]): { distance: any; done: boolean } | undefined;
}

export class LocomotorBase {}
