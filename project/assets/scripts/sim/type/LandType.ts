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
    Cliff = 10
}

/**
 * Our theatre vocabulary -> LandType.
 *
 * The reference reads the engine's TerrainType (a tile-art property) and throws
 * on anything unknown. We generate terrain procedurally, so the mapping lives
 * here and every kind we can emit has a LandType.
 */
import { TileKind } from '../../world/Terrain';

const terrainToLandTypeMap = new Map<TileKind, LandType>([
    [TileKind.Sand, LandType.Clear],
    [TileKind.Dune, LandType.Rough],
    [TileKind.Rock, LandType.Rock],
    [TileKind.Crystal, LandType.Tiberium],
    [TileKind.Road, LandType.Road],
    [TileKind.Water, LandType.Water],
]);

export function getLandType(terrainType: TileKind, solidify = false): LandType {
    if (solidify) return LandType.Cliff;
    const mapped = terrainToLandTypeMap.get(terrainType);
    if (mapped === undefined) throw new Error(`Unknown terrain type ${terrainType}`);
    return mapped;
}
