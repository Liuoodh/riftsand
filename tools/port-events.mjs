/**
 * One-off generator for the `sim/event/**` port (batch B6a).
 *
 * The reference `game/event/` directory is 68 files that average 8 lines each:
 * every one is a `readonly type` discriminator plus a positional constructor.
 * Writing 57 of those by hand is how field names drift from the reference
 * (`gameObject` silently becoming `target` in two files — which is exactly what
 * happened in B5a). So the table below is transcribed from
 * `redalert2/src/game/event/*.ts`, and the generator is the only thing that
 * touches the filesystem.
 *
 * Each entry: [ClassName, EventTypeMember, [[paramName, typeAnnotation, optional?], ...]]
 * A parameter named `__enum:Name` emits the `AllianceEventType` enum above the class.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'project', 'assets', 'scripts', 'sim', 'event');

/** @type {Array<[string, string, Array<[string, string, boolean?]>]>} */
const EVENTS = [
    ['AllianceChangeEvent', 'AllianceChange', [['alliance', 'any'], ['changeType', 'AllianceEventType'], ['from', 'any']]],
    ['BridgeRepairEvent', 'BridgeRepair', [['source', 'any'], ['tile', 'any']]],
    ['BuildingCaptureEvent', 'BuildingCapture', [['target', 'any']]],
    ['BuildingEvacuateEvent', 'BuildingEvacuate', [['target', 'any'], ['player', 'any']]],
    ['BuildingFailedPlaceEvent', 'BuildingFailedPlace', [['name', 'string'], ['player', 'any'], ['tile', 'any']]],
    ['BuildingGarrisonEvent', 'BuildingGarrison', [['target', 'any']]],
    ['BuildingInfiltrationEvent', 'BuildingInfiltration', [['target', 'any'], ['source', 'any']]],
    ['BuildingPlaceEvent', 'BuildingPlace', [['target', 'any']]],
    ['BuildingRepairFullEvent', 'BuildingRepairFull', [['target', 'any'], ['source', 'any']]],
    ['BuildingRepairStartEvent', 'BuildingRepairStart', [['target', 'any']]],
    ['CheerEvent', 'Cheer', [['player', 'any']]],
    ['CratePickupEvent', 'CratePickup', [['target', 'any'], ['player', 'any'], ['source', 'any'], ['tile', 'any']]],
    ['DeployNotAllowedEvent', 'DeployNotAllowed', [['target', 'any']]],
    ['EnterObjectEvent', 'EnterObject', [['target', 'any'], ['source', 'any']]],
    ['EnterTileEvent', 'EnterTile', [['target', 'any'], ['source', 'any']]],
    ['EnterTransportEvent', 'EnterTransport', [['target', 'any']]],
    ['FactoryProduceUnitEvent', 'FactoryProduceUnit', [['target', 'any']]],
    ['InsufficientFundsEvent', 'InsufficientFunds', [['target', 'any']]],
    ['LeaveTransportEvent', 'LeaveTransport', [['target', 'any']]],
    ['LightningStormCloudEvent', 'LightningStormCloud', [['position', 'any']]],
    ['LightningStormManifestEvent', 'LightningStormManifest', [['target', 'any']]],
    ['ObjectCloakChangeEvent', 'ObjectCloakChange', [['target', 'any']]],
    ['ObjectCrashingEvent', 'ObjectCrashing', [['gameObject', 'any']]],
    ['ObjectDestroyEvent', 'ObjectDestroy', [['target', 'any'], ['attackerInfo', 'any'], ['incidental', 'any']]],
    ['ObjectDisguiseChangeEvent', 'ObjectDisguiseChange', [['target', 'any']]],
    ['ObjectMorphEvent', 'ObjectMorph', [['from', 'any'], ['to', 'any']]],
    ['ObjectOwnerChangeEvent', 'ObjectOwnerChange', [['target', 'any'], ['prevOwner', 'any']]],
    ['ObjectSellEvent', 'ObjectSell', [['target', 'any']]],
    ['ObjectSpawnEvent', 'ObjectSpawn', [['gameObject', 'any']]],
    ['ObjectTeleportEvent', 'ObjectTeleport', [['target', 'any'], ['isChronoshift', 'any'], ['prevTile', 'any']]],
    ['ObjectUnspawnEvent', 'ObjectUnspawn', [['gameObject', 'any']]],
    ['PingLocationEvent', 'PingLocation', [['tile', 'any'], ['player', 'any']]],
    ['PlayerDefeatedEvent', 'PlayerDefeated', [['target', 'any']]],
    ['PlayerDroppedEvent', 'PlayerDropped', [['target', 'any'], ['assetsRedistributed', 'any']]],
    ['PlayerResignedEvent', 'PlayerResigned', [['target', 'any'], ['assetsRedistributed', 'any', true]]],
    ['PowerChangeEvent', 'PowerChange', [['target', 'any'], ['power', 'any'], ['drain', 'any']]],
    ['PowerLowEvent', 'PowerLow', [['target', 'any']]],
    ['PowerRestoreEvent', 'PowerRestore', [['target', 'any']]],
    ['PrimaryFactoryChangeEvent', 'PrimaryFactoryChange', [['target', 'any']]],
    ['RadarEvent', 'RadarEvent', [['target', 'any'], ['radarEventType', 'any'], ['tile', 'any']]],
    ['RadarOnOffEvent', 'RadarOnOff', [['target', 'any'], ['radarEnabled', 'boolean']]],
    ['RallyPointChangeEvent', 'RallyPointChange', [['target', 'any']]],
    ['ShipSubmergeChangeEvent', 'ShipSubmergeChange', [['target', 'any']]],
    ['StalemateDetectEvent', 'StalemateDetect', []],
    ['SuperWeaponActivateEvent', 'SuperWeaponActivate', [['target', 'any'], ['owner', 'any'], ['atTile', 'any'], ['atTile2', 'any'], ['noSfxWarning', 'boolean']]],
    ['SuperWeaponReadyEvent', 'SuperWeaponReady', [['target', 'any']]],
    ['TimerExpireEvent', 'TimerExpire', [['target', 'any']]],
    ['TriggerAnimEvent', 'TriggerAnim', [['name', 'string'], ['tile', 'any']]],
    ['TriggerEvaEvent', 'TriggerEva', [['soundId', 'string']]],
    ['TriggerSoundFxEvent', 'TriggerSoundFx', [['soundId', 'string'], ['tile', 'any', true]]],
    ['TriggerStopSoundFxEvent', 'TriggerStopSoundFx', [['tile', 'any']]],
    ['TriggerTextEvent', 'TriggerText', [['label', 'any']]],
    ['UnitDeployUndeployEvent', 'UnitDeployUndeploy', [['unit', 'any'], ['deployType', 'any']]],
    ['UnitPromoteEvent', 'UnitPromote', [['target', 'any']]],
    ['UnitRecycleEvent', 'UnitRecycle', [['target', 'any']]],
    ['UnitRepairFinishEvent', 'UnitRepairFinish', [['target', 'any'], ['from', 'any']]],
    ['UnitRepairStartEvent', 'UnitRepairStart', [['target', 'any']]],
];

