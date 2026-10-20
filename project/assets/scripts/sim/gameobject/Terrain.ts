/**
 * Port of redalert2/src/game/gameobject/Terrain.ts (12 lines).
 *
 * Terrain = the destructible scenery objects that are *not* overlays: trees,
 * light posts, barrels. They have HP (so they can be shot down for a small
 * bounty) but no owner, no weapon and no footprint.
 *
 * `ObjectFactory` gives them `rulesIni.general.treeStrength` as HP when
 * `Strength=` is absent, which is why this class has no health logic of its own.
 */
import { ObjectType } from '../type/ObjectType';
import { GameObject } from './GameObject';

export class Terrain extends GameObject {
    radarInvisible: boolean;

    static factory(name: string, rules: any, art: any): Terrain {
        return new this(ObjectType.Terrain, name, rules, art);
    }

    constructor(type: ObjectType, name: string, rules: any, art: any) {
        super(type, name, rules, art);
        this.radarInvisible = this.rules.radarInvisible;
    }
}
