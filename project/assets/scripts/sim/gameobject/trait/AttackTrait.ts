/**
 * Port of redalert2/src/game/gameobject/trait/AttackTrait.ts (504 lines).
 *
 * Everything a techno needs to shoot *without being told to*: the attack state
 * machine's home, weapon selection, passive target acquisition, retaliation and
 * opportunity fire. `AttackTask` owns the per-order state machine; this trait
 * owns the ambient one.
 *
 * Read it in four layers:
 *
 * **1. Weapon selection** (`selectDefaultWeapon`, `selectWeaponVersus`,
 * `getAvailableWeapons`, `selectWeaponFromList`). The chain is
 * "which weapons could this object use *at all*" → "which of those can hit that
 * target" → first acceptable. The deploy-fire, garrison and overpowered special
 * cases each replace the list entirely rather than adding a preference, because
 * a deployed G.I. genuinely has no primary weapon any more.
 *
 * `selectWeaponFromList`'s disguise branch is the reason a spy standing next to
 * an enemy tank is not shot: unless `force` is set, a disguised infiltrator with
 * a terrain disguise is simply not targetable by anything that lacks
 * `DetectDisguise`.
 *
 * **2. Target acquisition** (`scanForTarget`, `scanTechnosAround`, `computeThreat`).
 * The scan is a box query over `technosByTile` padded by the scan range, then a
 * *score* per candidate — not just "closest". `computeThreat` is worth reading
 * carefully: effectiveness against armour, special threat value, this weapon's
 * effectiveness against *their* armour, their remaining health, distance, and a
 * huge `+1e5` so that anything that passes the filters beats "no target". The
 * `VhpScan` block lets a unit ignore or down-weight targets it cannot actually
 * hurt (a Grizzly ignoring a diving Kirov). `distributedFire` subtracts `1e6`
 * per recent attack so a crowd spreads its fire instead of overkilling one unit.
 *
 * **3. Ambient behaviour** (`[NotifyTick.onTick]`). Three independent jobs, in
 * order: keep an opportunity-fire task running while the unit has orders that
 * permit it, convert a queued retaliation into an attack order, and run passive
 * acquisition on a cooldown. The opportunity-fire condition is a comma
 * expression with side effects — see the note on it below.
 *
 * **4. Retaliation** (`[NotifyDamage.onDamage]` → `shouldRetaliate`). Only the
 * *first* hit is remembered (`!this.retaliateTarget`), so focus fire by ten
 * tanks produces one retaliating victim per tick, not ten.
 *
 * Circular import: this file imports `AttackTask` and `AttackTask` imports
 * `AttackState` from here. Both directions are used only inside method bodies
 * (the enum at runtime inside `onTick`, the class inside `instanceof` and
 * `new`), so module initialisation order does not matter.
 */
import { isNotNullOrUndefined } from '../../util/typeGuard';
import { ArmorType } from '../../type/ArmorType';
import { ZoneType } from '../unit/ZoneType';
import { AttackTask } from '../task/AttackTask';
import { SideType } from '../../type/SideType';
import { NotifyTick } from './interface/NotifyTick';
import { RangeHelper } from '../unit/RangeHelper';
import { NotifyDamage } from './interface/NotifyDamage';
import { TaskRunner } from '../task/system/TaskRunner';
import { Target } from '../../Target';
import { MoveTask } from '../task/move/MoveTask';
import { CallbackTask } from '../task/system/CallbackTask';
import { MoveResult } from './MoveTrait';
import { MovementZone } from '../../type/MovementZone';
import { Coords } from '../../Coords';
import { NotifyTeleport } from './interface/NotifyTeleport';
import { VhpScan } from '../../type/VhpScan';
import { LosHelper } from '../unit/LosHelper';
import { Vector2 } from '../../math/Vector2';
import { Box2 } from '../../math/Box2';

export enum AttackState {
    Idle = 0,
    CheckRange = 1,
    PrepareToFire = 2,
    FireUp = 3,
    Firing = 4,
    JustFired = 5,
}

