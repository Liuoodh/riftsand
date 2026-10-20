/**
 * Port of redalert2/src/game/event/TriggerEvaEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class TriggerEvaEvent {
    public readonly type: EventType;

    constructor(
        public readonly soundId: string,
    ) {
        this.type = EventType.TriggerEva;
    }
}
