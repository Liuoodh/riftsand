/**
 * Graph + A* — a direct port of
 *   redalert2/src/util/Graph.ts
 *   redalert2/src/game/map/pathFinder/NodeHeap.ts
 *   redalert2/src/game/map/pathFinder/SearchStatePool.ts
 *   redalert2/src/game/map/pathFinder/PathFinder.ts
 *
 * The search is kept *identical* on purpose, including the two bits that look
 * odd but decide how the AI drives:
 *   - `bestEffort` returns the reached node with the best (f - g), not the
 *     geometrically closest one;
 *   - the heuristic adds 0.2 whenever the direction of travel changes between
 *     parent and child, which makes columns prefer straight lanes.
 */

export class GraphNode<T> {
    id: string;
    data: T;
    neighbors: Set<GraphNode<T>>;

    constructor(id: string, data: T) {
        this.id = id;
        this.data = data;
        this.neighbors = new Set();
    }

    addLink(node: GraphNode<T>): void {
        this.neighbors.add(node);
        if (node !== this) node.neighbors.add(this);
    }

    removeLink(node: GraphNode<T>): void {
        this.neighbors.delete(node);
        node.neighbors.delete(this);
    }

    deleteLinks(): void {
        for (const node of this.neighbors) node.neighbors.delete(this);
        this.neighbors.clear();
    }
}

export class Graph<T> {
    private nodes = new Map<string, GraphNode<T>>();

    addNode(id: string, data: T): GraphNode<T> {
        let node = this.getNode(id);
        if (node) node.data = data;
        else node = new GraphNode(id, data);
        this.nodes.set(id, node);
        return node;
    }

    removeNode(id: string): boolean {
        const node = this.getNode(id);
        if (!node) return false;
        node.deleteLinks();
        this.nodes.delete(id);
        return true;
    }

    hasNode(id: string): boolean {
        return this.nodes.has(id);
    }

    getNode(id: string): GraphNode<T> | undefined {
        return this.nodes.get(id);
    }

    getNodeCount(): number {
        return this.nodes.size;
    }

    forEachNode(cb: (node: GraphNode<T>) => void): void {
        for (const node of this.nodes.values()) cb(node);
    }

    clear(): void {
        for (const node of this.nodes.values()) node.deleteLinks();
        this.nodes.clear();
    }
}

interface HeapNode {
    fScore: number;
    heapIndex: number;
}

export class NodeHeap {
    private data: HeapNode[];
    length: number;

    constructor(initialData: HeapNode[] = []) {
        this.data = initialData;
        this.length = initialData.length;
        if (this.length > 0) {
            for (let i = this.length >> 1; i >= 0; i--) this.down(i);
        }
        for (let i = 0; i < this.length; ++i) this.setNodeId(this.data[i], i);
    }

    private compare(a: HeapNode, b: HeapNode): number {
        return a.fScore - b.fScore;
    }

    private setNodeId(node: HeapNode, index: number): void {
        node.heapIndex = index;
    }

    push(node: HeapNode): void {
        this.data.push(node);
        this.setNodeId(node, this.length);
        this.length++;
        this.up(this.length - 1);
    }

    pop(): HeapNode | undefined {
        if (this.length === 0) return undefined;
        const result = this.data[0];
        this.length--;
        if (this.length > 0) {
            this.data[0] = this.data[this.length];
            this.setNodeId(this.data[0], 0);
            this.down(0);
        }
        this.data.pop();
        return result;
    }

    peek(): HeapNode | undefined {
        return this.data[0];
    }

    updateItem(index: number): void {
        this.down(index);
        this.up(index);
    }

    private up(index: number): void {
        const data = this.data;
        const item = data[index];
        while (index > 0) {
            const parentIndex = (index - 1) >> 1;
            const parent = data[parentIndex];
            if (this.compare(item, parent) >= 0) break;
            data[index] = parent;
            this.setNodeId(parent, index);
            index = parentIndex;
        }
        data[index] = item;
        this.setNodeId(item, index);
    }

    private down(index: number): void {
        const data = this.data;
        const halfLength = this.length >> 1;
        const item = data[index];
        while (index < halfLength) {
            let childIndex = 1 + (index << 1);
            const rightChildIndex = childIndex + 1;
            let child = data[childIndex];
            if (rightChildIndex < this.length && this.compare(data[rightChildIndex], child) < 0) {
                childIndex = rightChildIndex;
                child = data[rightChildIndex];
            }
            if (this.compare(child, item) >= 0) break;
            data[index] = child;
            this.setNodeId(child, index);
            index = childIndex;
        }
        data[index] = item;
        this.setNodeId(item, index);
    }
}

