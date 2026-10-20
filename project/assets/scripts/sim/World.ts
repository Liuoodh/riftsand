/**
 * Shared world contract + rule adapter.
 *
 * `MoveTask` / locomotor talk to the world through this interface only, which is
 * how the port stays a *drop-in* copy of the reference: every `this.game.map.*`
 * call in the original has a matching member here.
 */
import { MovementZone } from './type/MovementZone';
import { SpeedType } from './type/SpeedType';
import { Terrain } from './map/Terrain';
import { MapBounds } from './map/MapBounds';
import { TileCollection } from './map/TileCollection';
import { TileOccupation } from './map/TileOccupation';
import { RAD } from './Math2';
import { TICK } from './MoveTrait';

export { SPEED, isBuildingObject } from './Constants';
import { SPEED } from './Constants';

export interface SimWorld {
    terrain: Terrain;
    tiles: TileCollection;
    mapBounds: MapBounds;
    tileOccupation: TileOccupation;
    currentTick: number;
    areFriendly(a: any, b: any): boolean;
    /** called when a moving unit drives over something crushable */
    crushObject?(victim: any, by: any): void;
}

export interface UnitRules {
    speed: number;
    speedType: SpeedType;
    movementZone: MovementZone;
    /** infantry can be run over */
    crushable: boolean;
    /** this unit runs others over */
    crusher: boolean;
    /** degrees per tick (reference: rules.rot) */
    rot: number;
    accelerates: boolean;
    accelerationFactor: number;
    locomotor: 'drive' | 'foot';
    tooBigToFitUnderBridge: boolean;
    invisibleInGame: boolean;
    gate: boolean;
    crate: boolean;
    tiberium: boolean;
}

const RULE_CACHE = new Map<string, UnitRules>();

/**
 * Build the reference-style `rules` bag for a unit definition.
 *
 * rot: the project stores turn rates in rad/s (Core.unitTurn), the reference in
 * degrees/tick — converting here keeps TurnTask / FacingUtil unmodified.
 */
export function rulesFor(def: any, turnRadPerSec: number): UnitRules {
    const key = def.id;
    let rules = RULE_CACHE.get(key);
    if (rules) return rules;
    const kind = def.kind;
    rules = {
        speed: def.speed,
        speedType:
            kind === 'infantry'
                ? SpeedType.Foot
                : kind === 'air'
                  ? SpeedType.Winged
                  : def.hover
                    ? SpeedType.Hover
                    : SpeedType.Track,
        movementZone: kind === 'air' ? MovementZone.Fly : kind === 'infantry' ? MovementZone.Infantry : MovementZone.Normal,
        crushable: kind === 'infantry',
        crusher: !!def.crush || kind === 'harvester' || kind === 'mcv',
        rot: turnRadPerSec * TICK * RAD,
        accelerates: kind !== 'infantry' && kind !== 'air',
        accelerationFactor: kind === 'harvester' || kind === 'mcv' ? 0.022 : 0.03,
        locomotor: kind === 'infantry' ? 'foot' : 'drive',
        tooBigToFitUnderBridge: false,
        invisibleInGame: false,
        gate: false,
        crate: false,
        tiberium: false,
    };
    RULE_CACHE.set(key, rules);
    return rules;
}
