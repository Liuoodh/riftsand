/**
 * Camera rig — a 2D "camera" emulated by moving/scaling the world root.
 * Supports drag-pan, pinch zoom, keyboard pan and edge clamping.
 */
import { Node } from 'cc';
import { HALF, clamp } from '../core/Core';

export class CameraRig {
    x = 0;
    y = 0;
    zoom = 0.86;
    targetZoom = 0.86;
    minZoom = 0.5;
    maxZoom = 1.7;
    /** impact shake, decays in a few frames */
    private shakeAmt = 0;
    private shakeT = 0;
    private shakeX = 0;
    private shakeY = 0;

    private tx = 0;
    private ty = 0;
    screenW = 1280;
    screenH = 720;

    constructor(private worldRoot: Node) {}

    addShake(strength: number) {
        this.shakeAmt = Math.min(16, Math.max(this.shakeAmt, strength));
        this.shakeT = 0.32;
    }

    setScreen(w: number, h: number) {
        this.screenW = w;
        this.screenH = h;
    }

    focus(x: number, y: number, immediate = false) {
        this.tx = x; this.ty = y;
        this.clampCam();
        if (immediate) {
            // snap to the clamped target, never outside the map rim
            this.x = this.tx;
            this.y = this.ty;
            this.apply();
        }
    }

    panBy(dxScreen: number, dyScreen: number) {
        this.tx -= dxScreen / this.zoom;
        this.ty -= dyScreen / this.zoom;
        this.clampCam();
    }

    zoomAt(factor: number, sx = 0, sy = 0) {
        const before = this.screenToWorld(sx, sy);
        this.targetZoom = clamp(this.targetZoom * factor, this.minZoom, this.maxZoom);
        const z = this.targetZoom;
        // keep the world point under the pinch pivot
        const nx = before.x - sx / z;
        const ny = before.y - sy / z;
        this.tx = nx;
        this.ty = ny;
        this.clampCam();
    }

    setZoom(z: number) {
        this.targetZoom = clamp(z, this.minZoom, this.maxZoom);
    }

    /**
     * Two-finger gesture in one step: keep the world point that sat under the
     * previous midpoint glued to the new midpoint while the span changes.
     * Doing pan and zoom separately made them fight over `tx`, which ate the pan.
     */
    pinch(prevDist: number, dist: number, pmx: number, pmy: number, mx: number, my: number) {
        const z0 = this.targetZoom;
        const worldX = pmx / z0 + this.tx;
        const worldY = pmy / z0 + this.ty;
        if (prevDist > 4 && dist > 4) {
            const f = dist / prevDist;
            if (Math.abs(f - 1) > 0.001) {
                this.targetZoom = clamp(this.targetZoom * f, this.minZoom, this.maxZoom);
            }
        }
        const z = this.targetZoom;
        this.tx = worldX - mx / z;
        this.ty = worldY - my / z;
        this.clampCam();
    }

    screenToWorld(sx: number, sy: number) {
        return {
            x: sx / this.zoom + this.x,
            y: sy / this.zoom + this.y,
        };
    }

    worldToScreen(wx: number, wy: number) {
        return {
            x: (wx - this.x) * this.zoom,
            y: (wy - this.y) * this.zoom,
        };
    }

    private clampCam() {
        this.zoom = this.targetZoom;
        const halfW = this.screenW / 2 / this.zoom;
        const halfH = this.screenH / 2 / this.zoom;
        const limX = Math.max(0, HALF + 120 - halfW);
        const limY = Math.max(0, HALF + 120 - halfH);
        this.tx = clamp(this.tx, -limX, limX);
        this.ty = clamp(this.ty, -limY, limY);
    }

    update(dt: number) {
        const k = Math.min(1, dt * 12);
        this.zoom += (this.targetZoom - this.zoom) * k;
        this.x += (this.tx - this.x) * k;
        this.y += (this.ty - this.y) * k;
        this.clampCam();
        if (this.shakeT > 0) {
            this.shakeT -= dt;
            const amp = this.shakeAmt * Math.max(0, this.shakeT / 0.32);
            this.shakeX = (Math.random() - 0.5) * amp;
            this.shakeY = (Math.random() - 0.5) * amp * 0.7;
            if (this.shakeT <= 0) { this.shakeAmt = 0; this.shakeX = 0; this.shakeY = 0; }
        } else {
            this.shakeX = 0;
            this.shakeY = 0;
        }
        this.apply();
    }

    apply() {
        this.worldRoot.setPosition(
            -this.x * this.zoom + this.shakeX,
            -this.y * this.zoom + this.shakeY,
            0,
        );
        this.worldRoot.setScale(this.zoom, this.zoom, 1);
    }

    get viewBounds() {
        const hw = this.screenW / 2 / this.zoom;
        const hh = this.screenH / 2 / this.zoom;
        return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
    }
}
