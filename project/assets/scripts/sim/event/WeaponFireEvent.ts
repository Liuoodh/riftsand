import { EventType } from './EventType';

/** Verbatim from redalert2/src/game/event/WeaponFireEvent.ts. */
export class WeaponFireEvent {
    public readonly type: EventType;

    constructor(
        public readonly weapon: any,
        public readonly gameObject: any,
    ) {
        this.type = EventType.WeaponFire;
    }
}
