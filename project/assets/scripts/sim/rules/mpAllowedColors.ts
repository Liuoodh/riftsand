/**
 * The `[Colors]` names a multiplayer slot may pick, in slot order.
 *
 * Reference: redalert2/src/game/rules/mpAllowedColors.ts (verbatim list length —
 * eight slots). The *names* are resolved against our own colour table by
 * `Rules.getMultiplayerColors`, which throws if one is missing; that check is the
 * reason this stays a name list instead of a colour list.
 */
export const mpAllowedColors = [
    'Gold',
    'DarkRed',
    'DarkBlue',
    'DarkGreen',
    'Orange',
    'DarkSky',
    'Purple',
    'Magenta',
];
