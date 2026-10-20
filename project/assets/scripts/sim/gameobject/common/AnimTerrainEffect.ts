import { ObjectType } from '../../type/ObjectType';
import { TileDirection } from '../../Tiles';
import { LandType } from '../../type/LandType';
import { TiberiumTrait } from '../trait/TiberiumTrait';

/**
 * Verbatim from redalert2/src/game/gameobject/common/AnimTerrainEffect.ts.
 *
 * Two side effects of an explosion that have nothing to do with damage:
 *
 *  - `destroyOre` — an explosion with a `Crater=yes` animation burns ore. The
 *    number of bails removed is `ceil(maxBails / 2) = 6` for a plain explosion,
 *    but a random `1..6` for anything else, and exactly 6 for `S_CLSN*`
 *    animations. The randomness is why two identical shells on identical ore can
 *    leave different amounts behind.
 *  - `spawnSmudges` — scorch marks. Only on `Clear` land with `rampType === 0`
 *    and only if the cell has no non-unit object on it. A 2x2 crater additionally
 *    requires all three southern neighbours to exist, because a multi-tile smudge
 *    anchored at the map edge would render off-map.
 *
 * Both are no-ops when the animation is unknown to the art layer, which is the
 * normal case for our own content until its `Crater=` flags are authored.
 */
export class AnimTerrainEffect {
    destroyOre(animationId: string, tile: any, game: any): void {
        if (
            tile.landType === LandType.Tiberium &&
            (game.art.hasObject(animationId, ObjectType.Animation)
                ? game.art.getAnimation(animationId)
                : undefined)?.crater
        ) {
            const tiberiumObject = game.map
                .getObjectsOnTile(tile)
                .find((obj: any) => obj.isOverlay() && obj.isTiberium());
            if (tiberiumObject) {
                let bailCount = Math.ceil(TiberiumTrait.maxBails / 2);
                bailCount = animationId.startsWith('S_CLSN')
                    ? bailCount
                    : game.generateRandomInt(1, bailCount);
                const tiberiumTrait = tiberiumObject.traits.get(TiberiumTrait);
                tiberiumTrait.removeBails(bailCount);
                if (!tiberiumTrait.getBailCount()) {
                    game.unspawnObject(tiberiumObject);
                }
            }
        }
    }

    spawnSmudges(animationId: string, tile: any, game: any): void {
        if (
            tile.landType === LandType.Clear &&
            tile.rampType === 0 &&
            game.map.mapBounds.isWithinBounds(tile) &&
            !game.map.getObjectsOnTile(tile).find((obj: any) => !obj.isUnit())
        ) {
            const animation = game.art.hasObject(animationId, ObjectType.Animation)
                ? game.art.getAnimation(animationId)
                : undefined;
            if (animation?.crater) {
                const craterSize = animation?.forceBigCraters ? 2 : 1;
                const isScorch = animation?.scorch;
                const hasNeighbors = [
                    TileDirection.Bottom,
                    TileDirection.BottomLeft,
                    TileDirection.BottomRight,
                ].every((dir) => game.map.tiles.getNeighbourTile(tile, dir));
                const validSmudges = [...game.rules.smudgeRules.values()].filter(
                    (rule: any) =>
                        ((rule.crater && rule.width === craterSize && rule.height === craterSize) ||
                            (isScorch && rule.burn)) &&
                        !((rule.width > 1 || rule.height > 1) && !hasNeighbors),
                );
                if (validSmudges.length) {
                    const selectedSmudge = validSmudges[game.generateRandomInt(0, validSmudges.length - 1)].name;
                    const smudgeObject = game.createObject(ObjectType.Smudge, selectedSmudge);
                    game.spawnObject(smudgeObject, tile);
                }
            }
        }
    }
}
