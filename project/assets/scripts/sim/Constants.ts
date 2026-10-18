/** Shared constants + tiny predicates with no dependencies (avoids import cycles). */

export const SPEED = {
    /** one cell in leptons (= this project's world pixels) */
    LEPTONS_PER_TILE: 32,
};

/**
 * `isBuilding` is a boolean flag on Entity in this project and a method in the
 * reference; every sim call site goes through this predicate so a structure is
 * recognised either way.
 */
export function isBuildingObject(obj: any): boolean {
    return !!obj && (obj.isBuilding === true || (typeof obj.isBuilding === 'function' && obj.isBuilding()));
}
