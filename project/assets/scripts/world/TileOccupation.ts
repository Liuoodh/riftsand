/**
 * Tile occupation table — the reference engine's answer to "who is standing here".
 *
 * Reference: redalert2/src/game/map/TileOccupation.ts
 *   `Set<GameObject>[]`, one bucket per cell; units register/unregister as they
 *   cross cell boundaries, and the game asks the table (not geometry) when it
 *   needs to know whether a cell is occupied.
 *
 * Why this exists at all, given we also have a geometric disc test:
 *   - crush is defined on the CELL TRANSITION, not on speed (reference:
 *     MoveTrait checks the new tile's occupants when it enters it), which needs a
 *     cheap "who is on this cell" query;
 *   - a squad standing on one cell has to be enumerable without an O(n) scan;
 *   - buildings and infantry sub-cell crowding become a data question rather
 *     than a special case in the movement code.
 *
 * Sub-cell note: infantry are allowed to share a cell (the retail engine gives a
 * cell three sub-positions). We keep a `passable` count per cell instead of
 * modelling sub-positions: infantry count 1/3 of a cell, vehicles a whole cell.
 */
import type { Unit } from '../game/Entities';

const INFANTRY_SHARE = 1 / 3;

export class TileOccupation {
    private cells: Array<Set<Unit> | null>;
    /** 0..1, how much of the cell is already taken */
    private fill: Float32Array;
    readonly size: number;

    constructor(size: number) {
        this.size = size;
        this.cells = new Array(size * size).fill(null);
        this.fill = new Float32Array(size * size);
    }

    inside(tx: number, ty: number) {
        return tx >= 0 && ty >= 0 && tx < this.size && ty < this.size;
    }

    private idx(tx: number, ty: number) {
        return ty * this.size + tx;
    }

    /** weight of one unit on its cell: infantry share, everything else is solid */
    static weightOf(u: Unit) {
        if (u.isAir) return 0;
        return u.def.kind === 'infantry' ? INFANTRY_SHARE : 1;
    }

    add(u: Unit, tx: number, ty: number) {
        if (!this.inside(tx, ty)) return;
        const i = this.idx(tx, ty);
        let set = this.cells[i];
        if (!set) { set = new Set(); this.cells[i] = set; }
        if (set.has(u)) return;
        set.add(u);
        this.fill[i] += TileOccupation.weightOf(u);
    }

    remove(u: Unit, tx: number, ty: number) {
        if (!this.inside(tx, ty)) return;
        const i = this.idx(tx, ty);
        const set = this.cells[i];
        if (!set || !set.has(u)) return;
        set.delete(u);
        this.fill[i] = Math.max(0, this.fill[i] - TileOccupation.weightOf(u));
        if (set.size === 0) this.cells[i] = null;
    }

    move(u: Unit, fromX: number, fromY: number, toX: number, toY: number) {
        if (fromX === toX && fromY === toY) return;
        this.remove(u, fromX, fromY);
        this.add(u, toX, toY);
    }

    at(tx: number, ty: number): Set<Unit> | null {
        if (!this.inside(tx, ty)) return null;
        return this.cells[this.idx(tx, ty)];
    }

    /** how crowded the cell is, 0 = empty, >=1 = a vehicle (or three infantry) */
    fillAt(tx: number, ty: number) {
        if (!this.inside(tx, ty)) return 1;
        return this.fill[this.idx(tx, ty)];
    }

    /** can another unit of this weight step onto the cell? */
    hasRoomFor(u: Unit, tx: number, ty: number) {
        const w = TileOccupation.weightOf(u);
        if (w >= 1) return this.fillAt(tx, ty) <= 0.001;
        return this.fillAt(tx, ty) + w <= 1.001;
    }

    clear() {
        for (let i = 0; i < this.cells.length; i++) {
            if (this.cells[i]) this.cells[i]!.clear();
        }
        this.fill.fill(0);
    }
}
