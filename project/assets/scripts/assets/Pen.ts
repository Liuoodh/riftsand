/**
 * Drawing backend abstraction.
 *
 * The art code was written against a handful of cc.Graphics calls. To be able
 * to bake the very same drawings into textures (and, later, to swap them for
 * retail SHP frames without touching a single line of art code) those calls are
 * expressed as this tiny Pen interface:
 *
 *   GfxPen    -> forwards to cc.Graphics  (immediate, was the only path before)
 *   CanvasPen -> records into a 2D context (used to bake sprite frames)
 *
 * Both backends follow the same rule: fill()/stroke() paint the current path
 * and then start a fresh one. cc.Graphics and canvas2D differ slightly here, so
 * normalising it in the wrappers keeps the art code backend-agnostic.
 */

import { Color, Graphics } from 'cc';

export type Ink = Color | string;

export interface Pen {
    fillColor: Ink;
    strokeColor: Ink;
    lineWidth: number;
    clear(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    close(): void;
    rect(x: number, y: number, w: number, h: number): void;
    roundRect(x: number, y: number, w: number, h: number, r: number): void;
    circle(cx: number, cy: number, r: number): void;
    ellipse(cx: number, cy: number, rx: number, ry: number): void;
    quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
    fill(): void;
    stroke(): void;
}

export class GfxPen implements Pen {
    fillColor: Ink = new Color(255, 255, 255, 255);
    strokeColor: Ink = new Color(0, 0, 0, 255);
    lineWidth = 1;

    constructor(private g: Graphics) {}

    clear() {
        this.g.clear();
    }
    moveTo(x: number, y: number) {
        this.g.moveTo(x, y);
    }
    lineTo(x: number, y: number) {
        this.g.lineTo(x, y);
    }
    close() {
        this.g.close();
    }
    rect(x: number, y: number, w: number, h: number) {
        this.g.rect(x, y, w, h);
    }
    roundRect(x: number, y: number, w: number, h: number, r: number) {
        this.g.roundRect(x, y, w, h, r);
    }
    circle(cx: number, cy: number, r: number) {
        this.g.circle(cx, cy, r);
    }
    ellipse(cx: number, cy: number, rx: number, ry: number) {
        this.g.ellipse(cx, cy, rx, ry);
    }
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
        this.g.quadraticCurveTo(cx, cy, x, y);
    }
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
        this.g.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
    }
    fill() {
        this.g.fillColor = this.fillColor as Color;
        this.g.fill();
    }
    stroke() {
        this.g.strokeColor = this.strokeColor as Color;
        this.g.lineWidth = this.lineWidth;
        this.g.stroke();
    }
}

const css = (ink: Ink): string => {
    if (typeof ink === 'string') return ink;
    const a = ink.a ?? 255;
    return `rgba(${ink.r},${ink.g},${ink.b},${a / 255})`;
};

export class CanvasPen implements Pen {
    fillColor: Ink = '#ffffff';
    strokeColor: Ink = '#000000';
    lineWidth = 1;

    constructor(private ctx: CanvasRenderingContext2D, private ox = 0, private oy = 0) {}

    clear() {
        this.ctx.clearRect(-this.ox, -this.oy, this.ctx.canvas.width * 2, this.ctx.canvas.height * 2);
    }
    private px(x: number) {
        return x + this.ox;
    }
    private py(y: number) {
        // canvas y grows downward, the art code uses math-style up
        return this.oy - y;
    }
    moveTo(x: number, y: number) {
        this.ctx.moveTo(this.px(x), this.py(y));
    }
    lineTo(x: number, y: number) {
        this.ctx.lineTo(this.px(x), this.py(y));
    }
    close() {
        this.ctx.closePath();
    }
    rect(x: number, y: number, w: number, h: number) {
        this.ctx.rect(this.px(x), this.py(y + h), w, h);
    }
    roundRect(x: number, y: number, w: number, h: number, r: number) {
        const c = this.ctx as any;
        if (typeof c.roundRect === 'function') {
            c.roundRect(this.px(x), this.py(y + h), w, h, r);
        } else {
            c.rect(this.px(x), this.py(y + h), w, h);
        }
    }
    circle(cx: number, cy: number, r: number) {
        this.ctx.moveTo(this.px(cx + r), this.py(cy));
        this.ctx.arc(this.px(cx), this.py(cy), r, 0, Math.PI * 2);
    }
    ellipse(cx: number, cy: number, rx: number, ry: number) {
        this.ctx.moveTo(this.px(cx + rx), this.py(cy));
        this.ctx.ellipse(this.px(cx), this.py(cy), Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    }
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
        this.ctx.quadraticCurveTo(this.px(cx), this.py(cy), this.px(x), this.py(y));
    }
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
        this.ctx.bezierCurveTo(
            this.px(c1x), this.py(c1y), this.px(c2x), this.py(c2y), this.px(x), this.py(y),
        );
    }
    fill() {
        this.ctx.fillStyle = css(this.fillColor);
        this.ctx.fill();
        this.ctx.beginPath();
    }
    stroke() {
        this.ctx.strokeStyle = css(this.strokeColor);
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.stroke();
        this.ctx.beginPath();
    }
}
