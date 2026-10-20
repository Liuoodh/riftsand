/**
 * Port of redalert2/src/game/event/ShipSubmergeChangeEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class ShipSubmergeChangeEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.ShipSubmergeChange;
    }
}
