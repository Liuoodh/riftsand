/**
 * Passability graph + A* entry point — port of
 *   redalert2/src/game/map/Terrain.ts
 *
 * Every speed type gets its own cached graph of passable cells; a building
 * placement invalidates the affected ring of cells and the graph is patched
 * lazily. The search itself lives in Graph.ts.
 *
 * No bridges in this game: the `bridge` parameters are kept so the call sites
 * read exactly like the reference, but they are always false / undefined.
 */
import { Graph } from './Graph';
import { PathFinder } from './Graph';
import { MapBounds, RadialTileFinder, Tile, TileCollection, TileDirection } from './Tiles';
import { TileOccupation, Occupant } from './TileOccupation';
import { isBuildingObject } from './Constants';
import { SpeedType, LandType, getSpeedModifier, getLandType } from './rules/TerrainRules';

export { SpeedType };
export { LandType };

export enum MovementZone {
    Ground = 0,
    Fly = 1,
    Infantry = 2,
}

export interface NodeData {
    tile: Tile;
    onBridge?: any;
    islandId?: number;
}

export interface PathNode {
    tile: Tile;
    onBridge?: any;
}

export interface Obstacle {
    obj: Occupant;
    static: boolean;
}

export interface PathOptions {
    maxExpandedNodes?: number;
    bestEffort?: boolean;
    excludeTiles?: (node: PathNode) => boolean;
    ignoredBlockers?: Occupant[];
}

export interface TerrainWorld {
    tiles: TileCollection;
    mapBounds: MapBounds;
    tileOccupation: TileOccupation;
    /** movement multiplier for the cell, 0 = impassable */
    speedAt(rx: number, ry: number, isInfantry: boolean, hover: boolean): number;
}

