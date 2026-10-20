/**
 * Port of redalert2/src/game/gameobject/Aircraft.ts (84 lines).
 *
 * Aircraft differ from vehicles in three ways that show up in the model:
 *
 * 1. **Three rotation axes.** `pitch` (nose up/down) and `roll` (bank) are
 *    fields, not derived, because the voxel renderer keys animations off them
 *    directly. `direction` is an alias for `yaw`, and the *setter* is what the
 *    turn logic writes — keeping it an alias means a turning plane cannot end up
 *    with yaw and direction disagreeing.
 * 2. **`zone` starts as `Ground`, not `Air`.** A landed plane is a ground
 *    object for targeting; `MissileLocomotor` flips it on lift-off.
 * 3. **No rocking.** A hit plane banks via `CrasheableTrait`, not the 34-frame
 *    decorative rock a tank gets.
 *
 * `factory` (trait assembly) ships with the trait batch; see `PORT-MATRIX.md`.
 */
import { ObjectType } from '../type/ObjectType';
import { ZoneType } from './unit/ZoneType';
import { CrateBonuses } from './unit/CrateBonuses';
import { Techno } from './Techno';

export class Aircraft extends Techno {
    pitch: number;
    yaw: number;
    roll: number;
    onBridge: boolean;
    zone: ZoneType;
    crateBonuses: CrateBonuses;
    moveTrait!: any;
    airportBoundTrait?: any;
    crashableTrait?: any;
    missileSpawnTrait?: any;
    spawnLinkTrait?: any;
    parasiteableTrait?: any;

    get direction(): number {
        return this.yaw;
    }

    set direction(value: number) {
        this.yaw = value;
    }

    get isMoving(): boolean {
        return this.moveTrait.isMoving();
    }

    constructor(type: ObjectType, name: string, rules: any, art: any) {
        super(type, name, rules, art);
        this.pitch = 0;
        this.yaw = 0;
        this.roll = 0;
        this.onBridge = false;
        this.zone = ZoneType.Ground;
        this.crateBonuses = new CrateBonuses();
    }

    isUnit(): boolean {
        return true;
    }

    isAircraft(): boolean {
        return true;
    }
}
