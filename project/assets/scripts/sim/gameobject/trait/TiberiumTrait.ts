import { OreOverlayTypes } from '../../map/OreOverlayTypes';
import { OverlayTibType } from '../../type/OverlayTibType';
import { TiberiumType } from '../../type/TiberiumType';
import { LandType } from '../../type/LandType';

/**
 * Verbatim from redalert2/src/game/gameobject/trait/TiberiumTrait.ts.
 *
 * An ore cell stores `value` in `[-1, 10]`, where `value` is *bails minus one*.
 * Hence `maxBails = 11` and `getBailCount() = value + 1`. The `-1` floor is the
 * "this cell is exhausted but not yet removed" state: `removeBails` clamps to
 * `-1` and `getBailCount()` then returns 0, which is exactly what
 * `AnimTerrainEffect.destroyOre` tests before unspawning the overlay.
 *
 * `collectBail` returns `undefined` on the last bail — the harvester's cargo
 * loop uses that `undefined` to know the cell is now empty, so returning a type
 * here would make a harvester loop forever on a dead cell.
 */
export class TiberiumTrait {
    static maxBails: number = 11;

    private gameObject: any;

    constructor(gameObject: any) {
        this.gameObject = gameObject;
    }

    static canBePlacedOn(tile: any, world: any): boolean {
        return (
            [LandType.Clear, LandType.Road, LandType.Rough].includes(tile.landType) &&
            !world.getGroundObjectsOnTile(tile).find((obj: any) => !obj.isSmudge() && !obj.isUnit())
        );
    }

    getTiberiumType(): TiberiumType {
        const overlayTibType = OreOverlayTypes.getOverlayTibType(this.gameObject.overlayId);
        switch (overlayTibType) {
            case OverlayTibType.Ore:
                return TiberiumType.Ore;
            case OverlayTibType.Gems:
                return TiberiumType.Gems;
            case OverlayTibType.Vinifera:
                return TiberiumType.Ore;
            default:
                throw new Error(`Unsupported tiberium type ${overlayTibType}`);
        }
    }

    collectBail(): TiberiumType | undefined {
        const bailCount = this.getBailCount();
        if (bailCount <= 0) {
            throw new Error('Attempted to collect an ore bail, but there are none left');
        }
        this.gameObject.value--;
        return bailCount > 1 ? this.getTiberiumType() : undefined;
    }

    spawnBails(count: number): void {
        this.gameObject.value = Math.min(TiberiumTrait.maxBails, this.gameObject.value + count);
    }

    removeBails(count: number): void {
        this.gameObject.value = Math.max(-1, this.gameObject.value - count);
    }

    getBailCount(): number {
        return this.gameObject.value + 1;
    }

    dispose(): void {
        this.gameObject = undefined;
    }
}
