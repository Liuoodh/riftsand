/**
 * Map layer — cells, bounds, passability, bridges, shroud.
 *
 * Reference: `redalert2/src/game/map/**` (21 files, 2,863 lines).
 *
 * File-by-file correspondence:
 *
 *   TileCollection.ts          TileCollection.ts
 *   Tile.ts                    Tile.ts
 *   MapBounds.ts               MapBounds.ts
 *   TileOccupation.ts          TileOccupation.ts
 *   TileOcclusion.ts           TileOcclusion.ts
 *   Terrain.ts                 Terrain.ts
 *   Bridges.ts                 Bridges.ts
 *   MapShroud.ts               MapShroud.ts
 *   OreSpread.ts               OreSpread.ts
 *   wallTypes.ts               wallTypes.ts
 *   BridgeOverlayTypes.ts      BridgeOverlayTypes.ts     (B3)
 *   OreOverlayTypes.ts         OreOverlayTypes.ts        (B3)
 *   tileFinder/*.ts            tileFinder/*.ts           (6 finders)
 *   pathFinder/*.ts            merged into ../Graph.ts   (PathFinder + NodeHeap +
 *                                                         SearchStatePool)
 */
export { TileCollection, TileDirection } from './TileCollection';
export type { Tile, TileData } from './TileCollection';
export { MapBounds } from './MapBounds';
export { TileOccupation, LayerType } from './TileOccupation';
export { TileOcclusion } from './TileOcclusion';
export { Terrain } from './Terrain';
export type { PathNode, PathOptions, Obstacle } from './Terrain';
export { Bridges, BridgeHeadType } from './Bridges';
export type { BridgePiece, BridgeSpec } from './Bridges';
export { MapShroud, ShroudType, ShroudFlag } from './MapShroud';
export { OreSpread } from './OreSpread';
export { wallTypes } from './wallTypes';
