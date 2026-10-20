/**
 * Port of redalert2/src/game/event/BuildingEvacuateEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class BuildingEvacuateEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly player: any,
    ) {
        this.type = EventType.BuildingEvacuate;
    }
}
