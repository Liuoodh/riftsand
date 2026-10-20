/**
 * Port of redalert2/src/game/event/PowerChangeEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class PowerChangeEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly power: any,
        public readonly drain: any,
    ) {
        this.type = EventType.PowerChange;
    }
}
