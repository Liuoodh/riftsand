import { DeathType } from './gameobject/DeathType';
import { StanceType } from './gameobject/StanceType';
import { ZoneType } from './gameobject/unit/ZoneType';
import { BridgeOverlayTypes, OverlayBridgeType } from './map/BridgeOverlayTypes';
import { NotifyAttack } from './trait/interface/NotifyAttack';
import { ArmorType } from './type/ArmorType';
import { CollisionType } from './gameobject/unit/CollisionType';
import { RangeHelper } from './gameobject/unit/RangeHelper';
import { RadialTileFinder } from './map/tileFinder/RadialTileFinder';
import { Coords } from './Coords';
import * as MathUtils from './util/math';
import { FacingUtil } from './gameobject/unit/FacingUtil';
import { ObjectType } from './type/ObjectType';
import { WarheadDetonateEvent } from './event/WarheadDetonateEvent';
import { WeaponType } from './type/WeaponType';
import { WeaponRules } from './rules/WeaponRules';
import { ProjectileRules } from './rules/ProjectileRules';
import { AnimTerrainEffect } from './gameobject/common/AnimTerrainEffect';
import { ObjectAttackedEvent } from './event/ObjectAttackedEvent';

interface GameObject {
    isSpawned: boolean;
    isDisposed: boolean;
    isDestroyed: boolean;
    isCrashing: boolean;
    healthTrait?: HealthTrait;
    rules: GameObjectRules;
    position: Position;
    direction: number;
    owner: Player;
    name: string;
    zone?: ZoneType;
    overlayId?: number;
    tileElevation: number;
    onBridge?: boolean;
    isTechno(): boolean;
    isUnit(): boolean;
    isBuilding(): boolean;
    isInfantry(): boolean;
    isAircraft(): boolean;
    isVehicle(): boolean;
    isOverlay(): boolean;
    isTerrain(): boolean;
    isBridge(): boolean;
    onAttack(source: GameObject, weaponInfo?: WeaponInfo): void;
    applyRocking(direction: number, intensity: number): void;
    getBridge?(): GameObject;
}

interface TechnoObject extends GameObject {
    warpedOutTrait: WarpedOutTrait;
    invulnerableTrait: InvulnerableTrait;
    veteranTrait?: VeteranTrait;
    moveTrait: MoveTrait;
    unitOrderTrait: UnitOrderTrait;
    suppressionTrait?: SuppressionTrait;
    missileSpawnTrait?: MissileSpawnTrait;
    crashableTrait?: CrashableTrait;
    submergibleTrait?: SubmergibleTrait;
    delayedKillTrait?: DelayedKillTrait;
}

interface UnitObject extends TechnoObject {
    crateBonuses: CrateBonuses;
}

interface InfantryObject extends UnitObject {
    stance: StanceType;
    isPanicked: boolean;
    infDeathType: DeathType;
}

interface HealthTrait {
    health: number;
    getHitPoints(): number;
    inflictDamage(amount: number, weaponInfo?: WeaponInfo, gameWorld?: GameWorld): void;
    healBy(amount: number, healer: GameObject, gameWorld: GameWorld): void;
}

interface GameObjectRules {
    armor: ArmorType;
    warpable: boolean;
    immune: boolean;
    immuneToRadiation: boolean;
    immuneToPsionics: boolean;
    invisibleInGame: boolean;
    fraidycat: boolean;
    insignificant: boolean;
    typeImmune: boolean;
    wall: boolean;
}

interface WarheadRules {
    temporal: boolean;
    radiation: boolean;
    psychicDamage: boolean;
    proneDamage: number;
    verses: Map<ArmorType, number>;
    wallAbsoluteDestroyer: boolean;
    wall: boolean;
    wood: boolean;
    infDeath: DeathType;
    affectsAllies: boolean;
    causesDelayKill: boolean;
    delayKillAtMax: number;
    delayKillFrames: number;
    rocker: boolean;
    conventional: boolean;
    emEffect: boolean;
    animList: string[];
    name: string;
    cellSpread: number;
    percentAtMax: number;
    radLevel: number;
}

interface WeaponInfo {
    minRange: number;
    range: number;
    speed: number;
    type: WeaponType;
    rules: WeaponRules;
    projectileRules: ProjectileRules;
    warhead: Warhead;
    weapon?: WeaponRules;
    obj?: GameObject;
    player?: Player;
}

