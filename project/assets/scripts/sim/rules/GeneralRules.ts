/**
 * `[General]` section — the big bag of cross-cutting tunables.
 *
 * Reference: redalert2/src/game/rules/GeneralRules.ts (183 lines, ~55 scalars and
 * 11 nested blocks).
 *
 * Everything here is a *rule*, not a constant: production speed, low-power
 * throttling, engineer capture maths, chrono distances, spy theft, refund and
 * sell-back policy. Four derived values are computed on read and must stay that
 * way, because the reference computes them in `readIni` and nothing re-clamps them
 * later:
 *   - `refundPercent` → `clamp(0, 1)`;
 *   - `revealTriggerRadius` → `min(10, raw)`;
 *   - `defaultMirageDisguises`, `baseUnit`, `harvesterUnit`, `padAircraft` are raw
 *     name lists resolved later.
 *
 * `readPrereqCategories` refuses to load when one of the six `Prerequisite*` lists
 * is absent. That is deliberate: an empty prerequisite list would make an entire
 * tech tier buildable from the start, so a missing key is a hard error rather than
 * a silent default.
 *
 * NOTE — the reference reads these out of an INI section; we read them out of a TS
 * data object with the same field semantics (project decision: no INI parser).
 */
import { clamp } from '../util/math';
import { CrewRules, CrewRulesData } from './general/CrewRules';
import { DMislRules, DMislRulesData } from './general/DMislRules';
import { HoverRules, HoverRulesData } from './general/HoverRules';
import { LightningStormRules, LightningStormRulesData } from './general/LightningStormRules';
import { MissileRules } from './general/MissileRules';
import { ParadropRules, ParadropRulesData } from './general/ParadropRules';
import { PrismRules, PrismRulesData } from './general/PrismRules';
import { RadarRules, RadarRulesData } from './general/RadarRules';
import { RepairRules, RepairRulesData } from './general/RepairRules';
import { ThreatRules, ThreatRulesData } from './general/ThreatRules';
import { V3RocketRules, V3RocketRulesData } from './general/V3RocketRules';
import { VeteranRules, VeteranRulesData } from './general/VeteranRules';

export enum PrereqCategory {
    Power = 0,
    Factory = 1,
    Barracks = 2,
    Radar = 3,
    Tech = 4,
    Proc = 5
}

const prereqCategoryMap = new Map<PrereqCategory, string>([
    [PrereqCategory.Power, 'PrerequisitePower'],
    [PrereqCategory.Factory, 'PrerequisiteFactory'],
    [PrereqCategory.Barracks, 'PrerequisiteBarracks'],
    [PrereqCategory.Radar, 'PrerequisiteRadar'],
    [PrereqCategory.Tech, 'PrerequisiteTech'],
    [PrereqCategory.Proc, 'PrerequisiteProc'],
]);

export interface GeneralRulesData {
    aircraftFogReveal?: number;
    alliedDisguise?: string;
    sovietDisguise?: string;
    thirdDisguise?: string;
    baseUnit?: string[];
    bridgeVoxelMax?: number;
    buildSpeed?: number;
    buildupTime?: number;
    chronoDelay?: number;
    chronoDistanceFactor?: number;
    chronoHarvTooFarDistance?: number;
    chronoMinimumDelay?: number;
    chronoRangeMinimum?: number;
    chronoTrigger?: boolean;
    cliffBackImpassability?: number;
    cloakDelay?: number;
    closeEnough?: number;
    crew?: CrewRulesData;
    defaultMirageDisguises?: string[];
    dMisl?: DMislRulesData;
    dropPodWeapon?: string;
    engineer?: string;
    engineerCaptureLevel?: number;
    engineerDamage?: number;
    engineerAlwaysCaptureTech?: boolean;
    flightLevel?: number;
    guardAreaTargetingDelay?: number;
    harvesterTooFarDistance?: number;
    harvesterUnit?: string[];
    hover?: HoverRulesData;
    infantryBlinkDisguiseTime?: number;
    lightningStorm?: LightningStormRulesData;
    lowPowerPenaltyModifier?: number;
    minLowPowerProductionSpeed?: number;
    maxLowPowerProductionSpeed?: number;
    maximumCheerRate?: number;
    maximumQueuedObjects?: number;
    maxWaypointPathLength?: number;
    multipleFactory?: number;
    normalTargetingDelay?: number;
    padAircraft?: string[];
    parachuteMaxFallRate?: number;
    paradrop?: ParadropRulesData;
    prism?: PrismRulesData;
    purifierBonus?: number;
    radar?: RadarRulesData;
    refundPercent?: number;
    repair?: RepairRulesData;
    returnStructures?: boolean;
    revealTriggerRadius?: number;
    shipSinkingWeight?: number;
    spyMoneyStealPercent?: number;
    spyPowerBlackout?: number;
    technician?: string;
    threat?: ThreatRulesData;
    treeStrength?: number;
    unitsUnsellable?: boolean;
    v3Rocket?: V3RocketRulesData;
    veteran?: VeteranRulesData;
    wallBuildSpeedCoefficient?: number;
    /** the six `Prerequisite*` name lists, keyed by category name */
    prerequisitePower?: string[];
    prerequisiteFactory?: string[];
    prerequisiteBarracks?: string[];
    prerequisiteRadar?: string[];
    prerequisiteTech?: string[];
    prerequisiteProc?: string[];
}

