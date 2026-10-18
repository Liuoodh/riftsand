/**
 * Position adapter — port of the movement-relevant half of
 *   redalert2/src/game/gameobject/ObjectPosition.ts
 *
 * The reference stores a tile + an offset inside it; this project stores a
 * world position. Both are the same number space (1 cell = 32 units), so the
 * adapter converts on the fly and fires the tile-change hook exactly when a
 * cell boundary is crossed — which is what drives occupation bookkeeping and
 * crush checks.
 */
import { Vec2 } from './Math2';
import { TileCollection } from './Tiles';
import { TILE, HALF } from '../core/Core';

export class Position {
    constructor(private u: any, private tiles: TileCollection) {}

    get tile() {
        return this.u.tile;
    }

    set tile(t: any) {
        this.u.tile = t;
    }

    /** leptons (= world px + HALF), identical to the reference's map position */
    getMapPosition(): Vec2 {
        return new Vec2(this.u.x + HALF, this.u.y + HALF);
    }

    get tileElevation(): number {
        return 0;
    }

    set tileElevation(_v: number) {
        /* no bridges / no elevation offsets in this game */
    }

    /** offset of the unit inside its cell, in px (0..32) */
    getTileOffset(): Vec2 {
        const lx = this.u.x + HALF;
        const ly = this.u.y + HALF;
        return new Vec2(lx - Math.floor(lx / TILE) * TILE, ly - Math.floor(ly / TILE) * TILE);
    }

    computeSubCellOffset(subCell: number): Vec2 {
        let width = 0;
        let height = 0;
        if (subCell) {
            const signX = ((subCell - 1) % 2) * 2 - 1;
            const signY = 2 * Math.floor((subCell - 1) / 2) - 1;
            width = (signX * TILE) / 4;
            height = (signY * TILE) / 4;
        }
        const half = TILE / 2;
        return new Vec2(half + width, half + height);
    }

    get subCell(): number {
        return this.u.subCell;
    }

    set subCell(v: number) {
        this.u.subCell = v;
        this.u.desiredSubCell = v;
    }

    get desiredSubCell(): number {
        return this.u.desiredSubCell;
    }

    set desiredSubCell(v: number) {
        this.u.desiredSubCell = v;
    }

    /** move by a delta in leptons, recomputing the cell and firing the hook */
    moveByLeptons(dx: number, dy: number, _allowOutOfBounds = false): void {
        const oldTile = this.u.tile;
        this.u.x += dx;
        this.u.y += dy;
        const lx = this.u.x + HALF;
        const ly = this.u.y + HALF;
        const rx = Math.floor(lx / TILE);
        const ry = Math.floor(ly / TILE);
        if (!oldTile || oldTile.rx !== rx || oldTile.ry !== ry) {
            const newTile = this.tiles.getByMapCoords(rx, ry) ?? oldTile;
            this.u.tile = newTile;
            if (newTile && newTile !== oldTile) {
                this.u.moveTrait.handleTileChange(oldTile, undefined, false, false);
            }
        }
    }

    moveByLeptons3(delta: { x: number; y: number }, allowOutOfBounds = false): void {
        this.moveByLeptons(delta.x, delta.y, allowOutOfBounds);
    }
}