interface GameWorld {
    map: GameMap;
    alliances: AllianceManager;
    traits: TraitContainer;
    events: EventDispatcher;
    rules: GameRules;
    gameOpts: GameOptions;
    mapRadiationTrait: MapRadiationTrait;
    destroyObject(obj: GameObject, source?: WeaponInfo, cause?: any, isDirectHit?: boolean): void;
    generateRandomInt(min: number, max: number): number;
}

interface GameMap {
    tiles: Tile[][];
    mapBounds: Rectangle;
    tileOccupation: TileOccupation;
    getObjectsOnTile(tile: Position): GameObject[];
}

interface Player {
    isCombatant(): boolean;
}

interface Position {
    getMapPosition(): Vector3;
    clone(): Position;
    sub(other: Vector3): Position;
}

interface Vector3 {
    x: number;
    y: number;
    z: number;
}

interface Rectangle {
    width: number;
    height: number;
}

interface WarpedOutTrait {
    isInvulnerable(): boolean;
}

interface InvulnerableTrait {
    isActive(): boolean;
}

interface VeteranTrait {
    getVeteranArmorMultiplier(): number;
}

interface MoveTrait {
    reservedPathNodes: PathNode[];
    isIdle(): boolean;
}

interface PathNode {
    tile: Position;
}

interface UnitOrderTrait {
    hasTasks(): boolean;
    addTask(task: any): void;
}

interface SuppressionTrait {
    isSuppressed(): boolean;
    suppress(): void;
}

interface MissileSpawnTrait {}

interface CrashableTrait {
    crash(source?: WeaponInfo): void;
}

interface SubmergibleTrait {}

interface DelayedKillTrait {
    isActive(): boolean;
    activate(frames: number, weaponInfo: WeaponInfo): void;
}

interface CrateBonuses {
    armor: number;
}

interface TraitContainer {
    filter(trait: any): any[];
}

interface EventDispatcher {
    dispatch(event: any): void;
}

interface GameRules {
    audioVisual: AudioVisualRules;
    combatDamage: CombatDamageRules;
}

interface AudioVisualRules {
    weaponNullifyAnim: string;
    weatherConBoltExplosion: string;
}

interface CombatDamageRules {
    splashList: string[];
    c4Warhead: string;
}

interface GameOptions {
    destroyableBridges: boolean;
}

interface MapRadiationTrait {
    createRadSite(position: Position, level: number, radius: number): void;
}

interface AllianceManager {
    areAllied(player1: Player, player2: Player): boolean;
}

interface Tile {}

interface TileOccupation {}

/**
 * Task construction is deferred until the task family itself is ported, so the
 * damage chain can call into it without owning a second implementation.
 */
export interface WarheadTaskFactory {
    createScatterTask(gameWorld: any, target?: any, options?: any): any;
    createCallbackTask(cb: (obj: any) => void): any;
}

/**
 * Verbatim from redalert2/src/game/Warhead.ts.
 *
 * Everything between "a shell landed" and "HP changed" lives here. The two entry
 * points are sharply split:
 *
 *  - `computeDamage` answers *how much* — pure, no side effects, and it is where
 *    the armour × verses table, the prone multiplier, the veteran armour divisor
 *    and the crate armour divisor all stack. Its last line is the one people get
 *    wrong: `damage > 0 ? Math.floor : Math.ceil`. Damage rounds *away from
 *    zero*, so a 0.3-damage hit does 1 and a -0.3 heal does -1. Rounding toward
 *    zero here would make weak weapons literally unable to kill a 1-HP unit.
 *  - `detonate` answers *who* — the radial walk, the friendly-fire filter, the
 *    falloff `lerp` toward `percentAtMax`, the `sign()` snap for sub-1 damage,
 *    the delayed-kill clamp, and finally the animation/smudge side effects.
 *
 * Four things in `detonate` are deliberately weird:
 *  1. `processedObjects.has(obj) && !obj.isBuilding()` — a building can be hit
 *     once per occupied tile, every other object only once.
 *  2. The `sign()` snap: `|damage| < 1` becomes ±1 **only if** either there is no
 *     spread or the post-falloff damage is still ≥25% of the original. This is
 *     what makes a near-miss still scratch paint instead of doing nothing.
 *  3. `delayKillFrames = lerp(delayKillFrames, maxDelay * delayKillFrames, d/spread)`
 *     — note the second argument multiplies the *base* frames, it is not
 *     `maxDelay` alone. A base of 30 with `DelayKillAtMax=1` stays 30 everywhere.
 *  4. `directHitTarget` is latched once and used for the *rest of the loop's*
 *     `isDirectHit` flag, so the "incidental" flag on `ObjectAttackedEvent`
 *     reflects whether *any* earlier object was hit within one tile.
 */
