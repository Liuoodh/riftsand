/**
 * Port of redalert2/src/game/event/BuildingFailedPlaceEvent.ts (verbatim signature).
 *
 * Carries the *name* rather than the rules object because the building was never
 * instantiated — placement failed before construction.
 */
import { EventType } from './EventType';

export class BuildingFailedPlaceEvent {
    public readonly type: EventType;

    constructor(
        public readonly name: string,
        public readonly player: any,
        public readonly tile: any,
    ) {
        this.type = EventType.BuildingFailedPlace;
    }
}
