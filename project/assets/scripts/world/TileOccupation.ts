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

    /**
     * Can `u` enter this cell?
     *
     * Reference: MoveTask.canStopAtTile() rejects a cell when two other infantry
     * already stand on it, or when the infantry would land on an occupied
     * sub-cell. Vehicles are not counted there at all; we additionally refuse to
     * let infantry walk into a cell a vehicle is parked on, and refuse to let a
     * vehicle into a cell another vehicle occupies. Infantry caught under a
     * vehicle are scattered by the caller (reference: ScatterTask).
     */
    hasRoomFor(u: Unit, tx: number, ty: number) {
        if (!this.inside(tx, ty)) return false;
        const set = this.cells[this.idx(tx, ty)];
        if (!set) return true;
        const isInfantry = u.def.kind === 'infantry';
        let infantry = 0;
        let vehicles = 0;
        for (const o of set) {
            if (o === u || o.dead) continue;
            if (o.def.kind === 'infantry') infantry++;
            else vehicles++;
        }
        if (isInfantry) return infantry < 3 && vehicles === 0;
        /*
         * Two harvesters may share a cell while docking.
         *
         * They are civilians working the same field and the same refinery apron;
         * with strict one-per-cell they lock nose to nose in a one-cell lane and
         * neither ever mines (measured: income 0 for a whole match). Retail
         * harvesters visibly overlap while unloading, so the looseness is
         * faithful as well as necessary.
         */
        if (u.isHarvester) {
            let harvesters = 0;
            for (const o of set) {
                if (o === u || o.dead) continue;
                if (o.isHarvester) harvesters++;
            }
            return harvesters < 2;
        }
        return vehicles === 0;
    }

    /** infantry sharing a cell get distinct sub-positions, 0..2 */
    claimSubCell(u: Unit, tx: number, ty: number) {
        const set = this.cells[this.idx(tx, ty)];
        if (!set) return 0;
        const used = [false, false, false];
        for (const o of set) {
            if (o === u || o.dead) continue;
            if (o.def.kind !== 'infantry') continue;
            const c = (o as any).subCell as number;
            if (c >= 0 && c < 3) used[c] = true;
        }
        for (let i = 0; i < 3; i++) if (!used[i]) return i;
        return 0;
    }

    clear() {
        for (let i = 0; i < this.cells.length; i++) {
            if (this.cells[i]) this.cells[i]!.clear();
        }
        this.fill.fill(0);
    }
}
