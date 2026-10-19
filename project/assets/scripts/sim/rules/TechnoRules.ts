/**
 * Techno rules — every field a vehicle / infantry / aircraft / building carries.
 *
 * Reference: redalert2/src/game/rules/TechnoRules.ts (703 lines, ~300 fields)
 *
 * This is the field dictionary the rest of the engine reads. The port keeps
 * **every field, every default and every derivation**; only the source changes
 * (an INI section becomes a data bag, per the project decision that our roster is
 * authored as TypeScript). Derivations that look odd are called out inline,
 * because each one exists because retail behaves that way:
 *
 *   - `sight` is capped at 11, and an engineer-vulnerable structure sees 6;
 *   - `speed` is scaled by 65 for ships/vehicles/chrono and 100 otherwise;
 *   - `factory = UnitType` silently becomes `NavalUnitType` when `naval`;
 *   - `unitRepair` implies one dock if none was declared;
 *   - `slaved` implies `harvester`, `enslaves` implies a refinery with a dock;
 *   - `pitchAngle` collapses to 0 once `pitchSpeed >= 1`;
 *   - `damageSmokeOffset` swaps Y/Z and divides Z by √2 (voxel → iso).
 */
import { ObjectType } from '../type/ObjectType';
import { SideType } from '../type/SideType';
import { SpeedType } from '../type/SpeedType';
import { PipColor } from '../type/PipColor';
import { LocomotorType } from '../type/LocomotorType';
import { MovementZone } from '../type/MovementZone';
import { ArmorType } from '../type/ArmorType';
import { LandTargeting } from '../type/LandTargeting';
import { NavalTargeting } from '../type/NavalTargeting';
import { VhpScan } from '../type/VhpScan';
import { VeteranAbility } from '../type/VeteranAbility';
import { WeaponType } from '../type/WeaponType';
import { Vector3 } from '../math/Vector3';
import { ObjectRules, ObjectRulesData } from './ObjectRules';

interface House {
    name: string;
}

export enum BuildCat {
    Combat = 0,
    Tech = 1,
    Resource = 2,
    Power = 3,
}

export enum FactoryType {
    None = 0,
    BuildingType = 1,
    InfantryType = 2,
    UnitType = 3,
    NavalUnitType = 4,
    AircraftType = 5,
}

/** The two general-rule flags TechnoRules reads while parsing. */
export interface TechnoRulesGeneralRules {
    unitsUnsellable?: boolean;
    returnStructures?: boolean;
}

