/**
 * `[General]` paradrop squads, one list per side.
 *
 * Reference: redalert2/src/game/rules/general/ParadropRules.ts
 *
 * Two reference quirks kept on purpose:
 *   - a squad with `num <= 0` is dropped from the list entirely;
 *   - the third side falls back to the Soviet list when its own is empty.
 */
import { SideType } from '../../type/SideType';

interface ParadropSquad {
    inf: string;
    num: number;
}

export interface ParadropRulesData {
    allyParaDrop?: ParadropSquad[];
    amerParaDrop?: ParadropSquad[];
    sovParaDrop?: ParadropSquad[];
    yuriParaDrop?: ParadropSquad[];
    paradropPlane?: string;
    paradropRadius?: number;
}

export class ParadropRules {
    allyParaDrop: ParadropSquad[] = [];
    amerParaDrop: ParadropSquad[] = [];
    sovParaDrop: ParadropSquad[] = [];
    yuriParaDrop: ParadropSquad[] = [];
    paradropPlane = '';
    paradropRadius = 0;

    read(data: ParadropRulesData = {}): ParadropRules {
        this.allyParaDrop = filterSquads(data.allyParaDrop ?? []);
        this.amerParaDrop = filterSquads(data.amerParaDrop ?? []);
        this.sovParaDrop = filterSquads(data.sovParaDrop ?? []);
        this.yuriParaDrop = filterSquads(data.yuriParaDrop ?? []);
        this.paradropPlane = data.paradropPlane ?? '';
        this.paradropRadius = data.paradropRadius ?? 0;
        return this;
    }

    getParadropSquads(side: SideType): ParadropSquad[] {
        switch (side) {
            case SideType.GDI:
                return this.allyParaDrop;
            case SideType.Nod:
                return this.sovParaDrop;
            case SideType.Yuri:
                return this.yuriParaDrop.length ? this.yuriParaDrop : this.sovParaDrop;
            default:
                return this.sovParaDrop;
        }
    }
}

function filterSquads(squads: ParadropSquad[]): ParadropSquad[] {
    return squads.filter((s) => s.num > 0);
}
