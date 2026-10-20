/**
 * The rules root — every table the simulation consults, in one object.
 *
 * Reference: redalert2/src/game/rules/Rules.ts (555 lines).
 *
 * This is a *behavioural* port: the lazy caches, the throw-on-unknown policy, the
 * ordered internal-id tables and the `[Cliff]` fallback are all preserved. What
 * changed is only where the bytes come from — the reference parses `rules.ini` and
 * mutates `IniSection`s; we take a `RulesContent` object tree (project decision: no
 * INI parser). Consequently:
 *   - `readObjectTypes` no longer has to skip non-numeric keys or de-duplicate; the
 *     content arrays are already ordered and unique, and the *order* is what assigns
 *     internal ids, so it still matters;
 *   - `ensureMapObjectDefaults` synthesises a data object instead of mutating a
 *     section, keeping the same "declared in a type list but has no section" repair.
 *
 * Two lookups deliberately stay lazy rather than eager, because retail maps and
 * saves reference warheads/projectiles that are only reachable through a weapon:
 *   - `getWarhead` caches by lower-case name and throws when the rules never
 *     declare it (a typo must not silently become a dud warhead);
 *   - `getProjectile` synthesises a default rule set when the name has no section,
 *     because some weapons point at projectiles retail never defines.
 */
import { Color } from '../util/Color';
import { ObjectType } from '../type/ObjectType';
import { LandType } from '../type/LandType';
import { CountryRules, CountryRulesData } from './CountryRules';
import { WeaponRules, WeaponRulesData } from './WeaponRules';
import { AudioVisualRules, AudioVisualRulesData } from './AudioVisualRules';
import { GeneralRules, GeneralRulesData } from './GeneralRules';
import { MpDialogSettings, MpDialogSettingsData } from './MpDialogSettings';
import { LandRules, LandRulesData } from './LandRules';
import { WarheadRules, WarheadRulesData } from './WarheadRules';
import { ProjectileRules, ProjectileRulesData } from './ProjectileRules';
import { ObjectRulesFactory } from './ObjectRulesFactory';
import { CombatDamageRules, CombatDamageRulesData } from './CombatDamageRules';
import { TiberiumRules, TiberiumRulesData } from './TiberiumRules';
import { AiRules, AiRulesData } from './AiRules';
import { ElevationModelRules, ElevationModelRulesData } from './ElevationModelRules';
import { RadiationRules, RadiationRulesData } from './RadiationRules';
import { SuperWeaponRules, SuperWeaponRulesData } from './SuperWeaponRules';
import { CrateRules, CrateRulesData } from './CrateRules';
import { PowerupsRules, PowerupsRulesData } from './PowerupsRules';
import { mpAllowedColors } from './mpAllowedColors';
import { ObjectRules, ObjectRulesData } from './ObjectRules';
import { TechnoRules, TechnoRulesData } from './TechnoRules';
import { OverlayRulesData } from './OverlayRules';
import { TerrainRulesData } from './TerrainRules';
import { SmudgeRulesData } from './SmudgeRules';
import { DebrisRulesData } from './DebrisRules';
import { isNotNullOrUndefined } from '../util/typeGuard';

interface Logger {
    debug(message: string): void;
}

/**
 * Weapon name injected by the superweapon machinery rather than by any rules
 * section. `Weapon.NUKE_PAYLOAD_NAME` in the reference; B3 ports `Weapon` and this
 * constant moves there.
 */
const NUKE_PAYLOAD_NAME = 'NukePayload';

export type ObjectRulesDataBag =
    | ObjectRulesData
    | TechnoRulesData
    | OverlayRulesData
    | TerrainRulesData
    | SmudgeRulesData
    | DebrisRulesData;