export interface TechnoRulesData extends ObjectRulesData {
    owner?: string[];
    aiBasePlanningSide?: number;
    requiredHouses?: string[];
    forbiddenHouses?: string[];
    requiresStolenAlliedTech?: boolean;
    requiresStolenSovietTech?: boolean;
    requiresStolenThirdTech?: boolean;
    techLevel?: number;
    cost?: number;
    points?: number;
    power?: number;
    powered?: boolean;
    poweredUnit?: boolean;
    powersUnit?: string;
    prerequisite?: string[];
    soylent?: number;
    crateGoodie?: boolean;
    buildCat?: BuildCat;
    adjacent?: number;
    baseNormal?: boolean;
    buildLimit?: number;
    airRangeBonus?: number;
    guardRange?: number;
    defaultToGuardArea?: boolean;
    eligibileForAllyBuilding?: boolean;
    numberImpassableRows?: number;
    bridgeRepairHut?: boolean;
    constructionYard?: boolean;
    refinery?: boolean;
    dockUnload?: boolean;
    enslaves?: string;
    slavesNumber?: number;
    slaved?: boolean;
    unitRepair?: boolean;
    unitReload?: boolean;
    unitSell?: boolean;
    isBaseDefense?: boolean;
    superWeapon?: string;
    chargedAnimTime?: number;
    naval?: boolean;
    underwater?: boolean;
    waterBound?: boolean;
    orePurifier?: boolean;
    cloning?: boolean;
    grinding?: boolean;
    nukeSilo?: boolean;
    repairable?: boolean;
    clickRepairable?: boolean;
    unsellable?: boolean;
    returnable?: boolean;
    gdiBarracks?: boolean;
    nodBarracks?: boolean;
    numberOfDocks?: number;
    factory?: FactoryType;
    weaponsFactory?: boolean;
    helipad?: boolean;
    hospital?: boolean;
    landTargeting?: LandTargeting;
    navalTargeting?: NavalTargeting;
    tooBigToFitUnderBridge?: boolean;
    bunker?: boolean;
    canBeOccupied?: boolean;
    maxNumberOccupants?: number;
    occupantsPowerBonus?: number;
    leaveRubble?: boolean;
    undeploysInto?: string;
    deploysInto?: string;
    deployTime?: number;
    capturable?: boolean;
    spyable?: boolean;
    needsEngineer?: boolean;
    c4?: boolean;
    canC4?: boolean;
    eligibleForDelayKill?: boolean;
    produceCashStartup?: number;
    produceCashAmount?: number;
    produceCashDelay?: number;
    explosion?: string[];
    explodes?: boolean;
    ifvMode?: number;
    turretIndexesByIfvMode?: Record<number, number>;
    turret?: boolean;
    turretCount?: number;
    turretAnim?: string;
    turretAnimIsVoxel?: boolean;
    turretAnimX?: number;
    turretAnimY?: number;
    turretAnimZAdjust?: number;
    isChargeTurret?: boolean;
    overpowerable?: boolean;
    freeUnit?: string;
    primary?: string;
    secondary?: string;
    elitePrimary?: string;
    eliteSecondary?: string;
    weaponCount?: number;
    isGattling?: boolean;
    weaponStages?: number;
    rateUp?: number;
    rateDown?: number;
    deathWeapon?: string;
    deathWeaponDamageModifier?: number;
    occupyWeapon?: string;
    eliteOccupyWeapon?: string;
    veteranAbilities?: VeteranAbility[];
    eliteAbilities?: VeteranAbility[];
    selfHealing?: boolean;
    wall?: boolean;
    gate?: boolean;
    armor?: ArmorType;
    strength?: number;
    immune?: boolean;
    immuneToRadiation?: boolean;
    immuneToPsionics?: boolean;
    typeImmune?: boolean;
    warpable?: boolean;
    isTilter?: boolean;
    walkRate?: number;
    idleRate?: number;
    noSpawnAlt?: boolean;
    crusher?: boolean;
    consideredAircraft?: boolean;
    crashable?: boolean;
    landable?: boolean;
    airportBound?: boolean;
    balloonHover?: boolean;
    hoverAttack?: boolean;
    omniFire?: boolean;
    fighter?: boolean;
    flightLevel?: number;
    locomotor?: LocomotorType;
    speedType?: SpeedType;
    speed?: number;
    movementZone?: MovementZone;
    fearless?: boolean;
    deployer?: boolean;
    isSimpleDeployer?: boolean;
    deployFire?: boolean;
    deployFireWeapon?: WeaponType;
    undeployDelay?: number;
    fraidycat?: boolean;
    notHuman?: boolean;
    organic?: boolean;
    occupier?: boolean;
    engineer?: boolean;
    ivan?: boolean;
    civilian?: boolean;
    agent?: boolean;
    infiltrate?: boolean;
    threatPosed?: number;
    specialThreatValue?: number;
    canPassiveAquire?: boolean;
    canRetaliate?: boolean;
    preventAttackMove?: boolean;
    opportunityFire?: boolean;
    distributedFire?: boolean;
    radialFireSegments?: number;
    attackCursorOnFriendlies?: boolean;
    bombable?: boolean;
    trainable?: boolean;
    crewed?: boolean;
    parasiteable?: boolean;
    suppressionThreshold?: number;
    reselectIfLimboed?: boolean;
    rejoinTeamIfLimboed?: boolean;
    weight?: number;
    accelerates?: boolean;
    accelerationFactor?: number;
    teleporter?: boolean;
    canDisguise?: boolean;
    disguiseWhenStill?: boolean;
    permaDisguise?: boolean;
    detectDisguise?: boolean;
    detectDisguiseRange?: number;
    cloakable?: boolean;
    sensors?: boolean;
    sensorArray?: boolean;
    sensorsSight?: number;
    /** BurstDelay0..3, `undefined` = key absent */
    burstDelay?: (number | undefined)[];
    vhpScan?: VhpScan;
    pip?: PipColor;
    passengers?: number;
    gunner?: boolean;
    openTopped?: boolean;
    ammo?: number;
    initialAmmo?: number;
    manualReload?: boolean;
    storage?: number;
    spawned?: boolean;
    spawns?: string;
    airstrikeTeam?: number;
    eliteAirstrikeTeam?: number;
    airstrikeTeamType?: string;
    eliteAirstrikeTeamType?: string;
    spawnsNumber?: number;
    spawnRegenRate?: number;
    spawnReloadRate?: number;
    missileSpawn?: boolean;
    size?: number;
    sizeLimit?: number;
    sight?: number;
    spySat?: boolean;
    gapGenerator?: boolean;
    gapRadiusInCells?: number;
    psychicDetectionRadius?: number;
    hasRadialIndicator?: boolean;
    harvester?: boolean;
    unloadingClass?: string;
    dock?: string[];
    radar?: boolean;
    radarInvisible?: boolean;
    revealToAll?: boolean;
    selectable?: boolean;
    isSelectableCombatant?: boolean;
    invisibleInGame?: boolean;
    moveToShroud?: boolean;
    leadershipRating?: number;
    unnatural?: boolean;
    natural?: boolean;
    buildTimeMultiplier?: number;
    allowedToStartInMultiplayer?: boolean;
    rot?: number;
    jumpjetAccel?: number;
    jumpjetClimb?: number;
    jumpjetCrash?: number;
    jumpjetDeviation?: number;
    jumpjetHeight?: number;
    jumpjetNoWobbles?: boolean;
    jumpjetSpeed?: number;
    jumpjetTurnRate?: number;
    jumpjetWobbles?: number;
    pitchSpeed?: number;
    damageParticleSystems?: string[];
    /** `DamageSmokeOffset` as authored: [x, y, z] in voxel space */
    damageSmokeOffset?: number[];
    minDebris?: number;
    maxDebris?: number;
    debrisTypes?: string[];
    debrisAnims?: string[];
    lightVisibility?: number;
    lightIntensity?: number;
    lightRedTint?: number;
    lightGreenTint?: number;
    lightBlueTint?: number;
    ambientSound?: string;
    createSound?: string;
    deploySound?: string;
    undeploySound?: string;
    voiceSelect?: string;
    voiceMove?: string;
    voiceAttack?: string;
    voiceFeedback?: string;
    voiceSpecialAttack?: string;
    voiceEnter?: string;
    voiceCapture?: string;
    voiceCrashing?: string;
    crashingSound?: string;
    impactLandSound?: string;
    auxSound1?: string;
    auxSound2?: string;
    dieSound?: string;
    moveSound?: string;
    enterWaterSound?: string;
    leaveWaterSound?: string;
    turretRotateSound?: string;
    workingSound?: string;
    notWorkingSound?: string;
    chronoInSound?: string;
    chronoOutSound?: string;
    enterTransportSound?: string;
    leaveTransportSound?: string;
    /** `Weapon1..N` — index 0 is Weapon1 */
    weapons?: string[];
    /** `EliteWeapon1..N` */
    eliteWeapons?: string[];
}