export class Warhead {
    static readonly SPECIAL_WARHEAD_NAME = 'Special';
    static readonly HE_WARHEAD_NAME = 'HE';

    /** Wired up in B7 when `ScatterTask` exists. Until then the hook is inert. */
    static taskFactory?: WarheadTaskFactory;

    constructor(public rules: WarheadRules) {}

    canDamage(obj: GameObject, tile: Position, zone: ZoneType): boolean {
        if (!obj.isSpawned || obj.isDisposed || obj.isDestroyed || obj.isCrashing) {
            return false;
        }

        if (obj.isTechno() && (obj as TechnoObject).warpedOutTrait.isInvulnerable() && !this.rules.temporal) {
            return false;
        }

        if (obj.isUnit()) {
            const unitObj = obj as UnitObject;
            if (unitObj.moveTrait.reservedPathNodes.find((node) => node.tile === tile)) {
                return false;
            }
        }

        if (!obj.healthTrait) {
            return false;
        }

        // Air/ground mismatch. A ground weapon cannot touch a flying unit and an
        // AA weapon cannot touch anything that is not a unit.
        if (obj.isUnit() && obj.zone === ZoneType.Air && zone !== ZoneType.Air) {
            return false;
        }
        if (!obj.isUnit() && zone === ZoneType.Air) {
            return false;
        }

        if (obj.isBuilding() && obj.rules.invisibleInGame) {
            return false;
        }

        if ((obj.isTechno() || obj.isTerrain()) && obj.rules.immune && !this.rules.temporal) {
            return false;
        }

        if (obj.isTechno() && !obj.rules.warpable && this.rules.temporal) {
            return false;
        }

        if (this.rules.radiation && (!obj.isUnit() || obj.rules.immuneToRadiation)) {
            return false;
        }

        if (this.rules.psychicDamage && !obj.isInfantry()) {
            return false;
        }

        // The low-bridge ramp cells are structurally part of the bridge and can
        // never be damaged, otherwise a bridge could be severed at its own foot.
        if (obj.isOverlay() && BridgeOverlayTypes.isLowBridgeHead(obj.overlayId!)) {
            return false;
        }

        return true;
    }

    computeDamage(baseDamage: number, target: GameObject, gameWorld: GameWorld, isWeatherStorm = false): number {
        let damage = baseDamage;

        if (damage > 0 && target.isTechno() && (target as TechnoObject).invulnerableTrait.isActive()) {
            return 0;
        }

        // A missile-spawning aircraft on the ground is the missile itself; hitting
        // it there must not damage the launcher.
        if (target.isAircraft()) {
            const aircraft = target as TechnoObject;
            if (aircraft.missileSpawnTrait && target.zone !== ZoneType.Air) {
                return 0;
            }
        }

        if (!gameWorld.gameOpts.destroyableBridges && target.isOverlay() && target.isBridge()) {
            return 0;
        }

        if (!this.rules.radiation && !this.rules.temporal && target.isInfantry()) {
            const infantry = target as InfantryObject;
            if (infantry.stance === StanceType.Prone) {
                damage *= this.rules.proneDamage;
            }
        }

        if (target.isTechno() || target.isOverlay() || target.isTerrain()) {
            let armorType = target.isTerrain() ? ArmorType.Wood : target.rules.armor;

            if (target.isOverlay() && target.isBridge()) {
                const bridgeType = BridgeOverlayTypes.getOverlayBridgeType(target.overlayId!);
                if (bridgeType === OverlayBridgeType.Wood) {
                    armorType = ArmorType.Wood;
                } else if (bridgeType === OverlayBridgeType.Concrete) {
                    armorType = ArmorType.Concrete;
                }
            }

            // Lightning storm ignores bridge/wall armour entirely and deals full
            // damage, which is why a storm can drop a bridge that survives a shell.
            if (!(isWeatherStorm && target.isOverlay() && (target.isBridge() || target.rules.wall))) {
                damage *= this.rules.verses.get(armorType) || 1;
            }

            if (damage > 0 && target.isTechno()) {
                const techno = target as TechnoObject;
                if (techno.veteranTrait) {
                    damage /= techno.veteranTrait.getVeteranArmorMultiplier();
                }
            }

            if (damage > 0 && target.isUnit()) {
                const unit = target as UnitObject;
                damage /= unit.crateBonuses.armor;
            }
        }

        if ((target.isOverlay() || target.isBuilding()) && target.rules.wall) {
            if (this.rules.wallAbsoluteDestroyer) {
                damage = Number.POSITIVE_INFINITY;
            } else if (!this.rules.wall && !(this.rules.wood && target.rules.armor === ArmorType.Wood)) {
                damage = 0;
            }
        }

        if (target.isOverlay() && target.isBridge() && !this.rules.wall) {
            damage = 0;
        }

        return damage > 0 ? Math.floor(damage) : Math.ceil(damage);
    }

