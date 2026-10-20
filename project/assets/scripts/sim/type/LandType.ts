/**
 * Land class of a tile — what the speed table is keyed by.
 *
 * Reference: redalert2/src/game/type/LandType.ts (verbatim).
 *
 * Two things in the reference are easy to miss and are preserved here:
 *
 *   - `getLandType` **throws** on an unknown terrain type. It is not a lookup
 *     with a fallback: a tile whose art says `Default` maps to `Clear`, but a
 *     tile with no recognised art at all is a data bug and must be loud.
 *   - `LandType.Wall` and `LandType.Tiberium` are never produced by this
 *     mapping. They exist only as *overlay* land types, assigned later by
 *     `TileOccupation.computeTileLandType` when a wall or an ore field occupies
 *     the cell. A generator that writes `Tiberium` straight into the terrain is
 *     modelling ore as ground, which is exactly the confusion this split
 *     exists to prevent.
 */
import { TerrainType } from './TerrainType';

export enum LandType {
    Clear = 0,
    Road = 1,
    Rock = 2,
    Beach = 3,
    Rough = 4,
    Railroad = 5,
    Weeds = 6,
    Water = 7,
    Wall = 8,
    Tiberium = 9,
    Cliff = 10,
}

const terrainToLandTypeMap = new Map<TerrainType, LandType>([
    [TerrainType.Default, LandType.Clear],
    [TerrainType.Clear, LandType.Clear],
    [TerrainType.Tunnel, LandType.Cliff],
    [TerrainType.Railroad, LandType.Railroad],
    [TerrainType.Rock1, LandType.Rock],
    [TerrainType.Rock2, LandType.Rock],
    [TerrainType.Water, LandType.Water],
    [TerrainType.Shore, LandType.Beach],
    [TerrainType.Pavement, LandType.Road],
    [TerrainType.Dirt, LandType.Road],
    [TerrainType.Rough, LandType.Rough],
    [TerrainType.Cliff, LandType.Cliff],
]);

export function getLandType(terrainType: TerrainType): LandType {
    if (!terrainToLandTypeMap.has(terrainType)) {
        throw new Error(`Unknown terrain type ${terrainType}`);
    }
    return terrainToLandTypeMap.get(terrainType)!;
}