export class GeneralRules {
    prereqCategories = new Map<PrereqCategory, string[]>();

    aircraftFogReveal = 0;
    flightLevel = 0;
    alliedDisguise = '';
    sovietDisguise = '';
    thirdDisguise = '';
    defaultMirageDisguises: string[] = [];
    cloakDelay = 0;
    infantryBlinkDisguiseTime = 0;
    baseUnit: string[] = [];

    buildSpeed = 0;
    buildupTime = 0;
    wallBuildSpeedCoefficient = 0;
    multipleFactory = 1;
    maximumQueuedObjects = 0;
    lowPowerPenaltyModifier = 1;
    minLowPowerProductionSpeed = 0.5;
    maxLowPowerProductionSpeed = 1;

    chronoDelay = 0;
    chronoDistanceFactor = 32;
    chronoHarvTooFarDistance = 0;
    chronoMinimumDelay = 0;
    chronoRangeMinimum = 0;
    chronoTrigger = true;

    bridgeVoxelMax = 0;
    cliffBackImpassability = 2;
    closeEnough = 0;
    maxWaypointPathLength = 0;

    engineer = '';
    engineerCaptureLevel = 0.25;
    engineerDamage = 0.437;
    engineerAlwaysCaptureTech = true;
    technician = '';
    harvesterTooFarDistance = 0;
    harvesterUnit: string[] = [];

    guardAreaTargetingDelay = 0;
    normalTargetingDelay = 0;
    revealTriggerRadius = 0;

    padAircraft: string[] = [];
    parachuteMaxFallRate = 0;
    dropPodWeapon = '';

    refundPercent = 0;
    returnStructures = false;
    unitsUnsellable = false;
    purifierBonus = 0;
    maximumCheerRate = 0;

    spyMoneyStealPercent = 0;
    spyPowerBlackout = 0;
    shipSinkingWeight = 0;
    treeStrength = 0;

    crew = new CrewRules();
    dMisl = new DMislRules();
    hover = new HoverRules();
    lightningStorm = new LightningStormRules();
    paradrop = new ParadropRules();
    prism = new PrismRules();
    radar = new RadarRules();
    repair = new RepairRules();
    threat = new ThreatRules();
    v3Rocket = new V3RocketRules();
    veteran = new VeteranRules();

