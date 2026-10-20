/**
 * Bridge pieces — the linked list that makes a bridge one object for damage,
 * repair and overlay spelling.
 *
 * Reference: redalert2/src/game/map/Bridges.ts (555 lines).
 *
 * A bridge is not a building: it is a chain of *overlay* cells, each one an
 * independent object with its own HP, that happen to be adjacent. This class
 * keeps a doubly-linked list over them so three questions have O(1) answers:
 *
 *   - is this cell a bridge head, a middle piece, or a lone segment? (`headType`)
 *   - if one piece is destroyed, which pieces collapse with it? (`findDominoPieces`)
 *   - which art frame does each piece show right now? (`updateOverlayData`)
 *
 * `updateOverlayData` is the bulk of the file and is pure table lookup: the
 * overlay id is a function of (head type, is-damaged, neighbour-is-damaged,
 * orientation). Every branch is a retail art frame. Do not "simplify" it into a
 * formula — the frames are not evenly spaced.
 *
 * Two behaviours worth naming:
 *
 *   - a **high** bridge's head type comes from geometry (`prevTile.z ===
 *     tile.z + tileElevation`), a **low** bridge's from its overlay id. Same
 *     enum, two entirely different sources.
 *   - `findDominoPieces` returns `[]` in *both* the "no neighbours at all" and
 *     "both directions reach a head" cases, and a non-empty list only when one
 *     direction runs to the map edge without finding a head. That inversion is
 *     the retail rule: a segment between two heads collapses alone.
 */
import { TileCollection, TileDirection, Tile } from './TileCollection';
import { BridgeOverlayTypes, OverlayBridgeType } from './BridgeOverlayTypes';
import { DirectionalTileFinder } from './tileFinder/DirectionalTileFinder';
import { RadialTileFinder } from './tileFinder/RadialTileFinder';
import { TileSets, HighBridgeHeadType } from '../theater/TileSets';
import { TerrainType } from '../type/TerrainType';
import { Vector2 } from '../math/Vector2';
import { FloodTileFinder } from './tileFinder/FloodTileFinder';
import { MapBounds } from './MapBounds';

export enum BridgeHeadType {
    None = 0,
    Start = 1,
    End = 2,
}

interface BridgeObject {
    tile: Tile;
    overlayId: number;
    value: number;
    name: string;
    tileElevation: number;
    healthTrait?: { health: number };
    isOverlay(): boolean;
    isBridge(): boolean;
    isXBridge(): boolean;
    isHighBridge(): boolean;
    isLowBridge(): boolean;
    isBridgePlaceholder(): boolean;
}

interface GameObject {
    isBuilding(): boolean;
    isUnit(): boolean;
    isSmudge(): boolean;
    isOverlay(): boolean;
    isBridgePlaceholder(): boolean;
    rules: { invisibleInGame: boolean };
}

interface TileOccupationUpdateEvent {
    object: BridgeObject;
    type: 'added' | 'removed';
}

interface TileOccupation {
    onChange: {
        subscribe(handler: (event: TileOccupationUpdateEvent) => void): void;
        unsubscribe(handler: (event: TileOccupationUpdateEvent) => void): void;
    };
    getBridgeOnTile(tile: Tile): BridgeObject | null | undefined;
    getGroundObjectsOnTile(tile: Tile): GameObject[];
}

interface Rules {
    getOverlayName(overlayId: number): string;
}

export interface BridgePiece {
    obj: BridgeObject;
    prev?: BridgePiece;
    next?: BridgePiece;
    headType: BridgeHeadType;
}

export interface BridgeSpec {
    start: Tile;
    end: Tile;
    type: OverlayBridgeType;
    isHigh: boolean;
}

interface HighBridgeBoundary {
    tile: Tile;
    headType: HighBridgeHeadType;
}

interface AdjacentTiles {
    prev: Tile | null;
    next: Tile | null;
}

