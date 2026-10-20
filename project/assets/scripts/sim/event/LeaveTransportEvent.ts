/**
 * Port of redalert2/src/game/event/LeaveTransportEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class LeaveTransportEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.LeaveTransport;
    }
}