/** Everything `Rules` needs, in the reference's own order of assembly. */
export interface RulesContent {
    general: GeneralRulesData;
    ai: AiRulesData;
    audioVisual: AudioVisualRulesData;
    combatDamage: CombatDamageRulesData;
    crateRules: CrateRulesData;
    elevationModel: ElevationModelRulesData;
    mpDialogSettings: MpDialogSettingsData;
    powerups: PowerupsRulesData;
    radiation: RadiationRulesData;
    /** name -> `"h,s,v"` (0-255 each), same format as the `[Colors]` section */
    colors: Record<string, string>;
    /** keyed by land *section* name: Clear, Road, Rock, Rough, ... */
    landRules: Record<string, LandRulesData>;
    tiberiumTypes: string[];
    tiberiums: Record<string, TiberiumRulesData>;
    superWeaponTypes: string[];
    superWeapons: Record<string, SuperWeaponRulesData>;
    countryTypes: string[];
    countries: Record<string, CountryRulesData>;
    warheads: Record<string, WarheadRulesData>;
    weapons: Record<string, WeaponRulesData>;
    projectiles: Record<string, ProjectileRulesData>;
    /** ordered: the array index becomes the internal object id */
    buildingTypes: string[];
    infantryTypes: string[];
    vehicleTypes: string[];
    aircraftTypes: string[];
    terrainTypes: string[];
    overlayTypes: string[];
    smudgeTypes: string[];
    debrisTypes: string[];
    animationNames: string[];
    /** name -> section data, dispatched by whichever type list the name came from */
    objectData: Record<string, ObjectRulesDataBag>;
}

interface SpecialFlags {
    initialVeteran?: boolean;
}

export class Rules {
    private logger?: Logger;

    private buildingTypes = new Map<number, string>();
    private vehicleTypes = new Map<number, string>();
    private infantryTypes = new Map<number, string>();
    private aircraftTypes = new Map<number, string>();
    private terrainTypes = new Map<number, string>();
    private overlayTypes = new Map<number, string>();
    private overlayIdsByType = new Map<string, number>();
    private animationTypes = new Map<number, string>();
    private animationNames = new Set<string>();
    private debrisTypes = new Map<number, string>();
    private smudgeTypes = new Map<number, string>();
    private warheadTypes = new Map<number, string>();
    private tiberiumTypes = new Map<number, string>();
    private superWeaponTypes = new Map<number, string>();
    private countryTypes = new Map<number, string>();

    readonly weaponTypes = new Map<number, string>();
    private allObjectRules = new Map<ObjectType, Map<string, ObjectRules>>();

    readonly buildingRules = new Map<string, ObjectRules>();
    readonly infantryRules = new Map<string, ObjectRules>();
    readonly vehicleRules = new Map<string, ObjectRules>();
    readonly aircraftRules = new Map<string, ObjectRules>();
    readonly terrainRules = new Map<string, ObjectRules>();
    readonly overlayRules = new Map<string, ObjectRules>();
    private smudgeRules = new Map<string, ObjectRules>();
    private debrisRules = new Map<string, ObjectRules>();
    private countryRules = new Map<string, CountryRules>();
    readonly warheadRules = new Map<string, WarheadRules>();

    powerups = new PowerupsRules();
    colors = new Map<string, Color>();
    general = new GeneralRules();
    ai = new AiRules();
    crateRules = new CrateRules();
    elevationModel = new ElevationModelRules();
    mpDialogSettings = new MpDialogSettings();
    audioVisual = new AudioVisualRules();
    combatDamage = new CombatDamageRules();
    radiation = new RadiationRules();

    private landRules = new Map<LandType, LandRules>();
    private tiberiumRules = new Map<string, TiberiumRules>();
    private superWeaponRules = new Map<string, SuperWeaponRules>();
    private cachedWeaponRules = new Map<string, WeaponRules>();
    private cachedProjectileRules = new Map<string, ProjectileRules>();

    private content: RulesContent;

    constructor(content: RulesContent, logger?: Logger) {
        this.content = content;
        this.logger = logger;
        this.init();
    }