export class Bridges {
    private pieces = new Set<BridgePiece>();
    private piecesByTile = new Map<Tile, BridgePiece>();

    constructor(
        private tileSets: TileSets,
        private tiles: TileCollection,
        private tileOccupation: TileOccupation,
        private mapBounds: MapBounds,
        private rules: Rules,
    ) {
        tileOccupation.onChange.subscribe(this.handleTileOccupationUpdate);
    }

    /**
     * A bridge overlay appeared or was removed. Both ends of the chain are
     * re-spelled because a head that just gained a neighbour is no longer an
     * end cap.
     */
    private handleTileOccupationUpdate = ({ object: obj, type }: TileOccupationUpdateEvent): void => {
        if (obj.isOverlay() && obj.isBridge()) {
            const tile = obj.tile;
            let piece = this.piecesByTile.get(tile);
            if (type === 'added') {
                if (piece) {
                    throw new Error(`A bridge piece already exists at tile (${tile.rx},${tile.ry})`);
                }
                const adjacentTiles = this.findBridgeAdjacentTiles(obj);
                piece = {
                    obj,
                    prev: undefined,
                    next: undefined,
                    headType: this.computeHead(obj, adjacentTiles.prev, adjacentTiles.next),
                };
                this.piecesByTile.set(tile, piece);
                this.pieces.add(piece);
                this.connectPiece(piece, adjacentTiles.prev, adjacentTiles.next);
                this.updateOverlayData(piece);
                if (piece.prev) this.updateOverlayData(piece.prev);
                if (piece.next) this.updateOverlayData(piece.next);
            } else {
                if (!piece) {
                    throw new Error(`Bridge piece was alredy removed at tile (${tile.rx},${tile.ry})`);
                }
                const prevPiece = piece.prev;
                const nextPiece = piece.next;
                this.disconnectPiece(piece);
                this.piecesByTile.delete(tile);
                this.pieces.delete(piece);
                if (prevPiece) this.updateOverlayData(prevPiece);
                if (nextPiece) this.updateOverlayData(nextPiece);
            }
        }
    };

    getPieceAtTile(tile: Tile): BridgePiece | undefined {
        return this.piecesByTile.get(tile);
    }

    handlePieceHealthChange(piece: BridgePiece): void {
        this.updateOverlayData(piece);
        if (piece.prev) this.updateOverlayData(piece.prev);
        if (piece.next) this.updateOverlayData(piece.next);
    }

    /**
     * Which pieces fall when this one is destroyed.
     *
     * See the file header: an empty result means "nothing else falls", and that
     * is what both the "isolated segment" and the "span between two heads"
     * cases return. The two passes are the two directions; the first pass only
     * commits its list if it did *not* find a head.
     */
    findDominoPieces(piece: BridgePiece): BridgePiece[] {
        const dominoPieces: BridgePiece[] = [];
        let foundEnd = false;

        let currentPiece = piece.next;
        if (piece.headType === BridgeHeadType.None || currentPiece) {
            while (currentPiece) {
                dominoPieces.push(currentPiece);
                if (currentPiece.headType !== BridgeHeadType.None) {
                    foundEnd = true;
                    break;
                }
                currentPiece = currentPiece.next;
            }
        } else {
            foundEnd = true;
        }

        if (foundEnd) {
            foundEnd = false;
            dominoPieces.length = 0;
            let currentPiece = piece.prev;
            if (piece.headType === BridgeHeadType.None || currentPiece) {
                while (currentPiece) {
                    dominoPieces.push(currentPiece);
                    if (currentPiece.headType !== BridgeHeadType.None) {
                        foundEnd = true;
                        break;
                    }
                    currentPiece = currentPiece.prev;
                }
            } else {
                foundEnd = true;
            }
            if (foundEnd) {
                return [];
            }
        }
        return dominoPieces;
    }

