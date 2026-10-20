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
export { TICKS_PER_SECOND, HARVESTER_STORAGE } from './Constants';
export { Timer } from './Timer';

/* combat core (B3) */
export { Target, TargetBridgeMode } from './Target';
export { Weapon } from './Weapon';
export { WeaponTargeting } from './WeaponTargeting';
export { Warhead } from './Warhead';
export type { WarheadTaskFactory } from './Warhead';
export { RangeHelper } from './gameobject/unit/RangeHelper';
export { FacingUtil } from './gameobject/unit/FacingUtil';
export { TargetUtil } from './gameobject/unit/TargetUtil';
export { ZoneType, getZoneType } from './gameobject/unit/ZoneType';
export { CollisionType } from './gameobject/unit/CollisionType';
export { HealthLevel } from './gameobject/unit/HealthLevel';
export { StanceType } from './gameobject/StanceType';
export { FlhCoords } from './art/FlhCoords';
export { RadialTileFinder } from './map/tileFinder/RadialTileFinder';
export { BridgeOverlayTypes, OverlayBridgeType } from './map/BridgeOverlayTypes';
export { OreOverlayTypes } from './map/OreOverlayTypes';
export { OverlayTibType } from './type/OverlayTibType';
export { TiberiumType } from './type/TiberiumType';
export { AnimTerrainEffect } from './gameobject/common/AnimTerrainEffect';

/* combat traits (B3) */
export { HealthTrait } from './gameobject/trait/HealthTrait';
export { InvulnerableTrait } from './gameobject/trait/InvulnerableTrait';
export { WarpedOutTrait } from './gameobject/trait/WarpedOutTrait';
export { DelayedKillTrait } from './gameobject/trait/DelayedKillTrait';
export { TiberiumTrait } from './gameobject/trait/TiberiumTrait';

/* trait hooks */
export { NotifyAttack } from './trait/interface/NotifyAttack';
export { NotifyDamage } from './gameobject/trait/interface/NotifyDamage';
export { NotifyHealthChange } from './gameobject/trait/interface/NotifyHealthChange';
export { NotifyHeal } from './gameobject/trait/interface/NotifyHeal';
export { NotifyTick } from './gameobject/trait/interface/NotifyTick';
export { NotifyWarpChange } from './gameobject/trait/interface/NotifyWarpChange';

/* events */
export { EventType } from './event/EventType';
export { WarheadDetonateEvent } from './event/WarheadDetonateEvent';
export { WeaponFireEvent } from './event/WeaponFireEvent';
export { ObjectAttackedEvent } from './event/ObjectAttackedEvent';
export { InflictDamageEvent } from './event/InflictDamageEvent';
export { HealthChangeEvent } from './event/HealthChangeEvent';

/* rules */
export { RULES, Rules, RULES_CONTENT } from './rules';
export type { RulesContent } from './rules';
export { GeneralRules, PrereqCategory } from './rules/GeneralRules';
export type { GeneralRulesData } from './rules/GeneralRules';
export { ObjectRules } from './rules/ObjectRules';
export type { ObjectRulesData } from './rules/ObjectRules';
export { ObjectRulesFactory } from './rules/ObjectRulesFactory';
export { TechnoRules } from './rules/TechnoRules';
export type { TechnoRulesData } from './rules/TechnoRules';
export { WarheadRules } from './rules/WarheadRules';
export { WeaponRules } from './rules/WeaponRules';
export { CombatDamageRules } from './rules/CombatDamageRules';
export { LandRules } from './rules/LandRules';
export { TerrainRules, OccupationBits, testOccupationBit } from './rules/TerrainRules';
export { OverlayRules } from './rules/OverlayRules';
export { SmudgeRules } from './rules/SmudgeRules';
export { DebrisRules } from './rules/DebrisRules';
export { ProjectileRules } from './rules/ProjectileRules';
export { RadiationRules } from './rules/RadiationRules';
export { SuperWeaponRules } from './rules/SuperWeaponRules';
export { AiRules } from './rules/AiRules';
export { CountryRules } from './rules/CountryRules';
export { CrateRules } from './rules/CrateRules';
export { ElevationModelRules } from './rules/ElevationModelRules';
export { PowerupsRules } from './rules/PowerupsRules';
export { AudioVisualRules } from './rules/AudioVisualRules';
export { MpDialogSettings } from './rules/MpDialogSettings';
export { mpAllowedColors } from './rules/mpAllowedColors';

/* reference vocabulary */
export { ArmorType } from './type/ArmorType';
export { LandType, getLandType } from './type/LandType';
export { SpeedType } from './type/SpeedType';
export { MovementZone } from './type/MovementZone';
export { LocomotorType } from './type/LocomotorType';
export { LandTargeting } from './type/LandTargeting';
export { NavalTargeting } from './type/NavalTargeting';
export { SuperWeaponType } from './type/SuperWeaponType';
export { PowerupType, UNSUPPORTED_POWERUP_TYPES } from './type/PowerupType';
export { PipColor } from './type/PipColor';
export { VhpScan } from './type/VhpScan';
export { ObjectType } from './type/ObjectType';
export { SideType } from './type/SideType';
export { TheaterType } from './type/TheaterType';
export { WeaponType } from './type/WeaponType';
export { VeteranAbility, VeteranLevel } from './type/VeteranAbility';

/* util */
export { Color } from './util/Color';
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
