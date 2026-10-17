/**
 * Touch overlay — the parts of the HUD that live directly under the finger:
 * control-group strip, long-press command wheel, box-select rectangle.
 *
 * Everything here is pure presentation; the input state machine lives in Boot.ts.
 */
import { Node, Graphics, Label, UITransform, Layers, Color } from 'cc';
import { PAL, HEX, GROUP_COUNT } from '../core/Core';

const W = 1280;
const HW = W / 2;

function mk(parent: Node, name: string): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    parent.addChild(n);
    const t = n.getComponent(UITransform) || n.addComponent(UITransform);
    t.setContentSize(0, 0);
    return n;
}

function label(parent: Node, text: string, size: number, color: string, bold = false): Label {
    const n = mk(parent, 't');
    n.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = Math.round(size * 1.2);
    l.color = HEX(color);
    l.useSystemFont = true;
    l.fontFamily = 'PingFang SC, Microsoft YaHei, sans-serif';
    l.horizontalAlign = Label.HorizontalAlign.CENTER;
    l.verticalAlign = Label.VerticalAlign.CENTER;
    l.overflow = Label.Overflow.NONE;
    (l as any).isBold = bold;
    return l;
}

export interface RadialItem {
    id: string;
    label: string;
    enabled: boolean;
}

interface Cell {
    n: number;
    x: number;
    y: number;
    w: number;
    h: number;
    g: Graphics;
    num: Label;
    cnt: Label;
    lastCount: number;
    lastSel: boolean;
}

/**
 * Command wheel geometry: items are laid out on a circle so the thumb can
 * reach them without lifting, which is what makes long-press usable on a phone.
 */
const RADIAL_R = 80;
const RADIAL_ITEM = 33;

export class Overlay {
    root: Node;
    private boxG: Graphics;
    private boxNode: Node;

    private groupLayer: Node;
    private cells: Cell[] = [];

    private radialLayer: Node;
    private radialBg: Graphics;
    private radialNodes: Array<{ g: Graphics; label: Label }> = [];
    private items: RadialItem[] = [];
    private cx = 0;
    private cy = 0;
    private activeIndex = -1;
    private open = false;

    constructor(canvas: Node) {
        this.root = mk(canvas, 'Overlay');

        this.boxNode = mk(this.root, 'box');
        this.boxG = this.boxNode.addComponent(Graphics);

        this.groupLayer = mk(this.root, 'groups');
        this.buildGroups();

        this.radialLayer = mk(this.root, 'radial');
        this.radialBg = mk(this.radialLayer, 'bg').addComponent(Graphics);
        this.radialLayer.active = false;
    }

    /* ------------------------------------------------------------------ */
    /* control groups                                                      */
    /* ------------------------------------------------------------------ */
    private buildGroups() {
        const w = 46, h = 40;
        const x = -HW + 16 + w / 2;
        let y = 104;
        for (let i = 0; i < GROUP_COUNT; i++) {
            const n = mk(this.groupLayer, 'g' + i);
            n.setPosition(x, y, 0);
            const g = n.addComponent(Graphics);
            const num = label(n, `${i + 1}`, 15, '#5f6d7a', true);
            num.node.setPosition(0, 3, 0);
            const cnt = label(n, '', 9, PAL.cyan, true);
            cnt.node.setPosition(0, -13, 0);
            const cell: Cell = { n: i, x, y, w, h, g, num, cnt, lastCount: -1, lastSel: false };
            this.cells.push(cell);
            this.paintCell(cell, 0, false);
            y -= h + 4;
        }
    }

    private paintCell(c: Cell, count: number, selected: boolean) {
        const g = c.g;
        g.clear();
        g.roundRect(-c.w / 2, -c.h / 2, c.w, c.h, 8);
        g.fillColor = HEX(selected ? '#1d3640' : '#0f151c', count > 0 ? 232 : 150);
        g.fill();
        g.strokeColor = count > 0 ? HEX(PAL.cyan, selected ? 235 : 130) : HEX('#2a343e', 120);
        g.lineWidth = selected ? 2 : 1;
        g.stroke();
        if (selected) {
            g.rect(-c.w / 2 + 5, c.h / 2 - 4, c.w - 10, 2);
            g.fillColor = HEX(PAL.cyan, 220);
            g.fill();
        }
        c.num.color = HEX(count > 0 ? PAL.white : '#5f6d7a');
        c.cnt.string = count > 0 ? `${count}` : '';
    }

    refreshGroups(counts: number[], selected: number) {
        for (const c of this.cells) {
            const n = counts[c.n] || 0;
            const sel = selected === c.n;
            if (c.lastCount !== n || c.lastSel !== sel) {
                c.lastCount = n;
                c.lastSel = sel;
                this.paintCell(c, n, sel);
            }
        }
    }

    /** -1 when the point is not on the strip */
    groupAt(x: number, y: number): number {
        for (const c of this.cells) {
            if (Math.abs(x - c.x) <= c.w / 2 + 2 && Math.abs(y - c.y) <= c.h / 2 + 2) return c.n;
        }
        return -1;
    }

    setGroupsVisible(v: boolean) {
        this.groupLayer.active = v;
    }