    /** The two cells along the bridge axis. `isXBridge` picks which axis. */
    private findBridgeAdjacentTiles(bridgeObj: BridgeObject): AdjacentTiles {
        const isXBridge = bridgeObj.isXBridge();
        const direction = new Vector2(Number(isXBridge), Number(!isXBridge));
        const currentPos = new Vector2(bridgeObj.tile.rx, bridgeObj.tile.ry);
        const prevPos = currentPos.clone().sub(direction);
        const prevTile = this.tiles.getByMapCoords(prevPos.x, prevPos.y);
        const nextPos = currentPos.clone().add(direction);
        const nextTile = this.tiles.getByMapCoords(nextPos.x, nextPos.y);
        return { prev: prevTile ?? null, next: nextTile ?? null };
    }

    private connectPiece(piece: BridgePiece, prevTile: Tile | null, nextTile: Tile | null): void {
        if (prevTile) {
            piece.prev = this.getPieceAtTile(prevTile);
            if (piece.prev) {
                piece.prev.next = piece;
            }
        }
        if (nextTile) {
            piece.next = this.getPieceAtTile(nextTile);
            if (piece.next) {
                piece.next.prev = piece;
            }
        }
    }

    private disconnectPiece(piece: BridgePiece): void {
        if (piece.next) {
            piece.next.prev = undefined;
            piece.next = undefined;
        }
        if (piece.prev) {
            piece.prev.next = undefined;
            piece.prev = undefined;
        }
    }

    /**
     * High bridge: a head is a piece whose neighbour sits at the deck height
     * (`tile.z + tileElevation`). Low bridge: the overlay id already says so.
     */
    private computeHead(
        bridgeObj: BridgeObject,
        prevTile: Tile | null,
        nextTile: Tile | null,
    ): BridgeHeadType {
        const tile = bridgeObj.tile;
        if (bridgeObj.isHighBridge()) {
            const bridgeZ = tile.z + bridgeObj.tileElevation;
            return prevTile?.z === bridgeZ
                ? BridgeHeadType.Start
                : nextTile?.z === bridgeZ
                  ? BridgeHeadType.End
                  : BridgeHeadType.None;
        }
        return BridgeOverlayTypes.isLowBridgeHead(bridgeObj.overlayId)
            ? BridgeOverlayTypes.isLowBridgeHeadStart(bridgeObj.overlayId)
                ? BridgeHeadType.Start
                : BridgeHeadType.End
            : BridgeHeadType.None;
    }

