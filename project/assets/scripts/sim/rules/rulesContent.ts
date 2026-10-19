/**
 * The rules *content* — every number the engine reads, in one data tree.
 *
 * This file is the project's `rules.ini`. The engine side (`sim/rules/**`) owns the
 * mechanisms; this file owns the values, so tuning the game never means editing a
 * class. Values carried over from the pre-port `GENERAL` constant keep their exact
 * numbers (they were calibrated against this project's cost curve); the rest are the
 * reference's retail defaults.
 *
 * Deliberately empty until the matching batch lands, because inventing placeholder
 * content is worse than an empty table that throws loudly:
 *   - `warheads` / `weapons` / `projectiles` -> B3
 *   - `buildingTypes` / `infantryTypes` / `vehicleTypes` / `aircraftTypes` and the
 *     matching `objectData` entries -> the content pass after B2
 *   - `superWeaponTypes` / `countries` -> B9
 */
import type { RulesContent } from './Rules';
import { SpeedType } from '../type/SpeedType';

export const RULES_CONTENT: RulesContent = {
    /* ------------------------------------------------------------- [AudioVisual] */
    audioVisual: {
        // Animation names are content, so the reference's retail fallbacks are not
        // carried over; names are filled in when the art pipeline needs them.
        messageDuration: 10,
        gravity: 0,
        conditionYellow: 0,
        conditionRed: 0,
        damageFireTypes: '',
        idleActionFrequency: 0.5,
        extraUnitLight: 0,
        extraInfantryLight: 0,
        extraAircraftLight: 0,
    },

    /* ------------------------------------------------------------ [CombatDamage] */
    combatDamage: {
        /**
         * Minutes between the C4 charge being planted and the structure collapsing
         * (`PlantC4Task` scales it by 60 * TICKS_PER_SECOND). 0.05 keeps the
         * 3-second fuse.
         */
        c4Delay: 0.05,
    },

    /* --------------------------------------------------------------- [Radiation] */
    radiation: {},

    /* ----------------------------------------------------------------- [General] */
    general: {
        baseUnit: [],
        buildSpeed: 1,
        /** minutes */
        buildupTime: 0.07,
        wallBuildSpeedCoefficient: 0.1,
        /** each extra factory divides build time by this */
        multipleFactory: 0.8,
        /** the queue holds max + 1 */
        maximumQueuedObjects: 6,
        lowPowerPenaltyModifier: 1,
        minLowPowerProductionSpeed: 0.5,
        maxLowPowerProductionSpeed: 1,
        chronoDistanceFactor: 32,
        chronoTrigger: true,
        cliffBackImpassability: 2,
        /** cells: a move order may stop this far from its target */
        closeEnough: 2,
        engineerCaptureLevel: 0.25,
        engineerDamage: 0.437,
        engineerAlwaysCaptureTech: true,
        /** cells before the harvester re-picks a refinery */
        harvesterTooFarDistance: 5,
        harvesterUnit: [],
        maxWaypointPathLength: 25,
        padAircraft: [],
        /** fraction of the purchase value returned on sell */
        refundPercent: 0.5,
        returnStructures: false,
        unitsUnsellable: false,
        /** per ore purifier */
        purifierBonus: 0.25,
        revealTriggerRadius: 5,
        spyMoneyStealPercent: 0.5,
        spyPowerBlackout: 0,
        treeStrength: 200,
        parachuteMaxFallRate: 3,
        guardAreaTargetingDelay: 40,
        normalTargetingDelay: 10,
        maximumCheerRate: 20,
        infantryBlinkDisguiseTime: 10,
        shipSinkingWeight: 5,

        crew: {
            alliedCrew: 'pebble',
            alliedSurvivorDivisor: 260,
            sovietCrew: 'sandfly',
            sovietSurvivorDivisor: 260,
        },

        repair: {
            /**
             * Minutes of pad time per ammunition round. Retail ships 1 (a full
             * minute per round); our aircraft carry 2-8 rounds, so it is tuned to
             * one second per round to keep a sortie cycle near 20 s.
             */
            reloadRate: 1 / 60,
            /**
             * Total cost of a repair from zero to full, as a fraction of the
             * purchase value — which is why per-HP cost is
             * `repairPercent * purchaseValue / maxHitPoints`.
             */
            repairPercent: 0.2,
            repairRate: 1,
            repairStep: 12,
            uRepairRate: 0.016,
            iRepairRate: 0.016,
            iRepairStep: 6,
        },

        /**
         * The two scripted missile profiles. `type` is the key
         * `getMissileRules` switches on, so it must be spelled exactly as the
         * weapon's `Projectile=` value writes it.
         */
        v3Rocket: { type: 'V3Rocket' },
        dMisl: { type: 'DMisl' },

        veteran: {
            veteranRatio: 3,
            veteranCombat: 1.1,
            veteranSpeed: 1.2,
            veteranSight: 1.2,
            veteranArmor: 1.5,
            veteranROF: 0.6,
            veteranCap: 2,
        },

        /**
         * The six prerequisite buckets. All must be present even when empty — a
         * missing bucket would silently make a whole tech tier free, so
         * `GeneralRules.readPrereqCategories` throws instead.
         */
        prerequisitePower: [],
        prerequisiteFactory: [],
        prerequisiteBarracks: [],
        prerequisiteRadar: [],
        prerequisiteTech: [],
        prerequisiteProc: [],
    },

    /* ---------------------------------------------------------------------- [AI] */
    ai: {
        buildPower: [],
        buildRefinery: [],
        buildTech: [],
        tiberiumFarScan: 50,
        tiberiumNearScan: 5,
    },

    /* ------------------------------------------------------------- [CrateRules] */
    crateRules: {
        crateMaximum: 6,
        crateMinimum: 1,
        crateRadius: 6,
        /** minutes between spawn attempts */
        crateRegen: 4,
        crateImg: '',
        waterCrateImg: '',
        healCrateSound: '',
        freeMCV: false,
    },

    /* --------------------------------------------------------- [ElevationModel] */
    elevationModel: {
        elevationIncrement: 4,
        elevationIncrementBonus: 5,
        elevationBonusCap: 50,
    },

    /* --------------------------------------------- [MultiplayerDialogSettings] */
    mpDialogSettings: {
        minMoney: 2500,
        money: 10000,
        maxMoney: 10000,
        moneyIncrement: 500,
        minUnitCount: 0,
        unitCount: 10,
        maxUnitCount: 10,
        crates: false,
        gameSpeed: 1,
        mcvRedeploys: true,
        shortGame: false,
        superWeapons: true,
        techLevel: 10,
        alliesAllowed: true,
        allyChangeAllowed: true,
        mustAlly: false,
        bridgeDestruction: true,
        multiEngineer: true,
    },

    /* --------------------------------------------------------------- [Powerups] */
    // `probShares,animName,waterAllowed,data`
    powerups: {
        Money: '20,<none>,yes',
        Unit: '20,<none>,no',
        HealBase: '10,<none>,no',
        Armor: '10,<none>,no',
        Firepower: '10,<none>,no',
        Speed: '10,<none>,no',
        Veteran: '10,<none>,no',
        Reveal: '10,<none>,no',
        Tiberium: '10,<none>,no',
        Cloak: '5,<none>,no',
        Explosion: '5,<none>,yes',
        ICBM: '5,<none>,no',
        Napalm: '5,<none>,yes',
    },

    /* ----------------------------------------------------------------- [Colors] */
    // `h,s,v`, each 0-255 — the same triple the reference reads.
    colors: {
        Gold: '42,204,230',
        DarkRed: '0,204,140',
        DarkBlue: '170,204,140',
        DarkGreen: '85,204,110',
        Orange: '30,230,240',
        DarkSky: '150,140,180',
        Purple: '210,180,160',
        Magenta: '235,204,204',
    },

    /* ---------------------------------------------------------- land sections */
    /**
     * One entry per land type. `[Cliff]` is declared explicitly even though retail
     * reuses `[Rock]` for it: our generator emits cliffs that are hard-impassable,
     * and `[Rock]` is a passable-with-penalty surface.
     */
    landRules: {
        Clear: {
            buildable: true,
            speed: { [SpeedType.Foot]: 1, [SpeedType.Track]: 1, [SpeedType.Wheel]: 1 },
        },
        Road: {
            buildable: true,
            speed: { [SpeedType.Foot]: 1, [SpeedType.Track]: 1, [SpeedType.Wheel]: 1 },
        },
        Rock: {
            buildable: false,
            speed: { [SpeedType.Foot]: 0.8, [SpeedType.Track]: 0.7, [SpeedType.Wheel]: 0.6 },
        },
        Beach: {
            buildable: true,
            speed: { [SpeedType.Foot]: 0.8, [SpeedType.Track]: 0.7, [SpeedType.Wheel]: 0.6 },
        },
        Rough: {
            buildable: true,
            speed: { [SpeedType.Foot]: 0.8, [SpeedType.Track]: 0.7, [SpeedType.Wheel]: 0.5 },
        },
        Railroad: {
            buildable: false,
            speed: { [SpeedType.Foot]: 1, [SpeedType.Track]: 1, [SpeedType.Wheel]: 1 },
        },
        Weeds: {
            buildable: true,
            speed: { [SpeedType.Foot]: 1, [SpeedType.Track]: 1, [SpeedType.Wheel]: 1 },
        },
        Water: { buildable: false, speed: {} },
        Wall: { buildable: false, speed: {} },
        Tiberium: {
            buildable: false,
            speed: { [SpeedType.Foot]: 0.9, [SpeedType.Track]: 0.8, [SpeedType.Wheel]: 0.7 },
        },
        Cliff: { buildable: false, speed: {} },
    },

    /* -------------------------------------------------------------- ore types */
    tiberiumTypes: ['Ore', 'Gem'],
    tiberiums: {
        Ore: { value: 25 },
        Gem: { value: 50 },
    },

    /* ------------------------------------------------------------ superweapons */
    superWeaponTypes: [],
    superWeapons: {},

    /* --------------------------------------------------------------- countries */
    countryTypes: [],
    countries: {},

    /* ----------------------------------------------------------------- combat */
    warheads: {},
    weapons: {},
    projectiles: {},

    /* -------------------------------------------------------- map object tables */
    buildingTypes: [],
    infantryTypes: [],
    vehicleTypes: [],
    aircraftTypes: [],
    terrainTypes: [],
    overlayTypes: [],
    smudgeTypes: [],
    debrisTypes: [],
    animationNames: [],
    objectData: {},
};
