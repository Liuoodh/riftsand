import { OverlayTibType } from '../type/OverlayTibType';

/**
 * Verbatim from redalert2/src/game/map/OreOverlayTypes.ts.
 *
 * The four ore species live in hard-coded overlay-id ranges. Note the overlap:
 * `minIdVinifera = 127` equals `maxIdRiparius = 127`, and `getOverlayTibType`
 * tests Riparius **first**, so 127 resolves to Riparius. That happens to be
 * correct for retail's art set and is kept as-is — reordering the checks would
 * silently turn one ore type into another on any map containing 127.
 */
export class OreOverlayTypes {
    static minIdRiparius = 102;
    static maxIdRiparius = 127;
    static minIdCruentus = 27;
    static maxIdCruentus = 38;
    static minIdVinifera = 127;
    static maxIdVinifera = 146;
    static minIdAboreus = 147;
    static maxIdAboreus = 166;

    static getOverlayTibType(id: number): OverlayTibType {
        return this.isRiparius(id)
            ? OverlayTibType.Riparius
            : this.isCruentus(id)
            ? OverlayTibType.Cruentus
            : this.isVinifera(id)
            ? OverlayTibType.Vinifera
            : this.isAboreus(id)
            ? OverlayTibType.Aboreus
            : OverlayTibType.NotSpecial;
    }

    static isRiparius(id: number): boolean {
        return id >= this.minIdRiparius && id <= this.maxIdRiparius;
    }

    static isCruentus(id: number): boolean {
        return id >= this.minIdCruentus && id <= this.maxIdCruentus;
    }

    static isVinifera(id: number): boolean {
        return id >= this.minIdVinifera && id <= this.maxIdVinifera;
    }

    static isAboreus(id: number): boolean {
        return id >= this.minIdAboreus && id <= this.maxIdAboreus;
    }
}