const ALLIANCE_ENUM = `/**
 * Sub-kind of \`AllianceChangeEvent\`. Kept on the event rather than in the
 * alliance model because the renderer needs to distinguish "someone asked" from
 * "someone broke it" without reading player state.
 */
export enum AllianceEventType {
    Requested = 0,
    Formed = 1,
    Broken = 2,
}
`;

/** Event names whose reference file carries a note worth keeping. */
const NOTES = {
    ObjectDestroyEvent: ` * \`attackerInfo\` is a \`{ player, object, weapon }\` bag, not a GameObject: the\n * killer is frequently already destroyed by the time the event dispatches.`,
    ObjectTeleportEvent: ` * \`prevTile\` lets the renderer draw the "warp in" streak from where the object\n * used to be; without it a chrono jump looks like a normal move.`,
    CratePickupEvent: ` * \`source\` is the crate object (already unspawned), \`target\` the picker. Both\n * are needed: the crate's kind lives on \`source\`, the beneficiary on \`target\`.`,
    ObjectCrashingEvent: ` * Fired once when an aircraft starts falling, *not* on every tick of the fall.\n * \`ObjectDestroyEvent\` follows when it hits.`,
    BuildingFailedPlaceEvent: ` * Carries the *name* rather than the rules object because the building was never\n * instantiated — placement failed before construction.`,
    SuperWeaponActivateEvent: ` * \`atTile2\` is the second corner for area-effect superweapons (iron curtain,\n * chronoshift); it is \`undefined\` for single-tile ones.`,
    RadarEvent: ` * \`radarEventType\` is the minimap ping shape (attack / unit-lost / …). The\n * renderer's switch is the only consumer.`,
    ObjectOwnerChangeEvent: ` * \`prevOwner\` is needed because \`target.owner\` is already the new one when the\n * handler runs — mind-control and engineer capture both rely on the pair.`,
    PlayerResignedEvent: ` * \`assetsRedistributed\` is optional: resigning in a 1v1 has nobody to give the\n * assets to.`,
};

