/**
 * Port of redalert2/src/game/event/SuperWeaponReadyEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class SuperWeaponReadyEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
    ) {
        this.type = EventType.SuperWeaponReady;
    }
}