    /* ------------------------------------------------------------------ objects */

    hasObject(name: string, type: ObjectType): boolean {
        return this.allObjectRules.get(type)?.has(name) ?? false;
    }

    getObject(name: string, type: ObjectType): ObjectRules {
        const rules = this.allObjectRules.get(type)?.get(name);
        if (!rules) {
            throw new Error(`Missing rules for object "${name}"`);
        }
        return rules;
    }

    getTechnoByInternalId(id: number, type: ObjectType): ObjectRules {
        let typeName: string | undefined;
        if (type === ObjectType.Building) {
            typeName = this.buildingTypes.get(id);
        }
        else if (type === ObjectType.Infantry) {
            typeName = this.infantryTypes.get(id);
        }
        else if (type === ObjectType.Vehicle) {
            typeName = this.vehicleTypes.get(id);
        }
        else if (type === ObjectType.Aircraft) {
            typeName = this.aircraftTypes.get(id);
        }
        else {
            throw new Error(`Type ${ObjectType[type]} is not a techno type`);
        }
        if (typeName === undefined) {
            throw new Error(`Object type "${ObjectType[type]}" with ID "${id}" not found`);
        }
        return this.getObject(typeName, type);
    }

    getBuilding(name: string): ObjectRules {
        const rules = this.buildingRules.get(name);
        if (!rules) {
            throw new Error(`Missing rules for building "${name}"`);
        }
        return rules;
    }

    /* ----------------------------------------------------------------- weapons */

    getWeapon(name: string): WeaponRules {
        let rules = this.cachedWeaponRules.get(name);
        if (!rules) {
            const data = this.content.weapons[name];
            if (!data) {
                throw new Error(`Weapon ${name} is missing ini section`);
            }
            rules = new WeaponRules({ ...data, name: data.name ?? name });
            this.cachedWeaponRules.set(name, rules);
        }
        return rules;
    }

    getWeaponByInternalId(id: number): WeaponRules {
        const weaponName = this.weaponTypes.get(id);
        if (!weaponName) {
            throw new RangeError(`Weapon with internal ID "${id}" not found`);
        }
        return this.getWeapon(weaponName);
    }

    getWarhead(name: string): WarheadRules {
        let rules = this.warheadRules.get(name.toLowerCase());
        if (!rules) {
            const data = this.content.warheads[name];
            if (data) {
                rules = new WarheadRules({ ...data, name: data.name ?? name });
                this.warheadRules.set(name.toLowerCase(), rules);
            }
        }
        if (!rules) {
            try {
                const known = Array.from(this.warheadRules.keys());
                const sample = known.slice(0, 20).join(', ');
                const hasSection = !!this.content.warheads[name];
                console.error(`[Diag] Unknown warhead "${name}". hasSection=${hasSection}. Known warheads (sample): ${sample} ... total=${known.length}`);
            }
            catch (error) {
                console.error('[Diag] Unknown warhead diagnostics failed:', error);
            }
            throw new Error('Unknown warhead ' + name);
        }
        return rules;
    }

    getProjectile(name: string): ProjectileRules {
        let rules = this.cachedProjectileRules.get(name);
        if (!rules) {
            let data = this.content.projectiles[name];
            if (!data) {
                // The original engine tolerates weapons referencing projectiles
                // with no ini section (e.g. YR's InvisibleLow) — all flags
                // default. Synthesize an empty section to match.
                this.logger?.debug(`Projectile "${name}" has no ini section; using defaults`);
                data = { name };
            }
            rules = new ProjectileRules(ObjectType.Projectile, { ...data, name: data.name ?? name });
            this.cachedProjectileRules.set(name, rules);
        }
        return rules;
    }

    /* ----------------------------------------------------------------- overlays */

    getOverlayName(id: number): string {
        const name = this.overlayTypes.get(id);
        if (!name) {
            throw new Error('Invalid overlay id ' + id);
        }
        return name;
    }

