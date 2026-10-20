import { EventType } from './EventType';

/**
 * Verbatim from redalert2/src/game/event/ObjectAttackedEvent.ts.
 *
 * `incidental` is true for splash damage — that is the flag the "unit under
 * attack" EVA line and the minimap ping filter on. It is computed by the caller
 * as `!directHitTarget`, i.e. "nothing was hit within one tile of the centre".
 */
export class ObjectAttackedEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly attacker: any,
        public readonly incidental: any,
    ) {
        this.type = EventType.ObjectAttacked;
    }
}
