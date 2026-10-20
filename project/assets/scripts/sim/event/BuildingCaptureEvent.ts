/**
 * Port of redalert2/src/game/event/BuildingCaptureEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class BuildingCaptureEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.BuildingCapture;
    }
}