export class TechnoRules extends ObjectRules {
    static readonly MAX_SIGHT = 11;

    owner: string[] = [];
    aiBasePlanningSide?: number;
    requiredHouses: string[] = [];
    forbiddenHouses: string[] = [];
    requiresStolenAlliedTech = false;
    requiresStolenSovietTech = false;
    requiresStolenThirdTech = false;
    techLevel = -1;
    cost = 0;
    points = 0;
    power = 0;
    powered = false;
    poweredUnit = false;
    powersUnit?: string;
    prerequisite: string[] = [];
    soylent = 0;
    crateGoodie = false;
    buildCat = BuildCat.Combat;
    adjacent = 1;
    baseNormal = true;
    buildLimit = Number.POSITIVE_INFINITY;
    airRangeBonus = 0;
    guardRange = 0;
    defaultToGuardArea = false;
    eligibileForAllyBuilding = false;
    numberImpassableRows = 0;
    bridgeRepairHut = false;
    constructionYard = false;
    refinery = false;
    dockUnload = false;
    enslaves?: string;
    slavesNumber = 5;
    slaved = false;
    unitRepair = false;
    unitReload = false;
    unitSell = false;
    isBaseDefense = false;
    superWeapon?: string;
    chargedAnimTime = 0;
    naval = false;
    underwater = false;
    waterBound = false;
    orePurifier = false;
    cloning = false;
    grinding = false;
    nukeSilo = false;
    repairable = false;
    clickRepairable = false;
    unsellable = false;
    returnable = false;
    gdiBarracks = false;
    nodBarracks = false;
    numberOfDocks = 0;
    factory = FactoryType.None;
    weaponsFactory = false;
    helipad = false;
    hospital = false;
    landTargeting = LandTargeting.LandOk;
    navalTargeting = NavalTargeting.UnderwaterNever;
    tooBigToFitUnderBridge = false;
    bunker = false;
    canBeOccupied = false;
    maxNumberOccupants = 0;
    occupantsPowerBonus = 0;
    leaveRubble = false;
    undeploysInto = '';
    deploysInto = '';
    deployTime = 0;
    capturable = false;
    spyable = false;
    needsEngineer = false;
    c4 = false;
    canC4 = true;
    eligibleForDelayKill = false;
    produceCashStartup = 0;
    produceCashAmount = 0;
    produceCashDelay = 0;
    explosion: string[] = [];
    explodes = false;
    ifvMode = 0;
    turretIndexesByIfvMode = new Map<number, number>();
    turret = false;
    turretCount = 0;
    turretAnim = '';
    turretAnimIsVoxel = false;
    turretAnimX = 0;
    turretAnimY = 0;
    turretAnimZAdjust = 0;
    isChargeTurret = false;
    overpowerable = false;
    freeUnit = '';
    primary?: string;
    secondary?: string;
    elitePrimary?: string;
    eliteSecondary?: string;
    weaponCount = 0;
    isGattling = false;
    weaponStages = 1;
    rateUp = 1;
    rateDown = 50;
    deathWeapon?: string;
    deathWeaponDamageModifier = 1;
    occupyWeapon?: string;
    eliteOccupyWeapon?: string;
    veteranAbilities = new Set<VeteranAbility>();
    eliteAbilities = new Set<VeteranAbility>();
    selfHealing = false;
    wall = false;
    gate = false;
    armor = ArmorType.None;
    strength = 0;
    immune = false;
    immuneToRadiation = false;
    immuneToPsionics = false;
    typeImmune = false;
    warpable = true;
    isTilter = true;
    walkRate = 1;
    idleRate = 0;
    noSpawnAlt = false;
    crusher = false;
    consideredAircraft = false;
    crashable = false;
    landable = false;
    airportBound = false;
    balloonHover = false;
    hoverAttack = false;
    omniFire = false;
    fighter = false;
    flightLevel?: number;
    locomotor = LocomotorType.Chrono;
    speedType?: SpeedType;
    speed = 0;
    movementZone = MovementZone.Normal;
    fearless = false;
    deployer = false;
    deployFire = false;
    deployFireWeapon = WeaponType.Secondary;
    undeployDelay = 0;
    fraidycat = false;
    isHuman = true;
    organic = false;
    occupier = false;
    engineer = false;
    ivan = false;
    civilian = false;
    agent = false;
    infiltrate = false;
    threatPosed = 0;
    specialThreatValue = 0;
    canPassiveAquire = true;
    canRetaliate = true;
    preventAttackMove = false;
    opportunityFire = false;
    distributedFire = false;
    radialFireSegments = 0;
    attackCursorOnFriendlies = false;
    bombable = true;
    trainable = false;
    crewed = false;
    parasiteable = false;
    suppressionThreshold = 0;
    reselectIfLimboed = false;
    rejoinTeamIfLimboed = false;
    weight = 0;
    accelerates = true;
    accelerationFactor = 0.03;
    teleporter = false;
    canDisguise = false;
    disguiseWhenStill = false;
    permaDisguise = false;
    detectDisguise = false;
    detectDisguiseRange = 0;
    cloakable = false;
    sensors = false;
    sensorArray = false;
    sensorsSight = 0;
    burstDelay: (number | undefined)[] = [undefined, undefined, undefined, undefined];
    vhpScan = VhpScan.None;
    pip = PipColor.Green;
    passengers = 0;
    gunner = false;
    openTopped = false;
    ammo = -1;
    initialAmmo = -1;
    manualReload = false;
    storage = 0;
    spawned = false;
    spawns = '';
    airstrikeTeam = 2;
    eliteAirstrikeTeam = 2;
    airstrikeTeamType = '';
    eliteAirstrikeTeamType = '';
    spawnsNumber = 0;
    spawnRegenRate = 0;
    spawnReloadRate = 0;
    missileSpawn = false;
    size = 1;
    sizeLimit = 0;
    sight = 1;
    spySat = false;
    gapGenerator = false;
    gapRadiusInCells = 0;
    psychicDetectionRadius = 0;
    hasRadialIndicator = false;
    harvester = false;
    unloadingClass = '';
    dock: string[] = [];
    radar = false;
    radarInvisible = false;
    revealToAll = false;
    selectable = true;
    isSelectableCombatant = false;
    invisibleInGame = false;
    moveToShroud = true;
    leadershipRating = 5;
    unnatural = false;
    natural = false;
    buildTimeMultiplier = 1;
    allowedToStartInMultiplayer = true;
    rot = 0;
    jumpjetAccel = 2;
    jumpjetClimb = 5;
    jumpjetCrash = 5;
    jumpjetDeviation = 40;
    jumpjetHeight = 500;
    jumpjetNoWobbles = false;
    jumpjetSpeed = 14;
    jumpjetTurnRate = 0;
    jumpjetWobbles = 0.15;
    pitchSpeed = 0.25;
    pitchAngle = 20;
    damageParticleSystems: string[] = [];
    damageSmokeOffset = new Vector3(0, 0, 0);
    minDebris = 0;
    maxDebris = 0;
    debrisTypes: string[] = [];
    debrisAnims: string[] = [];
    isLightpost = false;
    lightVisibility = 5000;
    lightIntensity = 0;
    lightRedTint = 1;
    lightGreenTint = 1;
    lightBlueTint = 1;
    ambientSound?: string;
    createSound?: string;
    deploySound?: string;
    undeploySound?: string;
    voiceSelect?: string;
    voiceMove?: string;
    voiceAttack?: string;
    voiceFeedback?: string;
    voiceSpecialAttack?: string;
    voiceEnter?: string;
    voiceCapture?: string;
    voiceCrashing?: string;
    crashingSound?: string;
    impactLandSound?: string;
    auxSound1?: string;
    auxSound2?: string;
    dieSound?: string;
    moveSound?: string;
    enterWaterSound?: string;
    leaveWaterSound?: string;
    turretRotateSound?: string;
    workingSound?: string;
    notWorkingSound?: string;
    chronoInSound?: string;
    chronoOutSound?: string;
    enterTransportSound?: string;
    leaveTransportSound?: string;

