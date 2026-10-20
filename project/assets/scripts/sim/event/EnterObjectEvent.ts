/**
 * Port of redalert2/src/game/event/EnterObjectEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class EnterObjectEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly source: any,
    ) {
        this.type = EventType.EnterObject;
    }
}
