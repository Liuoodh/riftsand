/**
 * `[General]` radar event rules.
 *
 * Reference: redalert2/src/game/rules/general/RadarRules.ts
 *
 * The three `getEvent*` accessors throw on a missing index instead of returning
 * undefined — that is the reference's behaviour and it is deliberate: a missing
 * entry means the INI was edited badly, and a silent 0 would make radar events
 * invisible with no error.
 */
export enum RadarEventType {
    GenericCombat = 0,
    GenericNonCombat = 1,
    DropZone = 2,
    BaseUnderAttack = 3,
    HarvesterUnderAttack = 4,
    EnemyObjectSensed = 5,
}

export interface RadarRulesData {
    eventSuppressionDistances?: number[];
    eventVisibilityDurations?: number[];
    eventDurations?: number[];
    flashFrameTime?: number;
    combatFlashTime?: number;
    eventMinRadius?: number;
    eventSpeed?: number;
    eventRotationSpeed?: number;
    eventColorSpeed?: number;
}

export class RadarRules {
    eventSuppressionDistances: number[] = [];
    eventVisibilityDurations: number[] = [];
    eventDurations: number[] = [];
    flashFrameTime = 0;
    combatFlashTime = 0;
    eventMinRadius = 0;
    eventSpeed = 0;
    eventRotationSpeed = 0;
    eventColorSpeed = 0;

    read(data: RadarRulesData = {}): RadarRules {
        this.eventSuppressionDistances = data.eventSuppressionDistances ?? [];
        this.eventVisibilityDurations = data.eventVisibilityDurations ?? [];
        this.eventDurations = data.eventDurations ?? [];
        this.flashFrameTime = data.flashFrameTime ?? 0;
        this.combatFlashTime = data.combatFlashTime ?? 0;
        this.eventMinRadius = data.eventMinRadius ?? 0;
        this.eventSpeed = data.eventSpeed ?? 0;
        this.eventRotationSpeed = data.eventRotationSpeed ?? 0;
        this.eventColorSpeed = data.eventColorSpeed ?? 0;
        return this;
    }

    getEventSuppresionDistance(eventType: RadarEventType): number {
        if (eventType > this.eventSuppressionDistances.length - 1) {
            throw new RangeError(`No event suppression distance is defined for type ${RadarEventType[eventType]}`);
        }
        return this.eventSuppressionDistances[eventType];
    }

    getEventVisibilityDuration(eventType: RadarEventType): number {
        if (eventType > this.eventVisibilityDurations.length - 1) {
            throw new RangeError(`No event visibility duration is defined for type ${RadarEventType[eventType]}`);
        }
        return this.eventVisibilityDurations[eventType];
    }

    getEventDuration(eventType: RadarEventType): number {
        if (eventType > this.eventDurations.length - 1) {
            throw new RangeError(`No event duration is defined for type ${RadarEventType[eventType]}`);
        }
        return this.eventDurations[eventType];
    }
}