export class AttackTrait {
    private disabled: boolean = false;
    private attackState: AttackState = AttackState.Idle;
    private passiveScanCooldownTicks: number = 0;
    private taskRunner: TaskRunner = new TaskRunner();
    private distributedFireHistory: Map<any, number> = new Map();
    private rangeHelper: RangeHelper;
    private losHelper: LosHelper;
    private opportunityFireTask?: any;
    private retaliateTarget?: any;
    private currentTarget?: any;

    constructor(tiles: any, tileOccupation: any) {
        this.rangeHelper = new RangeHelper(tileOccupation);
        this.losHelper = new LosHelper(tiles, tileOccupation);
    }

    isIdle(): boolean {
        return this.attackState === AttackState.Idle;
    }

    isFiring(): boolean {
        return (
            this.attackState === AttackState.Firing ||
            this.attackState === AttackState.FireUp ||
            this.attackState === AttackState.JustFired
        );
    }

    isDisabled(): boolean {
        return this.disabled;
    }

    setDisabled(disabled: boolean): void {
        this.disabled = disabled;
    }

    /**
     * Cooldown is checked against *both* weapons, not the selected one: a unit
     * that just fired its primary cannot sneak a secondary shot in while the
     * primary reloads. The deploy-fire weapon is excluded when it is an area
     * weapon that does not require a reload (`FireOnce=no`), because otherwise
     * a deployed unit would consider itself permanently on cooldown.
     */
    isOnCooldown(obj: any): boolean {
        let weapons = [obj.primaryWeapon, obj.secondaryWeapon];
        const deployFireWeapon = obj.armedTrait?.getDeployFireWeapon();
        if (deployFireWeapon?.rules.areaFire && !deployFireWeapon.rules.fireOnce) {
            weapons = weapons.filter((weapon: any) => weapon !== deployFireWeapon);
        }
        return weapons.some((weapon: any) => (weapon?.getCooldownTicks() ?? 0) > 0);
    }

    expirePassiveScanCooldown(): void {
        this.passiveScanCooldownTicks = 0;
    }

    increasePassiveScanCooldown(ticks: number): void {
        this.passiveScanCooldownTicks += ticks;
    }

    cancelOpportunityFire(): void {
        this.opportunityFireTask?.cancel();
    }

    /**
     * The weapon to use when nothing has been chosen yet. Note this is *not*
     * `primaryWeapon`: a deployed G.I. swaps to a different weapon, an occupied
     * garrison building picks by side, and an overpowered building uses whatever
     * its overpowered trait exposes.
     */
    selectDefaultWeapon(obj: any): any {
        let weapon;
        if ((obj.isInfantry() || obj.isVehicle()) && obj.rules.deployFire) {
            const deployFireWeapon = obj.armedTrait?.getDeployFireWeapon();
            weapon = obj.deployerTrait?.isDeployed()
                ? deployFireWeapon && !deployFireWeapon.rules.areaFire
                    ? deployFireWeapon
                    : undefined
                : [obj.primaryWeapon, obj.secondaryWeapon].find((candidate: any) => candidate !== deployFireWeapon);
        } else {
            weapon =
                obj.isBuilding() && obj.garrisonTrait
                    ? obj.garrisonTrait.isOccupied()
                        ? obj.owner.country.side === SideType.GDI
                            ? obj.primaryWeapon
                            : (obj.secondaryWeapon ?? obj.primaryWeapon)
                        : undefined
                    : obj.isBuilding() && obj.overpoweredTrait
                      ? obj.overpoweredTrait.getWeapon()
                      : obj.primaryWeapon;
        }
        return weapon;
    }

    selectWeaponVersus(obj: any, target: any, game: any, force: boolean = false, passive: boolean = false): any {
        const tile = target.tile;
        const targetObj = target instanceof Target ? target.obj : target;
        const weapons = this.getAvailableWeapons(obj, passive, targetObj?.isOverlay() || (force && !targetObj));
        return this.selectWeaponFromList(obj, targetObj, tile, weapons, game, force, passive, false);
    }

