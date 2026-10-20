/**
 * Port of redalert2/src/game/event/ObjectDestroyEvent.ts (verbatim signature).
 *
 * `attackerInfo` is a `{ player, object, weapon }` bag, not a GameObject: the
 * killer is frequently already destroyed by the time the event dispatches.
 */
import { EventType } from './EventType';

export class ObjectDestroyEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly attackerInfo: any,
        public readonly incidental: any,
    ) {
        this.type = EventType.ObjectDestroy;
    }
}
