/**
 * Port of redalert2/src/game/event/BuildingInfiltrationEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class BuildingInfiltrationEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly source: any,
    ) {
        this.type = EventType.BuildingInfiltration;
    }
}
