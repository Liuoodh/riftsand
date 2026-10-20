/**
 * Port of redalert2/src/game/gameobject/Overlay.ts (55 lines).
 *
 * Overlays are the flat, cell-sized things painted onto the ground: ore and
 * gems, walls, bridge decks and bridge placeholders. They are `GameObject`s
 * because they have HP (walls, bridges) and can be destroyed, but they are not
 * `Techno`s — no owner, no weapon, no movement.
 *
 * `overlayId` is the numeric id from `rules.ini`'s `[OverlayTypes]`; every
 * predicate below is a range check on it. That is why `isTiberium` /
 * `isBridge` are here rather than in `TileOccupation`: the map layer asks the
 * object, not a table, so a modded overlay id only has to be registered once.
 *
 * `getFoundation` is deliberately asymmetric: an X-shaped bridge piece spans
 * three *rows*, a straight one spans three *columns*. Swapping the two makes
 * every bridge deck one cell too short along one axis, and the passability
 * graph then leaves a hole exactly in the middle of the span.
 */
import { ObjectType } from '../type/ObjectType';
import { GameObject } from './GameObject';
import { BridgeOverlayTypes } from '../map/BridgeOverlayTypes';
import { OreOverlayTypes } from '../map/OreOverlayTypes';
import { OverlayTibType } from '../type/OverlayTibType';

export class Overlay extends GameObject {
    radarInvisible: boolean;
    wallTrait?: any;

    static factory(name: string, rules: any, art: any): Overlay {
        return new this(ObjectType.Overlay, name, rules, art);
    }

    constructor(type: ObjectType, name: string, rules: any, art: any) {
        super(type, name, rules, art);
        this.radarInvisible = this.rules.radarInvisible;
    }

    isTiberium(): boolean {
        return OreOverlayTypes.getOverlayTibType(this.overlayId) !== OverlayTibType.NotSpecial;
    }

    isBridge(): boolean {
        return BridgeOverlayTypes.isBridge(this.overlayId);
    }

    isXBridge(): boolean {
        return BridgeOverlayTypes.isXBridge(this.overlayId);
    }

    isHighBridge(): boolean {
        return BridgeOverlayTypes.isHighBridge(this.overlayId);
    }

    isLowBridge(): boolean {
        return BridgeOverlayTypes.isLowBridge(this.overlayId);
    }

    isBridgePlaceholder(): boolean {
        return BridgeOverlayTypes.isBridgePlaceholder(this.overlayId);
    }

    getFoundation(): { width: number; height: number } {
        const foundation = { width: 1, height: 1 };
        if (this.isBridge()) {
            if (this.isXBridge()) {
                foundation.height += 2;
            } else {
                foundation.width += 2;
            }
        }
        return foundation;
    }
}
