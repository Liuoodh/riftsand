/**
 * Verbatim from redalert2/src/game/event/EventMap.ts.
 *
 * Empty in the reference as well. It exists so the netcode can register
 * per-event handlers by `EventType` without a circular import on the events
 * themselves. Do not delete: the replay layer imports it as a namespace anchor.
 */
export const EventMap = {};
