import { isBetween } from '../util/math';

/**
 * Verbatim from redalert2/src/game/map/BridgeOverlayTypes.ts.
 *
 * Bridges in RA2 are just overlays whose ids fall into fixed ranges. The ranges
 * are hard-coded here because they are part of the data format, not of our
 * content: `Warhead.computeDamage` reads this to pick Wood vs Concrete armour
 * for a bridge segment, and `canDamage` uses `isLowBridgeHead` to refuse damage
 * on the ramp cells.
 *
 * The ids stay as-is on purpose. We are not rendering retail bridges, but any
 * map (ours included) that wants bridges has to number them the same way, or
 * every range check above silently fails.
 */
export enum OverlayBridgeType {
    NotBridge = 0,
    Concrete = 1,
    Wood = 2,
}

export class BridgeOverlayTypes {
    static minLowBridgeWoodId = 74;
    static maxLowBridgeWoodId = 99;
    static minLowBridgeConcreteId = 205;
    static maxLowBridgeConcreteId = 230;
    static minHighBridgeConcreteId = 24;
    static maxHighBridgeConcreteId = 25;
    static minHighBridgeWoodId = 237;
    static maxHighBridgeWoodId = 238;
    static bridgePlaceholderIds = [100, 101, 231, 232];

    static getOverlayBridgeType(id: number): OverlayBridgeType {
        return isBetween(id, this.minHighBridgeConcreteId, this.maxHighBridgeConcreteId) ||
            isBetween(id, this.minLowBridgeConcreteId, this.maxLowBridgeConcreteId)
            ? OverlayBridgeType.Concrete
            : isBetween(id, this.minHighBridgeWoodId, this.maxHighBridgeWoodId) ||
              isBetween(id, this.minLowBridgeWoodId, this.maxLowBridgeWoodId)
            ? OverlayBridgeType.Wood
            : OverlayBridgeType.NotBridge;
    }

    static isBridge(id: number): boolean {
        return this.isHighBridge(id) || this.isLowBridge(id);
    }

    static isBridgePlaceholder(id: number): boolean {
        return this.bridgePlaceholderIds.includes(id);
    }

    static isHighBridge(id: number): boolean {
        return (
            isBetween(id, this.minHighBridgeWoodId, this.maxHighBridgeWoodId) ||
            isBetween(id, this.minHighBridgeConcreteId, this.maxHighBridgeConcreteId)
        );
    }

    static isLowBridge(id: number): boolean {
        return (
            isBetween(id, this.minLowBridgeWoodId, this.maxLowBridgeWoodId) ||
            isBetween(id, this.minLowBridgeConcreteId, this.maxLowBridgeConcreteId)
        );
    }

    static isXBridge(id: number): boolean {
        return (
            id === this.minHighBridgeWoodId ||
            id === this.minHighBridgeConcreteId ||
            isBetween(id, this.minLowBridgeWoodId, this.minLowBridgeWoodId + 8) ||
            isBetween(id, this.minLowBridgeWoodId + 18, this.minLowBridgeWoodId + 21) ||
            isBetween(id, this.minLowBridgeConcreteId, this.minLowBridgeConcreteId + 8) ||
            isBetween(id, this.minLowBridgeConcreteId + 18, this.minLowBridgeConcreteId + 21)
        );
    }

    static isLowBridgeHead(id: number): boolean {
        return (
            isBetween(id, this.minLowBridgeWoodId + 18, this.minLowBridgeWoodId + 25) ||
            isBetween(id, this.minLowBridgeConcreteId + 18, this.minLowBridgeConcreteId + 25)
        );
    }

    static isLowBridgeHeadStart(id: number): boolean {
        return (
            isBetween(id, this.minLowBridgeWoodId + 20, this.minLowBridgeWoodId + 23) ||
            isBetween(id, this.minLowBridgeConcreteId + 20, this.minLowBridgeConcreteId + 23)
        );
    }

    static calculateLowBridgeOverlayId(type: OverlayBridgeType, isStart: boolean): number {
        let baseId: number;
        if (type === OverlayBridgeType.Concrete) {
            baseId = this.minLowBridgeConcreteId;
        } else if (type === OverlayBridgeType.Wood) {
            baseId = this.minLowBridgeWoodId;
        } else {
            throw new Error('Not implemented');
        }
        return baseId + (isStart ? 0 : 9);
    }

    static calculateHighBridgeOverlayId(type: OverlayBridgeType, isStart: boolean): number {
        let baseId: number;
        if (type === OverlayBridgeType.Concrete) {
            baseId = this.minHighBridgeConcreteId;
        } else if (type === OverlayBridgeType.Wood) {
            baseId = this.minHighBridgeWoodId;
        } else {
            throw new Error('Not implemented');
        }
        return baseId + (isStart ? 0 : 1);
    }
}
