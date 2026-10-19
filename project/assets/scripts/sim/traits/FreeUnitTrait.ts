/**
 * Port of redalert2/src/game/gameobject/trait/FreeUnitTrait.ts.
 *
 * A structure that comes with a free vehicle: the moment the buildup animation
 * finishes (`BuildStatus.BuildUp -> Ready`) one unit is placed on the ring
 * around the footprint. The reference walks the ring *backwards* from the
 * building (`RadialBackFirstTileFinder`), skipping overlays so the free unit
 * does not land on ore, and falls back to the first merely-passable tile when
 * every candidate is covered.
 *
 * If no tile can be found the unit is refunded rather than silently dropped —
 * that is the reference's `failed to find spawn tile` branch and it matters,
 * because losing a free MCV to a crowded base would be unrecoverable.
 */
export interface FreeUnitWorld {
    /** does this building produce a free unit at all, and which one */
    freeUnitTypeFor(building: any): string | undefined;
    /** is the type a vehicle (checked first) or infantry */
    isVehicleType(type: string): boolean;
    isInfantryType(type: string): boolean;
    createUnit(type: string, player: any): any;
    /** reference `RadialBackFirstTileFinder(...).getNextTile()`, plus the passable fallback */
    findSpawnTile(building: any, unit: any): any | undefined;
    spawnObject(obj: any, tile: any): void;
    /** refund when the spawn failed: `owner.credits += unit.purchaseValue` */
    refund(player: any, unit: any): void;
    isNeutral(player: any): boolean;
    log(message: string): void;
}

export class FreeUnitTrait {
    /** NotifyBuildStatus.onStatusChange */
    onStatusChange(oldStatus: number, building: any, world: FreeUnitWorld, readyStatus: number, buildUpStatus: number): void {
        if (building.buildStatus !== readyStatus || oldStatus !== buildUpStatus) return;
        if (world.isNeutral(building.player ?? building.owner)) return;

        const type = world.freeUnitTypeFor(building);
        if (!type) return;
        if (!world.isVehicleType(type) && !world.isInfantryType(type)) {
            world.log(`Free unit "${type}" is not a vehicle or infantry type.`);
            return;
        }

        const unit = world.createUnit(type, building.player ?? building.owner);
        if (!unit) return;
        const spawnTile = world.findSpawnTile(building, unit);
        if (!spawnTile) {
            world.refund(building.player ?? building.owner, unit);
            world.log(`[FreeUnitTrait] failed to find spawn tile for "${unit.name}" from "${building.name}"#${building.id}`);
            return;
        }
        world.spawnObject(unit, spawnTile);
    }
}