export class SearchState {
    node: any;
    parent: SearchState | null = null;
    closed = false;
    open = 0;
    distanceToSource = Number.POSITIVE_INFINITY;
    fScore = Number.POSITIVE_INFINITY;
    heapIndex = -1;

    constructor(node: any) {
        this.node = node;
    }
}

export class SearchStatePool {
    private index = 0;
    private pool: SearchState[] = [];

    createNewState(node: any): SearchState {
        let state = this.pool[this.index];
        if (state) {
            state.node = node;
            state.parent = null;
            state.closed = false;
            state.open = 0;
            state.distanceToSource = Number.POSITIVE_INFINITY;
            state.fScore = Number.POSITIVE_INFINITY;
            state.heapIndex = -1;
        } else {
            state = new SearchState(node);
            this.pool[this.index] = state;
        }
        this.index++;
        return state;
    }

    reset(): void {
        this.index = 0;
    }
}

export interface PathFinderOptions {
    bestEffort?: boolean;
    maxExpandedNodes?: number;
    heuristic?: (from: any, to: any, state?: any) => number;
    distance?: (from: any, to: any) => number;
    excludedNodes?: (data: any) => boolean;
}

export class PathFinder {
    private readonly bestEffort: boolean;
    private readonly maxExpandedNodes: number;
    private readonly heuristic: (from: any, to: any, state?: any) => number;
    private readonly distance: (from: any, to: any) => number;
    private readonly excludedNodes?: (data: any) => boolean;
    private readonly searchStatePool = new SearchStatePool();
    private readonly graph: any;

    lastExpanded = 0;

    constructor(graph: any, options: PathFinderOptions = {}) {
        this.bestEffort = options.bestEffort ?? false;
        this.maxExpandedNodes = options.maxExpandedNodes ?? Number.POSITIVE_INFINITY;
        this.heuristic = options.heuristic ?? (() => 0);
        this.distance = options.distance ?? (() => 1);
        this.excludedNodes = options.excludedNodes;
        this.graph = graph;
    }

    private reconstructPath(state: SearchState): any[] {
        const path = [state.node];
        let current = state.parent;
        while (current) {
            path.push(current.node);
            current = current.parent;
        }
        return path;
    }

    find(fromId: string, toId: string): any[] {
        const fromNode = this.graph.getNode(fromId);
        if (!fromNode) return [];
        const toNode = this.graph.getNode(toId);
        if (!toNode) return [];
        if (fromNode === toNode) return [];

        this.searchStatePool.reset();
        const states = new Map<string, SearchState>();
        const openSet = new NodeHeap();
        const startState = this.searchStatePool.createNewState(fromNode);
        states.set(fromId, startState);
        startState.fScore = this.excludedNodes?.(toNode.data) ? Number.POSITIVE_INFINITY : this.heuristic(fromNode, toNode);
        if (!isFinite(startState.fScore) && fromNode.neighbors.has(toNode)) return [];
        startState.distanceToSource = 0;
        openSet.push(startState);
        startState.open = 1;

        let current: SearchState;
        let bestState = startState;
        let expandedCount = 0;

        while (openSet.length > 0) {
            current = openSet.pop() as unknown as SearchState;
            if (current.node === toNode) return this.reconstructPath(current);
            expandedCount++;
            if (expandedCount > this.maxExpandedNodes) break;
            current.closed = true;
            current.node.neighbors.forEach((neighbor: any) => {
                let neighborState = states.get(neighbor.id);
                if (!neighborState) {
                    neighborState = this.searchStatePool.createNewState(neighbor);
                    states.set(neighbor.id, neighborState);
                }
                if (neighborState!.closed) return;
                if (neighborState!.open === 0) {
                    openSet.push(neighborState!);
                    neighborState!.open = 1;
                }
                const tentativeDistance = this.excludedNodes?.(neighbor.data)
                    ? Number.POSITIVE_INFINITY
                    : current.distanceToSource + this.distance(current.node, neighbor);
                if (tentativeDistance >= neighborState!.distanceToSource) return;
                neighborState!.parent = current;
                neighborState!.distanceToSource = tentativeDistance;
                if (this.excludedNodes?.(toNode.data)) {
                    neighborState!.fScore = Number.POSITIVE_INFINITY;
                } else {
                    neighborState!.fScore = tentativeDistance + this.heuristic(neighborState!.node, toNode, neighborState);
                }
                if (neighborState!.fScore - neighborState!.distanceToSource < bestState.fScore - bestState.distanceToSource) {
                    bestState = neighborState!;
                }
                openSet.updateItem(neighborState!.heapIndex);
            });
        }
        this.lastExpanded = expandedCount;
        return this.bestEffort ? this.reconstructPath(bestState) : [];
    }
}
