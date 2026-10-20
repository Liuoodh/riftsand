/**
 * Port of redalert2/src/game/event/PlayerResignedEvent.ts (verbatim signature).
 *
 * `assetsRedistributed` is optional: resigning in a 1v1 has nobody to give the
 * assets to.
 */
import { EventType } from './EventType';

export class PlayerResignedEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly assetsRedistributed?: any,
    ) {
        this.type = EventType.PlayerResigned;
    }
}
