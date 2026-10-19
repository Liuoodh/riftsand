/**
 * Production queue.
 *
 * Port of redalert2/src/game/player/production/ProductionQueue.ts — the data
 * model and every size/quantity rule are identical. The only additions are
 * four read-only aliases (`defId` / `cost` / `time` / `spent`) so the existing
 * sidebar and AI can keep reading a queue item without knowing about ObjectRules.
 */

export enum QueueType {
    Structures = 0,
    Armory = 1,
    Infantry = 2,
    Vehicles = 3,
    Aircrafts = 4,
    Ships = 5,
}

export enum QueueStatus {
    Idle = 0,
    Active = 1,
    OnHold = 2,
    Ready = 3,
}

/**
 * One line of the queue.
 *
 * Retail stacks identical items (`quantity`) instead of pushing N rows, and
 * tracks credits *spent so far on the first unit only* — `creditsSpent` belongs
 * to the item at the head of the queue, which is why the tick loop compares it
 * with `creditsEach` and resets it when the unit pops.
 */
export class QueueItem {
    rules: any;
    quantity: number;
    creditsEach: number;
    creditsSpent: number;
    creditsSpentLeftover: number;
    progress: number;

    constructor(rules: any, quantity: number, creditsEach: number) {
        this.rules = rules;
        this.quantity = quantity;
        this.creditsEach = creditsEach;
        this.creditsSpent = 0;
        this.creditsSpentLeftover = 0;
        this.progress = 0;
    }

    get defId(): string { return this.rules?.id ?? ''; }
    get cost(): number { return this.creditsEach; }
    get time(): number { return this.rules?.time ?? 0; }
    get spent(): number { return this.creditsSpent; }
    /** tooling / debug hook: fast-forward a queue row without simulating it */
    set spent(value: number) { this.creditsSpent = value; }
}

type UpdateHandler = (queue: ProductionQueue) => void;

export class ProductionQueue {
    readonly type: QueueType;
    private _maxSize: number;
    private maxItemQuantity: number;
    private rows: QueueItem[];
    private size: number;
    private _status: QueueStatus;
    private handlers: UpdateHandler[] = [];

    constructor(type: QueueType, maxSize: number, maxItemQuantity: number) {
        this.type = type;
        this._maxSize = maxSize;
        this.maxItemQuantity = maxItemQuantity;
        this.rows = [];
        this.size = 0;
        this._status = QueueStatus.Idle;
    }

    onUpdate(handler: UpdateHandler): void {
        this.handlers.push(handler);
    }

    private dispatch(): void {
        for (const handler of this.handlers) handler(this);
    }

    get status(): QueueStatus {
        return this._status;
    }

    set status(value: QueueStatus) {
        const oldStatus = this._status;
        this._status = value;
        if (value !== oldStatus) this.dispatch();
    }

    /** sidebar alias: "is the head item finished and waiting?" */
    get ready(): boolean {
        return this._status === QueueStatus.Ready;
    }

    get maxSize(): number {
        return this._maxSize;
    }

    /**
     * Shrinking a queue truncates the tail (the reference's `maxSize` setter),
     * which is how the aircraft queue is capped to the number of free helipads.
     */
    set maxSize(value: number) {
        const oldSize = this.size;
        this.size = Math.min(value, this.size);
        let totalQuantity = 0;
        let itemIndex = 0;
        while (totalQuantity <= this.size && itemIndex < this.rows.length) {
            const item = this.rows[itemIndex];
            totalQuantity += item.quantity;
            if (totalQuantity > this.size) {
                item.quantity -= totalQuantity - this.size;
            }
            if (item.quantity > 0) itemIndex++;
        }
        this._maxSize = value;
        if (this.rows[itemIndex]) this.rows.splice(itemIndex);
        if (oldSize !== this.size) {
            if (!this.size) this._status = QueueStatus.Idle;
            this.dispatch();
        }
    }

    get currentSize(): number {
        return this.size;
    }

    /** sidebar alias: a snapshot of the rows (never mutate this array) */
    get items(): QueueItem[] {
        return this.getAll();
    }

    find(rules: any): QueueItem[] {
        return this.rows.filter((item) => item.rules === rules);
    }

    getFirst(): QueueItem | undefined {
        return this.rows[0];
    }

    getAll(): QueueItem[] {
        return [...this.rows];
    }

    push(rules: any, quantity: number, creditsEach: number): void {
        quantity = Math.min(this.maxSize - this.size, quantity);
        const existingQuantity = this.find(rules).reduce((sum, item) => sum + item.quantity, 0);
        quantity = Math.min(this.maxItemQuantity - existingQuantity, quantity);
        const lastItem = this.rows[this.rows.length - 1];
        if (lastItem?.rules === rules) {
            lastItem.quantity += quantity;
        } else {
            this.rows.push(new QueueItem(rules, quantity, creditsEach));
        }
        this.size += quantity;
        if (quantity) {
            if (this._status === QueueStatus.Idle) this._status = QueueStatus.Active;
            this.dispatch();
        }
    }

    /** "queue one more in front of the rest", used by queued orders */
    insertAfterFirst(rules: any, quantity: number, creditsEach: number): void {
        quantity = Math.min(this.maxSize - this.size, quantity);
        const existingQuantity = this.find(rules).reduce((sum, item) => sum + item.quantity, 0);
        quantity = Math.min(this.maxItemQuantity - existingQuantity, quantity);
        if (!quantity) return;
        if (!this.rows.length) {
            this.push(rules, quantity, creditsEach);
            return;
        }
        const first = this.rows[0];
        const firstRemainingQuantity = Math.max(0, first.quantity - 1);
        first.quantity = 1;
        const rows: QueueItem[] = [first];
        const tail = this.rows.slice(1);
        rows.push(new QueueItem(rules, quantity, creditsEach));
        if (firstRemainingQuantity > 0) {
            rows.push(new QueueItem(first.rules, firstRemainingQuantity, first.creditsEach));
        }
        rows.push(...tail);
        this.rows = rows;
        this.size += quantity;
        if (this._status === QueueStatus.Idle) this._status = QueueStatus.Active;
        this.dispatch();
    }

    pop(rules: any, quantity: number): void {
        this.remove(rules, quantity, false);
    }

    shift(rules: any, quantity: number): void {
        this.remove(rules, quantity, true);
    }

    private remove(rules: any, quantity: number, fromStart: boolean): void {
        const matchingItems = this.find(rules);
        if (!matchingItems.length) {
            // A stale sidebar click after the queue changed must not kill a frame.
            return;
        }
        const totalQuantity = matchingItems.reduce((sum, item) => sum + item.quantity, 0);
        if (totalQuantity < quantity) quantity = totalQuantity;
        let remainingQuantity = quantity;
        while (remainingQuantity > 0) {
            const item = fromStart ? matchingItems.shift() : matchingItems.pop();
            if (!item) break;
            if (item.quantity <= remainingQuantity) {
                const wasFirst = this.getFirst() === item;
                this.rows.splice(this.rows.indexOf(item), 1);
                if (wasFirst) this._status = QueueStatus.Active;
                remainingQuantity -= item.quantity;
            } else {
                item.quantity -= remainingQuantity;
                remainingQuantity = 0;
            }
        }
        this.size -= quantity;
        if (quantity) {
            if (!this.size) this._status = QueueStatus.Idle;
            this.dispatch();
        }
    }

    notifyUpdated(): void {
        this.dispatch();
    }
}
