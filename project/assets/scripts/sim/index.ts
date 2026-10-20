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
export { DeathType } from './gameobject/DeathType';
export { InfDeathType } from './gameobject/InfDeathType';
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
export { NotifyCrash } from './gameobject/trait/interface/NotifyCrash';
export { NotifyOrder } from './gameobject/trait/interface/NotifyOrder';
export { NotifySell } from './gameobject/trait/interface/NotifySell';
export { NotifyTeleport } from './gameobject/trait/interface/NotifyTeleport';
export { NotifyBuildStatus } from './gameobject/trait/interface/NotifyBuildStatus';
export { NotifyDestroy } from './gameobject/trait/interface/NotifyDestroy';
export { NotifyOwnerChange } from './gameobject/trait/interface/NotifyOwnerChange';
export { NotifySpawn } from './gameobject/trait/interface/NotifySpawn';
export { NotifyUnspawn } from './gameobject/trait/interface/NotifyUnspawn';
export { NotifyTileChange } from './gameobject/trait/interface/NotifyTileChange';
/*
 * The *global* tile-change hook shares its name with the per-object one above.
 * Two different `Symbol()`s, two subscriber lists — re-exported under a distinct
 * name because this module is a flat namespace. See REFERENCE-PARITY §27.
 */
export { NotifyTileChange as GlobalNotifyTileChange } from './trait/interface/NotifyTileChange';
export { NotifyElevationChange } from './trait/interface/NotifyElevationChange';

/* events — the full 68-file catalogue from game/event/ */
export { AllianceChangeEvent } from './event/AllianceChangeEvent';
export { BridgeRepairEvent } from './event/BridgeRepairEvent';
export { BuildingCaptureEvent } from './event/BuildingCaptureEvent';
export { BuildingEvacuateEvent } from './event/BuildingEvacuateEvent';
export { BuildingFailedPlaceEvent } from './event/BuildingFailedPlaceEvent';
export { BuildingGarrisonEvent } from './event/BuildingGarrisonEvent';
export { BuildingInfiltrationEvent } from './event/BuildingInfiltrationEvent';
export { BuildingPlaceEvent } from './event/BuildingPlaceEvent';
export { BuildingRepairFullEvent } from './event/BuildingRepairFullEvent';
export { BuildingRepairStartEvent } from './event/BuildingRepairStartEvent';
export { BuildStatusChangeEvent } from './event/BuildStatusChangeEvent';
export { CheerEvent } from './event/CheerEvent';
export { CratePickupEvent } from './event/CratePickupEvent';
export { DeployNotAllowedEvent } from './event/DeployNotAllowedEvent';
export { EnterObjectEvent } from './event/EnterObjectEvent';
export { EnterTileEvent } from './event/EnterTileEvent';
export { EnterTransportEvent } from './event/EnterTransportEvent';
export { EventMap } from './event/EventMap';
export { EventType } from './event/EventType';
export { FactoryProduceUnitEvent } from './event/FactoryProduceUnitEvent';
export { HealthChangeEvent } from './event/HealthChangeEvent';
export { InflictDamageEvent } from './event/InflictDamageEvent';
export { InsufficientFundsEvent } from './event/InsufficientFundsEvent';
export { LeaveTransportEvent } from './event/LeaveTransportEvent';
export { LightningStormCloudEvent } from './event/LightningStormCloudEvent';
export { LightningStormManifestEvent } from './event/LightningStormManifestEvent';
export { ObjectAttackedEvent } from './event/ObjectAttackedEvent';
export { ObjectCloakChangeEvent } from './event/ObjectCloakChangeEvent';
export { ObjectCrashingEvent } from './event/ObjectCrashingEvent';
export { ObjectDestroyEvent } from './event/ObjectDestroyEvent';
export { ObjectDisguiseChangeEvent } from './event/ObjectDisguiseChangeEvent';
export { ObjectLandEvent } from './event/ObjectLandEvent';
export { ObjectLiftOffEvent } from './event/ObjectLiftOffEvent';
export { ObjectMorphEvent } from './event/ObjectMorphEvent';
export { ObjectOwnerChangeEvent } from './event/ObjectOwnerChangeEvent';
export { ObjectSellEvent } from './event/ObjectSellEvent';
export { ObjectSpawnEvent } from './event/ObjectSpawnEvent';
export { ObjectTeleportEvent } from './event/ObjectTeleportEvent';
export { ObjectUnspawnEvent } from './event/ObjectUnspawnEvent';
export { PingLocationEvent } from './event/PingLocationEvent';
export { PlayerDefeatedEvent } from './event/PlayerDefeatedEvent';
export { PlayerDroppedEvent } from './event/PlayerDroppedEvent';
export { PlayerResignedEvent } from './event/PlayerResignedEvent';
export { PowerChangeEvent } from './event/PowerChangeEvent';
export { PowerLowEvent } from './event/PowerLowEvent';
export { PowerRestoreEvent } from './event/PowerRestoreEvent';
export { PrimaryFactoryChangeEvent } from './event/PrimaryFactoryChangeEvent';
export { RadarEvent } from './event/RadarEvent';
export { RadarOnOffEvent } from './event/RadarOnOffEvent';
export { RallyPointChangeEvent } from './event/RallyPointChangeEvent';
export { ShipSubmergeChangeEvent } from './event/ShipSubmergeChangeEvent';
export { StalemateDetectEvent } from './event/StalemateDetectEvent';
export { SuperWeaponActivateEvent } from './event/SuperWeaponActivateEvent';
export { SuperWeaponReadyEvent } from './event/SuperWeaponReadyEvent';
export { TimerExpireEvent } from './event/TimerExpireEvent';
export { TriggerAnimEvent } from './event/TriggerAnimEvent';
export { TriggerEvaEvent } from './event/TriggerEvaEvent';
export { TriggerSoundFxEvent } from './event/TriggerSoundFxEvent';
export { TriggerStopSoundFxEvent } from './event/TriggerStopSoundFxEvent';
export { TriggerTextEvent } from './event/TriggerTextEvent';
export { UnitDeployUndeployEvent } from './event/UnitDeployUndeployEvent';
export { UnitPromoteEvent } from './event/UnitPromoteEvent';
export { UnitRecycleEvent } from './event/UnitRecycleEvent';
export { UnitRepairFinishEvent } from './event/UnitRepairFinishEvent';
export { UnitRepairStartEvent } from './event/UnitRepairStartEvent';
export { WarheadDetonateEvent } from './event/WarheadDetonateEvent';
export { WeaponFireEvent } from './event/WeaponFireEvent';

