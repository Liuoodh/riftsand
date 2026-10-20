/** Verbatim from redalert2/src/game/event/ObjectLandEvent.ts. */
import { EventType } from './EventType';

export class ObjectLandEvent {
    public readonly type: EventType;

    constructor(public readonly target: any) {
        this.type = EventType.ObjectLand;
    }
}
