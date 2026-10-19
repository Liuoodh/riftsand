/**
 * `[AudioVisual]` section — animation/sound names plus a few presentation knobs.
 *
 * Reference: redalert2/src/game/rules/AudioVisualRules.ts
 *
 * The reference hardcodes a retail fallback for nearly every key because YR's
 * `rulesmd.ini` omits values that RA2's `rules.ini` defines ("without them, code
 * paths like the move-order flash crash on an empty name"). That fallback table is
 * *content*, so it moved to the rules content file; the mechanism — "absent key
 * becomes an empty name, never undefined" — is preserved here, and `Rules` asserts
 * at load time that the names it needs are present.
 *
 * Two derived values survive unchanged:
 *   - `idleActionFrequency = 60 * raw` — the ini value is in seconds, the trait
 *     wants ticks;
 *   - `fireNames` splits on `.` **or** `,` and drops empty segments, because retail
 *     files are inconsistent about the separator.
 *
 * Fields are `private` in the reference but read from `engine/renderable/**`; TS
 * never enforced it, so they are `public` here.
 */
export interface AudioVisualRulesData {
    ambientChangeRate?: number;
    ambientChangeStep?: number;
    behind?: string;
    bridgeExplosions?: string[];
    chronoBeamColor?: number[];
    chronoBlast?: string;
    chronoBlastDest?: string;
    chronoPlacement?: string;
    chronoSparkle1?: string;
    conditionRed?: number;
    conditionYellow?: number;
    creditTicks?: string[];
    extraAircraftLight?: number;
    extraInfantryLight?: number;
    extraUnitLight?: number;
    /** `DamageFireTypes` — dot- or comma-separated */
    damageFireTypes?: string;
    flyerHelper?: string;
    gravity?: number;
    /** seconds in the ini; stored multiplied by 60 */
    idleActionFrequency?: number;
    impactLandSound?: string;
    impactWaterSound?: string;
    infantryExplode?: string;
    flamingInfantry?: string;
    infantryHeadPop?: string;
    infantryNuked?: string;
    ironCurtainInvokeAnim?: string;
    messageDuration?: number;
    metallicDebris?: string[];
    nukeTakeOff?: string;
    deadBodies?: string[];
    wake?: string;
    parachute?: string;
    moveFlash?: string;
    warpOut?: string;
    warpAway?: string;
    weaponNullifyAnim?: string;
    weatherConClouds?: string[];
    weatherConBoltExplosion?: string;
    weatherConBolts?: string[];
}

export class AudioVisualRules {
    ambientChangeRate = 0;
    ambientChangeStep = 0;
    behind = '';
    bridgeExplosions: string[] = [];
    chronoBeamColor: number[] = [];
    chronoBlast = '';
    chronoBlastDest = '';
    chronoPlacement = '';
    chronoSparkle1 = '';
    conditionRed = 0;
    conditionYellow = 0;
    creditTicks: string[] = [];
    extraAircraftLight = 0;
    extraInfantryLight = 0;
    extraUnitLight = 0;
    fireNames: string[] = [];
    flyerHelper = '';
    gravity = 0;
    idleActionFrequency = 0;
    impactLandSound?: string;
    impactWaterSound?: string;
    infantryExplode = '';
    flamingInfantry = '';
    infantryHeadPop = '';
    infantryNuked = '';
    ironCurtainInvokeAnim = '';
    messageDuration = 10;
    metallicDebris: string[] = [];
    nukeTakeOff = '';
    deadBodies: string[] = [];
    wake = '';
    parachute = '';
    moveFlash = '';
    warpOut = '';
    warpAway = '';
    weaponNullifyAnim = '';
    weatherConClouds: string[] = [];
    weatherConBoltExplosion = '';
    weatherConBolts: string[] = [];

    read(data: AudioVisualRulesData = {}): AudioVisualRules {
        const str = (key: string, live: string | undefined, fallback = ''): string => live || fallback;
        const arr = (live: string[] | undefined, fallback: string[] = []): string[] =>
            live && live.length ? live : fallback;

        this.ambientChangeRate = data.ambientChangeRate ?? 0;
        this.ambientChangeStep = data.ambientChangeStep ?? 0;
        this.behind = str('Behind', data.behind);
        this.bridgeExplosions = arr(data.bridgeExplosions);
        this.chronoBeamColor = data.chronoBeamColor ?? [];
        this.chronoBlast = str('ChronoBlast', data.chronoBlast);
        this.chronoBlastDest = str('ChronoBlastDest', data.chronoBlastDest);
        this.chronoPlacement = str('ChronoPlacement', data.chronoPlacement);
        this.chronoSparkle1 = str('ChronoSparkle1', data.chronoSparkle1);
        this.conditionRed = data.conditionRed ?? 0;
        this.conditionYellow = data.conditionYellow ?? 0;
        this.creditTicks = data.creditTicks ?? [];
        this.extraAircraftLight = data.extraAircraftLight ?? 0;
        this.extraInfantryLight = data.extraInfantryLight ?? 0;
        this.extraUnitLight = data.extraUnitLight ?? 0;
        const damageFireTypes = str('DamageFireTypes', data.damageFireTypes);
        this.fireNames = damageFireTypes.split(/\.|,/).filter((e) => e !== '');
        this.flyerHelper = data.flyerHelper ?? '';
        this.gravity = data.gravity ?? 0;
        this.idleActionFrequency = 60 * (data.idleActionFrequency ?? 0);
        this.impactLandSound = data.impactLandSound || undefined;
        this.impactWaterSound = data.impactWaterSound || undefined;
        this.infantryExplode = str('InfantryExplode', data.infantryExplode);
        this.flamingInfantry = str('FlamingInfantry', data.flamingInfantry);
        this.infantryHeadPop = str('InfantryHeadPop', data.infantryHeadPop);
        this.infantryNuked = str('InfantryNuked', data.infantryNuked);
        this.ironCurtainInvokeAnim = str('IronCurtainInvokeAnim', data.ironCurtainInvokeAnim);
        this.messageDuration = data.messageDuration ?? 10;
        this.metallicDebris = arr(data.metallicDebris);
        this.nukeTakeOff = str('NukeTakeOff', data.nukeTakeOff);
        this.deadBodies = arr(data.deadBodies);
        this.wake = str('Wake', data.wake);
        this.parachute = str('Parachute', data.parachute);
        this.moveFlash = str('MoveFlash', data.moveFlash);
        this.warpOut = str('WarpOut', data.warpOut);
        this.warpAway = str('WarpAway', data.warpAway);
        this.weaponNullifyAnim = str('WeaponNullifyAnim', data.weaponNullifyAnim);
        this.weatherConClouds = arr(data.weatherConClouds);
        this.weatherConBoltExplosion = str('WeatherConBoltExplosion', data.weatherConBoltExplosion);
        this.weatherConBolts = arr(data.weatherConBolts);
        return this;
    }
}
