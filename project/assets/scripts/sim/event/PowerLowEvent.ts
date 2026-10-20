/**
 * Port of redalert2/src/game/event/PowerLowEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class PowerLowEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.PowerLow;
    }
}