    /**
     * First weapon in `weapons` that can legally hit `target` and actually hurts
     * its armour. `isDefensive` relaxes the disguise and armour checks for the
     * "shoot back at whatever just shot me" path, where being picky means never
     * firing at all.
     */
    selectWeaponFromList(
        obj: any,
        target: any,
        tile: any,
        weapons: any[],
        game: any,
        force: boolean,
        passive: boolean,
        isDefensive: boolean,
    ): any {
        if (
            (!target?.isInfantry() && !target?.isVehicle()) ||
            !target.disguiseTrait ||
            this.canAttackThroughDisguise(obj, target, target.disguiseTrait, game, force, passive, isDefensive)
        ) {
            if (
                target?.isBuilding() &&
                target.overpoweredTrait &&
                target.owner === obj.owner &&
                weapons.find((weapon: any) => weapon.warhead.rules.electricAssault)
            ) {
                weapons = weapons.filter((weapon: any) => weapon.warhead.rules.electricAssault);
            }
            if (
                target?.isBuilding() &&
                obj.rules.airstrikeTeamType &&
                !game.areFriendly(target, obj) &&
                weapons.find((weapon: any) => weapon.warhead.rules.airstrike)
            ) {
                weapons = weapons.filter((weapon: any) => weapon.warhead.rules.airstrike);
            }
            if (!(passive && target?.isAircraft() && target.missileSpawnTrait && target.zone !== ZoneType.Air)) {
                const armor = target?.isTechno() ? target.rules.armor : undefined;
                for (const weapon of weapons) {
                    if (
                        weapon.targeting.canTarget(target, tile, game, force, passive) &&
                        (armor === undefined || this.checkArmor(weapon.warhead.rules, armor, isDefensive))
                    ) {
                        return weapon;
                    }
                }
            }
        }
    }

    /**
     * The candidate list, already filtered by `neverUse`. `isTileTarget` is true
     * for an overlay or for a forced ground attack — in both cases the secondary
     * weapon is only offered when the unit is *also* in passive mode, which is
     * what stops a tank from shelling empty ground with its AA missile.
     */
    getAvailableWeapons(obj: any, passive: boolean, isTileTarget: boolean): any[] {
        let weapons: any[];
        let deployFireWeapon: any;
        if ((obj.isInfantry() || obj.isVehicle()) && obj.rules.deployFire && obj.armedTrait) {
            deployFireWeapon = obj.armedTrait.getDeployFireWeapon();
            weapons = [
                obj.deployerTrait?.isDeployed()
                    ? deployFireWeapon.rules.areaFire
                        ? undefined
                        : deployFireWeapon
                    : deployFireWeapon === obj.secondaryWeapon
                      ? obj.primaryWeapon
                      : obj.secondaryWeapon,
            ];
        } else if (obj.isBuilding() && obj.garrisonTrait) {
            weapons = obj.garrisonTrait.isOccupied()
                ? [
                      obj.owner.country.side === SideType.GDI
                          ? obj.primaryWeapon
                          : (obj.secondaryWeapon ?? obj.primaryWeapon),
                  ]
                : [];
        } else if (obj.isBuilding() && obj.overpoweredTrait) {
            weapons = [obj.overpoweredTrait.getWeapon()];
        } else if (isTileTarget || passive) {
            weapons = [
                obj.primaryWeapon,
                !isTileTarget && passive && obj.secondaryWeapon ? obj.secondaryWeapon : undefined,
            ];
        } else {
            weapons = [obj.primaryWeapon, obj.secondaryWeapon];
        }
        return weapons.filter((weapon: any) => weapon && !weapon.rules.neverUse);
    }

    /**
     * A terrain-disguised spy is invisible to anything without `DetectDisguise`
     * or shared intel from an ally that has it. The `passive` branch is the
     * "don't shoot what looks like a tree" rule — a disguised unit standing
     * still is skipped entirely rather than merely deprioritised.
     */
    canAttackThroughDisguise(
        obj: any,
        target: any,
        disguiseTrait: any,
        game: any,
        force: boolean,
        passive: boolean,
        isDefensive: boolean,
    ): boolean {
        if (
            !force &&
            disguiseTrait.hasTerrainDisguise() &&
            !game.areFriendly(obj, target) &&
            !obj.owner.sharedDetectDisguiseTrait?.has(target)
        ) {
            return false;
        }
        if (passive) {
            if (
                isDefensive &&
                target.moveTrait.isIdle() &&
                !obj.rules.detectDisguise &&
                !obj.owner.sharedDetectDisguiseTrait?.has(target) &&
                !game.areFriendly(target, obj)
            ) {
                return false;
            }
            const disguise = disguiseTrait.getDisguise();
            if (
                disguise?.owner &&
                !obj.rules.detectDisguise &&
                !obj.owner.sharedDetectDisguiseTrait?.has(target) &&
                (disguise.owner === obj.owner || game.alliances.areAllied(obj.owner, disguise.owner))
            ) {
                return false;
            }
        }
        return true;
    }

