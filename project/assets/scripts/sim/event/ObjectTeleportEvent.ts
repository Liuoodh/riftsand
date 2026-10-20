/**
 * Port of redalert2/src/game/event/ObjectTeleportEvent.ts (verbatim signature).
 *
 * `prevTile` lets the renderer draw the "warp in" streak from where the object
 * used to be; without it a chrono jump looks like a normal move.
 */
import { EventType } from './EventType';

export class ObjectTeleportEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly isChronoshift: any,
        public readonly prevTile: any,
    ) {
        this.type = EventType.ObjectTeleport;
    }
}
