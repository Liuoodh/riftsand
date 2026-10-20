/**
 * Port of redalert2/src/game/event/ObjectOwnerChangeEvent.ts (verbatim signature).
 *
 * `prevOwner` is needed because `target.owner` is already the new one when the
 * handler runs — mind-control and engineer capture both rely on the pair.
 */
import { EventType } from './EventType';

export class ObjectOwnerChangeEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly prevOwner: any,
    ) {
        this.type = EventType.ObjectOwnerChange;
    }
}
