import { EventType } from './EventType';

/**
 * Verbatim from redalert2/src/game/event/WarheadDetonateEvent.ts.
 *
 * `explodeAnim` is `undefined` when the shot was nullified by an invulnerable
 * target or by a weather storm, so consumers must treat it as optional.
 */
export class WarheadDetonateEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly position: any,
        public readonly explodeAnim: any,
        public readonly isLightningStrike: boolean,
    ) {
        this.type = EventType.WarheadDetonate;
    }
}
