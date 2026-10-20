/**
 * Port of redalert2/src/game/event/CratePickupEvent.ts (verbatim signature).
 *
 * `source` is the crate object (already unspawned), `target` the picker. Both
 * are needed: the crate's kind lives on `source`, the beneficiary on `target`.
 */
import { EventType } from './EventType';

export class CratePickupEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly player: any,
        public readonly source: any,
        public readonly tile: any,
    ) {
        this.type = EventType.CratePickup;
    }
}
