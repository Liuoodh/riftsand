/**
 * The slice of the world the harvester tasks need.
 *
 * This mirrors the reference's `game.map.*` calls (terrain, tiles, mapBounds,
 * tileOccupation) plus the three retail `[General]` values. Keeping it explicit
 * means the tasks contain no `any`-shaped guesses about Game internals.
 */
import type { Tile, TileCollection } from '../../map/TileCollection';
import type { MapBounds } from '../../map/MapBounds';
import type { TileOccupation } from '../../map/TileOccupation';
import { SimWorld } from '../../World';

export interface MoveTarget {
    tile: Tile;
    onBridge?: any;
}

export interface HarvestWorld extends SimWorld {
    tiles: TileCollection;
    mapBounds: MapBounds;
    tileOccupation: TileOccupation;

    general: {
        /** CloseEnough, in cells */
        closeEnough: number;
        /** HarvesterTooFarDistance, in cells */
        harvesterTooFarDistance: number;
    };

    /** per-bail credit value, used to tell ore from gems */
    gemValue: number;

    isOreTile(tile: Tile): boolean;
    /** credits contained in one bail on this tile (0 = no ore) */
    oreValueAt(tile: Tile): number;
    /** Removes one bail and returns its credit value (0 = nothing there). */
    collectBail(tile: Tile): number;

    hasRefinery(unit: any): boolean;
    /** nearest reachable refinery, already filtered by dock availability */
    findRefinery(unit: any): any | undefined;
    /** the pad cell a harvester drives onto to unload */
    refineryDockTile(refinery: any): Tile | undefined;
    /** credits += ore, clears the cargo, plays the unload feedback */
    deliverOre(unit: any, refinery: any): void;

    createGatherTask(unit: any, target?: Tile, explicit?: boolean): any;
    createReturnTask(unit: any, forceTarget?: any): any;

    /** Chebyshev/octile cell distance, the reference's RangeHelper */
    tileDistance(a: Tile, b: Tile): number;

    /**
     * Reference `world.afterTick`. Deferred work queued during a spawn or a
     * tick callback; HarvesterTrait.onSpawn uses it so the very first
     * GatherOreTask is not pushed while the task loop is still iterating.
     */
    afterTick?(fn: () => void): void;
}
