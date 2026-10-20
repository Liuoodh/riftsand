/** Verbatim from redalert2/src/game/event/ObjectLiftOffEvent.ts. */
import { EventType } from './EventType';

export class ObjectLiftOffEvent {
    public readonly type: EventType;

    constructor(public readonly target: any) {
        this.type = EventType.ObjectLiftOff;
    }
}