/* task system */
export { TaskStatus } from './gameobject/task/system/TaskStatus';
export { Task } from './gameobject/task/system/Task';
export { TaskRunner } from './gameobject/task/system/TaskRunner';
export { TaskGroup } from './gameobject/task/system/TaskGroup';
export { CallbackTask } from './gameobject/task/system/CallbackTask';
export { WaitTicksTask } from './gameobject/task/system/WaitTicksTask';
export { WaitMinutesTask } from './gameobject/task/system/WaitMinutesTask';
export type { TargetLinesConfig } from './gameobject/task/system/TargetLinesConfig';
export { GameSpeed } from './GameSpeed';

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
export { TerrainType } from './type/TerrainType';
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

/* map — cells, bounds, passability, bridges, shroud */
export { TileCollection, TileDirection } from './map/TileCollection';
export type { Tile, TileData } from './map/TileCollection';
export { MapBounds } from './map/MapBounds';
export { TileOccupation, LayerType } from './map/TileOccupation';
export { TileOcclusion } from './map/TileOcclusion';
export { Terrain } from './map/Terrain';
export type { PathNode, PathOptions, Obstacle } from './map/Terrain';
export { Bridges, BridgeHeadType } from './map/Bridges';
export { MapShroud, ShroudType, ShroudFlag } from './map/MapShroud';
export { OreSpread } from './map/OreSpread';
export { wallTypes } from './map/wallTypes';
export { RadialBackFirstTileFinder } from './map/tileFinder/RadialBackFirstTileFinder';
export { RandomTileFinder } from './map/tileFinder/RandomTileFinder';
export { CardinalTileFinder } from './map/tileFinder/CardinalTileFinder';
export { DirectionalTileFinder } from './map/tileFinder/DirectionalTileFinder';
export { FloodTileFinder } from './map/tileFinder/FloodTileFinder';

/* theater — the tile-set seam (abstract only; the art is ours) */
export { HighBridgeHeadType } from './theater/TileSets';
export type { TileSets, TileSetEntry, TileImage } from './theater/TileSets';

/* content — our generated theater expressed in engine terms */
export { ProceduralTileSets, buildTileData, TERRAIN_TYPE_OF_KIND } from './content/tileSets';
export { OreOverlayStub } from './content/oreOverlay';

/* object core — the model that replaces `game/Entities.ts` (B5) */
export { Traits } from './Traits';
export { MoveTrait, MoveState, MoveResult, CollisionState } from './MoveTrait';
/*
 * B6b — the movement subsystem, ported against the object model. `MoveTrait`
 * exists twice on purpose: the name above is the legacy trait the live game
 * still drives (`World.ts`), the alias below is the reference's own trait, which
 * takes a `GameState` argument on every call. They share the enums.
 */
