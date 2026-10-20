/**
 * Port of redalert2/src/game/event/UnitPromoteEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class UnitPromoteEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.UnitPromote;
    }
}
