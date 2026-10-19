/**
 * MoveTrait — port of
 *   redalert2/src/game/gameobject/trait/MoveTrait.ts
 *
 * The four-state machine (Idle → ReachedNextWaypoint → PlanMove → Moving) is
 * the backbone of the reference's movement: collision is *planned* while in
 * PlanMove, then the unit simply drives in Moving. Nothing here pushes units
 * around; `MoveTask` decides.
 */
import { Vec2 } from './Math2';
import { PathNode } from './Passability';
import { TileOccupation } from './TileOccupation';

export enum MoveState {
    Idle = 0,
    ReachedNextWaypoint = 1,
    PlanMove = 2,
    Moving = 3,
}

export enum MoveResult {
    Success = 0,
    Cancel = 1,
    CloseEnough = 2,
    Fail = 3,
}

export enum CollisionState {
    Waiting = 0,
    Resolved = 1,
}

export const TICK = 1 / 60;

export class MoveTrait {
    /** set by Unit/Owner construction */
    gameObject: any;
    private tileOccupation: TileOccupation;

    disabled = false;
    speedPenalty = 0;
    velocity = new Vec2();
    reservedPathNodes: PathNode[] = [];
    moveState: MoveState = MoveState.Idle;
    collisionState: CollisionState = CollisionState.Resolved;
    locomotor?: any;
    currentWaypoint?: any;
    lastTargetOffset?: Vec2;
    lastVelocity?: Vec2;
    lastMoveResult?: MoveResult;
    lastTileSpeed = 1;

    /** called after the unit enters a new cell (crush, fog, dust …) */
    onTileChange: ((oldTile: any, newTile: any) => void) | null = null;

    constructor(gameObject: any, tileOccupation: TileOccupation) {
        this.gameObject = gameObject;
        this.tileOccupation = tileOccupation;
    }

    /** px per second (the reference's leptons per tick were integer-floored) */
    get baseSpeed(): number {
        const obj = this.gameObject;
        const healthPenalty = obj.isVehicle?.() && obj.hp <= obj.maxHp * 0.5 ? 0.75 : 1;
        return obj.def.speed * healthPenalty * (1 - this.speedPenalty);
    }

    isDisabled(): boolean {
        return this.disabled;
    }

    setDisabled(disabled: boolean): void {
        this.disabled = disabled;
    }

    isMoving(): boolean {
        return this.moveState === MoveState.Moving;
    }

    isIdle(): boolean {
        return this.moveState === MoveState.Idle;
    }

    isWaiting(): boolean {
        return this.collisionState === CollisionState.Waiting;
    }

    resetIdle(): void {
        this.velocity.set(0, 0);
        this.moveState = MoveState.Idle;
        this.locomotor = undefined;
    }

    /**
     * The cell-entry hook: occupation bookkeeping + the reference's crush pass.
     * `teleporting` suppresses friendly-fire crush (a chrono jump is not a ram).
     */
    handleTileChange(oldTile: any, bridge: any, teleporting: boolean, isTeleport = false): void {
        const obj = this.gameObject;
        /*
         * Units cover exactly one cell, so the single-tile API is enough and —
         * unlike occupyTileRange — it does not allocate a tile array nor fire
         * the "passability changed" event on every cell crossing.
         */
        this.tileOccupation.unoccupySingleTile(oldTile, obj);
        this.tileOccupation.occupySingleTile(obj.tile, obj);

        // reserved path nodes that are now behind us must be released, or other
        // units keep treating already-driven cells as claimed forever
        const nodeIndex = this.reservedPathNodes.findIndex((node) => node.tile === obj.tile);
        if (nodeIndex !== -1) this.reservedPathNodes.splice(nodeIndex, 1);

        this.onTileChange?.(oldTile, obj.tile);
    }

    unreservePathNodes(): void {
        for (const node of this.reservedPathNodes) {
            if (node.tile !== this.gameObject.tile) this.tileOccupation.unoccupySingleTile(node.tile, this.gameObject);
        }
        this.reservedPathNodes.length = 0;
    }
}