    /**
     * Re-spell the piece's overlay id from its place in the chain.
     *
     * Three separate tables, in order of how much they care about neighbours:
     * low-bridge heads (4 frames × 2 orientations), high/low bridge heads, and
     * bridge interiors (damage on either side). The `+9` for non-X bridges and
     * the `isXBridge ? ... : ...` swaps are the orientation half of the art.
     */
    private updateOverlayData(piece: BridgePiece): void {
        const obj = piece.obj;
        const prevPiece = piece.prev;
        const nextPiece = piece.next;
        let overlayChanged = false;
        const isXBridge = obj.isXBridge();
        const bridgeType = BridgeOverlayTypes.getOverlayBridgeType(obj.overlayId);

        if (BridgeOverlayTypes.isLowBridgeHead(obj.overlayId)) {
            let overlayValue = 0;
            if (BridgeOverlayTypes.isLowBridgeHeadStart(obj.overlayId)) {
                overlayValue = isXBridge ? 20 : 22;
                if (!nextPiece) overlayValue++;
            } else {
                overlayValue = isXBridge ? 18 : 24;
                if (!prevPiece) overlayValue++;
            }
            obj.overlayId =
                (bridgeType === OverlayBridgeType.Wood
                    ? BridgeOverlayTypes.minLowBridgeWoodId
                    : BridgeOverlayTypes.minLowBridgeConcreteId) + overlayValue;
            obj.value = overlayValue;
            overlayChanged = true;
        } else {
            let overlayValue: number;
            const isDamaged = (obj.healthTrait?.health ?? 100) <= 50;
            if (piece.headType !== BridgeHeadType.None) {
                if (piece.headType === BridgeHeadType.Start) {
                    if (nextPiece) {
                        if (isDamaged) {
                            overlayValue = 6;
                        } else {
                            overlayValue = (nextPiece.obj.healthTrait?.health ?? 100) <= 50 ? 5 : 0;
                        }
                    } else {
                        overlayValue = isXBridge ? 8 : 7;
                    }
                } else {
                    if (prevPiece) {
                        if (isDamaged) {
                            overlayValue = 6;
                        } else {
                            overlayValue = (prevPiece.obj.healthTrait?.health ?? 100) <= 50 ? 4 : 0;
                        }
                    } else {
                        overlayValue = isXBridge ? 7 : 8;
                    }
                }
            } else {
                let actualPrev = prevPiece;
                let actualNext = nextPiece;
                if (!isXBridge) {
                    [actualPrev, actualNext] = [actualNext, actualPrev];
                }
                if (actualPrev || actualNext) {
                    if (actualPrev) {
                        if (actualNext) {
                            const prevDamaged = (actualPrev.obj.healthTrait?.health ?? 100) <= 50;
                            const nextDamaged = (actualNext.obj.healthTrait?.health ?? 100) <= 50;
                            overlayValue =
                                isDamaged || (prevDamaged && nextDamaged)
                                    ? 6
                                    : prevDamaged
                                      ? 4
                                      : nextDamaged
                                        ? 5
                                        : 0;
                        } else {
                            overlayValue = 8;
                        }
                    } else {
                        overlayValue = 7;
                    }
                } else {
                    overlayValue = 0;
                }
            }
            if (!isXBridge) {
                overlayValue += 9;
            }
            if (obj.isHighBridge()) {
                obj.value = overlayValue;
            } else {
                obj.overlayId =
                    (bridgeType === OverlayBridgeType.Wood
                        ? BridgeOverlayTypes.minLowBridgeWoodId
                        : BridgeOverlayTypes.minLowBridgeConcreteId) + overlayValue;
                obj.value = overlayValue;
                overlayChanged = true;
            }
        }
        if (overlayChanged) {
            obj.name = this.rules.getOverlayName(obj.overlayId);
        }
    }

