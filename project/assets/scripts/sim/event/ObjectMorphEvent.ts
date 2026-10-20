/**
 * Port of redalert2/src/game/event/ObjectMorphEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class ObjectMorphEvent {
    public readonly type: EventType;

    constructor(
        public readonly from: any,
        public readonly to: any,
    ) {
        this.type = EventType.ObjectMorph;
    }
}