    inflictDamage(
        damage: number,
        target: GameObject,
        weaponInfo: WeaponInfo | undefined,
        gameWorld: GameWorld,
        isDirectHit = false,
    ): boolean {
        const healthTrait = target.healthTrait!;

        if (damage === Number.POSITIVE_INFINITY) {
            damage = healthTrait.getHitPoints();
        }

        healthTrait.inflictDamage(damage, weaponInfo, gameWorld);

        gameWorld.traits.filter(NotifyAttack).forEach((trait: any) => {
            trait[NotifyAttack.onAttack](target, weaponInfo?.obj, gameWorld);
        });

        target.onAttack(gameWorld as any, weaponInfo);
        gameWorld.events.dispatch(new ObjectAttackedEvent(target, weaponInfo, isDirectHit));

        if (target.isTechno() && !this.rules.temporal) {
            this.suppressOrScatterTarget(target as TechnoObject, gameWorld);
        }

        if (!healthTrait.health) {
            if (target.isInfantry()) {
                (target as InfantryObject).infDeathType = this.rules.infDeath;
            }
            if (this.rules.temporal) {
                (target as any).deathType = DeathType.Temporal;
            }

            // A crashing aircraft is not destroyed here — it enters its own
            // crash task and dies when it hits the ground.
            if (
                target.isUnit() &&
                (target as TechnoObject).crashableTrait &&
                target.zone === ZoneType.Air &&
                !this.rules.temporal
            ) {
                (target as TechnoObject).crashableTrait!.crash(weaponInfo);
            } else {
                gameWorld.destroyObject(target, weaponInfo, undefined, isDirectHit);
            }
            return true;
        }

        return false;
    }

    private suppressOrScatterTarget(target: TechnoObject, gameWorld: GameWorld): void {
        if (target.rules.fraidycat || (target.isVehicle() && !target.owner.isCombatant() && target.rules.insignificant)) {
            if (!target.unitOrderTrait.hasTasks()) {
                if (target.isInfantry()) {
                    (target as InfantryObject).isPanicked = true;
                }

                const scatterTask = Warhead.taskFactory?.createScatterTask(gameWorld, undefined, undefined);
                if (scatterTask) {
                    target.unitOrderTrait.addTask(scatterTask);
                }

                if (target.isInfantry()) {
                    const cbTask = Warhead.taskFactory?.createCallbackTask(
                        () => ((target as InfantryObject).isPanicked = false),
                    );
                    if (cbTask) {
                        target.unitOrderTrait.addTask(cbTask);
                    }
                }
            }
        } else if (target.isInfantry()) {
            const infantry = target as InfantryObject;
            if ((infantry.moveTrait.isIdle() || infantry.suppressionTrait?.isSuppressed()) && infantry.suppressionTrait) {
                infantry.suppressionTrait.suppress();
            }
        }
    }

    createDummyWeaponInfo(): WeaponInfo {
        return {
            minRange: 0,
            range: 0,
            speed: Number.POSITIVE_INFINITY,
            type: WeaponType.Primary,
            rules: new WeaponRules({ name: 'Dummy' }),
            projectileRules: new ProjectileRules(ObjectType.Projectile, { name: 'Dummy' }),
            warhead: this,
        };
    }

