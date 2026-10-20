/**
 * Port of redalert2/src/game/event/TriggerTextEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class TriggerTextEvent {
    public readonly type: EventType;

    constructor(
        public readonly label: any,
    ) {
        this.type = EventType.TriggerText;
    }
}
