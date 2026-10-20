/** Shared constants + tiny predicates with no dependencies (avoids import cycles). */
import { GameSpeed } from './GameSpeed';

export const SPEED = {
    /** one cell in leptons (= this project's world pixels) */
    LEPTONS_PER_TILE: 32,
};

/**
 * Logic ticks per second.
 *
 * The reference never reads this from rules.ini — it is a property of the
 * simulation clock (`GameSpeed.BASE_TICKS_PER_SECOND`), and every "minutes" value
 * in the rules is multiplied by `60 * TICKS_PER_SECOND` to become ticks. It is
 * an alias of `GameSpeed.BASE_TICKS_PER_SECOND` rather than a second literal so
 * the two cannot drift; `GameSpeed` itself imports nothing, so this stays
 * cycle-free.
 */
export const TICKS_PER_SECOND = GameSpeed.BASE_TICKS_PER_SECOND;

/**
 * Bails of ore a standard harvester carries.
 *
 * Retail reads this from the harvester's own `Storage=` in its TechnoRules section;
 * our unit definitions still carry the capacity on the def, so this is the fallback
 * until the content pass moves it onto the rules object. Documented here rather than
 * inlined so the number has one home.
 */
export const HARVESTER_STORAGE = 20;

/**
 * Reference `object.isBuilding()`.
 *
 * `isBuilding` used to be a boolean field on Entity and this predicate papered
 * over the difference. It is a method now, everywhere, so the only thing left
 * to do is guard against a null occupant.
 */
export function isBuildingObject(obj: any): boolean {
    return !!obj && typeof obj.isBuilding === 'function' && obj.isBuilding();
}
