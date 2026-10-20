/**
 * Port of redalert2/src/game/event/ObjectCrashingEvent.ts (verbatim signature).
 *
 * Fired once when an aircraft starts falling, *not* on every tick of the fall.
 * `ObjectDestroyEvent` follows when it hits.
 */
import { EventType } from './EventType';

export class ObjectCrashingEvent {
    public readonly type: EventType;

    constructor(
        public readonly gameObject: any,
    ) {
        this.type = EventType.ObjectCrashing;
    }
}