function header(name, params) {
    const note = NOTES[name];
    const lines = [` * Port of redalert2/src/game/event/${name}.ts (verbatim signature).`];
    if (note) lines.push(' *', note);
    if (params.length === 0) lines.push(' *', ' * No payload — the type discriminator is the whole message.');
    return `/**\n${lines.join('\n')}\n */`;
}

const body = (params) =>
    params.length === 0
        ? ''
        : `\n${params
              .map(([p, t, opt]) => `        public readonly ${p}${opt ? '?' : ''}: ${t},`)
              .join('\n')}\n    `;

const meta = (uuid) =>
    JSON.stringify(
        { ver: '4.0.24', importer: 'typescript', imported: true, uuid, files: [], subMetas: {}, userData: {} },
        null,
        2,
    ) + '\n';

mkdirSync(OUT, { recursive: true });

let written = 0;
for (const [name, member, params] of EVENTS) {
    const pre = name === 'AllianceChangeEvent' ? ALLIANCE_ENUM + '\n' : '';
    const src =
        `${header(name, params)}\n` +
        `import { EventType } from './EventType';\n\n` +
        pre +
        `export class ${name} {\n` +
        `    public readonly type: EventType;\n\n` +
        `    constructor(${body(params)}) {\n` +
        `        this.type = EventType.${member};\n` +
        `    }\n` +
        `}\n`;
    writeFileSync(join(OUT, `${name}.ts`), src);
    writeFileSync(join(OUT, `${name}.ts.meta`), meta(randomUUID()));
    written++;
}

// The two ambient files the reference keeps alongside the events.
writeFileSync(
    join(OUT, 'EventMap.ts'),
    `/**\n * Verbatim from redalert2/src/game/event/EventMap.ts.\n *\n * Empty in the reference as well. It exists so the netcode can register\n * per-event handlers by \`EventType\` without a circular import on the events\n * themselves. Do not delete: the replay layer imports it as a namespace anchor.\n */\nexport const EventMap = {};\n`,
);
writeFileSync(join(OUT, 'EventMap.ts.meta'), meta(randomUUID()));
writeFileSync(
    join(OUT, 'GameEvent.ts'),
    `/**\n * Verbatim from redalert2/src/game/event/GameEvent.ts — an empty module.\n *\n * It is the barrel anchor the reference uses to keep the event directory from\n * being tree-shaken away. Kept so the file list matches.\n */\nexport {};\n`,
);
writeFileSync(join(OUT, 'GameEvent.ts.meta'), meta(randomUUID()));

console.log(`wrote ${written} event classes + EventMap/GameEvent into ${OUT}`);
