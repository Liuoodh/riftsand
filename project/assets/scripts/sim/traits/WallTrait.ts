/**
 * Port of redalert2/src/game/gameobject/trait/WallTrait.ts.
 *
 * Two jobs, both entirely about adjacency:
 *
 *  1. **Autotiling.** Whenever a wall segment spawns (or a neighbour dies) the
 *     four cardinal neighbours are re-scanned and the segment's `wallType` is
 *     recomputed from the connection mask. `connectWall` updates the segment
 *     *and* each neighbour, so placing one piece fixes the seams on both sides
 *     without needing a second pass.
 *
 *  2. **Linked damage.** A wall is a chain: hitting one segment deals half the
 *     damage again to every adjacent segment. `linkedDamageHandled` is the
 *     re-entrancy guard — without it the second segment would bounce the damage
 *     back and the whole wall would take 2x from a single shell, which is the
 *     classic way to make walls useless.
 *
 * The reference reads `map.getObjectsOnTile(tile)`; here the world exposes
 * `objectsOnTile(tile)` and the same `(isBuilding() || isOverlay()) && name`
 * filter is applied verbatim.
 */
import { wallTypes } from '../map/wallTypes';

/** How the world answers the two map queries the trait needs. */
export interface WallWorld {
    /** every object standing on a tile, in draw order */
    objectsOnTile(tile: any): any[];
    getTile(rx: number, ry: number): any | undefined;
    /**
     * The four cardinal neighbours of a tile.
     *
     * The reference builds a `CardinalTileFinder` here; the project already has
     * `TileCollection.getAllNeighbourTiles`, so the world supplies the list.
     */
    neighbourTiles(tile: any): any[];
    landTypeOf(tile: any): number;
    /** `LandType.Wall` — passed in so the trait does not import the enum twice */
    wallLandType: number;
    /** `map.destroyObject(wall, source)` for a segment that linked damage killed */
    destroyObject(wall: any, source: any): void;
    inflictsDamage(wall: any, amount: number, source: any): void;
}

export class WallTrait {
    private linkedDamageHandled = false;
    private wallType = 0;

    getWallType(): number {
        return this.wallType;
    }

    setWallType(type: number): void {
        this.wallType = type;
    }

    /** NotifySpawn.onSpawn */
    onSpawn(gameObject: any, world: WallWorld): void {
        if (gameObject.isBuilding()) {
            this.connectWall(gameObject, world);
        } else {
            this.wallType = gameObject.value ?? 0;
        }
    }

    /** NotifyUnspawn.onUnspawn */
    onUnspawn(gameObject: any, world: WallWorld): void {
        this.updateAdjacentWalls(gameObject, world);
    }

    /** NotifyDamage.onDamage */
    onDamage(gameObject: any, world: WallWorld, damage: number, source: any): void {
        if (!this.linkedDamageHandled) {
            const linkedDamage = Math.floor(damage / 2);
            if (linkedDamage) {
                for (const tile of world.neighbourTiles(gameObject.tile)) {
                    if (world.landTypeOf(tile) === world.wallLandType) {
                        const wall = world
                            .objectsOnTile(tile)
                            .find((obj: any) => (obj.isBuilding?.() || obj.isOverlay?.()) && obj.wallTrait);
                        if (wall) {
                            wall.wallTrait.linkedDamageHandled = true;
                            world.inflictsDamage(wall, linkedDamage, source);
                            wall.wallTrait.linkedDamageHandled = false;
                            if (!wall.healthTrait.health) {
                                world.destroyObject(wall, source);
                            }
                        }
                    }
                }
            }
        }
    }

    private updateAdjacentWalls(gameObject: any, world: WallWorld): void {
        for (const tile of world.neighbourTiles(gameObject.tile)) {
            const wall = world
                .objectsOnTile(tile)
                .find((obj: any) => (obj.isBuilding?.() || obj.isOverlay?.()) && obj.name === gameObject.rules?.name);
            if (wall) {
                this.connectWall(wall, world);
            }
        }
    }

    private connectWall(wall: any, world: WallWorld): void {
        const adjacentData = this.getAdjacentWallData(wall.tile, wall.name, world);
        this.updateWallType(wall, adjacentData.map((data) => data.direction));
        adjacentData.forEach((data) => {
            const adjacentWallData = this.getAdjacentWallData(data.tile, data.wall.name, world);
            this.updateWallType(data.wall, adjacentWallData.map((d) => d.direction));
        });
    }

    private updateWallType(wall: any, directions: number[][]): void {
        const connections = [0, 0, 0, 0];
        for (const dir of directions) {
            if (dir[0] === 0 && dir[1] === -1) connections[0] = 1;
            if (dir[0] === 1 && dir[1] === 0) connections[1] = 1;
            if (dir[0] === 0 && dir[1] === 1) connections[2] = 1;
            if (dir[0] === -1 && dir[1] === 0) connections[3] = 1;
        }
        const wallType = this.findWallType(connections);
        if (wall.wallTrait) wall.wallTrait.wallType = wallType;
        if (wall.isOverlay?.()) {
            wall.value = wallType;
        }
    }

    private findWallType(connections: number[]): number {
        for (let i = 0; i < wallTypes.length; ++i) {
            const type = wallTypes[i];
            if (
                type[0] === connections[0] &&
                type[1] === connections[1] &&
                type[2] === connections[2] &&
                type[3] === connections[3]
            ) {
                return i;
            }
        }
        return 0;
    }

    private getAdjacentWallData(tile: any, wallName: string, world: WallWorld): Array<{ direction: number[]; tile: any; wall: any }> {
        const adjacentWalls: Array<{ direction: number[]; tile: any; wall: any }> = [];
        const directions = [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
        ];
        for (const dir of directions) {
            const adjacentTile = world.getTile(tile.rx + dir[0], tile.ry + dir[1]);
            if (adjacentTile) {
                const wall = world
                    .objectsOnTile(adjacentTile)
                    .find((obj: any) => (obj.isBuilding?.() || obj.isOverlay?.()) && obj.name === wallName);
                if (wall) {
                    adjacentWalls.push({ direction: dir, tile: adjacentTile, wall });
                }
            }
        }
        return adjacentWalls;
    }
}
