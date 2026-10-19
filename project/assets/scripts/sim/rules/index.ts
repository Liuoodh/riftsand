/**
 * The rules barrel + the one live `Rules` instance.
 *
 * The reference threads a `rules` reference through the game context. Our sim code
 * is mid-migration and does not have that plumbing everywhere yet, so the instance
 * lives here and is imported directly. When B10 lands the `Game`/`World` rewrite the
 * call sites can take a parameter instead — the class is already parameterised, this
 * module is only the default binding.
 */
import { Rules } from './Rules';
import { RULES_CONTENT } from './rulesContent';
import { LandType } from '../type/LandType';
import { SpeedType } from '../type/SpeedType';

export const RULES = new Rules(RULES_CONTENT);

/**
 * Convenience for the two legacy call sites that ask "how fast is this surface for
 * this locomotion". Equivalent to `RULES.getLandRules(land).getSpeedModifier(speed)`.
 */
export function getSpeedModifier(landType: LandType, speedType: SpeedType): number {
    return RULES.getLandRules(landType).getSpeedModifier(speedType);
}

export { Rules } from './Rules';
export type { RulesContent } from './Rules';
export { RULES_CONTENT } from './rulesContent';