    private weapons: string[] = [];
    private eliteWeapons: string[] = [];
    private generalRules: TechnoRulesGeneralRules;

    constructor(type: ObjectType, data: TechnoRulesData, generalRules: TechnoRulesGeneralRules = {}, index = -1) {
        super(data, type, index);
        this.generalRules = generalRules;
        this.parseTechno(data);
    }

    private parseTechno(data: TechnoRulesData): void {
        this.owner = data.owner ?? [];
        const aiBasePlanningValue = data.aiBasePlanningSide ?? 0;
        this.aiBasePlanningSide =
            aiBasePlanningValue !== -1 && SideType[aiBasePlanningValue] !== undefined
                ? aiBasePlanningValue
                : undefined;
        this.requiredHouses = data.requiredHouses ?? [];
        this.forbiddenHouses = data.forbiddenHouses ?? [];
        this.requiresStolenAlliedTech = !!data.requiresStolenAlliedTech;
        this.requiresStolenSovietTech = !!data.requiresStolenSovietTech;
        this.requiresStolenThirdTech = !!data.requiresStolenThirdTech;
        this.techLevel = data.techLevel ?? -1;
        this.cost = data.cost ?? 0;
        this.points = data.points ?? 0;
        this.power = data.power ?? 0;
        this.powered = !!data.powered;
        this.poweredUnit = !!data.poweredUnit;
        this.powersUnit = data.powersUnit || undefined;
        this.prerequisite = data.prerequisite ?? [];
        this.soylent = data.soylent ?? 0;
        this.crateGoodie = !!data.crateGoodie;
        this.buildCat = data.buildCat ?? BuildCat.Combat;
        this.adjacent = data.adjacent ?? 1;
        this.baseNormal = data.baseNormal ?? true;
        this.buildLimit = data.buildLimit ?? Number.POSITIVE_INFINITY;
        this.airRangeBonus = data.airRangeBonus ?? 0;
        this.guardRange = data.guardRange ?? 0;
        this.defaultToGuardArea = !!data.defaultToGuardArea;
        this.eligibileForAllyBuilding = !!data.eligibileForAllyBuilding;
        this.numberImpassableRows = data.numberImpassableRows ?? 0;
        this.bridgeRepairHut = !!data.bridgeRepairHut;
        this.constructionYard = !!data.constructionYard;
        this.refinery = !!data.refinery;
        this.unitRepair = !!data.unitRepair;
        this.unitReload = !!data.unitReload;
        this.unitSell = !!data.unitSell;
        this.isBaseDefense = !!data.isBaseDefense;
        this.superWeapon = this.parseWeaponName(data.superWeapon);
        this.chargedAnimTime = data.chargedAnimTime ?? 0;
        const naval = !!data.naval;
        this.naval = naval;
        this.underwater = !!data.underwater;
        this.waterBound = !!data.waterBound;
        this.orePurifier = !!data.orePurifier;
        this.cloning = !!data.cloning;
        this.grinding = !!data.grinding;
        this.nukeSilo = !!data.nukeSilo;
        this.repairable = data.repairable ?? this.type === ObjectType.Building;
        this.clickRepairable = data.clickRepairable ?? this.type === ObjectType.Building;
        this.unsellable =
            data.unsellable ?? (this.type !== ObjectType.Building && !!this.generalRules.unitsUnsellable);
        this.returnable = data.returnable ?? !!this.generalRules.returnStructures;
        this.gdiBarracks = !!data.gdiBarracks;
        this.nodBarracks = !!data.nodBarracks;
        this.numberOfDocks = data.numberOfDocks ?? 0;
        if (this.unitRepair && !this.numberOfDocks) {
            this.numberOfDocks = 1;
        }
        this.factory = data.factory ?? FactoryType.None;
        if (this.factory === FactoryType.UnitType && naval) {
            this.factory = FactoryType.NavalUnitType;
        }
        this.weaponsFactory = !!data.weaponsFactory;
        this.helipad = !!data.helipad;
        this.hospital = !!data.hospital;
        this.landTargeting = data.landTargeting ?? LandTargeting.LandOk;
        this.navalTargeting = data.navalTargeting ?? NavalTargeting.UnderwaterNever;
        this.tooBigToFitUnderBridge = data.tooBigToFitUnderBridge ?? this.type === ObjectType.Building;
        this.bunker = !!data.bunker;
        this.canBeOccupied = !!data.canBeOccupied;
        this.maxNumberOccupants = data.maxNumberOccupants ?? 0;
        // Retail hard-codes the Bio Reactor battery in the exe (YAPOWR has no
        // occupancy keys, yet holds 5 infantry at +100 power each). Here the data
        // simply declares `occupantsPowerBonus`, so the special case is content,
        // not code.
        this.occupantsPowerBonus = data.occupantsPowerBonus ?? 0;
        this.leaveRubble = !!data.leaveRubble;
        this.undeploysInto = data.undeploysInto ?? '';
        this.deploysInto = data.deploysInto ?? '';
        this.deployTime = data.deployTime ?? 0;
        this.capturable = !!data.capturable;
        this.spyable = !!data.spyable;
        this.needsEngineer = !!data.needsEngineer;
        this.c4 = !!data.c4;
        this.canC4 = data.canC4 ?? true;
        this.eligibleForDelayKill = !!data.eligibleForDelayKill;
        this.produceCashStartup = data.produceCashStartup ?? 0;
        this.produceCashAmount = data.produceCashAmount ?? 0;
        this.produceCashDelay = data.produceCashDelay ?? 0;
        this.explosion = data.explosion ?? [];
        this.explodes = !!data.explodes;
        this.ifvMode = data.ifvMode ?? 0;
        this.turretIndexesByIfvMode = new Map(
            Object.entries(data.turretIndexesByIfvMode ?? {}).map(([key, value]) => [Number(key), value]),
        );
        this.turret = !!data.turret;
        this.turretCount = data.turretCount ?? (this.turret ? 1 : 0);
        this.turretAnim = data.turretAnim ?? '';
        this.turretAnimIsVoxel = !!data.turretAnimIsVoxel;
        this.turretAnimX = data.turretAnimX ?? 0;
        this.turretAnimY = data.turretAnimY ?? 0;
        this.turretAnimZAdjust = data.turretAnimZAdjust ?? 0;
        this.isChargeTurret = !!data.isChargeTurret;
        this.overpowerable = !!data.overpowerable;
        this.freeUnit = data.freeUnit ?? '';
        this.weapons = data.weapons ?? [];
        this.eliteWeapons = data.eliteWeapons ?? [];
        this.primary = this.parseWeaponName(data.primary);
        this.secondary = this.parseWeaponName(data.secondary);
        this.elitePrimary = this.parseWeaponName(data.elitePrimary);
        this.eliteSecondary = this.parseWeaponName(data.eliteSecondary);
        this.weaponCount = data.weaponCount ?? 0;
        // Gattling weapons split WeaponCount slots into WeaponStages pairs —
        // odd slots anti-ground, even anti-air — escalating while firing.
        this.isGattling = !!data.isGattling;
        this.weaponStages = data.weaponStages ?? 1;
        this.rateUp = data.rateUp ?? 1;
        this.rateDown = data.rateDown ?? 50;
        this.deathWeapon = this.parseWeaponName(data.deathWeapon);
        this.deathWeaponDamageModifier = data.deathWeaponDamageModifier ?? 1;
        this.occupyWeapon = this.parseWeaponName(data.occupyWeapon);
        this.eliteOccupyWeapon = this.parseWeaponName(data.eliteOccupyWeapon);
        this.veteranAbilities = new Set(data.veteranAbilities ?? []);
        this.eliteAbilities = new Set([...this.veteranAbilities, ...(data.eliteAbilities ?? [])]);
        this.selfHealing = !!data.selfHealing;
        this.wall = !!data.wall;
        this.gate = !!data.gate;
        this.armor = data.armor ?? ArmorType.None;
        this.strength = Math.floor(data.strength ?? 0);
        this.immune = !!data.immune;
        this.immuneToRadiation = !!data.immuneToRadiation;
        this.immuneToPsionics = !!data.immuneToPsionics;
        this.typeImmune = !!data.typeImmune;
        this.warpable = data.warpable ?? true;
        this.isTilter = data.isTilter ?? true;
        this.walkRate = data.walkRate ?? 1;
        this.idleRate = data.idleRate ?? 0;
        this.noSpawnAlt = !!data.noSpawnAlt;
        this.crusher = !!data.crusher;
        this.consideredAircraft = !!data.consideredAircraft;
        this.crashable = !!data.crashable;
        const landable = !!data.landable;
        this.landable = landable;
        this.airportBound = !!data.airportBound;
        this.balloonHover = !!data.balloonHover;
        this.hoverAttack = !!data.hoverAttack;
        this.omniFire = !!data.omniFire;
        this.fighter = !!data.fighter;
        this.flightLevel = (data.flightLevel ?? 0) || undefined;

        const defaultLocomotor = this.type === ObjectType.Building ? LocomotorType.Statue : LocomotorType.Chrono;
        this.locomotor = data.locomotor ?? defaultLocomotor;

        if (this.locomotor !== LocomotorType.Statue) {
            let defaultSpeed = defaultSpeedsByLocomotor.get(this.locomotor);
            if (defaultSpeed === undefined) {
                if (this.type === ObjectType.Aircraft || this.consideredAircraft) {
                    defaultSpeed = SpeedType.Winged;
                } else if (this.type === ObjectType.Vehicle) {
                    defaultSpeed = this.crusher ? SpeedType.Track : SpeedType.Wheel;
                } else if (this.type === ObjectType.Infantry) {
                    defaultSpeed = SpeedType.Foot;
                }
            }
            this.speedType = data.speedType ?? defaultSpeed;
        }

        const speedMultiplier = [LocomotorType.Ship, LocomotorType.Vehicle, LocomotorType.Chrono].includes(
            this.locomotor,
        )
            ? 65
            : 100;
        this.speed = ObjectRules.iniSpeedToLeptonsPerTick(data.speed ?? 0, speedMultiplier);
        this.movementZone = data.movementZone ?? MovementZone.Normal;
        this.fearless = !!data.fearless;
        // YR added IsSimpleDeployer (Siege Chopper) alongside RA2's Deployer key
        this.deployer = !!data.deployer || !!data.isSimpleDeployer;
        this.deployFire = !!data.deployFire;
        this.deployFireWeapon = data.deployFireWeapon ?? WeaponType.Secondary;
        this.undeployDelay = data.undeployDelay ?? 0;
        this.fraidycat = data.fraidycat ?? false;
        this.isHuman = !data.notHuman;
        this.organic = this.type === ObjectType.Infantry || !!data.organic;
        this.occupier = !!data.occupier;
        this.engineer = !!data.engineer;
        this.ivan = !!data.ivan;
        this.civilian = !!data.civilian;
        this.agent = !!data.agent;
        this.infiltrate = !!data.infiltrate;
        this.threatPosed = data.threatPosed ?? 0;
        this.specialThreatValue = data.specialThreatValue ?? 0;
        this.canPassiveAquire = data.canPassiveAquire ?? true;
        this.canRetaliate = data.canRetaliate ?? true;
        this.preventAttackMove = !!data.preventAttackMove;
        this.opportunityFire = !!data.opportunityFire;
        this.distributedFire = !!data.distributedFire;
        this.radialFireSegments = data.radialFireSegments ?? 0;
        this.attackCursorOnFriendlies = !!data.attackCursorOnFriendlies;
        this.bombable = data.bombable ?? true;
        this.trainable = data.trainable ?? this.type !== ObjectType.Building;
        this.crewed = !!data.crewed;
        this.parasiteable = data.parasiteable ?? this.type !== ObjectType.Building;
        this.suppressionThreshold = data.suppressionThreshold ?? 0;
        this.reselectIfLimboed = !!data.reselectIfLimboed;
        this.rejoinTeamIfLimboed = !!data.rejoinTeamIfLimboed;
        this.weight = data.weight ?? 0;
        this.accelerates = data.accelerates ?? true;
        this.accelerationFactor = data.accelerationFactor ?? 0.03;
        this.teleporter = !!data.teleporter;
        this.canDisguise = !!data.canDisguise;
        this.disguiseWhenStill = !!data.disguiseWhenStill;
        this.permaDisguise = !!data.permaDisguise;
        this.detectDisguise = !!data.detectDisguise;
        this.detectDisguiseRange = data.detectDisguiseRange ?? 0;
        this.cloakable = !!data.cloakable;
        this.sensors = !!data.sensors;
        this.sensorArray = !!data.sensorArray;
        this.sensorsSight = data.sensorsSight ?? 0;

        const bursts = data.burstDelay ?? [];
        this.burstDelay = [];
        for (let i = 0; i < 4; i++) {
            this.burstDelay.push(bursts[i]);
        }

        this.vhpScan = data.vhpScan ?? VhpScan.None;
        this.pip = data.pip ?? PipColor.Green;
        this.passengers = data.passengers ?? 0;
        this.gunner = !!data.gunner;
        this.openTopped = !!data.openTopped;
        this.ammo = data.ammo ?? -1;
        this.initialAmmo = data.initialAmmo ?? -1;
        this.manualReload = data.manualReload ?? this.type === ObjectType.Aircraft;
        this.storage = data.storage ?? 0;
        this.spawned = !!data.spawned;
        this.spawns = data.spawns ?? '';
        this.airstrikeTeam = data.airstrikeTeam ?? 2;
        this.eliteAirstrikeTeam = data.eliteAirstrikeTeam ?? this.airstrikeTeam;
        this.airstrikeTeamType = data.airstrikeTeamType ?? '';
        this.eliteAirstrikeTeamType = data.eliteAirstrikeTeamType || this.airstrikeTeamType;
        this.spawnsNumber = data.spawnsNumber ?? 0;
        this.spawnRegenRate = data.spawnRegenRate ?? 0;
        this.spawnReloadRate = data.spawnReloadRate ?? 0;
        this.missileSpawn = !!data.missileSpawn;
        this.size = data.size ?? 1;
        this.sizeLimit = data.sizeLimit ?? 0;
        // engineers see further on a structure they can capture
        this.sight = Math.min(TechnoRules.MAX_SIGHT, this.needsEngineer ? 6 : data.sight ?? 1);
        this.spySat = !!data.spySat;
        this.gapGenerator = !!data.gapGenerator;
        this.gapRadiusInCells = data.gapRadiusInCells ?? 0;
        this.psychicDetectionRadius = data.psychicDetectionRadius ?? 0;
        this.hasRadialIndicator = !!data.hasRadialIndicator;
        this.harvester = !!data.harvester;
        this.unloadingClass = data.unloadingClass ?? '';
        this.dock = data.dock ?? [];
        this.radar = !!data.radar;
        this.radarInvisible = !!data.radarInvisible;
        this.revealToAll = !!data.revealToAll;
        this.selectable = !(this.type === ObjectType.Aircraft && !landable) && (data.selectable ?? true);
        this.isSelectableCombatant = !!data.isSelectableCombatant;
        this.invisibleInGame = !!data.invisibleInGame;
        this.moveToShroud = data.moveToShroud ?? this.type !== ObjectType.Aircraft;
        this.leadershipRating = data.leadershipRating ?? 5;
        this.unnatural = !!data.unnatural;
        this.natural = !!data.natural;
        this.buildTimeMultiplier = data.buildTimeMultiplier ?? 1;
        this.allowedToStartInMultiplayer = data.allowedToStartInMultiplayer ?? true;
        this.rot = ObjectRules.iniRotToDegsPerTick(data.rot ?? 0);
        this.jumpjetAccel = data.jumpjetAccel ?? 2;
        this.jumpjetClimb = data.jumpjetClimb ?? 5;
        this.jumpjetCrash = data.jumpjetCrash ?? 5;
        this.jumpjetDeviation = data.jumpjetDeviation ?? 40;
        this.jumpjetHeight = data.jumpjetHeight ?? 500;
        this.jumpjetNoWobbles = !!data.jumpjetNoWobbles;
        this.jumpjetSpeed = data.jumpjetSpeed ?? 14;
        this.jumpjetTurnRate = ObjectRules.iniRotToDegsPerTick(data.jumpjetTurnRate ?? 4);
        this.jumpjetWobbles = data.jumpjetWobbles ?? 0.15;
        this.pitchSpeed = data.pitchSpeed ?? 0.25;
        this.pitchAngle = this.pitchSpeed >= 1 ? 0 : 20;
        this.damageParticleSystems = data.damageParticleSystems ?? [];
        const smokeOffset = data.damageSmokeOffset ?? [0, 0, 0];
        this.damageSmokeOffset = new Vector3(smokeOffset[0], smokeOffset[2] / Math.SQRT2, smokeOffset[1]);
        this.minDebris = data.minDebris ?? 0;
        this.maxDebris = data.maxDebris ?? 0;
        this.debrisTypes = data.debrisTypes ?? [];
        this.debrisAnims = data.debrisAnims ?? [];
        // InvisibleInGame means "never draw this" — a light post exists to cast light
        this.isLightpost = this.invisibleInGame;
        this.lightVisibility = data.lightVisibility ?? 5000;
        this.lightIntensity = data.lightIntensity ?? 0;
        this.lightRedTint = data.lightRedTint ?? 1;
        this.lightGreenTint = data.lightGreenTint ?? 1;
        this.lightBlueTint = data.lightBlueTint ?? 1;
        this.ambientSound = data.ambientSound || undefined;
        this.createSound = data.createSound || undefined;
        this.deploySound = data.deploySound || undefined;
        this.undeploySound = data.undeploySound || undefined;
        this.voiceSelect = data.voiceSelect || undefined;
        this.voiceMove = data.voiceMove || undefined;
        this.voiceAttack = data.voiceAttack || undefined;
        this.voiceFeedback = data.voiceFeedback || undefined;
        this.voiceSpecialAttack = data.voiceSpecialAttack || undefined;
        this.voiceEnter = data.voiceEnter || undefined;
        this.voiceCapture = data.voiceCapture || undefined;
        this.voiceCrashing = data.voiceCrashing || undefined;
        this.crashingSound = data.crashingSound || undefined;
        this.impactLandSound = data.impactLandSound || undefined;
        this.auxSound1 = data.auxSound1 || undefined;
        this.auxSound2 = data.auxSound2 || undefined;
        this.dieSound = data.dieSound || undefined;
        this.moveSound = data.moveSound || undefined;
        this.enterWaterSound = data.enterWaterSound || undefined;
        this.leaveWaterSound = data.leaveWaterSound || undefined;
        this.turretRotateSound = data.turretRotateSound || undefined;
        this.workingSound = data.workingSound || undefined;
        this.notWorkingSound = data.notWorkingSound || undefined;
        this.chronoInSound = data.chronoInSound || undefined;
        this.chronoOutSound = data.chronoOutSound || undefined;
        this.enterTransportSound = data.enterTransportSound || undefined;
        this.leaveTransportSound = data.leaveTransportSound || undefined;

        // The slave-miner family derives generic flags the retail INI never sets:
        // a slave (Slaved=yes) IS a harvester, a slave miner (Enslaves=…) IS a
        // refinery with a dock.
        this.enslaves = data.enslaves || undefined;
        this.slavesNumber = data.slavesNumber ?? 5;
        this.slaved = !!data.slaved;
        if (this.slaved) {
            this.harvester = true;
        }
        if (this.enslaves) {
            this.refinery = true;
            this.dockUnload = true;
            if (!this.numberOfDocks) {
                this.numberOfDocks = 1;
            }
        }
    }

