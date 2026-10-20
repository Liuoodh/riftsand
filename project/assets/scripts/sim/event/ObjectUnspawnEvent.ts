/**
 * Port of redalert2/src/game/event/ObjectUnspawnEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class ObjectUnspawnEvent {
    public readonly type: EventType;

    constructor(
        public readonly gameObject: any,
    ) {
        this.type = EventType.ObjectUnspawn;
    }
}
