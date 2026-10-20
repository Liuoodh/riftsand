/**
 * Port of redalert2/src/game/event/ObjectSellEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class ObjectSellEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.ObjectSell;
    }
}
