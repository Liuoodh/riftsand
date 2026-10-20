/**
 * Port of redalert2/src/game/event/RadarOnOffEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class RadarOnOffEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly radarEnabled: boolean,
    ) {
        this.type = EventType.RadarOnOff;
    }
}
