/**
 * One `[Riparius]` / `[Cruentus]` / ... ore section.
 *
 * Reference: redalert2/src/game/rules/TiberiumRules.ts (the whole file is one
 * field — `Value`, the credits a single bail of that ore is worth).
 *
 * The ore *types* themselves are content: our world has one crystal kind, so the
 * table is short, but the lookup path (`Rules.getTiberium(id).value`) is the
 * reference's, which is why the harvester does not hardcode a price.
 */
export interface TiberiumRulesData {
    value?: number;
}

export class TiberiumRules {
    value = 0;

    read(data: TiberiumRulesData = {}): TiberiumRules {
        this.value = data.value ?? 0;
        return this;
    }
}
