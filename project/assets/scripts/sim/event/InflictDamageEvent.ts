import { EventType } from './EventType';

/**
 * Verbatim from redalert2/src/game/event/InflictDamageEvent.ts.
 *
 * Carries `damageHitPoints` (the integer actually subtracted) as well as the
 * before/after health percentages, because the floating damage number the
 * renderer shows must be the HP delta, not the percentage delta.
 */
export class InflictDamageEvent {
    public readonly type: EventType;

    constructor(
        public readonly target: any,
        public readonly attacker: any,
        public readonly damageHitPoints: any,
        public readonly currentHealth: any,
        public readonly prevHealth: any,
    ) {
        this.type = EventType.InflictDamage;
    }
}