export { MoveTrait as GameObjectMoveTrait } from './gameobject/trait/MoveTrait';
export { MoveTask } from './gameobject/task/move/MoveTask';
export type { MoveOptions } from './gameobject/task/move/MoveTask';
export { MoveAsideTask } from './gameobject/task/move/MoveAsideTask';
export { MoveTargetTask } from './gameobject/task/move/MoveTargetTask';
export { MoveInsideTask } from './gameobject/task/move/MoveInsideTask';
export { MoveOutsideTask } from './gameobject/task/move/MoveOutsideTask';
export { MoveToBlockTask } from './gameobject/task/move/MoveToBlockTask';
export { AttackMoveTask } from './gameobject/task/move/AttackMoveTask';
export { MoveInWeaponRangeTask, STRAFE_CLOSE_ENOUGH } from './gameobject/task/move/MoveInWeaponRangeTask';
export { MoveToDockTask } from './gameobject/task/MoveToDockTask';
export { ScatterTask } from './gameobject/task/ScatterTask';
export { WingedLocomotor } from './gameobject/locomotor/WingedLocomotor';
export { JumpjetLocomotor } from './gameobject/locomotor/JumpjetLocomotor';
export { GameObject } from './gameobject/GameObject';
export { Techno } from './gameobject/Techno';
export { Unit } from './gameobject/Unit';
export { Infantry } from './gameobject/Infantry';
export { Vehicle, ROCKING_TICKS } from './gameobject/Vehicle';
export { Aircraft } from './gameobject/Aircraft';
export { Building, BuildStatus } from './gameobject/Building';
export { Overlay } from './gameobject/Overlay';
export { Smudge } from './gameobject/Smudge';
export { Terrain as TerrainObject } from './gameobject/Terrain';
export { Weapon as WeaponObject } from './gameobject/Weapon';
export type { Bridge } from './gameobject/Bridge';
export { ObjectPosition } from './gameobject/ObjectPosition';

/* object core — per-unit helpers */
export { CollisionHelper } from './gameobject/unit/CollisionHelper';
export { CrateBonuses } from './gameobject/unit/CrateBonuses';
export { LosHelper } from './gameobject/unit/LosHelper';
export { MovePositionHelper } from './gameobject/unit/MovePositionHelper';
export { ScatterPositionHelper } from './gameobject/unit/ScatterPositionHelper';

/* object core — selection */
export { SelectionLevel } from './gameobject/selection/SelectionLevel';
export { SelectionModel } from './gameobject/selection/SelectionModel';
export { SelectionList } from './gameobject/selection/SelectionList';
export { UnitSelection } from './gameobject/selection/UnitSelection';
export { UnitSelectionLite } from './gameobject/selection/UnitSelectionLite';

/* object core — locomotor */
export { FootLocomotor } from './gameobject/locomotor/FootLocomotor';
export { DriveLocomotor } from './gameobject/locomotor/DriveLocomotor';
export { HoverLocomotor } from './gameobject/locomotor/HoverLocomotor';
export { ChronoLocomotor } from './gameobject/locomotor/ChronoLocomotor';
export { MissileLocomotor } from './gameobject/locomotor/MissileLocomotor';
export { LocomotorFactory } from './gameobject/locomotor/LocomotorFactory';

/*
 * B6c — the rest of the reference task set, plus the two traits it cannot exist
 * without. `AttackTrait` and `UnitOrderTrait` are pulled forward from B6d
 * because `AttackTask` *is* the attack state machine's other half and because
 * `UnitOrderTrait` is the only thing that drives tasks at all.
 *
 * `sim/task/**` still exists for the live hand-written engine (`game/Game.ts`);
 * it is not the same code and is deleted in B9, not here.
 */
export { TurnTask } from './gameobject/task/TurnTask';
export { WaitForBuildUpTask } from './gameobject/task/WaitForBuildUpTask';
export { EnterBuildingTask } from './gameobject/task/EnterBuildingTask';
export { EnterBunkerTask } from './gameobject/task/EnterBunkerTask';
export { EnterRecyclerTask } from './gameobject/task/EnterRecyclerTask';
export { EnterHospitalTask } from './gameobject/task/EnterHospitalTask';
export { EnterTransportTask } from './gameobject/task/EnterTransportTask';
export { EvacuateTransportTask } from './gameobject/task/EvacuateTransportTask';
export { GarrisonBuildingTask } from './gameobject/task/GarrisonBuildingTask';
export { InfiltrateBuildingTask } from './gameobject/task/InfiltrateBuildingTask';
export { CaptureBuildingTask } from './gameobject/task/CaptureBuildingTask';
export { RepairBuildingTask } from './gameobject/task/RepairBuildingTask';
export { PlantC4Task } from './gameobject/task/PlantC4Task';
export { CheerTask } from './gameobject/task/CheerTask';
export { ParadropTask } from './gameobject/task/ParadropTask';
export { AttackTask, IS_ATTACK_TASK } from './gameobject/task/AttackTask';
export { AttackMoveTargetTask } from './gameobject/task/move/AttackMoveTargetTask';
export { ExitFactoryTask } from './gameobject/task/move/ExitFactoryTask';
export { GatherOreTask } from './gameobject/task/harvester/GatherOreTask';
export { ReturnOreTask } from './gameobject/task/harvester/ReturnOreTask';
export { TeleportMoveToRefineryTask } from './gameobject/task/harvester/TeleportMoveToRefineryTask';
export { MorphIntoTask } from './gameobject/task/morph/MorphIntoTask';
export { DeployIntoTask } from './gameobject/task/morph/DeployIntoTask';
export { UndeployIntoTask } from './gameobject/task/morph/UndeployIntoTask';
export { PackBuildingTask } from './gameobject/task/morph/PackBuildingTask';
export { AttackTrait, AttackState } from './gameobject/trait/AttackTrait';
export { UnitOrderTrait } from './gameobject/trait/UnitOrderTrait';
export { SequenceType } from './art/SequenceType';
