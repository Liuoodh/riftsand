/**
 * Warhead rules — the per-armour damage table and the 30 effect flags.
 *
 * Reference: redalert2/src/game/rules/WarheadRules.ts
 *
 * The one thing that must not drift: `verses`. It is indexed by `ArmorType`
 * (0..10) and read as `verses.get(armor) || 1` — note the `|| 1`, a missing slot
 * means **full damage**, not zero. Retail relies on that for armour classes it
 * never wrote a verse for.
 *
 * Defaults below are the reference's own `getXxx(key, default)` fallbacks, so a
 * warhead that only sets `Verses` and `CellSpread` behaves identically.
 */
import { InfDeathType } from '../gameobject/InfDeathType';
import { ArmorType } from '../type/ArmorType';

export interface WarheadRulesData {
    name: string;
    affectsAllies?: boolean;
    airstrike?: boolean;
    psychedelic?: boolean;
    animList?: string[];
    bombDisarm?: boolean;
    bullets?: boolean;
    causesDelayKill?: boolean;
    cellSpread?: number;
    conventional?: boolean;
    culling?: boolean;
    delayKillAtMax?: number;
    delayKillFrames?: number;
    electricAssault?: boolean;
    emEffect?: boolean;
    isLocomotor?: boolean;
    infDeath?: InfDeathType;
    ivanBomb?: boolean;
    makesDisguise?: boolean;
    mindControl?: boolean;
    nukeMaker?: boolean;
    paralyzes?: number;
    parasite?: boolean;
    percentAtMax?: number;
    proneDamage?: number;
    psychicDamage?: boolean;
    radiation?: boolean;
    rocker?: boolean;
    sonic?: boolean;
    temporal?: boolean;
    /** index = ArmorType; missing slot = full damage */
    verses?: number[];
    wallAbsoluteDestroyer?: boolean;
    wall?: boolean;
    wood?: boolean;
}

export class WarheadRules {
    readonly name: string;

    affectsAllies = true;
    airstrike = false;
    psychedelic = false;
    animList: string[] = [];
    bombDisarm = false;
    bullets = false;
    causesDelayKill = false;
    cellSpread = 0;
    conventional = false;
    culling = false;
    delayKillAtMax = 0;
    delayKillFrames = 0;
    electricAssault = false;
    emEffect = false;
    isLocomotor = false;
    infDeath = InfDeathType.None;
    ivanBomb = false;
    makesDisguise = false;
    mindControl = false;
    nukeMaker = false;
    paralyzes = 0;
    parasite = false;
    percentAtMax = 1;
    proneDamage = 1;
    psychicDamage = false;
    radiation = false;
    rocker = false;
    sonic = false;
    temporal = false;
    /** ArmorType -> damage multiplier. Read as `get(armor) || 1`. */
    readonly verses = new Map<number, number>();
    wallAbsoluteDestroyer = false;
    wall = false;
    wood = false;

    constructor(data: WarheadRulesData) {
        this.name = data.name;
        this.parse(data);
    }

    private parse(data: WarheadRulesData): void {
        this.affectsAllies = data.affectsAllies ?? true;
        this.airstrike = !!data.airstrike;
        this.psychedelic = !!data.psychedelic;
        this.animList = data.animList ?? [];
        this.bombDisarm = !!data.bombDisarm;
        this.bullets = !!data.bullets;
        this.causesDelayKill = !!data.causesDelayKill;
        this.cellSpread = data.cellSpread ?? 0;
        this.conventional = !!data.conventional;
        this.culling = !!data.culling;
        this.delayKillAtMax = data.delayKillAtMax ?? 0;
        this.delayKillFrames = data.delayKillFrames ?? 0;
        this.electricAssault = !!data.electricAssault;
        this.emEffect = !!data.emEffect;
        this.isLocomotor = !!data.isLocomotor;
        this.infDeath = data.infDeath ?? InfDeathType.None;
        this.ivanBomb = !!data.ivanBomb;
        this.makesDisguise = !!data.makesDisguise;
        this.mindControl = !!data.mindControl;
        this.nukeMaker = !!data.nukeMaker;
        this.paralyzes = data.paralyzes ?? 0;
        this.parasite = !!data.parasite;
        this.percentAtMax = data.percentAtMax ?? 1;
        this.proneDamage = data.proneDamage ?? 1;
        this.psychicDamage = !!data.psychicDamage;
        this.radiation = !!data.radiation;
        this.rocker = !!data.rocker;
        this.sonic = !!data.sonic;
        this.temporal = !!data.temporal;
        (data.verses ?? []).forEach((value, index) => this.verses.set(index, value));
        this.wallAbsoluteDestroyer = !!data.wallAbsoluteDestroyer;
        this.wall = !!data.wall;
        this.wood = !!data.wood;
    }

    /** `verses.get(armor) || 1` — the missing-slot rule, in one place */
    versesModifier(armor: ArmorType): number {
        return this.verses.get(armor) || 1;
    }
}
