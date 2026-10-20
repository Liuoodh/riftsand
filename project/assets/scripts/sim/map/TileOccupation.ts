/**
 * Who occupies which cell — and, because of that, what the cell *is*.
 *
 * Reference: redalert2/src/game/map/TileOccupation.ts (162 lines).
 *
 * This class does two jobs that look unrelated and are not:
 *
 *   1. A per-cell `Set` of occupants, so `getObjectsOnTile` is O(1) and a
 *      building's footprint marks every covered cell.
 *   2. `landType` recomputation. A cell's land class is *derived*, not stored:
 *      `TileCollection` seeds it from the terrain art, and every time an
 *      occupant is added or removed this class recomputes it. A wall overlay
 *      makes the cell `Wall` (impassable, not a speed penalty — a *class*
 *      change), an ore overlay makes it `Tiberium` (slower), and removing them
 *      restores the ground class.
 *
 * Point 2 is why `Tile.landType` must never be written anywhere else. Moving a
 * harvester off an ore field has to restore the cell to `Clear` or the next
 * vehicle drives through at ore speed forever.
 *
 * The priority order in `computeTileLandType` is copied exactly: wall beats
 * tiberium beats a plain overlay's `Land` value beats the terrain. An overlay
 * that is a bridge or a bridge placeholder is skipped entirely here — bridges
 * live on the *bridge* layer, reported by `computeOnBridgeLandType`.
 */
import { LandType, getLandType } from '../type/LandType';
import { EventDispatcher } from '../util/event';
import { ZoneType, getZoneType } from '../gameobject/unit/ZoneType';

export enum LayerType {
    All = 0,
    Ground = 1,
    Air = 2,
}

export interface TileOccupationUpdateEvent {
    tiles: any[];
    object: any;
    type: 'added' | 'removed';
}

export class TileOccupation {
    private tiles: any;
    private tileOccupation: Set<any>[][];
    private emptyTiles: Set<any>;
    private _onChange: EventDispatcher<TileOccupation, TileOccupationUpdateEvent>;

    get onChange() {
        return this._onChange.asEvent();
    }

    constructor(tiles: any) {
        this.tiles = tiles;
        this.tileOccupation = [];
        this.emptyTiles = new Set();
        this._onChange = new EventDispatcher<TileOccupation, TileOccupationUpdateEvent>();

        const occupation = this.tileOccupation;
        for (const tile of tiles.getAll()) {
            occupation[tile.rx] = occupation[tile.rx] || [];
            occupation[tile.rx][tile.ry] = new Set();
            this.emptyTiles.add(tile);
        }
    }

    occupyTileRange(pos: any, obj: any) {
        const tiles = this.calculateTilesForGameObject(pos, obj);
        tiles.forEach((tile) => this.occupyTile(tile, obj));
        this._onChange.dispatch(this, {
            tiles,
            object: obj,
            type: 'added',
        });
    }

    unoccupyTileRange(pos: any, obj: any) {
        const tiles = this.calculateTilesForGameObject(pos, obj);
        tiles.forEach((tile) => this.unoccupyTile(tile, obj));
        this._onChange.dispatch(this, {
            tiles,
            object: obj,
            type: 'removed',
        });
    }

    occupySingleTile(tile: any, obj: any) {
        this.occupyTile(tile, obj);
        this._onChange.dispatch(this, {
            tiles: [tile],
            object: obj,
            type: 'added',
        });
    }

    unoccupySingleTile(tile: any, obj: any) {
        this.unoccupyTile(tile, obj);
        this._onChange.dispatch(this, {
            tiles: [tile],
            object: obj,
            type: 'removed',
        });
    }

    calculateTilesForGameObject(pos: any, obj: any) {
        return this.tiles.getInRectangle(pos, obj.getFoundation());
    }

    occupyTile(tile: any, obj: any) {
        const occupation = this.tileOccupation[tile.rx]?.[tile.ry];
        if (occupation) {
            occupation.add(obj);
            this.emptyTiles.delete(tile);
            tile.landType = this.computeTileLandType(tile);
            tile.onBridgeLandType = this.computeOnBridgeLandType(tile);
        }
    }

    unoccupyTile(tile: any, obj: any) {
        const occupation = this.tileOccupation[tile.rx]?.[tile.ry];
        if (occupation) {
            occupation.delete(obj);
            if (!occupation.size) {
                this.emptyTiles.add(tile);
            }
            tile.landType = this.computeTileLandType(tile);
            tile.onBridgeLandType = this.computeOnBridgeLandType(tile);
        }
    }

