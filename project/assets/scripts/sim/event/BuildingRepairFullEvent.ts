/**
 * Port of redalert2/src/game/event/BuildingRepairFullEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class BuildingRepairFullEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly source: any,
    ) {
        this.type = EventType.BuildingRepairFull;
    }
}