    private parseWeaponName(weaponName: string | undefined): string | undefined {
        return weaponName && weaponName.toLowerCase() !== 'none' ? weaponName : undefined;
    }

    hasOwner(house: House): boolean {
        return this.owner.length > 0 && this.owner.indexOf(house.name) !== -1;
    }

    isAvailableTo(house: House): boolean {
        const hasRequiredHouse = this.requiredHouses.length === 0 || this.requiredHouses.indexOf(house.name) !== -1;
        const isForbidden = this.forbiddenHouses.indexOf(house.name) !== -1;
        return hasRequiredHouse && !isForbidden;
    }

    getWeaponAtIndex(index: number): string | undefined {
        return this.parseWeaponName(this.weapons[index]);
    }

    getEliteWeaponAtIndex(index: number): string | undefined {
        return this.parseWeaponName(this.eliteWeapons[index]);
    }
}

/** default SpeedType per locomotor — mirrors `LocomotorType.defaultSpeedsByLocomotor` */
const defaultSpeedsByLocomotor = new Map<LocomotorType, SpeedType>([
    [LocomotorType.Infantry, SpeedType.Foot],
    [LocomotorType.Ship, SpeedType.Float],
    [LocomotorType.Hover, SpeedType.Hover],
    [LocomotorType.Jumpjet, SpeedType.Winged],
    [LocomotorType.Aircraft, SpeedType.Winged],
    [LocomotorType.Missile, SpeedType.Winged],
]);
