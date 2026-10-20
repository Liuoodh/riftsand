/**
 * Port of redalert2/src/game/event/EnterTransportEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class EnterTransportEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.EnterTransport;
    }
}
