/**
 * Port of redalert2/src/game/event/ObjectLandEvent.ts (verbatim signature).
 *
 * Paired with `ObjectLiftOffEvent`. `gameObject` — not `target`, which is what
 * B5a wrote here by mistake. The name matters: `ObjectLandEvent` is one of the
 * few events whose payload is always the object itself, never an attacker or a
 * victim role, so the reference consistently calls it `gameObject`.
 */
import { EventType } from './EventType';

export class ObjectLandEvent {
    public readonly type: EventType;

    constructor(public readonly gameObject: any) {
        this.type = EventType.ObjectLand;
    }
}