    hasOverlayId(id: number): boolean {
        return this.overlayTypes.has(id);
    }

    getOverlayId(name: string): number {
        const id = this.overlayIdsByType.get(name);
        if (id === undefined) {
            throw new Error('Invalid overlay name ' + name);
        }
        return id;
    }

    getOverlay(name: string): ObjectRules {
        const rules = this.overlayRules.get(name);
        if (!rules) {
            throw new Error(`Missing rules for overlay "${name}"`);
        }
        return rules;
    }

    getAnimationName(id: number): string | undefined {
        return this.animationTypes.get(id);
    }

    /* ----------------------------------------------------------------- countries */

    getCountry(name: string): CountryRules {
        if (!this.countryRules.has(name)) {
            throw new Error('Unknown country ' + name);
        }
        return this.countryRules.get(name)!;
    }

    getMultiplayerCountries(): CountryRules[] {
        return Array.from(this.countryRules.values()).filter((country) => country.multiplay);
    }

    getMultiplayerColors(): Map<string, Color> {
        const colors = new Map<string, Color>();
        mpAllowedColors.forEach((colorName) => {
            if (!this.colors.has(colorName)) {
                throw new Error(`Multiplayer color "${colorName}" does not exist in the rules [Colors] section.`);
            }
            colors.set(colorName, this.colors.get(colorName)!);
        });
        return colors;
    }

    /* -------------------------------------------------------------- land / ore */

    getLandRules(landType: LandType): LandRules {
        let rules = this.landRules.get(landType);
        if (!rules) {
            // Retail has no `[Cliff]` section: cliffs reuse `[Rock]`. Our content may
            // still declare one explicitly, so the own-name lookup comes first and the
            // `[Rock]` fallback only fires when it is absent.
            const sectionName = this.content.landRules[LandType[landType]] !== undefined
                ? LandType[landType]
                : (landType === LandType.Cliff ? 'Rock' : LandType[landType]);
            rules = new LandRules(this.content.landRules[sectionName] ?? {});
            this.landRules.set(landType, rules);
        }
        return rules;
    }

    getTiberium(id: number): TiberiumRules {
        const typeName = this.tiberiumTypes.get(id);
        if (!typeName) {
            throw new Error('Unknown tiberium type ' + id);
        }
        return this.tiberiumRules.get(typeName)!;
    }

    hasTiberiumType(name: string): boolean {
        return this.tiberiumRules.has(name);
    }

    /* ------------------------------------------------------------- superweapons */

    getSuperWeapon(name: string): SuperWeaponRules {
        if (!this.superWeaponRules.has(name)) {
            throw new Error(`Unknown superweapon type "${name}"`);
        }
        return this.superWeaponRules.get(name)!;
    }

    /* -------------------------------------------------------------------- misc */

    applySpecialFlags(flags: SpecialFlags): void {
        if (flags.initialVeteran) {
            this.general.veteran.initialVeteran = true;
        }
    }

    // Retail instantiates types that are declared in the type list but have no
    // ini section with engine defaults (two official YR co-op maps place such
    // buildings: CALA02, CALOND02). Synthesize a harmless default on demand.
    ensureMapObjectDefaults(name: string, type: ObjectType): boolean {
        if (this.hasObject(name, type)) {
            return true;
        }
        const typeMaps = new Map<ObjectType, Map<number, string>>([
            [ObjectType.Building, this.buildingTypes],
            [ObjectType.Infantry, this.infantryTypes],
            [ObjectType.Vehicle, this.vehicleTypes],
            [ObjectType.Aircraft, this.aircraftTypes],
            [ObjectType.Terrain, this.terrainTypes],
        ]);
        const typeMap = typeMaps.get(type);
        const entry = typeMap && Array.from(typeMap.entries()).find(([, typeName]) => typeName === name);
        if (!entry) {
            return false;
        }
        const defaults: ObjectRulesDataBag = {
            name,
            strength: 400,
            techLevel: -1,
            insignificant: true,
        } as ObjectRulesDataBag;
        const rules = new ObjectRulesFactory().create(type, defaults, this.general, entry[0]);
        this.allObjectRules.get(type)?.set(name, rules);
        return true;
    }

