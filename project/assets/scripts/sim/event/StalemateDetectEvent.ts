/**
 * Port of redalert2/src/game/event/StalemateDetectEvent.ts (verbatim signature).
 *
 * No payload — the type discriminator is the whole message.
 */
import { EventType } from './EventType';

export class StalemateDetectEvent {
    public readonly type: EventType;

    constructor() {
        this.type = EventType.StalemateDetect;
    }
}
