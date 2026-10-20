import { StanceType } from './gameobject/StanceType';
import { ZoneType } from './gameobject/unit/ZoneType';
import { LandTargeting } from './type/LandTargeting';
import { LandType } from './type/LandType';
import { NavalTargeting } from './type/NavalTargeting';
import { SpeedType } from './type/SpeedType';
import { WeaponType } from './type/WeaponType';

interface GameObject {
    name: string;
    owner: any;
    rules: {
        attackCursorOnFriendlies?: boolean;
        ivan?: boolean;
        natural?: boolean;
        unnatural?: boolean;
        spawned?: boolean;
        organic?: boolean;
        naval?: boolean;
        speedType?: SpeedType;
        navalTargeting: NavalTargeting;
        landTargeting: LandTargeting;
    };
    zone?: ZoneType;
    stance?: StanceType;
    tileElevation?: number;
    healthTrait?: {
        health: number;
    };
    overpoweredTrait?: any;
    cloakableTrait?: {
        isCloaked(): boolean;
    };
    tntChargeTrait?: {
        hasCharge(): boolean;
    };
    parasiteableTrait?: {
        isInfested(): boolean;
    };
    mindControllableTrait?: any;
    warpedOutTrait?: {
        isInvulnerable(): boolean;
    };
    submergibleTrait?: {
        isSubmerged(): boolean;
    };
    isUnit(): boolean;
    isInfantry(): boolean;
    isVehicle(): boolean;
    isAircraft(): boolean;
    isBuilding(): boolean;
    isTechno(): boolean;
}

interface ProjectileRules {
    isAntiGround: boolean;
    isAntiAir: boolean;
}

interface WeaponRules {
    damage: number;
    limboLaunch?: boolean;
}

interface WarheadRules {
    electricAssault?: boolean;
    bombDisarm?: boolean;
    mindControl?: boolean;
    parasite?: boolean;
    temporal?: boolean;
}

interface GeneralRules {
    prism: {
        type: string;
    };
}

interface GameContext {
    landType: LandType;
}

interface AllianceSystem {
    areFriendly(unit1: GameObject, unit2: GameObject): boolean;
    alliances: {
        haveSharedIntel(owner1: any, owner2: any): boolean;
    };
}

type TargetCheckFunction = (
    target?: GameObject,
    context?: GameContext,
    alliances?: AllianceSystem,
    forcefire?: boolean,
    shift?: boolean,
) => boolean;

/**
 * Verbatim from redalert2/src/game/WeaponTargeting.ts.
 *
 * The whole class is a *list of predicates*, built once per weapon in a fixed
 * order. That ordering matters only for short-circuit cost, but the *set* is the
 * entire "can I shoot this" rulebook, and each entry encodes a real RA2 rule:
 *
 *  - The first branch (a weapon with no `isAntiGround` at all — i.e. an
 *    anti-air-only weapon) gets `!!target`, meaning it refuses to shoot the
 *    ground no matter what else is true.
 *  - A prism tank's secondary weapon can target *only* another prism tower of
 *    the same owner, and only with Shift held. That is the prism-chain mechanic.
 *  - An `ElectricAssault` (Tesla trooper charging a Tesla coil) requires Shift
 *    or force-fire, a building, an `overpoweredTrait`, and the same owner.
 *  - Negative damage = healing. A medic can only "fire" at a friendly unit below
 *    100 HP, and only one that shares its air/ground nature so a medic cannot
 *    heal an aircraft.
 *  - `bombDisarm` (SEAL/Crazy Ivan defusing) inverts the friendly-fire rule:
 *    friendlies are fine, but only if they actually carry a charge.
 *  - Cloaked targets are only targetable when you have shared intel — this is the
 *    "you can see it, so you can shoot it" rule.
 *  - `natural` units (animals) refuse to auto-target `unnatural` units, which is
 *    how dolphins do not attack buildings.
 *
 * The final check is always the zone check, because everything above is about
 * *what* the target is and the zone check is about *where* it is.
 */
