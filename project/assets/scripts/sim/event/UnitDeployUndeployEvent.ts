/**
 * Port of redalert2/src/game/event/UnitDeployUndeployEvent.ts (verbatim signature).
 */
import { EventType } from './EventType';

export class UnitDeployUndeployEvent {
    public readonly type: EventType;

    constructor(
        public readonly unit: any,
        public readonly deployType: any,
    ) {
        this.type = EventType.UnitDeployUndeploy;
    }
}
