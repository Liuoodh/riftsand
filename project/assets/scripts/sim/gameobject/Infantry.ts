/**
 * Port of redalert2/src/game/gameobject/Infantry.ts (88 lines).
 *
 * Two details matter here and nowhere else:
 *
 * 1. **Infantry occupy sub-cells, vehicles occupy whole cells.** `SUB_CELLS`
 *    is the retail table `[2, 4, 3]` — a fireteam of three stands at sub-cells
 *    2, 4 and 3, not at 1, 2, 3. The order is deliberate: slot 1 is left empty
 *    so the first man is not offset into the corner where the iso sprite
 *    overlaps the cell border.
 * 2. **Stance is a *derived* value.** `_stance` only stores the explicit stance;
 *    the getter promotes `None` to `Prone` while `SuppressionTrait` reports
 *    suppressed. Writing `None` to clear a prone-from-fear soldier therefore
 *    does nothing until the suppression timer runs out — which is the point.
 *
 * `factory` (trait assembly) ships with the trait batch; see `PORT-MATRIX.md`.
 */
import { ObjectType } from '../type/ObjectType';
import { ZoneType } from './unit/ZoneType';
import { StanceType } from './StanceType';
import { InfDeathType } from './InfDeathType';
import type { MoveTrait } from './trait/MoveTrait';
import { CrateBonuses } from './unit/CrateBonuses';
import { Techno } from './Techno';

export class Infantry extends Techno {
    /** Retail sub-cell order for a 3-man squad. */
    static SUB_CELLS = [2, 4, 3];

    direction: number;
    onBridge: boolean;
    zone: ZoneType;
    private _stance: StanceType;
    isFiring: boolean;
    isPanicked: boolean;
    infDeathType: InfDeathType;
    crateBonuses: CrateBonuses;
    moveTrait: MoveTrait;
    crashableTrait?: any;
    suppressionTrait?: any;
    agentTrait?: any;
    harvesterTrait?: any;
    idleActionTrait?: any;

    get isMoving(): boolean {
        return this.moveTrait.isMoving();
    }

    constructor(type: ObjectType, name: string, rules: any, art: any) {
        super(type, name, rules, art);
        this.direction = 0;
        this.onBridge = false;
        this.zone = ZoneType.Ground;
        this._stance = StanceType.None;
        this.isFiring = false;
        this.isPanicked = false;
        this.infDeathType = InfDeathType.Gunfire;
        this.crateBonuses = new CrateBonuses();
    }

    get stance(): StanceType {
        return this._stance === StanceType.None && this.suppressionTrait?.isSuppressed()
            ? StanceType.Prone
            : this._stance;
    }

    set stance(value: StanceType) {
        this._stance = value;
        this.moveTrait.setDisabled([StanceType.Deployed, StanceType.Cheer].includes(value));
        this.attackTrait?.setDisabled([StanceType.Paradrop, StanceType.Cheer].includes(value));
    }

    isUnit(): boolean {
        return true;
    }

    isInfantry(): boolean {
        return true;
    }
}
