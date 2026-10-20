/**
 * Port of redalert2/src/game/event/ObjectCloakChangeEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class ObjectCloakChangeEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.ObjectCloakChange;
    }
}