    detonate(
        gameWorld: GameWorld,
        baseDamage: number,
        centerTile: Position,
        elevation: number,
        centerCoords: Vector3,
        zone: ZoneType,
        collisionType: CollisionType | undefined,
        target: { obj?: GameObject; getBridge?(): GameObject },
        weaponInfo: WeaponInfo | undefined,
        friendly: boolean,
        areaEffectSmudge: string | undefined,
        customSpread?: number,
        isWeatherStorm = false,
    ): void {
        const weapon = weaponInfo?.weapon ?? (this.createDummyWeaponInfo() as any);
        const sourceObj = weaponInfo?.obj;
        const sourcePlayer = weaponInfo?.player;
        const cellSpread = customSpread ? customSpread / Coords.LEPTONS_PER_TILE : this.rules.cellSpread;
        const percentAtMax = this.rules.percentAtMax;
        const processedObjects = new Set<GameObject>();
        const objectDistances = new Map<GameObject, number[]>();
        const rangeHelper = new RangeHelper(gameWorld.map.tileOccupation as any);
        const tileFinder = new RadialTileFinder(
            gameWorld.map.tiles as any,
            gameWorld.map.mapBounds as any,
            centerTile as any,
            { width: 1, height: 1 },
            0,
            Math.ceil(cellSpread),
            () => true,
        );

        let currentTile: any;
        while ((currentTile = tileFinder.getNextTile())) {
            for (const obj of gameWorld.map.getObjectsOnTile(currentTile)) {
                if (processedObjects.has(obj) && !obj.isBuilding()) continue;

                if (collisionType === CollisionType.UnderBridge && obj.isUnit() && (obj as UnitObject).onBridge) {
                    continue;
                }

                // Type-immune: two units of the same type from the same owner do
                // not hurt each other with splash (desolator radiation, etc).
                if (
                    sourceObj &&
                    obj.isTechno() &&
                    obj.rules.typeImmune &&
                    obj.owner === sourcePlayer &&
                    obj.name === sourceObj.name
                ) {
                    continue;
                }

                if (!this.canDamage(obj, currentTile, zone)) continue;

                if (obj.isOverlay()) {
                    if (
                        (!collisionType && Math.abs(obj.tileElevation - elevation) > 0.1) ||
                        (collisionType === CollisionType.OnBridge && !obj.isBridge())
                    ) {
                        continue;
                    }
                }

                let distance: number;
                if (obj.isBuilding()) {
                    distance = currentTile === centerTile ? 0 : rangeHelper.distance3(currentTile as any, centerCoords) / Coords.LEPTONS_PER_TILE;
                } else if (obj.isTerrain() || obj.isOverlay()) {
                    distance = rangeHelper.distance3(currentTile as any, centerTile as any) / Coords.LEPTONS_PER_TILE;
                } else {
                    distance = rangeHelper.distance3(obj as any, centerCoords) / Coords.LEPTONS_PER_TILE;
                }

                if (distance < 0.001) distance = 0;

                if (friendly && obj.isInfantry() && sourcePlayer) {
                    if (obj.owner === sourcePlayer || gameWorld.alliances.areAllied(obj.owner, sourcePlayer)) {
                        continue;
                    }
                }

                if (!cellSpread) {
                    if (obj.isTerrain()) {
                        if (currentTile !== centerTile || !this.rules.wall) continue;
                    } else if (
                        !friendly &&
                        (currentTile !== centerTile || (!obj.isBuilding() && obj !== (target.obj || target.getBridge?.())))
                    ) {
                        continue;
                    }
                }

                if (cellSpread && distance > cellSpread) continue;

                processedObjects.add(obj);
                const distances = obj.isBuilding() ? (objectDistances.get(obj) || []).concat(distance) : [distance];
                objectDistances.set(obj, distances);
            }
        }

        let hasInvulnerableHit = false;
        let directHitTarget: GameObject | undefined;

        for (const obj of processedObjects) {
            if (obj.isDestroyed || obj.isCrashing) continue;

            let damage = this.computeDamage(baseDamage, obj, gameWorld, isWeatherStorm);

            if (baseDamage > 0 && !this.rules.affectsAllies && obj.isTechno() && sourcePlayer) {
                if (gameWorld.alliances.areAllied(obj.owner, sourcePlayer) || obj.owner === sourcePlayer) {
                    damage = 0;
                }
            }

            if (!damage) continue;

            for (const distance of objectDistances.get(obj)!) {
                let finalDamage = damage;

                if (cellSpread > 0 && Number.isFinite(finalDamage)) {
                    finalDamage = MathUtils.lerp(finalDamage, percentAtMax * finalDamage, distance / cellSpread);
                }

                // Sub-1 damage still scratches, unless the falloff pushed it below
                // a quarter of the original — that is the "too far to matter" line.
                if (Math.abs(finalDamage) < 1 && (!cellSpread || finalDamage / damage >= 0.25)) {
                    finalDamage = Math.sign(finalDamage);
                }

                finalDamage = finalDamage > 0 ? Math.floor(finalDamage) : Math.ceil(finalDamage);
                if (!finalDamage) continue;

                const healthTrait = obj.healthTrait!;

                if (finalDamage < 0) {
                    if (!sourceObj) throw new Error('Expected healer object to be set');
                    healthTrait.healBy(-finalDamage, sourceObj, gameWorld);
                    if (healthTrait.health === 100) break;
                } else {
                    if (obj === target.obj && distance < 1) {
                        directHitTarget = obj;
                    }

                    if (this.rules.causesDelayKill && obj.isBuilding() && (obj as any).delayedKillTrait) {
                        const currentHP = healthTrait.getHitPoints();
                        if (finalDamage >= currentHP) {
                            finalDamage = currentHP - 1;
                            const delayedKill = (obj as any).delayedKillTrait;
                            if (!delayedKill.isActive()) {
                                const maxDelay = this.rules.delayKillAtMax;
                                let delayFrames = this.rules.delayKillFrames;
                                delayFrames = MathUtils.lerp(delayFrames, maxDelay * delayFrames, distance / cellSpread);
                                delayedKill.activate(delayFrames, weaponInfo);
                            }
                        }
                    }

                    if (this.inflictDamage(finalDamage, obj, weaponInfo, gameWorld, !directHitTarget)) {
                        break;
                    }

                    if (obj.isVehicle() && this.rules.rocker) {
                        const rockIntensity = MathUtils.clamp(damage / 300, 0, 1);
                        if (rockIntensity > 0) {
                            const rockDirection =
                                FacingUtil.fromMapCoords(
                                    (obj.position.getMapPosition() as any)
                                        .clone()
                                        .sub(Coords.vecWorldToGround(centerCoords as any) as any) as any,
                                ) - obj.direction;
                            obj.applyRocking(rockDirection, rockIntensity);
                        }
                    }
                }
            }

            if (obj.isTechno() && (obj as TechnoObject).invulnerableTrait.isActive()) {
                hasInvulnerableHit = true;
            }
        }

        const radLevel = (weapon as any).rules.radLevel;
        if (radLevel && cellSpread) {
            gameWorld.mapRadiationTrait.createRadSite(centerTile, radLevel, cellSpread + 1);
        }

        const animation = isWeatherStorm
            ? undefined
            : hasInvulnerableHit
            ? gameWorld.rules.audioVisual.weaponNullifyAnim
            : this.pickExplodeAnim(baseDamage, directHitTarget, zone, gameWorld, isWeatherStorm);

        if (!hasInvulnerableHit && zone === ZoneType.Ground) {
            const terrainEffect = new AnimTerrainEffect();
            if (animation) terrainEffect.destroyOre(animation, centerTile, gameWorld);
            if (areaEffectSmudge) terrainEffect.spawnSmudges(areaEffectSmudge, centerTile, gameWorld);
            if (animation) terrainEffect.spawnSmudges(animation, centerTile, gameWorld);
        }

        gameWorld.events.dispatch(new WarheadDetonateEvent(this, centerCoords, animation, isWeatherStorm));
    }

