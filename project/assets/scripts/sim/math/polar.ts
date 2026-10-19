/**
 * Cylindrical / Spherical — the two polar coordinate helpers the reference
 * extends from three. Used by locomotion and flying-object orientation.
 */
import { clamp } from '../util/math';
import { GameMath } from './GameMath';
import type { Vector3 } from './Vector3';

export class Cylindrical {
    radius: number;
    theta: number;
    y: number;

    constructor(radius = 1, theta = 0, y = 0) {
        this.radius = radius;
        this.theta = theta;
        this.y = y;
    }

    set(radius: number, theta: number, y: number): this {
        this.radius = radius;
        this.theta = theta;
        this.y = y;
        return this;
    }

    clone(): Cylindrical {
        return new Cylindrical(this.radius, this.theta, this.y);
    }

    copy(other: Cylindrical): this {
        this.radius = other.radius;
        this.theta = other.theta;
        this.y = other.y;
        return this;
    }

    setFromVector3(v: Vector3): this {
        this.radius = GameMath.sqrt(v.x * v.x + v.z * v.z);
        this.theta = GameMath.atan2(v.x, v.z);
        this.y = v.y;
        return this;
    }
}

export class Spherical {
    radius: number;
    phi: number;
    theta: number;

    constructor(radius = 1, phi = 0, theta = 0) {
        this.radius = radius;
        this.phi = phi;
        this.theta = theta;
    }

    set(radius: number, phi: number, theta: number): this {
        this.radius = radius;
        this.phi = phi;
        this.theta = theta;
        return this;
    }

    clone(): Spherical {
        return new Spherical(this.radius, this.phi, this.theta);
    }

    copy(other: Spherical): this {
        this.radius = other.radius;
        this.phi = other.phi;
        this.theta = other.theta;
        return this;
    }

    setFromVector3(v: Vector3): this {
        this.radius = v.length();
        if (this.radius === 0) {
            this.theta = 0;
            this.phi = 0;
        } else {
            this.theta = GameMath.atan2(v.x, v.z);
            this.phi = GameMath.acos(clamp(v.y / this.radius, -1, 1));
        }
        return this;
    }
}