    /**
     * `Verses` is a percentage; `checkArmor` turns it into "does this hurt".
     * `100 * verses <= (isDefensive ? 1 : 0)` is the whole rule: for ordinary
     * targeting *any* non-zero effect qualifies, while a defensive shot insists
     * on at least 1%. The C4/bomb-disarm/nuke-maker warheads bypass the table
     * because they carry their own damage.
     */
    checkArmor(warheadRules: any, armorType: ArmorType, isDefensive: boolean): boolean {
        const versesValue =
            warheadRules.ivanBomb || warheadRules.bombDisarm || warheadRules.nukeMaker
                ? 1
                : warheadRules.verses.get(armorType);
        if (versesValue === undefined) {
            console.warn(`Unhandled ArmorType ${ArmorType[armorType]} in warhead ${warheadRules.name} verses`);
            return false;
        }
        return !(100 * versesValue <= (isDefensive ? 1 : 0));
    }

    createAttackTask(game: any, targetObj: any, tile: any, weapon: any, options: any): AttackTask {
        return new AttackTask(game, game.createTarget(targetObj, tile), weapon, options);
    }

    /**
     * The comma expression below is the reference's, not a transcription error:
     *
     *     if (this.opportunityFireTask && (...side effects...), this.opportunityFireTask)
     *
     * The `&&` chain runs the side effects — when the unit's current order is
     * itself an attack, the opportunity-fire task is *dropped*; otherwise it is
     * cancelled — and then the comma operator throws that result away and makes
     * the condition merely "do we still have an opportunity-fire task". So this
     * whole block is skipped for one tick exactly when the unit just switched to
     * a real attack order. Re-writing it as `if (this.opportunityFireTask)` alone
     * would let the ambient task fire a shot at the same time as the ordered one.
     */
    [NotifyTick.onTick](obj: any, game: any): void {
        if (!this.isDisabled()) {
            if (
                (this.opportunityFireTask &&
                    (!obj.unitOrderTrait.hasTasks() ||
                        (obj.isUnit() && !obj.unitOrderTrait.getTasks()[0].preventOpportunityFire) ||
                        (obj.unitOrderTrait.getTasks()[0] instanceof AttackTask
                            ? (this.opportunityFireTask = undefined)
                            : this.opportunityFireTask.cancel())),
                this.opportunityFireTask)
            ) {
                const tasks = [this.opportunityFireTask];
                this.taskRunner.tick(tasks, obj);
                if (!tasks.length) {
                    this.opportunityFireTask = undefined;
                }
            }
            if (!this.opportunityFireTask && this.retaliateTarget) {
                const retaliateTarget = this.retaliateTarget;
                this.retaliateTarget = undefined;
                let weapon;
                if (!obj.unitOrderTrait.hasTasks() && game.isValidTarget(retaliateTarget)) {
                    weapon = this.selectWeaponVersus(obj, retaliateTarget, game, false);
                    if (weapon) {
                        obj.unitOrderTrait.addTask(
                            this.createAttackTask(game, retaliateTarget, retaliateTarget.tile, weapon, {
                                holdGround: obj.rules.movementZone === MovementZone.Fly,
                            }),
                        );
                    }
                }
            }
            if (!this.opportunityFireTask && this.shouldPassiveAcquire(obj)) {
                if (this.passiveScanCooldownTicks > 0) {
                    this.passiveScanCooldownTicks--;
                } else {
                    this.passiveScanCooldownTicks = obj.guardMode
                        ? game.rules.general.guardAreaTargetingDelay
                        : game.rules.general.normalTargetingDelay;
                    let weapon = this.selectDefaultWeapon(obj);
                    const hasTasks = obj.unitOrderTrait.hasTasks();
                    let scanRange = undefined;
                    let scanFromTile;
                    let leashTiles;
                    if (!hasTasks && obj.guardMode && weapon && obj.owner.isCombatant()) {
                        scanRange = obj.armedTrait?.computeGuardScanRange(weapon);
                        scanFromTile = obj.guardArea?.tile;
                        leashTiles = 50;
                    }
                    let acquired = false;
                    if (weapon) {
                        const scanResult = this.scanForTarget(obj, weapon, game, scanRange, scanFromTile);
                        if (scanResult.target) {
                            const { target: acquiredTarget, weapon: acquiredWeapon } = scanResult;
                            const task = this.createAttackTask(game, acquiredTarget, acquiredTarget.tile, acquiredWeapon, {
                                holdGround: hasTasks || !obj.guardMode,
                                disallowTurning: hasTasks,
                                leashTiles,
                                passive: true,
                            });
                            if (hasTasks) {
                                this.opportunityFireTask = task;
                            } else {
                                obj.unitOrderTrait.addTask(task);
                            }
                            acquired = true;
                            if (!hasTasks && obj.guardMode && !obj.guardArea) {
                                obj.guardArea = {
                                    tile: obj.tile,
                                    onBridge: !!obj.isUnit() && obj.onBridge,
                                };
                            }
                            if (acquired && !hasTasks) {
                                obj.unitOrderTrait[NotifyTick.onTick](obj, game);
                            }
                        }
                    }
                    if (!acquired && !hasTasks && obj.secondaryWeapon?.warhead.rules.electricAssault) {
                        weapon = obj.secondaryWeapon;
                        const electricScan = this.scanForTarget(obj, weapon, game, undefined, undefined, true);
                        if (electricScan.target) {
                            const { target: electricTarget, weapon: electricWeapon } = electricScan;
                            const task = this.createAttackTask(game, electricTarget, electricTarget.tile, electricWeapon, {
                                passive: true,
                            });
                            obj.unitOrderTrait.addTask(task);
                            acquired = true;
                        }
                    }
                    if (
                        !acquired &&
                        !hasTasks &&
                        obj.guardArea &&
                        obj.isUnit() &&
                        obj.moveTrait &&
                        !obj.moveTrait.isDisabled() &&
                        obj.guardArea.tile !== obj.tile
                    ) {
                        obj.unitOrderTrait.addTasks(
                            new MoveTask(game, obj.guardArea.tile, obj.guardArea.onBridge),
                            new CallbackTask(() => {
                                if (![MoveResult.Success, MoveResult.CloseEnough].includes(obj.moveTrait.lastMoveResult)) {
                                    obj.resetGuardModeToIdle();
                                }
                                obj.guardArea = undefined;
                            }),
                        );
                    }
                }
            }
        }
    }

