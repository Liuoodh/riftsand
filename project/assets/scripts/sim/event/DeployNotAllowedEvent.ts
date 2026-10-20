/**
 * Port of redalert2/src/game/event/DeployNotAllowedEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class DeployNotAllowedEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.DeployNotAllowed;
    }
}
