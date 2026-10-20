/**
 * Port of redalert2/src/game/event/EnterTileEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class EnterTileEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly source: any,
    ) {
        this.type = EventType.EnterTile;
    }
}
