/**
 * Port of redalert2/src/game/event/TriggerAnimEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class TriggerAnimEvent {
    public readonly type: EventType;

    constructor(
        public readonly name: string,
        public readonly tile: any,
    ) {
        this.type = EventType.TriggerAnim;
    }
}