    private pickExplodeAnim(
        damage: number,
        directHitTarget: GameObject | undefined,
        zone: ZoneType,
        gameWorld: GameWorld,
        isWeatherStorm: boolean,
    ): string | undefined {
        if (!damage) return undefined;

        if (isWeatherStorm) {
            return gameWorld.rules.audioVisual.weatherConBoltExplosion;
        }

        // Water splashes come from a separate list, indexed by damage / 50, and
        // only when nothing solid took the hit — a tank eating a shell mid-river
        // gets the normal explosion, not a splash.
        if (this.rules.conventional && zone === ZoneType.Water) {
            if (
                !directHitTarget ||
                directHitTarget.isBuilding() ||
                (directHitTarget.isVehicle() && (directHitTarget as TechnoObject).submergibleTrait)
            ) {
                const splashList = gameWorld.rules.combatDamage.splashList;
                const index = MathUtils.clamp(Math.floor(damage / 50), 0, splashList.length - 1);
                return splashList[index];
            }
        }

        const animCount = this.rules.animList.length;
        if (!animCount) return undefined;

        let animIndex: number;
        if (gameWorld.rules.combatDamage.c4Warhead === this.rules.name) {
            // C4 always uses the last animation — one dedicated explosion, never a
            // damage-scaled one.
            animIndex = animCount - 1;
        } else if (this.rules.emEffect) {
            animIndex = gameWorld.generateRandomInt(0, animCount - 1);
        } else {
            animIndex = MathUtils.clamp(Math.floor(damage / 25), 0, animCount - 1);
        }

        return this.rules.animList[animIndex];
    }
}