function calculateDistance(nodeA: any, nodeB: any): number {
    const dx = Math.abs(nodeA.data.tile.rx - nodeB.data.tile.rx);
    const dy = Math.abs(nodeA.data.tile.ry - nodeB.data.tile.ry);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

function calculateHeuristic(nodeA: any, nodeB: any, pathInfo?: any): number {
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

export class Passability {
    private passabilityGraphs = new Map<string, Graph<NodeData>>();
    private invalidatedTiles = new Map<string, Set<Tile>>();
    lastExpanded = 0;

    constructor(private world: TerrainWorld) {}

    private getGraphKey(speedType: SpeedType, isInfantry: boolean): string {
        return speedType + '_' + Number(isInfantry);
    }

    /** called by TileOccupation.onChange when a structure appears / disappears */
    handleTileOccupationUpdate = (tiles: Tile[], object: Occupant) => {
        const relevant = tiles.filter((tile) => {
            if (isBuildingObject(object)) return true;
            if (object.isTerrain?.()) return true;
            return false;
        });
        if (relevant.length) this.invalidateTiles(relevant);
    };

    invalidateTiles(tiles: Tile[]): void {
        if (!tiles.length) return;
        for (const key of Array.from(this.passabilityGraphs.keys())) {
            const set = this.invalidatedTiles.get(key);
            if (set) tiles.forEach((t) => set.add(t));
            else this.invalidatedTiles.set(key, new Set(tiles));
        }
    }

    computePath(
        speedType: SpeedType,
        isInfantry: boolean,
        startTile: Tile,
        startOnBridge: boolean,
        endTile: Tile,
        endOnBridge: boolean,
        options: PathOptions = {},
    ): PathNode[] {
        const { maxExpandedNodes = Number.POSITIVE_INFINITY, bestEffort = true, excludeTiles, ignoredBlockers = [] } = options;
        const graph = this.computePassabilityGraph(speedType, isInfantry);
        const ignoredTiles = ignoredBlockers
            .map((blocker) => this.world.tileOccupation.calculateTilesForGameObject(blocker.tile, blocker))
            .reduce((acc, tiles) => acc.concat(tiles), []);
        if (ignoredTiles.length) this.updatePassability(ignoredTiles, speedType, isInfantry, graph, ignoredBlockers);

        const startNodeId = this.getNodeId(startTile, startOnBridge);
        const hasStartNode = graph.hasNode(startNodeId);
        if (!hasStartNode) {
            graph.addNode(startNodeId, { tile: startTile, onBridge: undefined });
            this.updatePassability([startTile], speedType, isInfantry, graph, ignoredBlockers, 1);
        }

        const endNodeId = this.getNodeId(endTile, endOnBridge);
        const hasEndNode = graph.hasNode(endNodeId);
        let finalEndTile = endTile;
        let finalEndOnBridge = endOnBridge;
        let addedEndNode = false;

        try {
            const useIslandCheck = hasStartNode && !ignoredTiles.length;
            let islandChecker: (tile: Tile, onBridge: boolean) => boolean;
            let useIslandIds = false;
            if (useIslandCheck) {
                const islandIdMap = this.getIslandIdMap(speedType, isInfantry);
                const startIslandId = islandIdMap.get(startTile, startOnBridge);
                useIslandIds = startIslandId !== undefined;
                islandChecker = useIslandIds
                    ? (tile, tileOnBridge) => islandIdMap.get(tile, tileOnBridge) === startIslandId
                    : (tile, tileOnBridge) => this.getPassableSpeed(tile, speedType, isInfantry, tileOnBridge, ignoredBlockers) > 0;
            } else {
                islandChecker = (tile, tileOnBridge) =>
                    this.getPassableSpeed(tile, speedType, isInfantry, tileOnBridge, ignoredBlockers) > 0;
            }

            if (!hasEndNode || !islandChecker(endTile, endOnBridge)) {
                const fallbackTile = bestEffort
                    ? new RadialTileFinder(
                          this.world.tiles,
                          this.world.mapBounds,
                          endTile,
                          { width: 1, height: 1 },
                          1,
                          useIslandCheck ? 15 : 5,
                          (tile) =>
                              islandChecker(tile, false) &&
                              Math.abs(tile.z - endTile.z) < 2 &&
                              !excludeTiles?.({ tile, onBridge: undefined }),
                      ).getNextTile()
                    : undefined;
                if (fallbackTile) {
                    finalEndTile = fallbackTile;
                    finalEndOnBridge = false;
                } else {
                    if (useIslandCheck && useIslandIds) return [];
                    if (!hasEndNode) {
                        graph.addNode(endNodeId, { tile: endTile, onBridge: undefined });
                        addedEndNode = true;
                    }
                }
            }

            const finalStartId = this.getNodeId(startTile, startOnBridge);
            const finalEndId = this.getNodeId(finalEndTile, finalEndOnBridge);
            if (!graph.hasNode(finalStartId) || !graph.hasNode(finalEndId)) return [];

            const pathFinder = new PathFinder(graph, {
                bestEffort,
                maxExpandedNodes,
                excludedNodes: excludeTiles,
                distance: calculateDistance,
                heuristic: calculateHeuristic,
            });
            let path: PathNode[] = pathFinder
                .find(finalStartId, finalEndId)
                .map((node: any) => ({ tile: node.data.tile, onBridge: node.data.onBridge }));
            this.lastExpanded = pathFinder.lastExpanded;

            if (
                path.length < 2 ||
                (excludeTiles &&
                    path.length &&
                    ((!bestEffort && path[0].tile !== finalEndTile) || path[path.length - 1].tile !== startTile))
            ) {
                path = [];
            }
            return path;
        } finally {
            if (!hasStartNode) {
                graph.removeNode(startNodeId);
                this.updatePassability([startTile], speedType, isInfantry, graph);
            }
            if (addedEndNode) graph.removeNode(endNodeId);
            if (ignoredTiles.length) this.updatePassability(ignoredTiles, speedType, isInfantry, graph);
        }
    }

    private computePassabilityGraph(speedType: SpeedType, isInfantry: boolean): Graph<NodeData> {
        const graphKey = this.getGraphKey(speedType, isInfantry);
        let graph = this.passabilityGraphs.get(graphKey);
        if (graph) {
            const invalidatedSet = this.invalidatedTiles.get(graphKey);
            if (invalidatedSet?.size) {
                this.updatePassability(Array.from(invalidatedSet), speedType, isInfantry, graph);
                invalidatedSet.clear();
                this.computeIslandIds(graph);
            }
        } else {
            graph = new Graph<NodeData>();
            this.passabilityGraphs.set(graphKey, graph);
            this.world.tiles.forEach((tile) => this.computePassability(tile, speedType, isInfantry, graph));
            this.computeIslandIds(graph);
        }
        return graph;
    }

    private updatePassability(
        tiles: Tile[],
        speedType: SpeedType,
        isInfantry: boolean,
        graph: Graph<NodeData>,
        ignoredBlockers: Occupant[] = [],
        forcePassable?: number,
    ): void {
        const affectedTiles = new Set<Tile>();
        tiles.forEach((tile) => {
            const list = [
                tile,
                this.world.tiles.getNeighbourTile(tile, TileDirection.Left),
                this.world.tiles.getNeighbourTile(tile, TileDirection.TopLeft),
                this.world.tiles.getNeighbourTile(tile, TileDirection.Top),
                this.world.tiles.getNeighbourTile(tile, TileDirection.TopRight),
            ];
            list.forEach((t) => t && affectedTiles.add(t));
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
            this.computePassability(tile, speedType, isInfantry, graph, ignoredBlockers, forcePassable && tiles.indexOf(tile) !== -1 ? forcePassable : undefined);
        });
        savedIslandIds.forEach((islandId, nodeId) => {
            const node = graph.getNode(nodeId);
            if (node) node.data.islandId = islandId;
        });
    }

    private computePassability(
        tile: Tile,
        speedType: SpeedType,
        isInfantry: boolean,
        graph: Graph<NodeData>,
        ignoredBlockers: Occupant[] = [],
        forcePassable?: number,
    ): void {
        const directions = [TileDirection.Left, TileDirection.TopLeft, TileDirection.Top, TileDirection.TopRight];
        if (forcePassable || this.getPassableSpeed(tile, speedType, isInfantry, false, ignoredBlockers)) {
            const nodeId = this.getNodeId(tile, false);
            if (!graph.hasNode(nodeId)) graph.addNode(nodeId, { tile, onBridge: undefined });
            for (const direction of directions) {
                this.connectTiles(tile, direction, speedType, isInfantry, graph, ignoredBlockers);
            }
        }
    }

    private connectTiles(
        tile: Tile,
        direction: TileDirection,
        speedType: SpeedType,
        isInfantry: boolean,
        graph: Graph<NodeData>,
        ignoredBlockers: Occupant[] = [],
    ): void {
        const neighborTile = this.world.tiles.getNeighbourTile(tile, direction);
        if (!neighborTile) return;
        if (Math.abs(tile.z - neighborTile.z) > 1) return;
        if (!this.getPassableSpeed(neighborTile, speedType, isInfantry, false, ignoredBlockers)) return;
        const neighborNodeId = this.getNodeId(neighborTile, false);
        const neighborNode = graph.getNode(neighborNodeId) ?? graph.addNode(neighborNodeId, { tile: neighborTile, onBridge: undefined });
        const currentNode = graph.getNode(this.getNodeId(tile, false));
        if (currentNode) currentNode.addLink(neighborNode);
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
            if (!node.data.islandId) this.floodIslandId(node, islandId++);
        });
    }

    private floodIslandId(startNode: any, islandId: number): void {
        const queue = [startNode];
        while (queue.length) {
            const node = queue.pop()!;
            node.data.islandId = islandId;
            for (const neighbor of node.neighbors) {
                if (!neighbor.data.islandId) queue.push(neighbor);
            }
        }
    }

    /**
     * Flood fill over the *cached* graph, treating `blocked` cells as walls.
     *
     * Returns a per-cell mask (1 = reachable) rather than a Set of string ids:
     * an AI build scan asks this question a dozen times per placement and a
     * Set<string> over 6400 cells cost ~8 ms per call in the debug build, which
     * showed up as a visible freeze every time the AI picked a spot.
     *
     * The graph itself is never mutated, so no invalidate / rebuild / island
     * pass is triggered.
     */
    computeReachableMask(
        startTile: Tile,
        speedType: SpeedType,
        isInfantry: boolean,
        blocked: (tile: Tile) => boolean,
    ): Uint8Array {
        const graph = this.computePassabilityGraph(speedType, isInfantry);
        const size = this.world.tiles.size;
        const mask = new Uint8Array(size * size);
        const startId = this.getNodeId(startTile, false);
        const startNode = graph.getNode(startId);
        if (!startNode) return mask;
        const stack: any[] = [startNode];
        mask[startTile.ry * size + startTile.rx] = 1;
        while (stack.length) {
            const node = stack.pop()!;
            for (const nb of node.neighbors) {
                const t = nb.data.tile;
                const idx = t.ry * size + t.rx;
                if (mask[idx]) continue;
                mask[idx] = 1;
                if (blocked(t)) continue;
                stack.push(nb);
            }
        }
        return mask;
    }

    getIslandIdMap(speedType: SpeedType, isInfantry: boolean) {
        const graph = this.computePassabilityGraph(speedType, isInfantry);
        return {
            get: (tile: Tile, onBridge: boolean): number | undefined => {
                const nodeId = this.getNodeId(tile, onBridge);
                return graph.getNode(nodeId)?.data.islandId;
            },
        };
    }

    /**
     * Movement multiplier, 0 when the cell cannot be entered.
     *
     * `isInfantry` (3rd arg in the reference) selects the speed table and the
     * blocker rules; `bridgeLevel` is kept for signature parity.
     */
    getPassableSpeed(
        tile: Tile,
        speedType: SpeedType,
        isInfantry: boolean,
        bridgeLevel = false,
        ignoredBlockers: Occupant[] = [],
        skipBlockerCheck = false,
    ): number {
        if (!tile || !this.world.mapBounds.isWithinBounds(tile)) return 0;
        /*
         * Port of Terrain.getPassableSpeed.
         *
         * The speed table is keyed by LandType, not by a per-cell float: a road
         * and clear ground are both 100%, rough is 80/70/50 by locomotor, and
         * tiberium slows tracks by 20%. `LandType.Wall` is re-read as the
         * underlying terrain for tracked units (a wall has no track speed, but
         * the ground under it does — that is what lets a crusher drive at a
         * wall).
         */
        let landType = bridgeLevel ? tile.onBridgeLandType : tile.landType;
        if (landType === undefined) return 0;
        if (landType === LandType.Wall && speedType === SpeedType.Track) {
            landType = getLandType((tile as any).terrainType ?? 0, false);
        }
        const speedModifier = getSpeedModifier(landType, speedType);
        if (!speedModifier) return 0;
        if (!skipBlockerCheck) {
            let blocked = false;
            this.world.tileOccupation.forEachOnTile(tile, (obj) => {
                if (blocked) return;
                if (this.isBlockerObject(obj, tile, bridgeLevel, speedType, isInfantry) && ignoredBlockers.indexOf(obj) === -1) {
                    blocked = true;
                }
            });
            if (blocked) return 0;
        }
        return speedModifier;
    }

    private isBlockerObject(obj: Occupant, tile: Tile, bridgeLevel: boolean, speedType: SpeedType, isInfantry: boolean): boolean {
        if (isBuildingObject(obj)) {
            if (obj.dead) return false;
            if (obj.rules?.invisibleInGame) return false;
            if (obj.rules?.gate) return false;
            const foundation = obj.art?.foundation ?? { width: obj.size ?? 1, height: obj.size ?? 1 };
            const width = foundation.width ?? 1;
            const height = foundation.height ?? 1;
            return (
                tile.rx >= obj.tile.rx &&
                tile.rx < obj.tile.rx + width &&
                tile.ry >= obj.tile.ry &&
                tile.ry < obj.tile.ry + height
            );
        }
        if (obj.isAircraft?.() || obj.isInfantry?.() || obj.isVehicle?.()) return false;
        if (obj.isOverlay?.()) {
            if (obj.rules?.crate || obj.rules?.tiberium) return false;
        }
        if ((speedType === SpeedType.Track || speedType === SpeedType.Hover) && obj.rules?.crushable) return false;
        return true;
    }

    /**
     * Everything on the cell that can stop `unit` right now.
     *
     * `static` marks terrain / structures; the move task re-paths for those and
     * negotiates with units.
     */
    findObstacles(pathNode: PathNode, unit: any): Obstacle[] {
        const speedType: SpeedType = unit.rules.speedType;
        const isInfantry = unit.isInfantry();
        const obstacles: Obstacle[] = [];
        this.world.tileOccupation.forEachOnTile(pathNode.tile, (obj) => {
            if (obj === unit) return;
            if (obj.isAircraft?.()) return;
            const isStaticBlocker = this.isBlockerObject(obj, pathNode.tile, !!pathNode.onBridge, speedType, isInfantry);
            let shouldInclude = false;
            if (isStaticBlocker) {
                shouldInclude = true;
            } else if (obj.isUnit?.()) {
                const sameLocation = obj.tile === pathNode.tile;
                const inReservedPath = !!obj.moveTrait?.reservedPathNodes?.find(
                    (node: PathNode) => node.tile === pathNode.tile && !!node.onBridge === !!pathNode.onBridge,
                );
                if (sameLocation || inReservedPath) shouldInclude = true;
            } else if ((speedType === SpeedType.Track || speedType === SpeedType.Hover) && obj.rules?.crushable) {
                shouldInclude = true;
            } else if (isBuildingObject(obj)) {
                shouldInclude = true;
            }
            if (shouldInclude) {
                const obstacle: Obstacle = { obj, static: isStaticBlocker };
                if (obj.isInfantry?.() && isInfantry) {
                    if (obj.position?.desiredSubCell === unit.position?.desiredSubCell) obstacles.push(obstacle);
                } else {
                    obstacles.push(obstacle);
                }
            }
        });
        return obstacles;
    }
}
