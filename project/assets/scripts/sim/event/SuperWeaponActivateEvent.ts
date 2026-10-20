/**
 * Port of redalert2/src/game/event/SuperWeaponActivateEvent.ts (verbatim signature).
 *
 * `atTile2` is the second corner for area-effect superweapons (iron curtain,
 * chronoshift); it is `undefined` for single-tile ones.
 */
import { EventType } from './EventType';

export class SuperWeaponActivateEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly owner: any,
        public readonly atTile: any,
        public readonly atTile2: any,
        public readonly noSfxWarning: boolean,
    ) {
        this.type = EventType.SuperWeaponActivate;
    }
}