export class WeaponTargeting {
    private targetChecks: TargetCheckFunction[] = [];

    constructor(
        private weaponType: WeaponType,
        private projectileRules: ProjectileRules,
        private weaponRules: WeaponRules,
        private warheadRules: WarheadRules,
        private gameObject: GameObject,
        private generalRules: GeneralRules,
    ) {
        this.initConditions();
    }

    private initConditions(): void {
        if (!this.projectileRules.isAntiGround) {
            this.targetChecks.push((target) => !!target);
        }

        const prismType = this.generalRules.prism.type;

        if (this.gameObject.name === prismType && this.weaponType === WeaponType.Secondary) {
            this.targetChecks.push(
                (target, context, alliances, forcefire, shift) =>
                    !(
                        !shift ||
                        !target?.isBuilding() ||
                        target.name !== prismType ||
                        target.owner !== this.gameObject.owner
                    ),
            );
        } else if (this.warheadRules.electricAssault) {
            this.targetChecks.push(
                (target, context, alliances, forcefire, shift) =>
                    !(
                        (!forcefire && !shift) ||
                        !target?.isBuilding() ||
                        !target.overpoweredTrait ||
                        target.owner !== this.gameObject.owner
                    ),
            );
        } else if (this.weaponRules.damage < 0) {
            this.targetChecks.push(
                (target, context, alliances) =>
                    !!(
                        target !== this.gameObject &&
                        target?.isUnit() &&
                        alliances?.areFriendly(target, this.gameObject) &&
                        target.healthTrait &&
                        target.healthTrait.health < 100 &&
                        this.gameObject.isAircraft() === target.isAircraft()
                    ),
            );
        } else {
            if (this.gameObject.rules.attackCursorOnFriendlies || this.warheadRules.bombDisarm) {
                this.targetChecks.push(
                    (target, context, alliances, forcefire, shift) =>
                        !shift &&
                        !!(
                            !this.warheadRules.bombDisarm ||
                            (target?.isTechno() && target.tntChargeTrait?.hasCharge())
                        ),
                );
            } else {
                this.targetChecks.push(
                    (target, context, alliances, forcefire) =>
                        !(
                            (!forcefire || this.warheadRules.mindControl) &&
                            target?.isTechno() &&
                            alliances?.areFriendly(target, this.gameObject)
                        ),
                );
            }

            this.targetChecks.push(
                (target, context, alliances) =>
                    !(
                        target?.isTechno() &&
                        target.cloakableTrait?.isCloaked() &&
                        !alliances?.alliances.haveSharedIntel(this.gameObject.owner, target.owner)
                    ),
            );

            if (this.weaponRules.limboLaunch) {
                this.targetChecks.push(
                    (target, context, alliances, forcefire, shift) =>
                        !(
                            shift &&
                            target &&
                            (target.isVehicle() || target.isAircraft()) &&
                            target.parasiteableTrait?.isInfested()
                        ),
                );
            }

            if (this.gameObject.rules.ivan) {
                this.targetChecks.push(
                    (target) => !(!target?.isTechno() || !target.tntChargeTrait || target.tntChargeTrait.hasCharge()),
                );
            }

            if (this.warheadRules.parasite) {
                this.targetChecks.push(
                    (target, context, alliances, forcefire) =>
                        !!(
                            (!target && forcefire) ||
                            target?.isInfantry() ||
                            ((target?.isVehicle() || target?.isAircraft()) && target.parasiteableTrait)
                        ),
                );
            }

            if (this.warheadRules.mindControl) {
                this.targetChecks.push((target) => !(!target?.isTechno() || !target.mindControllableTrait));
            }

            if (!this.warheadRules.temporal) {
                this.targetChecks.push(
                    (target, context, alliances, forcefire, shift) =>
                        !(shift && target?.isTechno() && target.warpedOutTrait?.isInvulnerable()),
                );
            }

            if (this.gameObject.rules.natural) {
                this.targetChecks.push((target) => !target?.isTechno() || !target.rules.unnatural);
            }
        }

        this.targetChecks.push((target, context) => this.canTargetZone(target, context));
    }

