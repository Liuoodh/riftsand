/**
 * Ore as an *overlay*, not as ground.
 *
 * In the reference engine a tiberium field is not a terrain type — it is an
 * `OverlayObject` that occupies a cell, and `TileOccupation.computeTileLandType`
 * turns the cell's land class into `LandType.Tiberium` only while that object is
 * there. Harvesting the last bail removes the object and the cell goes back to
 * `Clear`.
 *
 * Our generator marks ore cells with `TileKind.Crystal`, which is a *content*
 * decision (where the ore is), not an engine one (what the ore is). This stub is
 * the bridge: one object per ore cell, registered with `TileOccupation` exactly
 * like a wall segment would be, so the engine derives the land class the same
 * way it does for retail tiberium.
 *
 * It is deliberately not an `Entity`: it has no HP, no owner, no tick, and must
 * never be drawn as a game object. The renderer reads the ore from the terrain
 * layer, so the only thing that matters here is that the engine can answer
 * `isOverlay()` and `isTiberium()` about it.
 */
import type { Tile } from '../map/TileCollection';
import { LandType } from '../type/LandType';

export class OreOverlayStub {
    /**
     * The `rules` bag `TileOccupation` inspects. `wall: false` is what keeps the
     * cell from becoming `LandType.Wall`, and `land: Clear` is the "no opinion"
     * value that makes `computeTileLandType` fall through to `Tiberium` via the
     * `isTiberium()` branch instead of a plain overlay land class.
     */
    readonly rules = {
        wall: false,
        land: LandType.Clear,
        crate: false,
        crushable: false,
    };

    constructor(readonly tile: Tile) {}

    /*
     * The predicate set the map layer asks about every occupant.
     *
     * These have to exist as *methods* even though this class is not an Entity,
     * because `TileOccupation.computeTileLandType`, `Terrain.isBlockerObject`
     * and `TileOccupation.getGroundObjectsOnTile` all duck-type their way
     * through the occupant set — there is no base class to inherit from. Ore is
     * an overlay and a tiberium object, and nothing else: `isTechno()` false
     * keeps it out of the air-zone filter, and every bridge question is false so
     * `computeOnBridgeLandType` skips it.
     */
    isOverlay(): boolean { return true; }

    isTiberium(): boolean { return true; }

    isBuilding(): boolean { return false; }

    isTerrain(): boolean { return false; }

    isUnit(): boolean { return false; }

    isInfantry(): boolean { return false; }

    isVehicle(): boolean { return false; }

    isAircraft(): boolean { return false; }

    isSmudge(): boolean { return false; }

    isTechno(): boolean { return false; }

    isBridge(): boolean { return false; }

    isHighBridge(): boolean { return false; }

    isLowBridge(): boolean { return false; }

    isXBridge(): boolean { return false; }

    isBridgePlaceholder(): boolean { return false; }
}
