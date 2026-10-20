/**
 * Port of redalert2/src/game/event/CheerEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class CheerEvent {
    public readonly type: EventType;

    constructor(
        public readonly player: any,
    ) {
        this.type = EventType.Cheer;
    }
}