    public canTarget(
        target?: GameObject,
        context?: GameContext,
        alliances?: AllianceSystem,
        forcefire?: boolean,
        shift?: boolean,
    ): boolean {
        return this.targetChecks.every((check) => check(target, context, alliances, forcefire, shift));
    }

    private canTargetZone(target?: GameObject, context?: GameContext): boolean {
        let zone: ZoneType;

        if (target?.isUnit()) {
            // A paradropping infantryman above 2 tiles is treated as a flying
            // target even though his zone is still Ground.
            if (target?.isInfantry() && target.stance === StanceType.Paradrop && (target.tileElevation ?? 0) > 2) {
                return (
                    this.projectileRules.isAntiAir &&
                    (this.projectileRules.isAntiGround || this.weaponType === WeaponType.Secondary)
                );
            }

            if (target.zone === ZoneType.Air) {
                return this.projectileRules.isAntiAir;
            }

            // A secondary-only AA weapon (e.g. the AA gun's primary) must not
            // fall through to the land check and shoot at ground units.
            if (
                this.weaponType === WeaponType.Secondary &&
                this.projectileRules.isAntiAir &&
                !this.projectileRules.isAntiGround
            ) {
                return false;
            }

            zone = target.zone ?? ZoneType.Ground;
        } else {
            zone = context?.landType === LandType.Water ? ZoneType.Water : ZoneType.Ground;
        }

        return zone === ZoneType.Water
            ? this.canTargetNaval(this.gameObject.rules.navalTargeting, this.gameObject, target, this.weaponType)
            : this.canTargetLand(this.gameObject.rules.landTargeting, this.weaponType);
    }

    private canTargetLand(landTargeting: LandTargeting, weaponType: WeaponType): boolean {
        switch (landTargeting) {
            case LandTargeting.LandOk:
                return true;
            case LandTargeting.LandNotOk:
                return false;
            case LandTargeting.LandSecondary:
                return weaponType === WeaponType.Secondary;
            default:
                throw new Error(`Unhandled LandTargeting value "${landTargeting}"`);
        }
    }

    private canTargetNaval(
        navalTargeting: NavalTargeting,
        shooter: GameObject,
        target?: GameObject,
        weaponType?: WeaponType,
    ): boolean {
        switch (navalTargeting) {
            case NavalTargeting.UnderwaterNever:
                return !target || !(target.isVehicle() && target.submergibleTrait?.isSubmerged());
            case NavalTargeting.UnderwaterSecondary:
                return target && target.isVehicle() && target.submergibleTrait && !shooter.rules.spawned
                    ? weaponType === WeaponType.Secondary
                    : weaponType === WeaponType.Primary;
            case NavalTargeting.UnderwaterOnly:
                return !!(target && target.isVehicle() && target.submergibleTrait);
            case NavalTargeting.OrganicSecondary:
                return target?.isTechno() && target.rules.organic
                    ? weaponType === WeaponType.Secondary
                    : weaponType === WeaponType.Primary;
            case NavalTargeting.SealSpecial:
                return target?.isTechno() &&
                    target.rules.naval &&
                    !target.rules.organic &&
                    (target.isBuilding() || target.rules.speedType === SpeedType.Float)
                    ? weaponType === WeaponType.Secondary
                    : weaponType === WeaponType.Primary;
            case NavalTargeting.NavalAll:
                return true;
            case NavalTargeting.NavalNone:
                return false;
            default:
                throw new Error(`Unhandled NavalTargeting value "${navalTargeting}"`);
        }
    }
}