    [NotifyDamage.onDamage](obj: any, game: any, damage: number, weaponInfo: any): void {
        if (!this.isDisabled() && !this.retaliateTarget && !this.opportunityFireTask && weaponInfo && weaponInfo.obj && weaponInfo.weapon) {
            if (this.shouldRetaliate(obj, game, damage, weaponInfo.obj, weaponInfo.weapon.warhead)) {
                this.retaliateTarget = weaponInfo.obj;
            }
        }
    }

    [NotifyTeleport.onBeforeTeleport](obj: any, fromPos: any, toPos: any, crossRealm: boolean): void {
        if (!crossRealm) {
            this.attackState = AttackState.Idle;
            this.currentTarget = undefined;
            this.retaliateTarget = undefined;
            this.opportunityFireTask = undefined;
        }
    }

    /**
     * Whether ambient scanning may run at all. Three vetoes that are easy to
     * miss: `manualReload` units with an empty magazine must not scan (they are
     * reloading, not hunting), `mindControllerTrait` at capacity must not scan
     * (it would keep attacking instead of holding its puppets), and a unit whose
     * head-of-queue task sets `preventOpportunityFire` must not scan.
     */
    shouldPassiveAcquire(obj: any): boolean {
        if (
            (!obj.owner.isCombatant() && obj.rules.needsEngineer) ||
            !obj.rules.canPassiveAquire ||
            !obj.primaryWeapon ||
            (obj.ammoTrait && !obj.ammoTrait.ammo && obj.rules.manualReload)
        ) {
            return false;
        }
        if (obj.mindControllerTrait?.isAtCapacity()) {
            return false;
        }
        const allowsOpportunityFire =
            obj.rules.opportunityFire ||
            obj.openToppedTrait?.hasArmedPassengers() ||
            (obj.rules.balloonHover && obj.unitOrderTrait.getCurrentTask()?.isAttackMove);
        if (obj.isUnit() && allowsOpportunityFire) {
            if (obj.unitOrderTrait.hasTasks() && obj.unitOrderTrait.getTasks()[0].preventOpportunityFire) {
                return false;
            }
        } else if (obj.unitOrderTrait.hasTasks()) {
            return false;
        }
        return true;
    }

