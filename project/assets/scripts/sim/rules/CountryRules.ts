/**
 * One country/faction section.
 *
 * Reference: redalert2/src/game/rules/CountryRules.ts
 *
 * Kept from the reference: `Side` is mandatory and unknown values throw (a typo in
 * a faction table is a load-time error, not a silent Civilian); `Multiplay` is what
 * `Rules.getMultiplayerCountries` filters on.
 *
 * Changed: the reference resolves `Side` from a string table of *retail* faction
 * names and their localisation keys. Both are content, so they moved to the
 * faction table — `read()` accepts either the canonical slot name or the enum.
 */
import { SideType } from '../type/SideType';

const sideMap = new Map<string, SideType>()
    .set('GDI', SideType.GDI)
    .set('Nod', SideType.Nod)
    .set('Civilian', SideType.Civilian)
    .set('Mutant', SideType.Mutant)
    .set('ThirdSide', SideType.Yuri);

export interface CountryRulesData {
    name: string;
    uiName?: string;
    uiTooltip?: string;
    /** canonical side slot name, or the enum itself */
    side: string | SideType;
    multiplay?: boolean;
    multiplayPassive?: boolean;
    veteranAircraft?: string[];
    veteranInfantry?: string[];
    veteranUnits?: string[];
}

export class CountryRules {
    id: string;
    name: string;
    uiName = '';
    uiTooltip?: string;
    side: SideType;
    multiplay = false;
    multiplayPassive = false;
    veteranAircraft: string[] = [];
    veteranInfantry: string[] = [];
    veteranUnits: string[] = [];

    constructor(id: string, data: CountryRulesData) {
        this.id = id;
        this.name = data.name;
        this.read(data);
    }

    read(data: CountryRulesData): CountryRules {
        this.name = data.name;
        this.uiName = data.uiName ?? '';
        this.uiTooltip = data.uiTooltip;
        if (data.side === undefined || data.side === null || data.side === '') {
            throw new Error(`Missing Side for country "${this.name}"`);
        }
        const side = typeof data.side === 'number' ? data.side : sideMap.get(data.side);
        if (side === undefined) {
            throw new Error(`Unknown side "${data.side}" for country "${this.name}"`);
        }
        this.side = side;
        this.multiplay = !!data.multiplay;
        this.multiplayPassive = !!data.multiplayPassive;
        this.veteranAircraft = data.veteranAircraft ?? [];
        this.veteranInfantry = data.veteranInfantry ?? [];
        this.veteranUnits = data.veteranUnits ?? [];
        return this;
    }
}
