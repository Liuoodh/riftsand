/**
 * Port of redalert2/src/game/event/RallyPointChangeEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class RallyPointChangeEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.RallyPointChange;
    }
}
