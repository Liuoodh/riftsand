/**
 * Base object rules — the eight fields every `[ObjectType]` section carries.
 *
 * Reference: redalert2/src/game/rules/ObjectRules.ts
 *
 * The reference subclasses this for five different object families and reads the
 * values out of an INI section. We do not ship an INI parser (decision: TS data
 * objects, fields semantically identical), so `parse()` becomes a plain field
 * read from a data bag. Everything else — the two unit-conversion helpers, the
 * derived `imageName`, the per-type defaults for `crushable` — is unchanged.
 */
import type { ObjectType } from '../type/ObjectType';

export interface ObjectRulesData {
    name: string;
    alphaImage?: string;
    alternateArcticArt?: boolean;
    crushable?: boolean;
    crushSound?: string;
    dontScore?: boolean;
    insignificant?: boolean;
    legalTarget?: boolean;
    noShadow?: boolean;
    uiName?: string;
    /** overrides `imageName` when present; retail also accepts the literal "null" */
    image?: string;
}

export class ObjectRules {
    static readonly IMAGE_NONE = 'none';

    type: ObjectType;
    index: number;

    name: string;
    alphaImage?: string;
    alternateArcticArt = false;
    crushable = false;
    crushSound?: string;
    dontScore = false;
    insignificant = false;
    legalTarget = true;
    noShadow = false;
    uiName = '';

    /**
     * `Speed` in an INI is expressed at a nominal 100 fps; the simulation moves in
     * leptons per tick. Capped at one cell per tick — nothing in the game is
     * allowed to teleport through a wall because of a typo.
     */
    static iniSpeedToLeptonsPerTick(speed: number, frameRate: number): number {
        return Math.min(256, (256 * speed) / frameRate);
    }

    /** `ROT` is 1/256th of a turn per tick; the sim works in degrees per tick. */
    static iniRotToDegsPerTick(rotation: number): number {
        return (rotation / 256) * 360;
    }

    constructor(data: ObjectRulesData, type: ObjectType, index = -1) {
        this.type = type;
        this.index = index;
        this.name = data.name;
        this.parse(data);
    }

    protected parse(data: ObjectRulesData): void {
        this.alphaImage = data.alphaImage || undefined;
        this.alternateArcticArt = !!data.alternateArcticArt;
        // infantry are crushable unless told otherwise; everything else is not
        this.crushable = data.crushable ?? this.type === 3 /* ObjectType.Infantry */;
        this.crushSound = data.crushSound || undefined;
        this.dontScore = !!data.dontScore;
        this.insignificant = !!data.insignificant;
        this.legalTarget = data.legalTarget ?? true;
        this.noShadow = !!data.noShadow;
        this.uiName = data.uiName ?? '';
        this.imageOverride = data.image;
    }

    private imageOverride?: string;

    get imageName(): string {
        const image = this.imageOverride;
        return image && image !== 'null' ? image : this.name;
    }
}
