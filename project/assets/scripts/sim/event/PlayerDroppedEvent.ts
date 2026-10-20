/**
 * Port of redalert2/src/game/event/PlayerDroppedEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class PlayerDroppedEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly assetsRedistributed: any,
    ) {
        this.type = EventType.PlayerDropped;
    }
}
