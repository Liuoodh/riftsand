/**
 * Port of redalert2/src/game/event/ObjectSpawnEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class ObjectSpawnEvent {
    public readonly type: EventType;

    constructor(
        public readonly gameObject: any,
    ) {
        this.type = EventType.ObjectSpawn;
    }
}
