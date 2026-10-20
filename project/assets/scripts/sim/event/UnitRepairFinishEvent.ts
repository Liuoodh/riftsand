/**
 * Port of redalert2/src/game/event/UnitRepairFinishEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class UnitRepairFinishEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly from: any,
    ) {
        this.type = EventType.UnitRepairFinish;
    }
}