    /**
     * Find the bridge nearest `centerTile` and resolve its two ends.
     *
     * Two very different paths behind one method: a low bridge already has
     * pieces, so the ends are found by walking the chain; a high bridge is
     * terrain, so the ends are found by flooding the boundary tiles and sorting
     * them along the bridge axis. The `sort` in `findHighBridgeBoundary` picks
     * the tile at the *far* end of the boundary run, which is the head.
     */
    findClosestBridgeSpec(centerTile: Tile): BridgeSpec | undefined {
        const finder = new RadialTileFinder(
            this.tiles,
            this.mapBounds,
            centerTile,
            { width: 1, height: 1 },
            1,
            3,
            (tile: Tile) => {
                if (tile.z !== centerTile.z) return false;
                const bridge = this.tileOccupation.getBridgeOnTile(tile);
                return (
                    (!!bridge?.isLowBridge() && this.getPieceAtTile(bridge.tile)?.headType !== BridgeHeadType.None) ||
                    !!this.tileSets.isHighBridgeBoundaryTile(tile.tileNum)
                );
            },
            false,
        );
        const foundTile = finder.getNextTile();
        if (!foundTile) return undefined;

        let startTile: Tile;
        let bridgeType: OverlayBridgeType;
        let isXBridge: boolean;
        let isStartHead: boolean;
        let endTile: Tile;
        let headType: HighBridgeHeadType | undefined;

        const isHighBridge = !this.tileOccupation.getBridgeOnTile(foundTile);
        if (isHighBridge) {
            const boundary = this.findHighBridgeBoundary(foundTile);
            if (!boundary) return undefined;
            startTile = boundary.tile;
            bridgeType =
                this.tileSets.getSetNum(foundTile.tileNum) === this.tileSets.getGeneralValue('WoodBridgeSet')
                    ? OverlayBridgeType.Wood
                    : OverlayBridgeType.Concrete;
            isXBridge =
                boundary.headType === HighBridgeHeadType.TopLeft ||
                boundary.headType === HighBridgeHeadType.BottomRight;
            isStartHead =
                boundary.headType === HighBridgeHeadType.TopLeft ||
                boundary.headType === HighBridgeHeadType.TopRight;
            headType = boundary.headType;
        } else {
            const bridge = this.tileOccupation.getBridgeOnTile(foundTile)!;
            startTile = bridge.tile;
            const piece = this.getPieceAtTile(startTile);
            if (!piece) {
                throw new Error('Bridge head is not defined');
            }
            const overlayBridgeType = BridgeOverlayTypes.getOverlayBridgeType(piece.obj.overlayId);
            if (overlayBridgeType === OverlayBridgeType.NotBridge) {
                throw new Error('Expected a bridge type');
            }
            bridgeType = overlayBridgeType;
            isXBridge = piece.obj.isXBridge();
            isStartHead = piece.headType === BridgeHeadType.Start;
        }

        const deltaX = Number(isXBridge) * (isStartHead ? 1 : -1);
        const deltaY = Number(!isXBridge) * (isStartHead ? 1 : -1);

        if (isHighBridge) {
            const endFinder = new DirectionalTileFinder(
                this.tiles,
                this.mapBounds,
                startTile,
                1,
                100,
                deltaX,
                deltaY,
                (tile: Tile) => tile.z === startTile.z && this.tileSets.isHighBridgeBoundaryTile(tile.tileNum),
                false,
            );
            const foundEndTile = endFinder.getNextTile();
            if (!foundEndTile) {
                return undefined;
            }
            const startSetNum = this.tileSets.getSetNum(startTile.tileNum);
            if (this.tileSets.getSetNum(foundEndTile.tileNum) !== startSetNum) {
                return undefined;
            }
            const endBoundary = this.findHighBridgeBoundary(foundEndTile);
            if (!endBoundary) return undefined;
            if (headType !== this.tileSets.getOppositeHighBridgeHeadType(endBoundary.headType)) {
                return undefined;
            }
            endTile = endBoundary.tile;
        } else {
            let targetPiece: BridgePiece | undefined;
            let distance = 1;
            const startX = startTile.rx;
            const startY = startTile.ry;
            while (!targetPiece) {
                const checkTile = this.tiles.getByMapCoords(startX + deltaX * distance, startY + deltaY * distance);
                if (!checkTile) return undefined;
                const piece = this.getPieceAtTile(checkTile);
                if (piece && piece.obj.isXBridge() !== isXBridge) return undefined;
                if (piece?.headType === (isStartHead ? BridgeHeadType.End : BridgeHeadType.Start)) {
                    targetPiece = piece;
                }
                distance++;
            }
            endTile = targetPiece.obj.tile;
        }

        return {
            start: isStartHead ? startTile : endTile,
            end: isStartHead ? endTile : startTile,
            type: bridgeType,
            isHigh: isHighBridge,
        };
    }

