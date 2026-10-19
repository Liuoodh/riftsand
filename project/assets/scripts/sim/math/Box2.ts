/**
 * Box2 — axis-aligned box in 2D, the subset of three.Box2 the game uses.
 *
 * Reference: redalert2/src/game/math/Box2.ts (a bare `extends THREE.Box2`).
 * Used by `util/geometry.ts` and by tile-rectangle queries.
 */
import { Vector2 } from './Vector2';

export class Box2 {
    readonly isBox2 = true;
    min: Vector2;
    max: Vector2;

    constructor(min = new Vector2(Infinity, Infinity), max = new Vector2(-Infinity, -Infinity)) {
        this.min = min;
        this.max = max;
    }

    set(min: Vector2, max: Vector2): this {
        this.min.copy(min);
        this.max.copy(max);
        return this;
    }

    setFromPoints(points: Vector2[]): this {
        this.makeEmpty();
        for (const p of points) this.expandByPoint(p);
        return this;
    }

    setFromCenterAndSize(center: Vector2, size: Vector2): this {
        const halfSize = Box2._vector.copy(size).multiplyScalar(0.5);
        this.min.copy(center).sub(halfSize);
        this.max.copy(center).add(halfSize);
        return this;
    }

    clone(): Box2 {
        return new Box2().copy(this);
    }

    copy(box: Box2): this {
        this.min.copy(box.min);
        this.max.copy(box.max);
        return this;
    }

    makeEmpty(): this {
        this.min.x = this.min.y = Infinity;
        this.max.x = this.max.y = -Infinity;
        return this;
    }

    isEmpty(): boolean {
        return this.max.x < this.min.x || this.max.y < this.min.y;
    }

    getCenter(target = new Vector2()): Vector2 {
        return this.isEmpty()
            ? target.set(0, 0)
            : target.addVectors(this.min, this.max).multiplyScalar(0.5);
    }

    getSize(target = new Vector2()): Vector2 {
        return this.isEmpty() ? target.set(0, 0) : target.subVectors(this.max, this.min);
    }

    expandByPoint(point: Vector2): this {
        this.min.min(point);
        this.max.max(point);
        return this;
    }

    expandByVector(vector: Vector2): this {
        this.min.sub(vector);
        this.max.add(vector);
        return this;
    }

    expandByScalar(scalar: number): this {
        this.min.addScalar(-scalar);
        this.max.addScalar(scalar);
        return this;
    }

    containsPoint(point: Vector2): boolean {
        return !(
            point.x < this.min.x || point.x > this.max.x ||
            point.y < this.min.y || point.y > this.max.y
        );
    }

    containsBox(box: Box2): boolean {
        return (
            this.min.x <= box.min.x && box.max.x <= this.max.x &&
            this.min.y <= box.min.y && box.max.y <= this.max.y
        );
    }

    getParameter(point: Vector2, target = new Vector2()): Vector2 {
        return target.set(
            (point.x - this.min.x) / (this.max.x - this.min.x),
            (point.y - this.min.y) / (this.max.y - this.min.y),
        );
    }

    intersectsBox(box: Box2): boolean {
        return !(
            box.max.x < this.min.x || box.min.x > this.max.x ||
            box.max.y < this.min.y || box.min.y > this.max.y
        );
    }

    clampPoint(point: Vector2, target = new Vector2()): Vector2 {
        return target.copy(point).clamp(this.min, this.max);
    }

    distanceToPoint(point: Vector2): number {
        const clampedPoint = Box2._vector.copy(point).clamp(this.min, this.max);
        return clampedPoint.sub(point).length();
    }

    intersect(box: Box2): this {
        this.min.max(box.min);
        this.max.min(box.max);
        if (this.isEmpty()) this.makeEmpty();
        return this;
    }

    union(box: Box2): this {
        this.min.min(box.min);
        this.max.max(box.max);
        return this;
    }

    translate(offset: Vector2): this {
        this.min.add(offset);
        this.max.add(offset);
        return this;
    }

    equals(box: Box2): boolean {
        return box.min.equals(this.min) && box.max.equals(this.max);
    }

    private static _vector = new Vector2();
}