    /* ------------------------------------------------------------------- setup */

    private init(): void {
        this.readAudioVisual();
        this.readCombatDamage();
        this.readRadiation();
        this.readGeneral();
        this.readAi();
        this.readCrateRules();
        this.readElevationModel();
        this.readMpDialogSettings();
        this.readObjectTypes(this.content.buildingTypes, this.buildingTypes);
        this.readObjectTypes(this.content.infantryTypes, this.infantryTypes);
        this.readObjectTypes(this.content.vehicleTypes, this.vehicleTypes);
        this.readObjectTypes(this.content.aircraftTypes, this.aircraftTypes);
        this.readObjectTypes(this.content.terrainTypes, this.terrainTypes);
        this.readObjectTypes(this.content.smudgeTypes, this.smudgeTypes);
        this.readObjectTypes(this.content.animationNames, this.animationTypes);
        this.animationNames = new Set(this.animationTypes.values());
        this.readObjectTypes(this.content.debrisTypes, this.debrisTypes);
        this.readObjectTypes(this.content.overlayTypes, this.overlayTypes);
        this.overlayTypes.forEach((name, id) => this.overlayIdsByType.set(name, id));
        this.readColors();
        this.readObjectTypes(this.content.countryTypes, this.countryTypes);
        this.readObjectTypes(Object.keys(this.content.warheads), this.warheadTypes);
        this.readObjectTypes(this.content.tiberiumTypes, this.tiberiumTypes);
        this.readObjectTypes(this.content.superWeaponTypes, this.superWeaponTypes);

        this.allObjectRules
            .set(ObjectType.Building, this.buildingRules)
            .set(ObjectType.Infantry, this.infantryRules)
            .set(ObjectType.Vehicle, this.vehicleRules)
            .set(ObjectType.Aircraft, this.aircraftRules)
            .set(ObjectType.Terrain, this.terrainRules)
            .set(ObjectType.Overlay, this.overlayRules)
            .set(ObjectType.Smudge, this.smudgeRules)
            .set(ObjectType.VoxelAnim, this.debrisRules);

        this.readObjects(ObjectType.Building, this.buildingTypes, this.buildingRules);
        this.readObjects(ObjectType.Infantry, this.infantryTypes, this.infantryRules);
        this.readObjects(ObjectType.Vehicle, this.vehicleTypes, this.vehicleRules);
        this.readObjects(ObjectType.Aircraft, this.aircraftTypes, this.aircraftRules);
        this.readObjects(ObjectType.Terrain, this.terrainTypes, this.terrainRules);
        this.readObjects(ObjectType.Overlay, this.overlayTypes, this.overlayRules);
        this.readObjects(ObjectType.Smudge, this.smudgeTypes, this.smudgeRules);
        this.readObjects(ObjectType.VoxelAnim, this.debrisTypes, this.debrisRules);

        this.readCountries();
        this.readWarheads();
        this.readPowerups();
        this.readTiberiums();
        this.readSuperWeapons();
        this.buildWeaponsList();
    }

    private readAudioVisual(): void {
        this.audioVisual.read(this.content.audioVisual);
    }

    private readCombatDamage(): void {
        this.combatDamage.read(this.content.combatDamage);
    }

    private readRadiation(): void {
        this.radiation.read(this.content.radiation);
    }

    private readGeneral(): void {
        this.general.read(this.content.general);
    }

    private readAi(): void {
        this.ai.read(this.content.ai);
    }

    private readCrateRules(): void {
        this.crateRules.read(this.content.crateRules);
    }

    private readElevationModel(): void {
        this.elevationModel.read(this.content.elevationModel);
    }

