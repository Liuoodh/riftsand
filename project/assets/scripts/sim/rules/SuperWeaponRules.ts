/**
 * One `[NukeSpecial]` / ... superweapon section.
 *
 * Reference: redalert2/src/game/rules/SuperWeaponRules.ts
 *
 * `preClick` / `postClick` describe *when* the player picks the target: a
 * `preClick` weapon fires on the click that places it, a `postClick` one needs a
 * second confirmation. `preDependent` chains a prerequisite superweapon (the
 * chronosphere needs the chrono lab's own power). `rechargeTime` is minutes.
 *
 * `sidebarImage` is lower-cased on read — the SHP lookup is case-sensitive in the
 * reference asset loader, so the casing is normalised once here.
 */
import { SuperWeaponType } from '../type/SuperWeaponType';

export interface SuperWeaponRulesData {
    name: string;
    disableableFromShell?: boolean;
    isPowered?: boolean;
    preClick?: boolean;
    preDependent?: SuperWeaponType;
    postClick?: boolean;
    range?: number;
    rechargeTime?: number;
    showTimer?: boolean;
    sidebarImage?: string;
    type?: SuperWeaponType;
    uiName?: string;
    weaponType?: string;
}

export class SuperWeaponRules {
    index: number;
    disableableFromShell = false;
    isPowered = true;
    name: string;
    preClick = false;
    preDependent?: SuperWeaponType;
    postClick = false;
    range = 0;
    rechargeTime = 5;
    showTimer = false;
    sidebarImage = '';
    type?: SuperWeaponType;
    uiName = '';
    weaponType?: string;

    constructor(index: number, data: SuperWeaponRulesData) {
        this.index = index;
        this.name = data.name;
        this.read(data);
    }

    read(data: SuperWeaponRulesData): this {
        this.disableableFromShell = !!data.disableableFromShell;
        this.isPowered = data.isPowered ?? true;
        this.name = data.name;
        this.preClick = !!data.preClick;
        this.preDependent = data.preDependent;
        this.postClick = !!data.postClick;
        this.range = data.range ?? 0;
        this.rechargeTime = data.rechargeTime ?? 5;
        this.showTimer = !!data.showTimer;
        this.sidebarImage = (data.sidebarImage ?? '').toLowerCase();
        this.type = data.type;
        this.uiName = data.uiName ?? '';
        this.weaponType = data.weaponType || undefined;
        return this;
    }
}
