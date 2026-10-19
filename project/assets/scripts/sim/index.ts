/**
 * sim barrel — the engine layer's public surface.
 *
 * Two consumers:
 *   1. `Boot.ts`, which hangs it on `globalThis.__riftsandSim` so the headless
 *      regression scripts can assert against the same objects the game runs;
 *   2. future batches (rules / warhead / map), which import through here so a
 *      file move never ripples into gameplay code.
 *
 * Kept explicit instead of `export *` because `clamp` and friends exist in both
 * the reference `util/math` and the older `sim/Math2` helpers.
 */

/* math */
export { GameMath } from './math/GameMath';
export { Vector2 } from './math/Vector2';
export { Vector3 } from './math/Vector3';
export { Quaternion } from './math/Quaternion';
export { Euler } from './math/Euler';
export { Matrix4 } from './math/Matrix4';
export { Box2 } from './math/Box2';
export { Cylindrical, Spherical } from './math/polar';
export { CurvePath, LineCurve, QuadraticBezierCurve, CubicBezierCurve3 } from './math/curves';
export {
    radToDeg, degToRad, rotateVec2, angleDegFromVec2, angleDegBetweenVec2,
    angleDegBetweenVec3, quaternionFromVec3, rotateVec3Towards, angleBetweenQuaternions,
} from './math/geometry';

/* spatial / random / projection */
export { Coords } from './Coords';
export { Prng } from './Prng';

/* reference vocabulary */
export { ArmorType } from './type/ArmorType';
export { LandType, getLandType } from './type/LandType';
export { SpeedType } from './type/SpeedType';
export { MovementZone } from './type/MovementZone';
export { LocomotorType } from './type/LocomotorType';
export { LandTargeting } from './type/LandTargeting';
export { NavalTargeting } from './type/NavalTargeting';
export { SuperWeaponType } from './type/SuperWeaponType';
export { PowerupType } from './type/PowerupType';
export { PipColor } from './type/PipColor';
export { VhpScan } from './type/VhpScan';

/* util */
export {
    clamp, lerp, isBetween, getRandomInt, floorTo,
    truncToDecimals, roundToDecimals, fnv32a,
} from './util/math';
export { EventDispatcher } from './util/event';
export { BoxedVar } from './util/BoxedVar';
export { Base64 } from './util/Base64';
export { Crc32 } from './util/Crc32';
export {
    rectIntersect, rectContainsPoint, rectContainsRect, rectClampPoint,
    circleIntersect, circleContainsPoint, octileDistance, pointEquals, rectEquals,
} from './util/geometry';