    /**
     * The head tile of a high-bridge boundary run.
     *
     * Flood the tiles that share this `tileNum` (one boundary art frame spans
     * several cells), then sort along the bridge axis and take the first. The
     * sort key `100 * delta + cross-axis` puts "further along the axis" first
     * and uses the cross axis only as a tie-break, so two cells at the same
     * progress resolve deterministically.
     */
    private findHighBridgeBoundary(tile: Tile): HighBridgeBoundary | undefined {
        const tileData = this.tileSets.getTile(tile.tileNum);
        const headType = this.tileSets.getHighBridgeHeadType(tileData?.index ?? -1);
        if (headType === undefined) {
            console.warn(`Couldn't find a valid bridge type for index "${tileData?.index}" @ ${tile.rx},${tile.ry}`);
            return undefined;
        }
        let deltaX = 0;
        let deltaY = 0;
        switch (headType) {
            case HighBridgeHeadType.TopLeft:
            case HighBridgeHeadType.MiddleTlBr:
                deltaX = 1;
                deltaY = 0;
                break;
            case HighBridgeHeadType.BottomRight:
                deltaX = -1;
                deltaY = 0;
                break;
            case HighBridgeHeadType.TopRight:
            case HighBridgeHeadType.MiddleTrBl:
                deltaX = 0;
                deltaY = 1;
                break;
            case HighBridgeHeadType.BottomLeft:
                deltaX = 0;
                deltaY = -1;
                break;
            default:
                throw new Error(`Unhandled head type "${headType}"`);
        }

        const floodFinder = new FloodTileFinder(
            this.tiles,
            this.mapBounds,
            tile,
            (t: Tile) => t.tileNum === tile.tileNum,
            (t: Tile) => t.terrainType === TerrainType.Pavement && t.z >= tile.z,
            false,
        );
        const tiles: Tile[] = [];
        let foundTile: Tile | undefined;
        while ((foundTile = floodFinder.getNextTile())) {
            tiles.push(foundTile);
        }
        if (tiles.length) {
            tiles.sort(
                (a, b) =>
                    100 * (deltaX ? deltaX * (b.rx - a.rx) : deltaY * (b.ry - a.ry)) +
                    (deltaX ? a.ry - b.ry : a.rx - b.rx),
            );
            return { tile: tiles[0], headType };
        }
        return undefined;
    }

    /**
     * Can this bridge be repaired? Requires at least one missing piece and no
     * structure (high) or non-unit object (low) on the three cells each piece
     * spans. The triple-cell span is why a low bridge cannot be rebuilt under a
     * tank division: every piece covers three cells, not one.
     */
    canBeRepaired(spec: BridgeSpec): boolean {
        const finder = this.createBridgePieceTileFinder(
            spec,
            (tile: Tile) =>
                !(
                    this.getPieceAtTile(tile) ||
                    (this.tileSets.isHighBridgeMiddleTile(tile.tileNum) && tile.z === spec.start.z)
                ),
        );
        let hasDestroyedPieces = false;
        const direction = spec.start.rx !== spec.end.rx ? TileDirection.BottomLeft : TileDirection.BottomRight;
        let tile: Tile | undefined;
        while ((tile = finder.getNextTile())) {
            hasDestroyedPieces = true;
            const secondTile = this.tiles.getNeighbourTile(tile, direction);
            const thirdTile = secondTile && this.tiles.getNeighbourTile(secondTile, direction);
            if (spec.isHigh) {
                if (
                    [tile, secondTile, thirdTile].find((t) =>
                        t ? this.tileOccupation.getGroundObjectsOnTile(t).some((obj) => obj.isBuilding() && !obj.rules.invisibleInGame) : false,
                    )
                ) {
                    return false;
                }
            } else {
                if (
                    [tile, secondTile, thirdTile].find((t) =>
                        t
                            ? this.tileOccupation
                                  .getGroundObjectsOnTile(t)
                                  .some(
                                      (obj) =>
                                          !(obj.isUnit() || obj.isSmudge() || (obj.isOverlay() && obj.isBridgePlaceholder())),
                                  )
                            : false,
                    )
                ) {
                    return false;
                }
            }
        }
        return hasDestroyedPieces;
    }

    getPieceTiles(piece: BridgePiece): (Tile | undefined)[] {
        const tile = piece.obj.tile;
        const direction = piece.obj.isXBridge() ? TileDirection.BottomLeft : TileDirection.BottomRight;
        const secondTile = this.tiles.getNeighbourTile(tile, direction);
        return [tile, secondTile, secondTile && this.tiles.getNeighbourTile(secondTile, direction)];
    }

