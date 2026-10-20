/**
 * Passability graphs + the one path query the whole game goes through.
 *
 * Reference: redalert2/src/game/map/Terrain.ts (532 lines).
 *
 * One cached A* graph per (speedType, onBridge) pair. A node exists iff a cell
 * can be *entered*; edges exist between cells one height step apart. Placing a
 * building removes nodes and re-adds them lazily: `TileOccupation.onChange`
 * marks the affected cells dirty and the next query patches only those.
 *
 * Four things here are load-bearing and easy to "fix" into a bug:
 *
 *   1. **`updatePassability` recomputes the SOUTH side.** `computePassability`
 *      only links northward (`Left/TopLeft/Top/TopRight`) because `addLink` is
 *      symmetric, so when a cell changes it is the *southern* neighbours whose
 *      links pointed at it that must be rebuilt. Using the north set in both
 *      places looks symmetric and silently leaves stale edges behind a
 *      destroyed building.
 *
 *   2. **`computePath` mutates the shared graph and must undo it in `finally`.**
 *      Forced start nodes, temporarily-passable blocker cells and the synthetic
 *      end node all live in the *shared* graph. If the search throws and the
 *      cleanup is skipped, ghost passable nodes stay inside buildings forever
 *      and every later path near them misbehaves.
 *
 *   3. **The island check is an optimisation with an escape hatch.** When the
 *      start cell already has an island id, a target on another island cannot
 *      be reached and the search is skipped. The id is `undefined` for a cell
 *      that was just forced into the graph, and `undefined === undefined` would
 *      accept *every* nodeless cell — hence `useIslandIds` gates the map
 *      comparison and falls back to a real speed test.
 *
 *   4. **`graph.addNode` on an existing id REPLACES its data**, wiping
 *      `islandId` while keeping the edges. So the synthetic end node is only
 *      added when absent.
 */
import { TileCollection, TileDirection, Tile } from './TileCollection';
import { SpeedType } from '../type/SpeedType';
import { Graph, GraphNode, PathFinder } from '../Graph';
import { isNotNullOrUndefined } from '../util/typeGuard';
import { RadialTileFinder } from './tileFinder/RadialTileFinder';
import { rectContainsPoint } from '../util/geometry';
import { LandType, getLandType } from '../type/LandType';
import { OccupationBits } from '../rules/TerrainRules';
import { MapBounds } from './MapBounds';
import { Rules } from '../rules/Rules';

interface GameObject {
    tile: Tile;
    onBridge?: any;
    zone?: number;
    isTerrain(): boolean;
    isOverlay(): boolean;
    isBridge(): boolean;
    isTiberium(): boolean;
    isBuilding(): boolean;
    isAircraft(): boolean;
    isInfantry(): boolean;
    isVehicle(): boolean;
    isSmudge(): boolean;
    isHighBridge(): boolean;
    isBridgePlaceholder(): boolean;
    isUnit(): boolean;
    /**
     * Optional because only the building branches read them: a `Unit` has no
     * `art` and is never destroyed-while-standing in the way a structure is.
     * The reference declares both as required on `GameObject` because its
     * `GameObject` is the real base class; ours is a structural contract that
     * units and structures both satisfy.
     */
    isDestroyed?: boolean;
    art?: any;
    rules: any;
    position: any;
    moveTrait: any;
}

interface Bridge {
    tileElevation?: number;
    isHighBridge(): boolean;
    /** present on the real overlay object; the path query only probes it */
    isDestroyed?: boolean;
}

export interface PathNode {
    tile: Tile;
    onBridge?: Bridge;
}

interface TileOccupation {
    onChange: {
        subscribe(handler: (event: { tiles: Tile[]; object: GameObject }) => void): void;
        unsubscribe(handler: (event: { tiles: Tile[]; object: GameObject }) => void): void;
    };
    calculateTilesForGameObject(tile: Tile, object: GameObject): Tile[];
    getBridgeOnTile(tile: Tile): Bridge | undefined;
    getObjectsOnTile(tile: Tile): GameObject[];
    getGroundObjectsOnTile(tile: Tile): GameObject[];
}

