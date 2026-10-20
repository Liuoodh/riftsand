/**
 * Re-export of the canonical hook at
 * `sim/gameobject/trait/interface/NotifyAttack.ts`.
 *
 * This file used to declare its own `Symbol()` under the reference's older path
 * (`game/trait/interface/…`). Two modules declaring the same marker create two
 * *different* symbols, and `Traits.filter` matches on symbol identity — so a
 * trait implementing the old path would have been invisible to
 * `GameObject.onAttack`, silently, with no type error. One definition, one
 * symbol, two import paths.
 */
export { NotifyAttack } from '../../gameobject/trait/interface/NotifyAttack';
