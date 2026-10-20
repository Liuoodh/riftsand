/**
 * Port of redalert2/src/game/event/AllianceChangeEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

/**
 * Sub-kind of `AllianceChangeEvent`. Kept on the event rather than in the
 * alliance model because the renderer needs to distinguish "someone asked" from
 * "someone broke it" without reading player state.
 */
export enum AllianceEventType {
    Requested = 0,
    Formed = 1,
    Broken = 2,
}

export class AllianceChangeEvent {
    public readonly type: EventType;

    constructor(
        public readonly alliance: any,
        public readonly changeType: AllianceEventType,
        public readonly from: any,
    ) {
        this.type = EventType.AllianceChange;
    }
}
