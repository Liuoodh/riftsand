/**
 * Port of redalert2/src/game/gameobject/task/move/MoveInsideTask.ts (34 lines).
 *
 * Walk *into* a structure — used by `EnterBuildingTask`-style flows where the
 * destination is the building's own footprint and the unit is allowed to stand
 * on a tile the building occupies.
 *
 * `chooseTargetFoundationTile` exists for buildings whose foundation hangs off
 * the map edge: `centerTile` can be outside `mapBounds`, and pathfinding to an
 * out-of-bounds tile returns an empty path, which reads as "unreachable" rather
 * than "already there". It falls back to the first in-bounds foundation tile.
 *
 * `canStopAtTile` is quoted verbatim even though it degenerates:
 *   (!A || !B) && !(!A && !B)  ≡  A XOR B   (A = cancelling, B = occupied)
 * With the normal non-cancelling path that is `isOccupied`, which is what the
 * caller wants; only cancel-while-standing-on-the-target behaves oddly, and
 * `MoveTask`'s cancel-reposition branch covers that. Kept as written because
 * "simplifying" it to `isOccupied` would change cancel behaviour.
 */
import { MoveTask } from './MoveTask';

export class MoveInsideTask extends MoveTask {
    private target: any;

    static chooseTargetFoundationTile(target: any, game: any) {
        if (target.isBuilding()) {
            let tile = target.centerTile;
            if (!game.map.mapBounds.isWithinBounds(tile)) {
                tile =
                    game.map.tileOccupation
                        .calculateTilesForGameObject(target.tile, target)
                        .find((tile: any) => game.map.mapBounds.isWithinBounds(tile)) ?? target.tile;
            }
            return tile;
        }
        return target.tile;
    }

    constructor(game: any, target: any) {
        super(game, MoveInsideTask.chooseTargetFoundationTile(target, game), false, {
            ignoredBlockers: [target],
            closeEnoughTiles: 0,
        });
        this.target = target;
    }

    hasReachedDestination(unit: any): boolean {
        return super.hasReachedDestination(unit) || this.canStopAtTile(unit, unit.tile, unit.onBridge);
    }

    canStopAtTile(unit: any, tile: any, onBridge: any): boolean {
        const isOccupied = this.game.map.tileOccupation.isTileOccupiedBy(tile, this.target);
        return (!this.isCancelling() || !isOccupied) && !(!this.isCancelling() && !isOccupied);
    }

    isCloseEnoughToDest(unit: any, tile: any, onBridge: any): boolean {
        return this.game.map.tileOccupation.isTileOccupiedBy(tile, this.target);
    }
}
