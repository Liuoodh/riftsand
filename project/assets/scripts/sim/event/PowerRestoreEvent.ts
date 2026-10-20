/**
 * Port of redalert2/src/game/event/PowerRestoreEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class PowerRestoreEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.PowerRestore;
    }
}
