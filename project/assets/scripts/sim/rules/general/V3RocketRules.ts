/**
 * `[General]` V3 block — the ballistic rocket flight profile.
 *
 * Reference: redalert2/src/game/rules/general/V3RocketRules.ts
 */
import { MissileRules } from './MissileRules';

export interface V3RocketRulesData {
    pauseFrames?: number;
    tiltFrames?: number;
    pitchInitial?: number;
    pitchFinal?: number;
    turnRate?: number;
    acceleration?: number;
    altitude?: number;
    damage?: number;
    eliteDamage?: number;
    bodyLength?: number;
    lazyCurve?: boolean;
    type?: string;
}

export class V3RocketRules extends MissileRules {
    pauseFrames = 0;
    tiltFrames = 0;
    pitchInitial = 0;
    pitchFinal = 0;
    turnRate = 0;
    acceleration = 0;
    altitude = 0;
    damage = 0;
    eliteDamage = 0;
    bodyLength = 0;
    lazyCurve = false;
    type = '';

    read(data: V3RocketRulesData = {}): V3RocketRules {
        this.pauseFrames = data.pauseFrames ?? 0;
        this.tiltFrames = data.tiltFrames ?? 0;
        this.pitchInitial = data.pitchInitial ?? 0;
        this.pitchFinal = data.pitchFinal ?? 0;
        this.turnRate = data.turnRate ?? 0;
        this.acceleration = data.acceleration ?? 0;
        this.altitude = data.altitude ?? 0;
        this.damage = data.damage ?? 0;
        this.eliteDamage = data.eliteDamage ?? 0;
        this.bodyLength = data.bodyLength ?? 0;
        this.lazyCurve = data.lazyCurve ?? false;
        this.type = data.type ?? '';
        return this;
    }
}