    /**
     * The distance rule at the end is retail's: a unit retaliates only if the
     * attacker is within `max(weapon.range, sight)`. That is why an undefended
     * base does not answer a Prism Tank shelling it from beyond its own range.
     */
    shouldRetaliate(obj: any, game: any, damage: number, attacker: any, warhead: any): boolean {
        if (
            damage < 1 ||
            game.areFriendly(obj, attacker) ||
            !obj.rules.canRetaliate ||
            !obj.primaryWeapon ||
            (obj.ammoTrait && !obj.ammoTrait.ammo && obj.rules.manualReload) ||
            warhead.rules.temporal ||
            attacker.rules.missileSpawn ||
            obj.unitOrderTrait.hasTasks() ||
            !game.isValidTarget(attacker) ||
            ((attacker.isInfantry() || attacker.isVehicle()) && attacker.disguiseTrait && !obj.rules.detectDisguise) ||
            obj.mindControllerTrait?.isAtCapacity()
        ) {
            return false;
        }
        const weapon = this.selectWeaponVersus(obj, attacker, game, false);
        if (!weapon) {
            return false;
        }
        const distance =
            obj.isBuilding() || attacker.isBuilding()
                ? this.rangeHelper.tileDistance(obj, attacker)
                : this.rangeHelper.distance2(obj, attacker) / Coords.LEPTONS_PER_TILE;
        return !(distance > Math.max(weapon.range, obj.sight));
    }

    scanForTarget(
        obj: any,
        weapon: any,
        game: any,
        maxRange?: number,
        fromTile?: any,
        isDefensive: boolean = false,
    ): { target?: any; weapon?: any } {
        let best: { target?: any; weapon?: any } = {};
        let bestScore = Number.NEGATIVE_INFINITY;
        const availableWeapons = this.getAvailableWeapons(obj, true, false);
        const scanRange =
            maxRange ??
            (obj.rules.guardRange || weapon.range) +
                1 +
                3 +
                game.rules.elevationModel.bonusCap +
                (weapon.projectileRules.isAntiAir ? obj.rules.airRangeBonus : 0);
        for (const candidate of this.scanTechnosAround(obj, scanRange, game)) {
            const candidateWeapon = this.selectWeaponFromList(
                obj,
                candidate,
                candidate.tile,
                availableWeapons,
                game,
                false,
                true,
                true,
            );
            if (
                candidateWeapon &&
                this.canPassiveAcquire(candidate, game) &&
                game.isValidTarget(candidate) &&
                (maxRange
                    ? this.rangeHelper.isInRange(
                          obj,
                          candidate,
                          candidateWeapon.minRange,
                          maxRange,
                          candidateWeapon.rules.cellRangefinding,
                      ) && (!fromTile || this.rangeHelper.isInRange2(fromTile, candidate, 0, maxRange))
                    : this.rangeHelper.isInWeaponRange(obj, candidate, candidateWeapon, game.rules)) &&
                (isDefensive || this.losHelper.hasLineOfSight(obj, candidate, candidateWeapon))
            ) {
                let distance = this.rangeHelper.distance3(obj, candidate) / Coords.LEPTONS_PER_TILE;
                distance = this.computeThreat(candidate, obj, candidateWeapon, distance, game.rules.general.threat);
                if (distance > bestScore) {
                    best = { target: candidate, weapon: candidateWeapon };
                    bestScore = distance;
                }
            }
        }
        if (best.target && obj.rules.distributedFire) {
            this.updateDistributedFireHistory(best as { target: any; weapon: any });
        }
        return best;
    }

