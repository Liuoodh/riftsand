/**
 * Port of redalert2/src/game/event/ObjectLiftOffEvent.ts (verbatim signature).
 *
 * Fired when a jumpjet or helicopter leaves the ground, i.e. when the object
 * switches from `_tileElevation` to `_absoluteElevation`. See `ObjectLandEvent`
 * for why the payload is called `gameObject` and not `target`.
 */
import { EventType } from './EventType';

export class ObjectLiftOffEvent {
    public readonly type: EventType;

    constructor(public readonly gameObject: any) {
        this.type = EventType.ObjectLiftOff;
    }
}
