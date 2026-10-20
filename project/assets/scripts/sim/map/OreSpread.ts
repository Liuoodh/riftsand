/**
 * Ore field overlay id — which of the twelve ore art frames a cell uses.
 *
 * Reference: redalert2/src/game/map/OreSpread.ts (30 lines, verbatim).
 *
 * The id is a deterministic function of the cell's **display** coordinates, so
 * the ore pattern is stable across saves and identical on every client without
 * storing anything per cell. The three nested `% 12` are the retail formula;
 * `+ 120000` exists to keep the result positive after the subtraction, because
 * JavaScript's `%` keeps the sign of the dividend and `-5 % 12` is `-5`.
 *
 * `NotSpecial` returns `undefined`: a cell marked as ore by something other
 * than a real ore field (a scripted reveal, a crate) has no spread pattern and
 * falls back to a single frame.
 */
import { OreOverlayTypes } from './OreOverlayTypes';
import { OverlayTibType } from '../type/OverlayTibType';

interface Tile {
    dx: number;
    dy: number;
}

export class OreSpread {
    static calculateOverlayId(type: OverlayTibType, tile: Tile): number | undefined {
        if (type !== OverlayTibType.NotSpecial) {
            let x = tile.dx;
            const y = tile.dy;
            x = Math.floor(
                ((((y - 9) / 2) % 12) * (((y - 8) / 2) % 12)) % 12 -
                    ((((x - 13) / 2) % 12) * (((x - 12) / 2) % 12)) % 12 +
                    120000,
            );
            x %= 12;
            switch (type) {
                case OverlayTibType.Ore:
                    return OreOverlayTypes.minIdRiparius + x;
                case OverlayTibType.Gems:
                    return OreOverlayTypes.minIdCruentus + x;
                case OverlayTibType.Vinifera:
                    return OreOverlayTypes.minIdVinifera + x;
                case OverlayTibType.Aboreus:
                    return OreOverlayTypes.minIdAboreus + x;
                default:
                    return undefined;
            }
        }
        return undefined;
    }
}
