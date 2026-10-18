/**
 * Tile occupation table — port of
 *   redalert2/src/game/map/TileOccupation.ts
 *
 * This table, not geometry, is what the reference calls a "collision": a cell
 * holds one building, one vehicle, or up to three infantry on distinct
 * sub-cells. `MoveTask` asks this table (`findObstacles`, `canStopAtTile`) and
 * decides to wait / push aside / re-path. There is no per-frame shoving.
 */

import { isBuildingObject } from './Constants';
import { TileCollection } from './Tiles';

export interface Occupant {
    tile: any;
    onBridge?: boolean;
    isBuilding?: any;
    isUnit(): boolean;
    isInfantry(): boolean;
    isAircraft(): boolean;
    isTerrain(): boolean;
    isOverlay(): boolean;
    isVehicle(): boolean;
    dead?: boolean;
    isDestroyed?: boolean;
    position?: any;
    [key: string]: any;
}

export class TileOccupation {
    private cells: Array<Set<Occupant> | null>;
    readonly size: number;
    /** fired with the affected tiles whenever something starts/stops blocking */
    onChange: ((tiles: any[], object: Occupant) => void) | null = null;

    constructor(size: number, private tiles?: TileCollection) {
        this.size = size;
        this.cells = new Array(size * size).fill(null);
    }

    private idx(tx: number, ty: number) {
        return ty * this.size + tx;
    }

    inside(tx: number, ty: number) {
        return tx >= 0 && ty >= 0 && tx < this.size && ty < this.size;
    }

    occupySingleTile(tile: any, obj: Occupant): void {
        if (!tile || !this.inside(tile.rx, tile.ry)) return;
        const i = this.idx(tile.rx, tile.ry);
        let set = this.cells[i];
        if (!set) {
            set = new Set();
            this.cells[i] = set;
        }
        set.add(obj);
    }

    unoccupySingleTile(tile: any, obj: Occupant): void {
        if (!tile || !this.inside(tile.rx, tile.ry)) return;
        const i = this.idx(tile.rx, tile.ry);
        const set = this.cells[i];
        if (!set) return;
        set.delete(obj);
        if (set.size === 0) this.cells[i] = null;
    }

    /** reference: occupyTileRange — a building covers its whole foundation */
    occupyTileRange(tile: any, obj: Occupant): void {
        const tiles = this.calculateTilesForGameObject(tile, obj);
        for (const t of tiles) this.occupySingleTile(t, obj);
        this.onChange?.(tiles, obj);
    }

    unoccupyTileRange(tile: any, obj: Occupant): void {
        const tiles = this.calculateTilesForGameObject(tile, obj);
        for (const t of tiles) this.unoccupySingleTile(t, obj);
        this.onChange?.(tiles, obj);
    }

    calculateTilesForGameObject(tile: any, obj: Occupant): any[] {
        if (!tile) return [];
        if (!isBuildingObject(obj)) return [tile];
        const size = obj.art?.foundation?.width ?? obj.size ?? 1;
        const height = obj.art?.foundation?.height ?? obj.size ?? 1;
        const out: any[] = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < size; x++) {
                const t = this.tiles?.getByMapCoords(tile.rx + x, tile.ry + y) ?? (x === 0 && y === 0 ? tile : undefined);
                if (t) out.push(t);
            }
        }
        return out.length ? out : [tile];
    }

    getObjectsOnTile(tile: any): Occupant[] {
        if (!tile || !this.inside(tile.rx, tile.ry)) return [];
        const set = this.cells[this.idx(tile.rx, tile.ry)];
        // NOTE: Array.from, not [...set] — the Cocos rollup runs Babel in loose
        // mode where a spread of a Set compiles to [].concat(set) = [Set].
        return set ? Array.from(set) : [];
    }

    /** everything except aircraft — the reference's ground-layer queries */
    getGroundObjectsOnTile(tile: any): Occupant[] {
        return this.getObjectsOnTile(tile).filter((obj) => !obj.isAircraft?.());
    }

    /* ---- helpers used by the probe scripts / debug UI ---- */

    remove(obj: Occupant, tx: number, ty: number): void {
        const tile = this.tiles?.getByMapCoords(tx, ty);
        if (tile) this.unoccupySingleTile(tile, obj);
    }

    at(tx: number, ty: number): Set<Occupant> | null {
        const tile = this.tiles?.getByMapCoords(tx, ty);
        if (!tile) return null;
        const list = this.getObjectsOnTile(tile);
        return list.length ? new Set(list) : null;
    }

    fillAt(tx: number, ty: number): number {
        const set = this.at(tx, ty);
        if (!set) return 0;
        let n = 0;
        for (const o of set) n += o.isInfantry?.() ? 1 / 3 : 1;
        return n;
    }

    /** can this unit stand on the cell at all (capacity only, no passability) */
    hasRoomFor(u: Occupant, tx: number, ty: number): boolean {
        const set = this.at(tx, ty);
        if (!set) return true;
        const infantry = u.isInfantry?.() ?? false;
        let men = 0;
        let vehicles = 0;
        for (const o of set) {
            if (o === u) continue;
            if (o.isInfantry?.()) men++;
            else if (o.isUnit?.()) vehicles++;
        }
        return infantry ? men < 3 && vehicles === 0 : vehicles === 0;
    }

    clear(): void {
        for (let i = 0; i < this.cells.length; i++) this.cells[i] = null;
    }
}