    findMapHighBridgeHeadTiles(): Set<Tile> {
        const bridgeSetTiles = this.tiles.getAllBridgeSetTiles();
        const headTiles = new Set<Tile>();
        for (const tile of bridgeSetTiles) {
            const boundary = this.findHighBridgeBoundary(tile);
            if (boundary) {
                headTiles.add(boundary.tile);
            }
        }
        return headTiles;
    }

    findBridgeSpecsForHeadTiles(headTiles: Set<Tile>): BridgeSpec[] {
        const specMap = new Map<string, BridgeSpec>();
        for (const tile of headTiles) {
            const spec = this.findClosestBridgeSpec(tile);
            if (spec) {
                specMap.set(spec.start.id + ':' + spec.end.id, spec);
            }
        }
        // `Array.from`, not `[...specMap.values()]` — see TileOccupation.getEmptyTiles
        return Array.from(specMap.values());
    }

    findAllBridgeTiles(spec: BridgeSpec): (Tile | undefined)[] {
        const tiles: (Tile | undefined)[] = [];
        const direction = spec.start.rx !== spec.end.rx ? TileDirection.BottomLeft : TileDirection.BottomRight;
        for (const pieceTile of this.findNonBuildablePieceTiles(spec)) {
            const secondTile = this.tiles.getNeighbourTile(pieceTile, direction);
            const thirdTile = secondTile && this.tiles.getNeighbourTile(secondTile, direction);
            tiles.push(pieceTile, secondTile, thirdTile);
        }
        return tiles;
    }

    findBridgePieces(spec: BridgeSpec): BridgePiece[] {
        const finder = this.createBridgePieceTileFinder(spec, (tile: Tile) => !!this.getPieceAtTile(tile));
        const pieces: BridgePiece[] = [];
        let tile: Tile | undefined;
        while ((tile = finder.getNextTile())) {
            pieces.push(this.getPieceAtTile(tile)!);
        }
        return pieces;
    }

    findDestroyedPieceTiles(spec: BridgeSpec): Tile[] {
        const finder = this.createBridgePieceTileFinder(
            spec,
            (tile: Tile) =>
                !(
                    this.getPieceAtTile(tile) ||
                    (this.tileSets.isHighBridgeMiddleTile(tile.tileNum) && tile.z === spec.start.z)
                ),
        );
        const tiles: Tile[] = [];
        let tile: Tile | undefined;
        while ((tile = finder.getNextTile())) {
            tiles.push(tile);
        }
        return tiles;
    }

    findNonBuildablePieceTiles(spec: BridgeSpec): Tile[] {
        const finder = this.createBridgePieceTileFinder(
            spec,
            (tile: Tile) => !(this.tileSets.isHighBridgeMiddleTile(tile.tileNum) && tile.z === spec.start.z),
        );
        const tiles: Tile[] = [];
        let tile: Tile | undefined;
        while ((tile = finder.getNextTile())) {
            tiles.push(tile);
        }
        return tiles;
    }

    private createBridgePieceTileFinder(spec: BridgeSpec, predicate: (tile: Tile) => boolean): DirectionalTileFinder {
        const isXDirection = spec.start.rx !== spec.end.rx;
        return new DirectionalTileFinder(
            this.tiles,
            this.mapBounds,
            spec.start,
            1,
            (isXDirection ? spec.end.rx - spec.start.rx : spec.end.ry - spec.start.ry) - 1,
            Number(isXDirection),
            Number(!isXDirection),
            predicate,
            false,
        );
    }

    dispose(): void {
        this.pieces.forEach((piece) => {
            piece.prev = undefined;
            piece.next = undefined;
        });
        this.tileOccupation.onChange.unsubscribe(this.handleTileOccupationUpdate);
    }
}
