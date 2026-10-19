/**
 * Weapon rules.
 *
 * Reference: redalert2/src/game/rules/WeaponRules.ts
 *
 * Three conversions are load-bearing and easy to lose when moving off the INI:
 *   1. `Range = -2` means "unlimited" and becomes `Infinity`.
 *   2. `Speed` is stored twice: `iniSpeed` verbatim and `speed` converted to
 *      leptons/tick at a nominal 100 fps.
 *   3. `Projectile` / `Warhead` stay as *names*; resolution to the actual
 *      ProjectileRules / WarheadRules happens in the projectile factory, which is
 *      why an unknown name is a deferred error, not a parse error.
 */
import { ObjectRules } from './ObjectRules';

export interface WeaponRulesData {
    name: string;
    ambientDamage?: number;
    anim?: string[];
    areaFire?: boolean;
    burst?: number;
    cellRangefinding?: boolean;
    damage?: number;
    decloakToFire?: boolean;
    fireOnce?: boolean;
    isAlternateColor?: boolean;
    isElectricBolt?: boolean;
    isHouseColor?: boolean;
    isLaser?: boolean;
    isRadBeam?: boolean;
    isSonic?: boolean;
    laserDuration?: number;
    limboLaunch?: boolean;
    minimumRange?: number;
    neverUse?: boolean;
    omniFire?: boolean;
    projectile?: string;
    radLevel?: number;
    range?: number;
    report?: string[];
    revealOnFire?: boolean;
    rof?: number;
    sabotageCursor?: boolean;
    spawner?: boolean;
    speed?: number;
    suicide?: boolean;
    useSparkParticles?: boolean;
    warhead?: string;
}

export class WeaponRules {
    readonly name: string;

    ambientDamage = 0;
    anim: string[] = [];
    areaFire = false;
    burst = 1;
    cellRangefinding = false;
    damage = 0;
    decloakToFire = true;
    fireOnce = false;
    isAlternateColor = false;
    isElectricBolt = false;
    isHouseColor = false;
    isLaser = false;
    isRadBeam = false;
    isSonic = false;
    laserDuration = 0;
    limboLaunch = false;
    minimumRange = 0;
    neverUse = false;
    omniFire = false;
    projectile = '';
    radLevel = 0;
    range = 0;
    report: string[] = [];
    revealOnFire = true;
    rof = 0;
    sabotageCursor = false;
    spawner = false;
    /** `Speed` exactly as written — kept because some checks compare against it */
    iniSpeed = 0;
    /** leptons per tick, converted at the reference's nominal 100 fps */
    speed = 0;
    suicide = false;
    useSparkParticles = false;
    warhead = '';

    constructor(data: WeaponRulesData) {
        this.name = data.name;
        this.parse(data);
    }

    private parse(data: WeaponRulesData): void {
        this.ambientDamage = data.ambientDamage ?? 0;
        this.anim = data.anim ?? [];
        this.areaFire = !!data.areaFire;
        this.burst = data.burst ?? 1;
        this.cellRangefinding = !!data.cellRangefinding;
        this.damage = data.damage ?? 0;
        this.decloakToFire = data.decloakToFire ?? true;
        this.fireOnce = !!data.fireOnce;
        this.isAlternateColor = !!data.isAlternateColor;
        this.isElectricBolt = !!data.isElectricBolt;
        this.isHouseColor = !!data.isHouseColor;
        this.isLaser = !!data.isLaser;
        this.isRadBeam = !!data.isRadBeam;
        this.isSonic = !!data.isSonic;
        this.laserDuration = data.laserDuration ?? 0;
        this.limboLaunch = !!data.limboLaunch;
        this.minimumRange = data.minimumRange ?? 0;
        this.neverUse = !!data.neverUse;
        this.omniFire = !!data.omniFire;
        this.projectile = data.projectile ?? '';
        this.radLevel = data.radLevel ?? 0;
        this.range = data.range ?? 0;
        if (this.range === -2) {
            this.range = Number.POSITIVE_INFINITY;
        }
        this.report = data.report ?? [];
        this.revealOnFire = data.revealOnFire ?? true;
        this.rof = data.rof ?? 0;
        this.sabotageCursor = !!data.sabotageCursor;
        this.spawner = !!data.spawner;
        this.iniSpeed = data.speed ?? 0;
        this.speed = ObjectRules.iniSpeedToLeptonsPerTick(this.iniSpeed, 100);
        this.suicide = !!data.suicide;
        this.useSparkParticles = !!data.useSparkParticles;
        this.warhead = data.warhead ?? '';
    }
}
