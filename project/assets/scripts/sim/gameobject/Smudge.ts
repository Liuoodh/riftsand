/**
 * Port of redalert2/src/game/gameobject/Smudge.ts (16 lines).
 *
 * A smudge is a scorch mark / crater left by an explosion. It is a game object
 * only so that it can be picked, sorted and serialised like everything else; it
 * has no traits at all.
 *
 * Footprint comes from `art.width/height` (the smudge art INI), not from
 * `rules` — smudges have no rules record worth the name.
 */
import { ObjectType } from '../type/ObjectType';
import { GameObject } from './GameObject';

export class Smudge extends GameObject {
    static factory(name: string, rules: any, art: any): Smudge {
        return new this(ObjectType.Smudge, name, rules, art);
    }

    constructor(type: ObjectType, name: string, rules: any, art: any) {
        super(type, name, rules, art);
    }

    getFoundation(): { width: number; height: number } {
        return { width: this.rules.width, height: this.rules.height };
    }
}
