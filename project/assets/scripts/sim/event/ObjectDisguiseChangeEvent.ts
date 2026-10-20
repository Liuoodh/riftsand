/**
 * Port of redalert2/src/game/event/ObjectDisguiseChangeEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class ObjectDisguiseChangeEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.ObjectDisguiseChange;
    }
}
