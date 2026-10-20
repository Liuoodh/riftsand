/**
 * Verbatim from redalert2/src/game/trait/interface/NotifyAttack.ts.
 *
 * A symbol-keyed hook, not a method name. `Warhead.inflictDamage` iterates
 * `gameWorld.traits.filter(NotifyAttack)` and calls `trait[NotifyAttack.onAttack]`,
 * so a trait opts in by declaring a computed-key method — the symbol is what
 * makes it impossible to accidentally collide with a same-named method.
 */
export const NotifyAttack = {
    onAttack: Symbol(),
};

export interface NotifyAttack {
    [key: symbol]: (...args: any[]) => void;
}
