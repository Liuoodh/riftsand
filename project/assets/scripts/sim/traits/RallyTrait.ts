/**
 * Port of redalert2/src/game/gameobject/trait/RallyTrait.ts.
 *
 * A rally point is stored as a *tile*, never as a pixel position, and it is
 * re-validated when it is set: a point inside a rock or on top of a building
 * would make the produced unit immediately stuck, so the finder walks outward
 * up to 20 cells and takes the first legal one.
 */
import { RadialTileFinder } from '../Tiles';
import { SpeedType } from '../type/SpeedType';

export class RallyTrait {
    private rallyPoint: any;

    getRallyPoint(): any {
        return this.rallyPoint;
    }

    changeRallyPoint(targetTile: any, gameObject: any, world: any): void {
        const validPoint = this.findValidRallyPoint(gameObject, targetTile, world);
        if (validPoint) this.rallyPoint = validPoint;
    }

    findValidRallyPoint(gameObject: any, targetTile: any, world: any): any {
        const finder = new RadialTileFinder(
            world.tiles,
            world.mapBounds,
            targetTile,
            { width: 1, height: 1 },
            0,
            20,
            (tile: any) =>
                !world.tileOccupation.getGroundObjectsOnTile(tile).some((obj: any) => obj.isBuilding && !obj.dead) &&
                world.passability.getPassableSpeed(tile, gameObject?.rules?.speedType ?? SpeedType.Track, false) > 0,
        );
        return finder.getNextTile();
    }

    /** the cell a produced unit should drive to, never inside a footprint */
    findRallyPointforUnit(unit: any, targetTile: any, world: any, checkBuildings: boolean, targetElevation?: number): any {
        const finder = new RadialTileFinder(
            world.tiles,
            world.mapBounds,
            targetTile,
            { width: 1, height: 1 },
            0,
            5,
            (tile: any) =>
                world.passability.findObstacles({ tile, onBridge: undefined }, unit).length === 0 &&
                (targetElevation === undefined || Math.abs(targetElevation - tile.z) < 4) &&
                (!checkBuildings ||
                    !world.tileOccupation.getGroundObjectsOnTile(tile).some((obj: any) => obj.isBuilding && !obj.dead)) &&
                world.passability.getPassableSpeed(tile, unit.rules.speedType, unit.isInfantry(), false) > 0,
        );
        return finder.getNextTile() ?? targetTile;
    }

    findRallyNodeForUnit(unit: any, world: any): any {
        if (!this.rallyPoint) return undefined;
        const tile = this.findRallyPointforUnit(unit, this.rallyPoint, world, true);
        return { tile, onBridge: undefined };
    }
}
