/**
 * Port of redalert2/src/game/gameobject/Vehicle.ts (166 lines).
 *
 * `rocking` is the only piece of logic in the class and it is pure decoration:
 * `applyRocking` is called by the damage path when a vehicle is hit, and the
 * state decays over exactly `ROCKING_TICKS` (34) frames. It is merged here
 * (rather than a trait) because the renderer needs it every frame and 34 is
 * shorter than any trait's attention span.
 *
 * `isSinker` is computed in `factory` from ship-sinking weight: a heavy *land*
 * vehicle also sinks when it ends up on water, which is how the "drown your MCV"
 * trick works. It is left as a field here because the value is rule-derived once
 * and never changes.
 *
 * `factory` (trait assembly) ships with the trait batch; see `PORT-MATRIX.md`.
 */
import { ObjectType } from '../type/ObjectType';
import { ZoneType } from './unit/ZoneType';
import { CrateBonuses } from './unit/CrateBonuses';
import { Techno } from './Techno';

export const ROCKING_TICKS = 34;

export interface RockingState {
    ticksLeft: number;
    facing: number;
    factor: number;
}

export class Vehicle extends Techno {
    direction = 0;
    spinVelocity = 0;
    crateBonuses = new CrateBonuses();
    turretNo = 0;
    onBridge = false;
    isSinker = false;
    isFiring = false;
    zone: ZoneType;
    rocking?: RockingState;
    moveTrait!: any;
    crashableTrait?: any;
    crewedTrait?: any;
    harvesterTrait?: any;
    transportTrait?: any;
    gunnerTrait?: any;
    openToppedTrait?: any;
    turretTrait?: any;
    parasiteableTrait?: any;
    submergibleTrait?: any;
    tilterTrait?: any;

    get isMoving(): boolean {
        return this.moveTrait.isMoving();
    }

    constructor(type: ObjectType, name: string, rules: any, art: any) {
        super(type, name, rules, art);
        this.zone = rules.naval ? ZoneType.Water : ZoneType.Ground;
    }

    isUnit(): boolean {
        return true;
    }

    isVehicle(): boolean {
        return true;
    }

    getUiName(): string {
        if (this.gunnerTrait) {
            // IFV: the name is "weapon mode + base name", e.g. "{MachineGun} {IFV}".
            const specialWeaponIndex = this.armedTrait.getSpecialWeaponIndex();
            const ifvModeName = this.gunnerTrait.getUiNameForIfvMode(
                specialWeaponIndex,
                this.transportTrait?.units[0]?.name,
            );
            const baseName = 'name:' + this.name;
            return ifvModeName ? `{${ifvModeName}} {${baseName}}` : baseName;
        }
        return super.getUiName();
    }

    update(deltaTime: number): void {
        if (this.rocking) {
            this.rocking.ticksLeft--;
            if (!this.rocking.ticksLeft) {
                this.rocking = undefined;
            }
        }
        super.update(deltaTime);
    }

    applyRocking(facing: number, factor: number): void {
        if (!this.rules.consideredAircraft) {
            this.rocking = {
                // Reset the countdown to a *fresh* 34 only when there was none;
                // a second hit mid-rock extends nothing (retail behaviour).
                ticksLeft: this.rocking?.ticksLeft ?? ROCKING_TICKS,
                facing: facing,
                factor: factor,
            };
        }
    }
}