    private readMpDialogSettings(): void {
        this.mpDialogSettings.read(this.content.mpDialogSettings);
    }

    private readObjectTypes(names: string[], typeMap: Map<number, string>): void {
        names.forEach((name, index) => typeMap.set(index, name));
    }

    private readColors(): void {
        for (const [name, value] of Object.entries(this.content.colors)) {
            const [h, s, v] = value.split(',');
            const color = Color.fromHsv(parseInt(h, 10), parseInt(s, 10), parseInt(v, 10));
            this.colors.set(name, color);
        }
    }

    private readObjects(objectType: ObjectType, typeMap: Map<number, string>, rulesMap: Map<string, ObjectRules>): void {
        typeMap.forEach((typeName, id) => {
            const data = this.content.objectData[typeName];
            if (data) {
                const rules = new ObjectRulesFactory().create(objectType, data, this.general, id);
                rulesMap.set(typeName, rules);
            }
            else {
                this.logger?.debug(`${ObjectType[objectType]} type "${typeName}" has no rules section`);
            }
        });
    }

    private readCountries(): void {
        this.countryTypes.forEach((name, id) => {
            const data = this.content.countries[name];
            if (!data) {
                throw new Error('Missing ini section for country ' + name);
            }
            const rules = new CountryRules(String(id), { ...data, name: data.name ?? name });
            this.countryRules.set(name, rules);
        });
    }

    private readWarheads(): void {
        for (const [name, data] of Object.entries(this.content.warheads)) {
            this.warheadRules.set(name.toLowerCase(), new WarheadRules({ ...data, name: data.name ?? name }));
        }
    }

    private readPowerups(): void {
        this.powerups.read(this.content.powerups);
    }

    private readTiberiums(): void {
        this.tiberiumTypes.forEach((name) => {
            const data = this.content.tiberiums[name];
            if (!data) {
                throw new Error('Missing rules section for tiberium type ' + name);
            }
            this.tiberiumRules.set(name, new TiberiumRules().read(data));
        });
    }

    private readSuperWeapons(): void {
        this.superWeaponTypes.forEach((name, id) => {
            const data = this.content.superWeapons[name];
            if (!data) {
                throw new Error('Missing rules section for superweapon type ' + name);
            }
            this.superWeaponRules.set(name, new SuperWeaponRules(id, { ...data, name: data.name ?? name }));
        });
    }

    private buildWeaponsList(): void {
        const weaponNames = new Set<string>();
        weaponNames.add(this.general.dropPodWeapon);
        for (const superWeapon of this.superWeaponRules.values()) {
            if (superWeapon.weaponType) {
                weaponNames.add(superWeapon.weaponType);
            }
        }
        weaponNames.add(NUKE_PAYLOAD_NAME);
        const allObjectRules = [
            ...this.buildingRules.values(),
            ...this.aircraftRules.values(),
            ...this.vehicleRules.values(),
            ...this.infantryRules.values(),
        ] as TechnoRules[];
        for (const rules of allObjectRules) {
            const weaponSlots: (string | undefined)[] = [];
            for (let index = 0; index < rules.weaponCount; index++) {
                weaponSlots.push(rules.getWeaponAtIndex?.(index));
                weaponSlots.push(rules.getEliteWeaponAtIndex?.(index));
            }
            const weapons = [
                rules.deathWeapon,
                rules.primary,
                rules.secondary,
                rules.elitePrimary,
                rules.eliteSecondary,
                rules.occupyWeapon,
                rules.eliteOccupyWeapon,
                ...weaponSlots,
            ]
                .filter(isNotNullOrUndefined)
                .filter((weapon) => weapon !== '');
            for (const weapon of weapons) {
                weaponNames.add(weapon);
            }
        }
        let weaponIndex = 0;
        for (const weaponName of weaponNames) {
            this.weaponTypes.set(weaponIndex++, weaponName);
        }
    }
}