interface NodeData {
    tile: Tile;
    onBridge?: Bridge;
    islandId?: number;
}

export interface PathOptions {
    maxExpandedNodes?: number;
    bestEffort?: boolean;
    excludeTiles?: (node: PathNode) => boolean;
    ignoredBlockers?: GameObject[];
}

export interface Obstacle {
    /**
     * The full occupant, not the reduced `GameObject` contract above.
     *
     * `MoveTask` reads `direction`, `owner`, `orders` and `moveTrait` off it —
     * all `Unit` members the reference gets for free because its `GameObject` is
     * the real base class. Typing this as `GameObject` would only push a cast
     * into the caller.
     */
    obj: any;
    static: boolean;
}

function calculateDistance(nodeA: GraphNode<NodeData>, nodeB: GraphNode<NodeData>): number {
    const dx = Math.abs(nodeA.data.tile.rx - nodeB.data.tile.rx);
    const dy = Math.abs(nodeA.data.tile.ry - nodeB.data.tile.ry);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

/**
 * Octile distance, plus a 0.2 surcharge whenever the direction of travel
 * changes between the grandparent and the child.
 *
 * That surcharge is why units prefer a straight lane over a staircase of equal
 * length, and it is applied through `pathInfo` — the search state object is
 * reused as scratch storage for the parent's direction, which is why the
 * heuristic has a side effect.
 */
function calculateHeuristic(
    nodeA: GraphNode<NodeData>,
    nodeB: GraphNode<NodeData>,
    pathInfo?: {
        parent?: { node: GraphNode<NodeData>; dirX: number; dirY: number };
        dirX?: number;
        dirY?: number;
    },
): number {
    const dx = Math.abs(nodeA.data.tile.rx - nodeB.data.tile.rx);
    const dy = Math.abs(nodeA.data.tile.ry - nodeB.data.tile.ry);
    let distance = dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
    if (pathInfo?.parent) {
        const parentNode = pathInfo.parent.node;
        const newDirX = parentNode.data.tile.rx - nodeA.data.tile.rx;
        const newDirY = parentNode.data.tile.ry - nodeA.data.tile.ry;
        pathInfo.dirX = newDirX;
        pathInfo.dirY = newDirY;
        if (newDirX !== pathInfo.parent.dirX || newDirY !== pathInfo.parent.dirY) {
            distance += 0.2;
        }
    }
    return distance;
}

export class Terrain {
    private passabilityGraphs = new Map<string, Graph<NodeData>>();
    private invalidatedTiles = new Map<string, Set<Tile>>();
    /**
     * How many nodes the last `computePath` expanded.
     *
     * Not in the reference — the AI build scan uses it to spot a query that hit
     * `maxExpandedNodes` and gave up. Purely diagnostic: nothing reads it to
     * make a decision.
     */
    lastExpanded = 0;

    constructor(
        private tiles: TileCollection,
        private theaterType: any,
        private mapBounds: MapBounds,
        private tileOccupation: TileOccupation,
        private rules: Rules,
    ) {
        this.tileOccupation.onChange.subscribe(this.handleTileOccupationUpdate);
        this.mapBounds.onLocalResize.subscribe(this.handleMapBoundsResize);
    }

    /**
     * A cell changed occupant. Rebuild only the graphs whose answer could have
     * changed — a infantry-only obstacle does not touch the Track graph.
     */
    private handleTileOccupationUpdate = ({ tiles, object }: { tiles: Tile[]; object: GameObject }) => {
        const relevantTiles = tiles.filter((tile) => {
            let speedType = SpeedType.Foot;
            let isInfantry = true;
            if (
                object.isTerrain() &&
                object.rules.getOccupationBits(this.theaterType) !== OccupationBits.All
            ) {
                speedType = SpeedType.Wheel;
                isInfantry = false;
            }
            return (
                (object.isOverlay() && (object.isBridge() || object.isTiberium())) ||
                this.isBlockerObject(object, tile, false, speedType, isInfantry) ||
                this.isBlockerObject(object, tile, true, speedType, isInfantry) ||
                (object.isBuilding() && object.rules.leaveRubble)
            );
        });
        if (relevantTiles.length) {
            this.invalidateTiles(relevantTiles);
        }
    };

    private handleMapBoundsResize = () => {
        this.passabilityGraphs.clear();
    };

    private getGraphKey(speedType: SpeedType, onBridge: boolean): string {
        return speedType + '_' + Number(onBridge);
    }

    private invalidateTiles(tiles: Tile[]): void {
        if (!tiles.length) return;
        Array.from(this.passabilityGraphs.keys()).forEach((graphKey) => {
            const invalidatedSet = this.invalidatedTiles.get(graphKey);
            if (invalidatedSet) {
                tiles.forEach((tile) => invalidatedSet!.add(tile));
            } else {
                this.invalidatedTiles.set(graphKey, new Set(tiles));
            }
        });
    }

    computePath(
        speedType: SpeedType,
        onBridge: boolean,
        startTile: Tile,
        startOnBridge: boolean,
        endTile: Tile,
        endOnBridge: boolean,
        options: PathOptions = {},
    ): PathNode[] {
        const {
            maxExpandedNodes = Number.POSITIVE_INFINITY,
            bestEffort = true,
            excludeTiles,
            ignoredBlockers = [],
        } = options;
        const graph = this.computePassabilityGraph(speedType, onBridge);

        const ignoredTiles = ignoredBlockers
            .map((blocker) => this.tileOccupation.calculateTilesForGameObject(blocker.tile, blocker))
            .reduce((acc, tiles) => acc.concat(tiles), []);
        if (ignoredTiles.length) {
            this.updatePassability(ignoredTiles, speedType, onBridge, graph, ignoredBlockers);
        }

        const startNodeId = this.getNodeId(startTile, startOnBridge);
        const hasStartNode = graph.hasNode(startNodeId);
        if (!hasStartNode) {
            graph.addNode(startNodeId, {
                tile: startTile,
                onBridge: this.tileOccupation.getBridgeOnTile(startTile),
            });
            this.updatePassability([startTile], speedType, onBridge, graph, ignoredBlockers, 1);
        }

        const endNodeId = this.getNodeId(endTile, endOnBridge);
        const hasEndNode = graph.hasNode(endNodeId);
        let finalEndTile = endTile;
        let finalEndOnBridge = endOnBridge;
        let addedEndNode = false;

        // The graph mutations above (ignored blockers, forced start node) MUST
        // be reverted even when the search throws — a skipped cleanup leaves
        // force-passable ghost nodes inside buildings in the shared graph, and
        // every later query near them misbehaves (units pathing through
        // buildings, "toId is not defined" crashes on ordinary move orders,
        // war factories wedged mid-delivery).
        try {
            const useIslandCheck = hasStartNode && !ignoredTiles.length;
            let islandChecker: ((tile: Tile, onBridge: boolean) => boolean) | undefined;
            let useIslandIds = false;
            if (useIslandCheck) {
                const islandIdMap = this.getIslandIdMap(speedType, onBridge);
                const startIslandId = islandIdMap.get(startTile, startOnBridge);
                // An undefined start island id (freshly re-added node) would make
                // the checker accept every NODELESS tile (undefined === undefined)
                // and hand the path finder a target that isn't in the graph.
                useIslandIds = startIslandId !== undefined;
                islandChecker = useIslandIds
                    ? (tile, tileOnBridge) => islandIdMap.get(tile, tileOnBridge) === startIslandId
                    : (tile, tileOnBridge) =>
                          this.getPassableSpeed(tile, speedType, onBridge, tileOnBridge, ignoredBlockers) > 0;
            } else {
                islandChecker = (tile, tileOnBridge) =>
                    this.getPassableSpeed(tile, speedType, onBridge, tileOnBridge, ignoredBlockers) > 0;
            }

            if (!hasEndNode || !islandChecker(endTile, endOnBridge)) {
                const fallbackTile = bestEffort
                    ? new RadialTileFinder(
                          this.tiles,
                          this.mapBounds,
                          endTile,
                          { width: 1, height: 1 },
                          1,
                          useIslandCheck ? 15 : 5,
                          (tile) =>
                              islandChecker!(tile, false) &&
                              Math.abs(tile.z - endTile.z) < 2 &&
                              !excludeTiles?.({ tile, onBridge: undefined }),
                      ).getNextTile()
                    : undefined;
                if (fallbackTile) {
                    finalEndTile = fallbackTile;
                    finalEndOnBridge = false;
                } else {
                    if (useIslandCheck && useIslandIds) {
                        return [];
                    }
                    // Graph.addNode on an EXISTING id replaces its data, wiping
                    // the island id while keeping edges — only add when absent.
                    if (!hasEndNode) {
                        graph.addNode(endNodeId, { tile: endTile, onBridge: undefined });
                        addedEndNode = true;
                    }
                    // Reference: a no-op expression left in place. Kept verbatim
                    // so the line number and shape stay recognisable.
                    Math.min(maxExpandedNodes, 500);
                }
            }

            const finalStartId = this.getNodeId(startTile, startOnBridge);
            const finalEndId = this.getNodeId(finalEndTile, finalEndOnBridge);
            if (!graph.hasNode(finalStartId) || !graph.hasNode(finalEndId)) {
                // Unreachable/unknown endpoint: "no path", never a crash.
                return [];
            }

            const pathFinder = new PathFinder(graph, {
                bestEffort,
                maxExpandedNodes,
                excludedNodes: excludeTiles,
                distance: calculateDistance,
                heuristic: calculateHeuristic,
            });
            let path: PathNode[] = pathFinder
                .find(finalStartId, finalEndId)
                .map((node: GraphNode<NodeData>) => ({
                    tile: node.data.tile,
                    onBridge: node.data.onBridge,
                }));
            this.lastExpanded = pathFinder.lastExpanded;

            if (
                path.length < 2 ||
                (excludeTiles &&
                    path.length &&
                    ((!bestEffort && path[0].tile !== finalEndTile) ||
                        path[path.length - 1].tile !== startTile))
            ) {
                path = [];
            }
            return path;
        } finally {
            if (!hasStartNode) {
                graph.removeNode(startNodeId);
                this.updatePassability([startTile], speedType, onBridge, graph);
            }
            if (addedEndNode) {
                graph.removeNode(endNodeId);
            }
            if (ignoredTiles.length) {
                this.updatePassability(ignoredTiles, speedType, onBridge, graph);
            }
        }
    }

    computeAllPassabilityGraphs(): void {
        Object.keys(SpeedType).forEach((key) => {
            const speedType = Number(key);
            if (!isNaN(speedType) && speedType !== SpeedType.Winged) {
                this.computePassabilityGraph(speedType, false);
                this.computePassabilityGraph(speedType, true);
            }
        });
    }

    private computePassabilityGraph(speedType: SpeedType, onBridge: boolean): Graph<NodeData> {
        const graphKey = this.getGraphKey(speedType, onBridge);
        let graph = this.passabilityGraphs.get(graphKey);
        if (graph) {
            const invalidatedSet = this.invalidatedTiles.get(graphKey);
            if (invalidatedSet?.size) {
                this.updatePassability(Array.from(invalidatedSet), speedType, onBridge, graph);
                invalidatedSet.clear();
                this.computeIslandIds(graph);
            }
        } else {
            graph = new Graph<NodeData>();
            this.passabilityGraphs.set(graphKey, graph);
            this.tiles.forEach((tile) => {
                this.computePassability(tile, speedType, onBridge, graph);
            });
            this.computeIslandIds(graph);
        }
        return graph;
    }

    /**
     * Rebuild the cells that changed **and their southern neighbours**.
     *
     * See the file header, point 1: the north set is used by
     * `computePassability`, so the south set is what has to be rebuilt here.
     * Island ids are saved and restored around the rebuild so the caller does
     * not have to re-flood the whole map for a one-cell change.
     */
    private updatePassability(
        tiles: Tile[],
        speedType: SpeedType,
        onBridge: boolean,
        graph: Graph<NodeData>,
        ignoredBlockers: GameObject[] = [],
        forcePassable?: number,
    ): void {
        const affectedTiles = new Set<Tile>();
        tiles.forEach((tile) => {
            [
                tile,
                this.tiles.getNeighbourTile(tile, TileDirection.Right),
                this.tiles.getNeighbourTile(tile, TileDirection.BottomRight),
                this.tiles.getNeighbourTile(tile, TileDirection.Bottom),
                this.tiles.getNeighbourTile(tile, TileDirection.BottomLeft),
            ]
                .filter(isNotNullOrUndefined)
                .forEach((t) => affectedTiles.add(t));
        });

        const savedIslandIds = new Map<string, number | undefined>();
        tiles.forEach((tile) => {
            const nodes = [graph.getNode(this.getNodeId(tile, false)), graph.getNode(this.getNodeId(tile, true))];
            for (const node of nodes) {
                if (node) {
                    savedIslandIds.set(node.id, node.data.islandId);
                    graph.removeNode(node.id);
                }
            }
        });

        affectedTiles.forEach((tile) => {
            this.computePassability(
                tile,
                speedType,
                onBridge,
                graph,
                ignoredBlockers,
                forcePassable && tiles.includes(tile) ? forcePassable : undefined,
            );
        });

        savedIslandIds.forEach((islandId, nodeId) => {
            const node = graph.getNode(nodeId);
            if (node) {
                node.data.islandId = islandId;
            }
        });
    }

    /**
     * Add the node for `tile` (and for its bridge level) and link it northward
     * to each of the four northern neighbours that accept `speedType`.
     */
    private computePassability(
        tile: Tile,
        speedType: SpeedType,
        onBridge: boolean,
        graph: Graph<NodeData>,
        ignoredBlockers: GameObject[] = [],
        forcePassable?: number,
    ): void {
        const directions = [
            TileDirection.Left,
            TileDirection.TopLeft,
            TileDirection.Top,
            TileDirection.TopRight,
        ];
        if (forcePassable || this.getPassableSpeed(tile, speedType, onBridge, false, ignoredBlockers)) {
            const nodeId = this.getNodeId(tile, false);
            if (!graph.hasNode(nodeId)) {
                graph.addNode(nodeId, { tile, onBridge: undefined });
            }
            for (const direction of directions) {
                this.connectTiles(tile, undefined, direction, speedType, onBridge, graph, ignoredBlockers);
            }
        }

        const bridge = this.tileOccupation.getBridgeOnTile(tile);
        if (bridge && (forcePassable || this.getPassableSpeed(tile, speedType, onBridge, true, ignoredBlockers))) {            const nodeId = this.getNodeId(tile, true);
            if (!graph.hasNode(nodeId)) {
                graph.addNode(nodeId, { tile, onBridge: bridge });
            }
            for (const direction of directions) {
                this.connectTiles(tile, bridge, direction, speedType, onBridge, graph, ignoredBlockers);
            }
        }
    }

    /**
     * Link `tile` to its neighbour in `direction`.
     *
     * The elevation rule is the whole reason bridges are tricky: on the ground a
     * step of more than one level is impossible; on a bridge the two ends must
     * be at *exactly* the same base height, because a bridge deck is flat. The
     * special case in the middle — two high-bridge heads meeting over a gap,
     * where `tile.z` differs but both are high bridges — is what lets a
     * destroyed span be re-linked when it is rebuilt.
     */
    private connectTiles(
        tile: Tile,
        bridge: Bridge | undefined,
        direction: TileDirection,
        speedType: SpeedType,
        onBridge: boolean,
        graph: Graph<NodeData>,
        ignoredBlockers: GameObject[] = [],
    ): void {
        const neighborTile = this.tiles.getNeighbourTile(tile, direction);
        if (!neighborTile) return;

        let neighborBridge = this.tileOccupation.getBridgeOnTile(neighborTile);
        const maxElevationDiff = bridge || neighborBridge ? 0 : 1;
        const elevationDiff = Math.abs(
            tile.z +
                (bridge?.tileElevation ?? 0) -
                (neighborTile.z + (neighborBridge?.tileElevation ?? 0)),
        );
        if (elevationDiff > maxElevationDiff) {
            if (
                (!neighborBridge?.isHighBridge() && !bridge?.isHighBridge()) ||
                Math.abs(tile.z - neighborTile.z) !== 0 ||
                !graph.hasNode(this.getNodeId(tile, false))
            ) {
                return;
            }
            bridge = neighborBridge = undefined;
        }

        if (!this.getPassableSpeed(neighborTile, speedType, onBridge, !!neighborBridge, ignoredBlockers)) {
            return;
        }

        const neighborNodeId = this.getNodeId(neighborTile, !!neighborBridge);
        const neighborNode =
            graph.getNode(neighborNodeId) ??
            graph.addNode(neighborNodeId, { tile: neighborTile, onBridge: neighborBridge });
        const currentNodeId = this.getNodeId(tile, !!bridge);
        const currentNode = graph.getNode(currentNodeId);
        if (currentNode) {
            currentNode.addLink(neighborNode);
        }
    }

    private getNodeId(tile: Tile, onBridge: boolean): string {
        return tile.id + (onBridge ? '_bridge' : '');
    }

    private computeIslandIds(graph: Graph<NodeData>): void {
        let islandId = 1;
        graph.forEachNode((node) => {
            node.data.islandId = undefined;
        });
        graph.forEachNode((node) => {
            if (!node.data.islandId) {
                this.floodIslandId(node, islandId++);
            }
        });
    }

    private floodIslandId(startNode: GraphNode<NodeData>, islandId: number): void {
        const queue = [startNode];
        while (queue.length) {
            const node = queue.pop()!;
            node.data.islandId = islandId;
            for (const neighbor of node.neighbors) {
                if (!neighbor.data.islandId) {
                    queue.push(neighbor);
                }
            }
        }
    }

    getIslandIdMap(speedType: SpeedType, onBridge: boolean) {
        const graph = this.computePassabilityGraph(speedType, onBridge);
        return {
            get: (tile: Tile, onBridge: boolean): number | undefined => {
                const nodeId = this.getNodeId(tile, onBridge);
                return graph.getNode(nodeId)?.data.islandId;
            },
        };
    }

    /**
     * Movement multiplier for a cell, 0 when it cannot be entered.
     *
     * **Parameter names are the opposite of the reference's.** The original
     * declares `(tile, speedType, onBridge, bridgeLevel, ...)`, but every single
     * caller passes `(isInfantry, onBridge)` — twenty-odd call sites in
     * `locomotor/`, `task/` and `Projectile`. The data flow is what actually
     * runs, so the names here follow the callers:
     *
     *   isInfantry  fed to `isBlockerObject`, where it exempts partial terrain
     *               and widens a building's impassable depth to its full width
     *   onBridge    selects `onBridgeLandType` over `landType`
     *
     * The one place the reference does *not* follow this convention is its own
     * `computePassability`, which passes the graph's `onBridge` flag as
     * `isInfantry`. That is a genuine reference bug — it makes every object on
     * a bridge-level graph take the infantry blocker path — and it is copied
     * verbatim at the two call sites below.
     *
     * The `Wall` special case: a wall has no track speed of its own, but the
     * *ground under it* does, which is what lets a crusher drive at a wall
     * (and then be stopped by `isBlockerObject`, not by the speed table).
     */
    public getPassableSpeed(
        tile: Tile,
        speedType: SpeedType,
        isInfantry: boolean,
        onBridge: boolean,
        ignoredBlockers: GameObject[] = [],
        skipBlockerCheck = false,
    ): number {
        if (!this.mapBounds.isWithinBounds(tile)) return 0;

        let landType = onBridge ? tile.onBridgeLandType : tile.landType;
        if (landType === undefined) return 0;
        if (landType === LandType.Wall && speedType === SpeedType.Track) {
            landType = getLandType(tile.terrainType);
        }
        const landRules = this.rules.getLandRules(landType);
        const speedModifier = landRules.getSpeedModifier(speedType);
        if (!speedModifier) return 0;

        if (!skipBlockerCheck) {
            for (const obj of this.tileOccupation.getObjectsOnTile(tile)) {
                if (
                    this.isBlockerObject(obj, tile, onBridge, speedType, isInfantry) &&
                    !ignoredBlockers.includes(obj)
                ) {
                    return 0;
                }
            }
        }
        return speedModifier;
    }

    /**
     * Does `obj` stop a unit of `speedType` from entering `tile`?
     *
     * The order of the checks matters — each one is an exemption from the
     * previous verdict, and several look wrong until you see the rule they
     * encode:
     *
     *   - terrain with partial `OccupationBits` never blocks infantry: a tree
     *     or a rock occupies some sub-cells, and the soldier walks around it.
     *   - a destroyed building that leaves rubble stops blocking.
     *   - a gate stops blocking (it opens for its owner; the *unit* filter
     *     decides who may pass, not the terrain).
     *   - for infantry the impassable depth is the whole foundation width,
     *     not `numberImpassableRows` — infantry cannot walk into a building's
     *     footprint at all, while a tank can drive up to the last row.
     *   - a weapons factory with no explicit `numberImpassableRows` is
     *     passable except its last row, because the exit pad is part of it.
     */
    private isBlockerObject(
        obj: GameObject,
        tile: Tile,
        bridgeLevel: boolean,
        speedType: SpeedType,
        isInfantry: boolean,
    ): boolean {
        if (
            obj.isTerrain() &&
            isInfantry &&
            obj.rules.getOccupationBits(this.theaterType) !== OccupationBits.All
        ) {
            return false;
        }
        if (obj.isBuilding()) {
            if (obj.rules.invisibleInGame) return false;
            if (obj.isDestroyed && obj.rules.leaveRubble) return false;
            if (obj.rules.gate) return false;

            const foundation = obj.art.foundation;
            let impassableRows = obj.rules.numberImpassableRows;
            if (isInfantry) {
                impassableRows = foundation.width;
            } else if (obj.rules.weaponsFactory && !impassableRows) {
                impassableRows = foundation.width - 1;
            }
            const rect = {
                x: obj.tile.rx,
                y: obj.tile.ry,
                width: (impassableRows || foundation.width) - 1,
                height: foundation.height - 1,
            };
            return rectContainsPoint(rect, { x: tile.rx, y: tile.ry });
        }
        if (obj.isAircraft() || obj.isInfantry() || obj.isVehicle() || obj.isSmudge()) {
            return false;
        }
        if (obj.isOverlay()) {
            if (
                (bridgeLevel && obj.isBridge()) ||
                (!bridgeLevel && obj.isHighBridge()) ||
                obj.isTiberium() ||
                obj.rules.crate ||
                obj.isBridgePlaceholder()
            ) {
                return false;
            }
        }
        if ([SpeedType.Track, SpeedType.Hover].includes(speedType) && obj.rules.crushable) {
            return false;
        }
        return true;
    }

    /**
     * Everything on the cell that can stop `unit` right now.
     *
     * `static` separates terrain/structures (re-route around) from units
     * (negotiate or crush). The infantry branch is the subtle one: two soldiers
     * only conflict when they want the *same* sub-cell, and a terrain object
     * only conflicts when it actually occupies the sub-cell the soldier wants.
     */
    findObstacles(pathNode: PathNode, unit: GameObject): Obstacle[] {
        const speedType = unit.rules.speedType;
        const isInfantry = unit.isInfantry();
        const obstacles: Obstacle[] = [];
        for (const obj of this.tileOccupation.getGroundObjectsOnTile(pathNode.tile)) {
            if (obj === unit) continue;
            const isStaticBlocker = this.isBlockerObject(
                obj,
                pathNode.tile,
                !!pathNode.onBridge,
                speedType,
                isInfantry,
            );
            let shouldInclude = false;
            if (isStaticBlocker) {
                shouldInclude = true;
            } else if (obj.isUnit()) {
                const sameLocation = obj.tile === pathNode.tile && obj.onBridge === !!pathNode.onBridge;
                const inReservedPath = obj.moveTrait.reservedPathNodes.find(
                    (node: PathNode) => node.tile === pathNode.tile && !!node.onBridge === !!pathNode.onBridge,
                );
                if (sameLocation || inReservedPath) {
                    shouldInclude = true;
                }
            } else if ([SpeedType.Track, SpeedType.Hover].includes(speedType) && obj.rules.crushable) {
                shouldInclude = true;
            } else if (isInfantry && obj.isTerrain()) {
                shouldInclude = true;
            } else if (obj.isBuilding() && obj.rules.gate) {
                shouldInclude = true;
            }
            if (shouldInclude) {
                const obstacle: Obstacle = { obj, static: isStaticBlocker };
                if (obj.isInfantry() && isInfantry) {
                    if (obj.position.desiredSubCell === unit.position.desiredSubCell) {
                        obstacles.push(obstacle);
                    }
                } else {
                    const skipForInfantryTerrain =
                        obj.isTerrain() &&
                        isInfantry &&
                        !obj.rules.getOccupiedSubCells(this.theaterType).includes(unit.position.desiredSubCell);
                    if (!skipForInfantryTerrain) {
                        obstacles.push(obstacle);
                    }
                }
            }
        }
        return obstacles;
    }

    /**
     * Per-cell reachability mask, flooded over the **cached** graph.
     *
     * Not in the reference. The AI build scan asks "can a unit reach my base
     * from here" a dozen times per placement, and a `Set<string>` over 6,400
     * cells cost ~8 ms per call in the debug build — a visible freeze every time
     * the AI picked a spot. Returning a `Uint8Array` indexed by `rx + ry*width`
     * brought it under a millisecond.
     *
     * The graph is never mutated, so no invalidate / rebuild / island pass is
     * triggered by asking.
     */
    computeReachableMask(
        startTile: Tile,
        speedType: SpeedType,
        onBridge: boolean,
        blocked: (tile: Tile) => boolean,
    ): Uint8Array {
        const graph = this.computePassabilityGraph(speedType, onBridge);
        const { width } = this.tiles.getMapSize();
        const mask = new Uint8Array(width * this.tiles.getMapSize().height);
        const startId = this.getNodeId(startTile, false);
        const startNode = graph.getNode(startId);
        if (!startNode) return mask;

        const stack: GraphNode<NodeData>[] = [startNode];
        mask[startTile.rx + startTile.ry * width] = 1;
        while (stack.length) {
            const node = stack.pop()!;
            for (const nb of node.neighbors) {
                const t = nb.data.tile;
                const idx = t.rx + t.ry * width;
                if (mask[idx]) continue;
                mask[idx] = 1;
                if (blocked(t)) continue;
                stack.push(nb);
            }
        }
        return mask;
    }

    dispose(): void {
        this.tileOccupation.onChange.unsubscribe(this.handleTileOccupationUpdate);
        this.mapBounds.onLocalResize.unsubscribe(this.handleMapBoundsResize);
    }
}