    /* ------------------------------------------------------------------ */
    /* box select                                                          */
    /* ------------------------------------------------------------------ */
    showBox(x0: number, y0: number, x1: number, y1: number) {
        const g = this.boxG;
        const lx = Math.min(x0, x1);
        const ly = Math.min(y0, y1);
        const w = Math.abs(x1 - x0);
        const h = Math.abs(y1 - y0);
        g.clear();
        g.rect(lx, ly, w, h);
        g.fillColor = new Color(63, 217, 236, 34);
        g.fill();
        g.strokeColor = new Color(63, 217, 236, 190);
        g.lineWidth = 1.4;
        g.stroke();
        // corner brackets read better than a plain box on a busy map
        const k = Math.min(12, w / 2, h / 2);
        g.strokeColor = new Color(200, 250, 255, 235);
        g.lineWidth = 2;
        const corners: Array<[number, number, number, number]> = [
            [lx, ly, 1, 1], [lx + w, ly, -1, 1], [lx, ly + h, 1, -1], [lx + w, ly + h, -1, -1],
        ];
        for (const [px, py, sx, sy] of corners) {
            g.moveTo(px + sx * k, py);
            g.lineTo(px, py);
            g.lineTo(px, py + sy * k);
        }
        g.stroke();
    }

    hideBox() {
        this.boxG.clear();
    }

    /* ------------------------------------------------------------------ */
    /* command wheel                                                       */
    /* ------------------------------------------------------------------ */
    get radialOpen() { return this.open; }
    get radialIndex() { return this.activeIndex; }

    showRadial(x: number, y: number, items: RadialItem[]) {
        this.items = items;
        this.cx = x;
        this.cy = y;
        this.activeIndex = -1;
        this.open = true;
        this.radialLayer.active = true;
        this.radialLayer.setPosition(0, 0, 0);

        const bg = this.radialBg;
        bg.clear();
        bg.circle(x, y, RADIAL_R + RADIAL_ITEM + 16);
        bg.fillColor = new Color(8, 12, 16, 208);
        bg.fill();
        bg.strokeColor = HEX(PAL.cyanDim, 120);
        bg.lineWidth = 1.4;
        bg.stroke();
        // faint guide ring
        bg.circle(x, y, RADIAL_R);
        bg.strokeColor = HEX(PAL.cyanDim, 70);
        bg.lineWidth = 1;
        bg.stroke();
        bg.circle(x, y, 22);
        bg.fillColor = new Color(20, 28, 36, 240);
        bg.fill();
        bg.strokeColor = HEX(PAL.red, 150);
        bg.lineWidth = 1.2;
        bg.stroke();

        this.ensureItemNodes(items.length);
        for (let i = 0; i < items.length; i++) {
            const a = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
            const px = x + Math.cos(a) * RADIAL_R;
            const py = y + Math.sin(a) * RADIAL_R;
            const slot = this.radialNodes[i];
            slot.g.node.setPosition(px, py, 0);
            slot.g.node.active = true;
            slot.label.string = items[i].label;
            this.paintRadialItem(i, false);
        }
        for (let i = items.length; i < this.radialNodes.length; i++) {
            this.radialNodes[i].g.node.active = false;
        }
    }

    private ensureItemNodes(n: number) {
        while (this.radialNodes.length < n) {
            const node = mk(this.radialLayer, 'item');
            const g = node.addComponent(Graphics);
            const l = label(node, '', 13, PAL.white, true);
            this.radialNodes.push({ g, label: l });
        }
    }

    private paintRadialItem(i: number, hot: boolean) {
        const slot = this.radialNodes[i];
        const it = this.items[i];
        if (!slot || !it) return;
        const g = slot.g;
        g.clear();
        const r = RADIAL_ITEM;
        g.circle(0, 0, r);
        g.fillColor = it.enabled
            ? (hot ? new Color(38, 96, 110, 250) : new Color(20, 30, 39, 240))
            : new Color(18, 22, 27, 220);
        g.fill();
        g.strokeColor = it.enabled
            ? (hot ? HEX(PAL.cyan, 255) : HEX(PAL.cyanDim, 175))
            : HEX('#39424c', 120);
        g.lineWidth = hot ? 2.2 : 1.2;
        g.stroke();
        slot.label.color = HEX(it.enabled ? (hot ? '#ffffff' : '#e2edf6') : '#5b6773');
    }

    setRadialActive(i: number) {
        if (i === this.activeIndex) return;
        const prev = this.activeIndex;
        this.activeIndex = i;
        if (prev >= 0) this.paintRadialItem(prev, false);
        if (i >= 0) this.paintRadialItem(i, true);
    }

    /** -2 = outside the wheel, -1 = centre (cancel), >=0 = item index */
    radialHit(x: number, y: number): number {
        if (!this.open) return -2;
        const dx = x - this.cx;
        const dy = y - this.cy;
        const d = Math.hypot(dx, dy);
        if (d > RADIAL_R + RADIAL_ITEM + 16) return -2;
        if (d < 26) return -1;
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < this.items.length; i++) {
            const a = -Math.PI / 2 + (i / this.items.length) * Math.PI * 2;
            const px = Math.cos(a) * RADIAL_R;
            const py = Math.sin(a) * RADIAL_R;
            const dd = Math.hypot(dx - px, dy - py);
            if (dd < bestD) { bestD = dd; best = i; }
        }
        return bestD <= RADIAL_ITEM + 10 ? best : -1;
    }

    hideRadial() {
        this.open = false;
        this.activeIndex = -1;
        this.radialLayer.active = false;
        for (const s of this.radialNodes) s.g.node.active = false;
    }

    itemAt(i: number): RadialItem | null {
        return i >= 0 && i < this.items.length ? this.items[i] : null;
    }
}
