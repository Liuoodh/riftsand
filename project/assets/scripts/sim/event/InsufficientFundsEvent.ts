/**
 * Port of redalert2/src/game/event/InsufficientFundsEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class InsufficientFundsEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.InsufficientFunds;
    }
}
