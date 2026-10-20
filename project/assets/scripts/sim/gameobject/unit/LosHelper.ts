/**
 * Port of redalert2/src/game/gameobject/unit/LosHelper.ts (85 lines).
 *
 * Line of sight is *not* a raycast. It walks a Bresenham line of cells and
 * applies three independent vetoes, each of which is enabled by a different
 * flag on the weapon:
 *
 *   `subjectToWalls`   any `LandType.Wall` cell vetoes the shot
 *   `subjectToCliffs`  a cliff higher than the shooter vetoes; and once you have
 *                      crossed a cliff, a higher cell beyond it vetoes too
 *                      (that `wasCliff` state is the "you cannot shoot out of a
 *                      canyon" rule)
 *   `spawner`          a high bridge within the first two cells vetoes, because
 *                      a spawned aircraft would immediately hit the deck
 *
 * `warhead.wall` short-circuits all of it: a warhead that damages walls ignores
 * them for LOS purposes.
 */
import { bresenham } from '../../bresenham';
import { LandType } from '../../type/LandType';

interface TileOccupation {
    getBridgeOnTile(tile: any): any;
}

interface Tiles {
    getByMapCoords(x: number, y: number): any;
}

interface WeaponRules {
    warhead: { rules: { wall: boolean } };
    projectileRules: { subjectToWalls: boolean; subjectToCliffs: boolean };
    rules: { spawner: boolean };
}

export class LosHelper {
    private tiles: Tiles;
    private tileOccupation: TileOccupation;

    constructor(tiles: Tiles, tileOccupation: TileOccupation) {
        this.tiles = tiles;
        this.tileOccupation = tileOccupation;
    }

    hasLineOfSight(source: any, target: any, weapon: WeaponRules): boolean {
        const ignoreWalls = weapon.warhead.rules.wall || !weapon.projectileRules.subjectToWalls;
        const checkCliffs = weapon.projectileRules.subjectToCliffs;
        const isSpawner = weapon.rules.spawner;

        let cliffCount = 0;
        let wasCliff = false;

        if (!ignoreWalls || checkCliffs || isSpawner) {
            const sourceTile = this.hasPosition(source) ? source.tile : source;
            // A building's LOS target is its *centre* cell, not its origin cell:
            // a 3x3 building whose origin is behind a wall can still shoot.
            const targetTile = this.hasPosition(target)
                ? target.isBuilding()
                    ? target.centerTile
                    : target.tile
                : target;

            let sourceZ = sourceTile.z;
            if (checkCliffs && this.hasPosition(source) && source.isUnit() && source.onBridge) {
                sourceZ += this.tileOccupation.getBridgeOnTile(sourceTile)?.tileElevation ?? 0;
            }

            for (const { x, y } of bresenham(sourceTile.rx, sourceTile.ry, targetTile.rx, targetTile.ry)) {
                const tile = this.tiles.getByMapCoords(x, y);
                if (!tile) return false;

                if (!ignoreWalls && tile.landType === LandType.Wall) return false;

                if (checkCliffs) {
                    if (tile.landType === LandType.Cliff) {
                        if (tile.z > sourceZ) return false;
                        wasCliff = true;
                    } else {
                        if (tile.z > sourceZ && wasCliff) return false;
                        wasCliff = false;
                    }
                }

                if (isSpawner && cliffCount < 2 && this.tileOccupation.getBridgeOnTile(tile)?.isHighBridge()) {
                    return false;
                }
                cliffCount++;
            }
        }

        return true;
    }

    private hasPosition(obj: any): boolean {
        return obj.position !== undefined;
    }
}
