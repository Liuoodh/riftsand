/**
 * Port of redalert2/src/game/gameobject/Unit.ts (10 lines).
 *
 * A thin alias whose only job is to exist as a distinct constructor so
 * `ObjectType.Vehicle` has a class name. `ObjectFactory` never calls it
 * directly for vehicles — `Vehicle.factory` does — but `instanceof` on `Unit`
 * would be wrong for infantry/aircraft, which is why the model answers
 * membership through `isUnit()` instead.
 */
import { ObjectType } from '../type/ObjectType';
import { Techno } from './Techno';

export class Unit extends Techno {
    static factory(name: string, rules: any, art: any): Unit {
        return new this(ObjectType.Vehicle, name, rules, art);
    }

    constructor(type: ObjectType, name: string, rules: any, art: any) {
        super(type, name, rules, art);
    }
}