    isTileOccupiedBy(tile: any, obj: any): boolean {
        return !!this.tileOccupation[tile.rx]?.[tile.ry]?.has(obj);
    }

    /**
     * Recompute a cell's land class from its occupants.
     *
     * `LandType.Rock` is an early-out: rock never becomes a wall or an ore
     * field, so a wall built on rock stays rock. That is not a shortcut — it is
     * what keeps cliff shadows impassable no matter what is placed on them.
     */
    computeTileLandType(tile: any): LandType {
        if (tile.landType === LandType.Rock) return LandType.Rock;

        const baseLandType = getLandType(tile.terrainType);
        for (const obj of this.tileOccupation[tile.rx]?.[tile.ry] ?? []) {
            if ((obj.isOverlay() || obj.isBuilding()) && obj.rules.wall) {
                return LandType.Wall;
            }
            if (obj.isOverlay() && obj.isTiberium()) {
                return LandType.Tiberium;
            }
            if (
                obj.isOverlay() &&
                obj.rules.land !== LandType.Clear &&
                !obj.isBridge() &&
                !obj.isBridgePlaceholder()
            ) {
                return obj.rules.land;
            }
        }
        return baseLandType;
    }

    /**
     * Land class of the *bridge* layer, or `undefined` when there is no bridge.
     *
     * A high bridge is always `Road` — not because the art looks like a road,
     * but because the deck is the only surface a vehicle can be on at that
     * height, and `Road` is the only class with no terrain penalties.
     */
    computeOnBridgeLandType(tile: any): LandType | undefined {
        for (const obj of this.tileOccupation[tile.rx]?.[tile.ry] ?? []) {
            if (obj.isOverlay() && obj.isBridge()) {
                return obj.isHighBridge() ? LandType.Road : obj.rules.land;
            }
        }
        return undefined;
    }

    getTileZone(tile: any, useBaseLandType: boolean = false): ZoneType {
        return getZoneType(useBaseLandType ? tile.landType : tile.onBridgeLandType ?? tile.landType);
    }

    getBridgeOnTile(tile: any) {
        for (const obj of this.tileOccupation[tile.rx]?.[tile.ry] ?? []) {
            if (obj.isOverlay() && obj.isBridge()) {
                return obj;
            }
        }
        return undefined;
    }

    getObjectsOnTile(tile: any): any[] {
        return Array.from(this.tileOccupation[tile.rx]?.[tile.ry] ?? []);
    }

    /**
     * Everything on the cell that physically sits on the ground.
     *
     * Aircraft in the air zone are excluded — a helicopter hovering over a
     * building does not block a tank from driving under it. Note the test is
     * `isTechno() && !isBuilding() && zone === Air`, not `isAircraft()`: a
     * landed aircraft has `zone === Ground` and *does* block.
     */
    getGroundObjectsOnTile(tile: any): any[] {
        const objects: any[] = [];
        for (const obj of this.tileOccupation[tile.rx]?.[tile.ry] ?? []) {
            if (!(obj.isTechno() && !obj.isBuilding() && obj.zone === ZoneType.Air)) {
                objects.push(obj);
            }
        }
        return objects;
    }

    getAirObjectsOnTile(tile: any): any[] {
        const objects: any[] = [];
        for (const obj of this.tileOccupation[tile.rx]?.[tile.ry] ?? []) {
            if (obj.isUnit() && obj.zone === ZoneType.Air) {
                objects.push(obj);
            }
        }
        return objects;
    }

    getObjectsOnTileByLayer(tile: any, layer: LayerType): any[] {
        switch (layer) {
            case LayerType.Ground:
                return this.getGroundObjectsOnTile(tile);
            case LayerType.Air:
                return this.getAirObjectsOnTile(tile);
            case LayerType.All:
                return this.getObjectsOnTile(tile);
            default:
                throw new Error(`Unhandled layer type "${layer}"`);
        }
    }

    getEmptyTiles(): any[] {
        /*
         * `Array.from`, never `[...set]`. The Cocos build runs Babel in loose
         * mode, where array spread compiles to `[].concat(x)` — correct for a
         * plain array, silently wrong for a Set or an iterator (it yields the
         * container itself as one element). Same rule for every `[...map
         * .keys()]` in this codebase.
         */
        return Array.from(this.emptyTiles);
    }
}
