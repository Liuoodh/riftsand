/**
 * Port of redalert2/src/game/gameobject/Techno.ts (59 lines).
 *
 * "Techno" is the retail name for *anything that a player owns and that can be
 * shot at*: units, aircraft and buildings. The class itself carries almost no
 * logic — it mirrors a handful of rule flags onto fields (because hot code paths
 * read them every tick) and exposes four computed getters.
 *
 * `sight` is the one getter with a hard clamp: `TechnoRules.MAX_SIGHT` (11) wins
 * over any veteran multiplier, so an elite unit with a large `Sight=` still
 * cannot out-range the shroud. Removing the clamp looks harmless and silently
 * gives elite units vision beyond the fog tile the renderer can even reveal.
 */
import { VeteranLevel } from './unit/VeteranLevel';
import { TechnoRules } from '../rules/TechnoRules';
import { NotifyTick } from './trait/interface/NotifyTick';
import { GameObject } from './GameObject';
import { ObjectType } from '../type/ObjectType';

export class Techno extends GameObject {
    explodes: boolean;
    radarInvisible: boolean;
    c4: boolean;
    crusher: boolean;
    defaultToGuardArea: boolean;
    guardMode: boolean;
    purchaseValue: number;
    guardArea?: any;

    get primaryWeapon() {
        return this.armedTrait?.primaryWeapon;
    }

    get secondaryWeapon() {
        return this.armedTrait?.secondaryWeapon;
    }

    get ammo() {
        return this.ammoTrait?.ammo;
    }

    get sight(): number {
        return Math.min(
            TechnoRules.MAX_SIGHT,
            this.rules.sight * (this.veteranTrait?.getVeteranSightMultiplier() ?? 1),
        );
    }

    get veteranLevel(): VeteranLevel {
        return this.veteranTrait?.veteranLevel ?? VeteranLevel.None;
    }

    constructor(type: ObjectType, name: string, rules: any, art: any) {
        super(type, name, rules, art);
        this.explodes = this.rules.explodes;
        this.radarInvisible = this.rules.radarInvisible;
        this.c4 = this.rules.c4;
        this.crusher = this.rules.crusher;
        this.defaultToGuardArea = this.rules.defaultToGuardArea;
        this.guardMode = this.rules.defaultToGuardArea;
        this.purchaseValue = this.rules.cost;
    }

    resetGuardModeToIdle(): void {
        this.guardMode = this.defaultToGuardArea;
        this.guardArea = undefined;
    }

    update(delta: number): void {
        if (this.warpedOutTrait?.isActive()) {
            /*
             * While warped out (chrono shift, temporal warp) most traits must not
             * run — a warped tank should not reload, heal or acquire targets. The
             * exceptions opt in with `ticksWhenWarpedOut`.
             */
            for (const trait of this.cachedTraits.tick) {
                if (trait.ticksWhenWarpedOut) {
                    trait[NotifyTick.onTick](this, delta);
                }
            }
        } else {
            super.update(delta);
        }
    }

    isTechno(): boolean {
        return true;
    }
}
