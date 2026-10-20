import { EventType } from './EventType';

/** Verbatim from redalert2/src/game/event/HealthChangeEvent.ts. */
export class HealthChangeEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly currentHealth: any,
        public readonly prevHealth: any,
    ) {
        this.type = EventType.HealthChange;
    }
}
