import { Coords } from './Coords';
import { ZoneType } from './gameobject/unit/ZoneType';
import { LandType } from './type/LandType';
import { LocomotorType } from './type/LocomotorType';
import { MovementZone } from './type/MovementZone';
import { SpeedType } from './type/SpeedType';

/**
 * Verbatim from redalert2/src/game/Target.ts.
 *
 * A `Target` is not "an object" — it is a *place to shoot at*, which is why a
 * bare tile, an ore cell and a bridge segment are all first-class targets while
 * a building's 15 tiles collapse into one (`centerTile`).
 *
 * Three behaviours that look like bugs and must be kept:
 *  - An ore overlay sets `isOre` and takes the tile, but **not** `obj`. That is
 *    how a harvester can be told "go here" and how a shot at ore hits the ground.
 *  - A bridge overlay sets `obj` *and* `bridge` *and* forces
 *    `bridgeMode = Bridge`, so `equals()` distinguishes "the bridge" from "the
 *    ground under the bridge" even though both have the same tile.
 *  - `getBridge()` falls back to the tile occupation for units standing on a
 *    bridge — the bridge is not the target, the unit is, but the projectile still
 *    has to fly at deck height.
 */
export enum TargetBridgeMode {
    Auto = 0,
    Ground = 1,
    Bridge = 2,
}

export class Target {
    private tileOccupation: any;
    private isOre: boolean;
    private bridge?: any;
    private bridgeMode: TargetBridgeMode;
    public tile: any;
    public obj?: any;

    constructor(obj: any, tile: any, tileOccupation: any, bridgeMode: TargetBridgeMode = TargetBridgeMode.Auto) {
        this.tileOccupation = tileOccupation;
        this.isOre = false;
        this.bridgeMode = bridgeMode;

        if (obj) {
            if (obj.isOverlay() && obj.isBridge()) {
                this.bridge = obj;
                this.obj = obj;
                this.tile = tile;
                this.bridgeMode = TargetBridgeMode.Bridge;
            } else if (obj.isOverlay() && obj.isTiberium()) {
                this.isOre = true;
                this.tile = obj.tile;
            } else {
                this.obj = obj;
                this.tile = obj.isBuilding() ? obj.centerTile : obj.tile;
            }
        } else {
            if (tile.landType === LandType.Tiberium) {
                this.isOre = true;
            }
            if (bridgeMode === TargetBridgeMode.Bridge) {
                this.bridge = tileOccupation.getBridgeOnTile(tile);
            } else if (bridgeMode === TargetBridgeMode.Auto && tile.onBridgeLandType !== undefined) {
                this.bridge = tileOccupation.getBridgeOnTile(tile);
            }
            this.tile = tile;
        }
    }

    equals(other: Target): boolean {
        return (
            this.obj === other.obj &&
            this.tile === other.tile &&
            this.bridge === other.bridge &&
            this.isOre === other.isOre
        );
    }

    getWorldCoords() {
        return this.obj
            ? this.obj.position.worldPosition
            : Coords.tile3dToWorld(
                  this.tile.rx + 0.5,
                  this.tile.ry + 0.5,
                  this.tile.z + (this.bridge?.tileElevation ?? 0),
              );
    }

    isBridge(): boolean {
        return !!this.bridge;
    }

    getBridge() {
        return (
            this.bridge ||
            (this.obj?.isUnit() && this.obj.onBridge
                ? this.tileOccupation.getBridgeOnTile(this.obj.tile)
                : undefined)
        );
    }

    getBridgeFor(sourceObject?: any) {
        if (sourceObject && Target.usesGroundLayerUnderBridge(sourceObject)) {
            return undefined;
        }
        return this.getBridge();
    }

    getBridgeMode(): TargetBridgeMode {
        return this.bridgeMode;
    }

    hasExplicitBridgeMode(): boolean {
        return this.bridgeMode !== TargetBridgeMode.Auto;
    }

    /**
     * "Is this shooter shooting from *under* the bridge?" — a naval unit, a
     * swimmer, or anything that floats. Such a unit must aim at the ground layer
     * even when a bridge deck covers the tile.
     */
    static usesGroundLayerUnderBridge(sourceObject: any): boolean {
        const rules = sourceObject?.rules;
        return (
            !!rules &&
            (rules.naval ||
                rules.waterBound ||
                rules.locomotor === LocomotorType.Ship ||
                sourceObject.zone === ZoneType.Water ||
                rules.movementZone === MovementZone.Water ||
                rules.speedType === SpeedType.Float ||
                rules.speedType === SpeedType.FloatBeach)
        );
    }
}