    read(data: GeneralRulesData): void {
        this.aircraftFogReveal = data.aircraftFogReveal ?? 0;
        this.alliedDisguise = data.alliedDisguise ?? '';
        this.thirdDisguise = data.thirdDisguise ?? '';
        this.baseUnit = data.baseUnit ?? [];
        this.bridgeVoxelMax = data.bridgeVoxelMax ?? 0;
        this.buildSpeed = data.buildSpeed ?? 0;
        this.buildupTime = data.buildupTime ?? 0;
        this.chronoDelay = data.chronoDelay ?? 0;
        this.chronoDistanceFactor = data.chronoDistanceFactor ?? 32;
        this.chronoHarvTooFarDistance = data.chronoHarvTooFarDistance ?? 0;
        this.chronoMinimumDelay = data.chronoMinimumDelay ?? 0;
        this.chronoRangeMinimum = data.chronoRangeMinimum ?? 0;
        this.chronoTrigger = data.chronoTrigger ?? true;
        this.cliffBackImpassability = data.cliffBackImpassability ?? 2;
        this.cloakDelay = data.cloakDelay ?? 0;
        this.closeEnough = data.closeEnough ?? 0;
        this.crew = new CrewRules().read(data.crew);
        this.defaultMirageDisguises = data.defaultMirageDisguises ?? [];
        this.dMisl = new DMislRules().read(data.dMisl);
        this.dropPodWeapon = data.dropPodWeapon ?? '';
        this.engineer = data.engineer ?? '';
        this.engineerCaptureLevel = data.engineerCaptureLevel ?? 0.25;
        this.engineerDamage = data.engineerDamage ?? 0.437;
        this.engineerAlwaysCaptureTech = data.engineerAlwaysCaptureTech ?? true;
        this.flightLevel = data.flightLevel ?? 0;
        this.guardAreaTargetingDelay = data.guardAreaTargetingDelay ?? 0;
        this.harvesterTooFarDistance = data.harvesterTooFarDistance ?? 0;
        this.harvesterUnit = data.harvesterUnit ?? [];
        this.hover = new HoverRules().read(data.hover);
        this.infantryBlinkDisguiseTime = data.infantryBlinkDisguiseTime ?? 0;
        this.lightningStorm = new LightningStormRules().read(data.lightningStorm);
        this.lowPowerPenaltyModifier = data.lowPowerPenaltyModifier ?? 1;
        this.minLowPowerProductionSpeed = data.minLowPowerProductionSpeed ?? 0.5;
        this.maxLowPowerProductionSpeed = data.maxLowPowerProductionSpeed ?? 1;
        this.maximumCheerRate = data.maximumCheerRate ?? 0;
        this.maximumQueuedObjects = data.maximumQueuedObjects ?? 0;
        this.maxWaypointPathLength = data.maxWaypointPathLength ?? 0;
        this.multipleFactory = data.multipleFactory ?? 1;
        this.normalTargetingDelay = data.normalTargetingDelay ?? 0;
        this.padAircraft = data.padAircraft ?? [];
        this.parachuteMaxFallRate = data.parachuteMaxFallRate ?? 0;
        this.paradrop = new ParadropRules().read(data.paradrop);
        this.prism = new PrismRules().read(data.prism);
        this.purifierBonus = data.purifierBonus ?? 0;
        this.radar = new RadarRules().read(data.radar);
        this.refundPercent = clamp(data.refundPercent ?? 0, 0, 1);
        this.repair = new RepairRules().read(data.repair);
        this.returnStructures = !!data.returnStructures;
        this.revealTriggerRadius = Math.min(10, data.revealTriggerRadius ?? 0);
        this.shipSinkingWeight = data.shipSinkingWeight ?? 0;
        this.sovietDisguise = data.sovietDisguise ?? '';
        this.spyMoneyStealPercent = data.spyMoneyStealPercent ?? 0;
        this.spyPowerBlackout = data.spyPowerBlackout ?? 0;
        this.technician = data.technician ?? '';
        this.threat = new ThreatRules().read(data.threat);
        this.treeStrength = data.treeStrength ?? 0;
        this.unitsUnsellable = !!data.unitsUnsellable;
        this.v3Rocket = new V3RocketRules().read(data.v3Rocket);
        this.veteran = new VeteranRules().read(data.veteran);
        this.wallBuildSpeedCoefficient = data.wallBuildSpeedCoefficient ?? 0;
        this.readPrereqCategories(data);
    }

    private readPrereqCategories(data: GeneralRulesData): void {
        const byCategory = new Map<PrereqCategory, string[] | undefined>([
            [PrereqCategory.Power, data.prerequisitePower],
            [PrereqCategory.Factory, data.prerequisiteFactory],
            [PrereqCategory.Barracks, data.prerequisiteBarracks],
            [PrereqCategory.Radar, data.prerequisiteRadar],
            [PrereqCategory.Tech, data.prerequisiteTech],
            [PrereqCategory.Proc, data.prerequisiteProc],
        ]);
        for (const [category, key] of prereqCategoryMap) {
            const list = byCategory.get(category);
            if (list === undefined) {
                throw new Error(`Missing prerequisite category ${key} in [General] section`);
            }
            this.prereqCategories.set(category, list);
        }
    }

    getMissileRules(type: string): MissileRules {
        switch (type) {
            case this.v3Rocket.type:
                return this.v3Rocket;
            case this.dMisl.type:
                return this.dMisl;
            default:
                throw new Error(`Unsupported missile type "${type}"`);
        }
    }
}
