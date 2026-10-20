/**
 * Port of redalert2/src/game/gameobject/unit/CollisionHelper.ts (88 lines).
 *
 * Answers "what would a projectile hit if it stopped on this cell?". Used by
 * `Projectile` every time it enters a new tile, so it is deliberately an
 * ordered cascade of cheap tests rather than a physical query.
 *
 * The order is load-bearing:
 *
 *   1. `walls` first — a wall stops the shot before a bridge deck under it is
 *      even considered.
 *   2. `shore` then `ground` — a shot that lands on water *under* a bridge is a
 *      `Shore` hit, not an `UnderBridge` hit, because the bridge never gets
 *      consulted for a low one.
 *   3. high bridges last — the height comparison decides `OnBridge` vs
 *      `UnderBridge`, and both need `source`/`target` absolute heights.
 *
 * `source.tileElevation <= 2` for walls is the retail "tall enough to shoot
 * over" threshold: a unit standing on a 3-level plateau shoots over a wall.
 */
import { TerrainType } from '../../type/TerrainType';
import { LandType } from '../../type/LandType';
import { CollisionType } from './CollisionType';
import { ZoneType } from './ZoneType';

interface TileOccupation {
    getObjectsOnTile(tile: any): any[];
    getBridgeOnTile(tile: any): any;
}

export interface CollisionOptions {
    walls?: boolean;
    units?: (owner: any) => boolean;
    shore?: boolean;
    ground?: boolean;
    cliffs?: boolean;
}

export interface CollisionResult {
    type: CollisionType;
    target?: any;
}

export class CollisionHelper {
    private tileOccupation: TileOccupation;

    constructor(tileOccupation: TileOccupation) {
        this.tileOccupation = tileOccupation;
    }

    checkCollisions(source: any, target: any, options: CollisionOptions): CollisionResult {
        const sourceTile = source.tile;
        let bridge: any, unit: any, wall: any;
        for (const obj of this.tileOccupation.getObjectsOnTile(sourceTile)) {
            if (obj.isOverlay() && obj.isBridge()) bridge = obj;
            if (obj.isOverlay() && obj.wallTrait) wall = obj;
            if (obj.isTechno() && !obj.isDestroyed) unit = obj;
        }

        if (options.walls) {
            if (source.tileElevation <= 2 && sourceTile.landType === LandType.Wall) {
                return { type: CollisionType.Wall, target: wall };
            }
            if (
                options.units &&
                unit?.tile === sourceTile &&
                (!unit.isUnit() || unit.zone === ZoneType.Ground) &&
                source.tileElevation <= 1.1 &&
                options.units(unit.owner)
            ) {
                return { type: CollisionType.Wall, target: unit };
            }
        }

        if (options.shore && sourceTile.landType !== LandType.Water) {
            return { type: CollisionType.Shore };
        }

        if (options.ground && source.tileElevation < 0) {
            return { type: CollisionType.Ground };
        }

        const sourceHeight = source.tileElevation + sourceTile.z;
        const targetHeight = target.tileElevation + target.tile.z;
        if (bridge?.isHighBridge()) {
            const bridgeHeight = bridge.tile.z + bridge.tileElevation;
            if (
                (bridgeHeight < targetHeight && sourceHeight <= bridgeHeight) ||
                (targetHeight < bridgeHeight && bridgeHeight - 1 <= sourceHeight)
            ) {
                return targetHeight < bridgeHeight
                    ? { type: CollisionType.UnderBridge, target: bridge }
                    : { type: CollisionType.OnBridge, target: bridge };
            }
        } else if (bridge?.isLowBridge() && options.shore) {
            // A low bridge sits at water level: anything that reached "shore"
            // logic and found a low deck here is passing underneath it.
            return { type: CollisionType.UnderBridge, target: bridge };
        }

        if (options.cliffs) {
            const heightDiff = sourceTile.z - target.tile.z;
            if (source.tileElevation < 0 && heightDiff >= 4) {
                return { type: CollisionType.Cliff };
            }
        }

        return { type: CollisionType.None };
    }

    computeDetonationZone(tile: any, height: number, collisionType: CollisionType): ZoneType {
        const bridge = this.tileOccupation.getBridgeOnTile(tile);
        if (collisionType === CollisionType.None && height > 1.5 + (bridge?.tileElevation ?? 0)) {
            return ZoneType.Air;
        }
        if ((bridge && height > 1.5) || tile.terrainType !== TerrainType.Water || bridge?.isLowBridge()) {
            return ZoneType.Ground;
        }
        return ZoneType.Water;
    }
}
