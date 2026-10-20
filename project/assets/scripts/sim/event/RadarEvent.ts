/**
 * Port of redalert2/src/game/event/RadarEvent.ts (verbatim signature).
 *
 * `radarEventType` is the minimap ping shape (attack / unit-lost / …). The
 * renderer's switch is the only consumer.
 */
import { EventType } from './EventType';

export class RadarEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly radarEventType: any,
        public readonly tile: any,
    ) {
        this.type = EventType.RadarEvent;
    }
}
