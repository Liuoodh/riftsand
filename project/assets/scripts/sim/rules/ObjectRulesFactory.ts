/**
 * Dispatches an object section to the right rules class.
 *
 * Reference: redalert2/src/game/rules/ObjectRulesFactory.ts (verbatim switch).
 *
 * The four techno families share `TechnoRules`; the five map-prop families each get
 * their own subclass; anything else falls back to the bare `ObjectRules` (which is
 * what `Projectile` does — projectiles are built lazily by `Rules.getProjectile`
 * instead of through the factory).
 *
 * Argument order note: the reference declares `create(type, ini, generalRules, index)`
 * but its subclasses take `(type, ini, index, generalRules)` — the mismatch is
 * invisible because the factory is the only caller. We standardise on the factory's
 * order everywhere, so subclasses take `(type, data, generalRules, index)`.
 */
import { ObjectType } from '../type/ObjectType';
import { ObjectRules, ObjectRulesData } from './ObjectRules';
import { TechnoRules, TechnoRulesData, TechnoRulesGeneralRules } from './TechnoRules';
import { OverlayRules, OverlayRulesData } from './OverlayRules';
import { TerrainRules, TerrainRulesData } from './TerrainRules';
import { SmudgeRules, SmudgeRulesData } from './SmudgeRules';
import { DebrisRules, DebrisRulesData } from './DebrisRules';

export type AnyRulesData =
    | ObjectRulesData
    | TechnoRulesData
    | OverlayRulesData
    | TerrainRulesData
    | SmudgeRulesData
    | DebrisRulesData
    | Record<string, unknown>;

export class ObjectRulesFactory {
    create(
        type: ObjectType,
        data: AnyRulesData,
        generalRules?: TechnoRulesGeneralRules,
        index = -1,
    ): ObjectRules {
        switch (type) {
            case ObjectType.Aircraft:
            case ObjectType.Building:
            case ObjectType.Infantry:
            case ObjectType.Vehicle:
                return new TechnoRules(type, data as TechnoRulesData, generalRules, index);
            case ObjectType.Overlay:
                return new OverlayRules(type, data as OverlayRulesData, generalRules, index);
            case ObjectType.Terrain:
                return new TerrainRules(type, data as TerrainRulesData, generalRules, index);
            case ObjectType.Smudge:
                return new SmudgeRules(type, data as SmudgeRulesData, generalRules, index);
            case ObjectType.VoxelAnim:
                return new DebrisRules(type, data as DebrisRulesData, generalRules, index);
            default:
                return new ObjectRules(data as ObjectRulesData, type, index);
        }
    }
}