    /**
     * Box query over the spatial index. The box spans the object's *foundation*
     * (so a 3×3 building scans from its edges, not its corner) expanded by the
     * scan range on every side.
     */
    scanTechnosAround(obj: any, range: number, game: any): any[] {
        const foundation = obj.getFoundation();
        const min = new Vector2(obj.tile.rx, obj.tile.ry);
        const max = new Vector2(obj.tile.rx + foundation.width - 1, obj.tile.ry + foundation.height - 1);
        min.addScalar(-range);
        max.addScalar(range);
        const box = new Box2(min, max);
        return game.map.technosByTile.queryRange(box);
    }

    /**
     * Who is worth shooting. Neutral and civilian objects are excluded, and the
     * `threatPosed`/`specialThreatValue`/`harvester` triple is how retail makes
     * a harvester a high-priority target without giving it a weapon.
     */
    canPassiveAcquire(candidate: any, game: any): boolean {
        return (
            !candidate.owner.isNeutral &&
            !candidate.rules.civilian &&
            !candidate.rules.insignificant &&
            (candidate.rules.threatPosed > 1 ||
                (candidate.rules.specialThreatValue > 0 && !candidate.isBuilding()) ||
                candidate.rules.harvester ||
                candidate.name === game.rules.general.paradrop.paradropPlane)
        );
    }

    /**
     * The scoring function. Each term is additive and deliberately un-normalised
     * so that `+1e5` guarantees any candidate outranks "nothing"; the negative
     * term for an already-targeted unit (`attackTrait?.currentTarget?.obj === self`)
     * makes a crowd pick different victims. `vhpScan` is the "can I even hurt it"
     * gate: `Strong` discards, `Normal` halves or doubles.
     */
    computeThreat(target: any, self: any, weapon: any, distance: number, threatRules: any): number {
        let score =
            [target.primaryWeapon, target.secondaryWeapon]
                .filter(isNotNullOrUndefined)
                .map((candidateWeapon: any) => candidateWeapon.warhead.rules.verses.get(self.rules.armor) ?? 0)
                .reduce((a: number, b: number) => Math.max(a, b), 0) * threatRules.targetEffectivenessCoefficientDefault;
        if (target.attackTrait?.currentTarget?.obj === self) {
            score *= -1;
        }
        score += target.rules.specialThreatValue * threatRules.targetSpecialThreatCoefficientDefault;
        score += (weapon.warhead.rules.verses.get(target.rules.armor) ?? 0) * threatRules.myEffectivenessCoefficientDefault;
        score += (target.healthTrait.health / 100) * threatRules.targetStrengthCoefficientDefault;
        score += distance * threatRules.targetDistanceCoefficientDefault;
        score += 1e5;
        if (self.rules.vhpScan !== VhpScan.None) {
            const projectedHitPoints = target.healthTrait.getProjectedHitPoints();
            if (self.rules.vhpScan === VhpScan.Strong) {
                if (projectedHitPoints <= 0) {
                    score = Number.NEGATIVE_INFINITY;
                }
            } else if (self.rules.vhpScan === VhpScan.Normal) {
                if (projectedHitPoints <= 0) {
                    score /= 2;
                } else if (projectedHitPoints <= target.healthTrait.maxHitPoints / 2) {
                    score *= 2;
                }
            }
        }
        if (self.rules.distributedFire) {
            score -= 1e6 * (this.distributedFireHistory.get(target) ?? 0);
        }
        return score;
    }

    /**
     * A decaying "recently attacked" registry: hitting a new target ages every
     * other entry by one and stamps the new one at 50. The `!== 50` guard keeps
     * repeated hits on the same target from re-stamping and starving the decay.
     */
    updateDistributedFireHistory(entry: { target: any; weapon: any }): void {
        if (this.distributedFireHistory.get(entry.target) !== 50) {
            for (const [target, value] of this.distributedFireHistory) {
                const newValue = value - 1;
                if (newValue <= 0) {
                    this.distributedFireHistory.delete(target);
                } else {
                    this.distributedFireHistory.set(target, newValue);
                }
            }
            this.distributedFireHistory.set(entry.target, 50);
        }
    }

    dispose(): void {
        this.distributedFireHistory.clear();
    }
}
