/**
 * HUD / UI layer — built entirely in code so the whole game ships as scripts.
 * Designed for 1280x720 landscape (WeChat / Douyin mini-game default).
 */
import {
    Node, Graphics, Label, UITransform, Layers, Color, Sprite, SpriteFrame, Texture2D, Rect,
} from 'cc';
import {
    PAL, HEX, BuildingDef, UnitDef, UNITS, BUILDINGS, Faction, FACTIONS,
    MAP_TILES, MAP_SIZE, HALF, TILE, fmtTime, clamp,
} from '../core/Core';
import { Game } from '../game/Game';
import { Building } from '../game/Entities';
import { drawBuilding, drawUnit } from '../render/Art';

const W = 1280;
const H = 720;
const HW = W / 2;
const HH = H / 2;

export interface UIHooks {
    onBuild: (defId: string) => void;
    onProduce: (b: Building, defId: string) => void;
    onSell: () => void;
    onSelectAll: () => void;
    onStop: () => void;
    onAttackMove: () => void;
    onHarvest: () => void;
    onPause: () => void;
    onResume: () => void;
    onStart: (faction: Faction, diff: 'easy' | 'normal' | 'hard') => void;
    onRestart: () => void;
    onQuit: () => void;
    onMinimap: (wx: number, wy: number) => void;
    onCancelBuild: () => void;
    onZoom: (dir: number) => void;
}

function circ(g: Graphics, x: number, y: number, r: number, fill: Color | null, stroke: Color | null, lw = 1.5) {
    g.circle(x, y, r);
    if (fill) { g.fillColor = fill; g.fill(); }
    if (stroke) { g.strokeColor = stroke; g.lineWidth = lw; g.stroke(); }
}

export function mkNode(parent: Node, name: string): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    parent.addChild(n);
    const t = n.getComponent(UITransform) || n.addComponent(UITransform);
    t.setContentSize(0, 0);
    return n;
}

export function mkLabel(parent: Node, text: string, size = 16, color: string = PAL.white, bold = false): Label {
    const n = mkNode(parent, 't');
    n.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = Math.round(size * 1.32);
    l.color = HEX(color);
    l.useSystemFont = true;
    l.fontFamily = 'PingFang SC, Microsoft YaHei, sans-serif';
    l.horizontalAlign = Label.HorizontalAlign.LEFT;
    l.verticalAlign = Label.VerticalAlign.CENTER;
    l.overflow = Label.Overflow.NONE;
    (l as any).isBold = bold;
    return l;
}

export function alignLabel(l: Label, mode: 'left' | 'center' | 'right' = 'left') {
    const t = l.node.getComponent(UITransform) || l.node.addComponent(UITransform);
    if (mode === 'left') { t.setAnchorPoint(0, 0.5); l.horizontalAlign = Label.HorizontalAlign.LEFT; }
    else if (mode === 'right') { t.setAnchorPoint(1, 0.5); l.horizontalAlign = Label.HorizontalAlign.RIGHT; }
    else { t.setAnchorPoint(0.5, 0.5); l.horizontalAlign = Label.HorizontalAlign.CENTER; }
    return l;
}

class UIButton {
    node: Node;
    g: Graphics;
    label: Label | null = null;
    enabled = true;
    visible = true;
    active = false;
    onClick: () => void;
    cx = 0;
    cy = 0;
    w: number;
    h: number;
    color: string;

    constructor(parent: Node, w: number, h: number, text: string, size: number, onClick: () => void, color = PAL.cyanDim) {
        this.w = w; this.h = h; this.onClick = onClick; this.color = color;
        this.node = mkNode(parent, 'btn');
        this.g = this.node.addComponent(Graphics);
        if (text) {
            this.label = mkLabel(this.node, text, size, PAL.white, true);
            alignLabel(this.label, 'center');
        }
        this.draw();
    }

    setPosition(x: number, y: number) {
        this.cx = x; this.cy = y;
        this.node.setPosition(x, y, 0);
        return this;
    }

    setText(s: string) { if (this.label) this.label.string = s; return this; }

    setEnabled(v: boolean) {
        this.enabled = v;
        if (this.label) this.label.color = HEX(v ? PAL.white : '#6b7783');
        this.draw();
    }

    setActive(v: boolean) {
        this.active = v;
        this.draw();
    }

    setVisible(v: boolean) {
        this.visible = v;
        this.node.active = v;
    }

    draw() {
        const g = this.g;
        g.clear();
        g.roundRect(-this.w / 2, -this.h / 2, this.w, this.h, 6);
        g.fillColor = this.active ? HEX(PAL.cyan, 56) : HEX('#1d242d', this.enabled ? 235 : 140);
        g.fill();
        g.strokeColor = this.active ? HEX(PAL.cyan, 220) : HEX(this.color, this.enabled ? 165 : 70);
        g.lineWidth = this.active ? 2 : 1.2;
        g.stroke();
        if (this.active) {
            g.rect(-this.w / 2 + 4, this.h / 2 - 5, this.w - 8, 2);
            g.fillColor = HEX(PAL.cyan, 210);
            g.fill();
        }
    }

    hit(x: number, y: number) {
        return this.visible && this.enabled
            && Math.abs(x - this.cx) <= this.w / 2 && Math.abs(y - this.cy) <= this.h / 2;
    }
}

class Card {
    node: Node;
    g: Graphics;
    icon: Graphics;
    nameL: Label;
    costL: Label;
    progress: Graphics;
    badge: Label;
    enabled = true;
    available = true;
    w: number;
    h: number;

    constructor(parent: Node, public id: string, public kind: 'build' | 'unit', w: number, h: number) {
        this.w = w; this.h = h;
        this.node = mkNode(parent, 'card');
        this.g = this.node.addComponent(Graphics);
        this.icon = mkNode(this.node, 'icon').addComponent(Graphics);
        this.progress = mkNode(this.node, 'prog').addComponent(Graphics);
        this.nameL = mkLabel(this.node, '', 12, PAL.white);
        alignLabel(this.nameL, 'center');
        this.nameL.node.setPosition(0, -h / 2 + 23, 0);
        this.costL = mkLabel(this.node, '', 11, PAL.amber);
        alignLabel(this.costL, 'center');
        this.costL.node.setPosition(0, -h / 2 + 10, 0);
        this.badge = mkLabel(this.node, '', 12, PAL.cyan, true);
        this.badge.node.setPosition(w / 2 - 10, h / 2 - 12, 0);
        alignLabel(this.badge, 'right');
        this.drawBase();
    }

    drawBase() {
        const g = this.g;
        g.clear();
        g.roundRect(-this.w / 2, -this.h / 2, this.w, this.h, 7);
        g.fillColor = HEX('#171d25', 238);
        g.fill();
        g.strokeColor = HEX(PAL.cyanDim, 140);
        g.lineWidth = 1.2;
        g.stroke();
        g.rect(-this.w / 2 + 5, this.h / 2 - 5, this.w - 10, 2);
        g.fillColor = HEX(PAL.cyan, 110);
        g.fill();
        // icon plate keeps the dark vector art readable on a dark card
        const iy = this.h / 2 - 34;
        g.roundRect(-this.w / 2 + 7, iy - 20, this.w - 14, 42, 6);
        g.fillColor = HEX('#26313c', 255);
        g.fill();
        g.strokeColor = HEX(PAL.cyanDim, 90);
        g.lineWidth = 1;
        g.stroke();
    }

    hit(x: number, y: number) {
        const p = this.node.position;
        return Math.abs(x - p.x) <= this.w / 2 && Math.abs(y - p.y) <= this.h / 2;
    }
}

export class UI {
    root: Node;
    mode: 'menu' | 'game' | 'paused' | 'over' = 'menu';
    game: Game | null = null;
    cam: any = null;

    private topBar: Node;
    private bottom: Node;
    private cardLayer: Node;
    private menuLayer: Node;
    private modalLayer: Node;

    private creditsL: Label;
    private powerL: Label;
    private powerG: Graphics;
    private timeL: Label;
    private hintL: Label;
    private toastL: Label;
    private toastT = 0;

    private btnPause: UIButton;
    private btnAll: UIButton;
    private btnStop: UIButton;
    private btnAttackMove: UIButton;
    private btnHarvest: UIButton;
    private btnSell: UIButton;
    private btnCancelBuild: UIButton;
    private btnZoomIn: UIButton;
    private btnZoomOut: UIButton;

    private cards: Card[] = [];
    private cardSig = '';

    private mmSize = 176;
    private mmX = -HW + 18 + 88;
    private mmY = -HH + 16 + 88;
    private mmTex: Texture2D | null = null;
    private mmData: Uint8Array | null = null;
    private mmBase: Uint8Array | null = null;
    private mmView: Graphics | null = null;
    private mmTimer = 0;

    private menuBtns: UIButton[] = [];
    private modalBtns: UIButton[] = [];

    private selFaction: Faction = 'BU';
    private selDiff: 'easy' | 'normal' | 'hard' = 'normal';
    attackMoveMode = false;

    constructor(private canvas: Node, private hooks: UIHooks) {
        this.root = mkNode(canvas, 'UI');
        this.topBar = mkNode(this.root, 'top');
        this.bottom = mkNode(this.root, 'bottom');
        this.cardLayer = mkNode(this.root, 'cards');
        this.menuLayer = mkNode(this.root, 'menu');
        this.modalLayer = mkNode(this.root, 'modal');
        this.buildTop();
        this.buildBottom();
        this.buildMinimap();
        this.buildToast();
        this.buildMenu();
    }

    /* ------------------------------------------------------------ */
    private buildTop() {
        const bg = mkNode(this.topBar, 'bg').addComponent(Graphics);
        bg.roundRect(-HW + 14, HH - 58, W - 28, 44, 9);
        bg.fillColor = HEX('#0d1218', 236);
        bg.fill();
        bg.strokeColor = HEX(PAL.cyanDim, 110);
        bg.lineWidth = 1.2;
        bg.stroke();
        bg.rect(-HW + 14, HH - 58, W - 28, 2);
        bg.fillColor = HEX(PAL.cyan, 90);
        bg.fill();

        const ic = mkNode(this.topBar, 'crys').addComponent(Graphics);
        ic.node.setPosition(-HW + 40, HH - 36, 0);
        ic.moveTo(-6, -7); ic.lineTo(0, 9); ic.lineTo(6, -7); ic.close();
        ic.fillColor = HEX(PAL.cyan, 230);
        ic.fill();
        ic.moveTo(-6, -7); ic.lineTo(0, -2); ic.lineTo(6, -7); ic.close();
        ic.fillColor = HEX('#bff7ff', 200);
        ic.fill();

        this.creditsL = mkLabel(this.topBar, '7000', 19, PAL.white, true);
        this.creditsL.node.setPosition(-HW + 58, HH - 36, 0);

        this.powerG = mkNode(this.topBar, 'pwr').addComponent(Graphics);
        this.powerG.node.setPosition(-HW + 196, HH - 36, 0);
        this.powerL = mkLabel(this.topBar, '', 13, PAL.sandLight);
        this.powerL.node.setPosition(-HW + 230, HH - 36, 0);

        this.timeL = mkLabel(this.topBar, '0:00', 16, PAL.sandLight, true);
        this.timeL.node.setPosition(-HW + 356, HH - 36, 0);

        this.btnAll = new UIButton(this.topBar, 92, 30, '全选部队', 13, () => this.hooks.onSelectAll());
        this.btnAll.setPosition(HW - 296, HH - 36);

        this.btnZoomOut = new UIButton(this.topBar, 34, 30, '−', 18, () => this.hooks.onZoom(-1));
        this.btnZoomOut.setPosition(HW - 194, HH - 36);
        this.btnZoomIn = new UIButton(this.topBar, 34, 30, '+', 18, () => this.hooks.onZoom(1));
        this.btnZoomIn.setPosition(HW - 152, HH - 36);

        this.btnPause = new UIButton(this.topBar, 84, 30, '暂停', 13, () => this.hooks.onPause());
        this.btnPause.setPosition(HW - 72, HH - 36);
    }

    /* ------------------------------------------------------------ */
    private buildBottom() {
        const bg = mkNode(this.bottom, 'bg').addComponent(Graphics);
        bg.roundRect(-HW + 14, -HH + 12, W - 28, 212, 12);
        bg.fillColor = HEX('#0d1218', 242);
        bg.fill();
        bg.strokeColor = HEX(PAL.cyanDim, 110);
        bg.lineWidth = 1.2;
        bg.stroke();
        bg.rect(-HW + 14, -HH + 224, W - 28, 2);
        bg.fillColor = HEX(PAL.cyan, 80);
        bg.fill();

        this.hintL = mkLabel(this.bottom, '', 14, PAL.sandLight);
        this.hintL.node.setPosition(-HW + 220, -HH + 178, 0);

        this.btnStop = new UIButton(this.bottom, 78, 32, '停止', 13, () => this.hooks.onStop());
        this.btnStop.setPosition(HW - 470, -HH + 178);
        this.btnAttackMove = new UIButton(this.bottom, 96, 32, '攻击移动', 13, () => {
            this.setAttackMoveMode(!this.attackMoveMode);
        });
        this.btnAttackMove.setPosition(HW - 372, -HH + 178);
        this.btnHarvest = new UIButton(this.bottom, 78, 32, '采集', 13, () => this.hooks.onHarvest());
        this.btnHarvest.setPosition(HW - 274, -HH + 178);
        this.btnSell = new UIButton(this.bottom, 78, 32, '拆除', 13, () => this.hooks.onSell(), PAL.red);
        this.btnSell.setPosition(HW - 182, -HH + 178);

        this.btnCancelBuild = new UIButton(this.bottom, 108, 32, '取消建造', 13, () => this.hooks.onCancelBuild(), PAL.red);
        this.btnCancelBuild.setPosition(HW - 100, -HH + 178);
        this.btnCancelBuild.setVisible(false);
    }

    /* ------------------------------------------------------------ */
    private buildMinimap() {
        const n = mkNode(this.bottom, 'minimap');
        n.setPosition(this.mmX, this.mmY, 0);
        const border = mkNode(n, 'frame').addComponent(Graphics);
        border.roundRect(-this.mmSize / 2 - 6, -this.mmSize / 2 - 6, this.mmSize + 12, this.mmSize + 12, 8);
        border.fillColor = HEX('#0a0e12', 245);
        border.fill();
        border.strokeColor = HEX(PAL.cyanDim, 165);
        border.lineWidth = 1.5;
        border.stroke();

        const size = MAP_TILES;
        this.mmData = new Uint8Array(size * size * 4);
        this.mmBase = new Uint8Array(size * size * 4);
        this.mmTex = new Texture2D();
        this.mmTex.reset({ width: size, height: size, format: Texture2D.PixelFormat.RGBA8888, mipmapLevel: 0 });
        this.mmTex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
        this.mmTex.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);

        const sn = mkNode(n, 'img');
        const sf = new SpriteFrame();
        sf.texture = this.mmTex;
        sf.rect = new Rect(0, 0, size, size);
        sf.packable = false;
        const sp = sn.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = sf;
        sn.getComponent(UITransform)!.setContentSize(this.mmSize, this.mmSize);

        this.mmView = mkNode(n, 'view').addComponent(Graphics);
    }

    private buildMinimapBase() {
        if (!this.game || !this.mmBase) return;
        const size = MAP_TILES;
        const d = this.mmBase;
        const t = this.game.terrain;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const k = t.kind[y * size + x];
                const o = (y * size + x) * 4;
                let r = 198, g = 158, b = 112;
                if (k === 1) { r = 214; g = 178; b = 130; }
                else if (k === 2) { r = 150; g = 126; b = 95; }
                else if (k === 3) { r = 63; g = 217; b = 236; }
                d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
            }
        }
    }

    private refreshMinimap(dt: number) {
        if (!this.game || !this.mmData || !this.mmTex || !this.mmBase) return;
        this.mmTimer -= dt;
        if (this.mmTimer > 0) { this.updateMinimapView(); return; }
        this.mmTimer = 0.28;
        this.buildMinimapBase();
        const size = MAP_TILES;
        const p = this.game.human;
        const d = this.mmData;
        d.set(this.mmBase);
        for (let i = 0; i < size * size; i++) {
            const o = i * 4;
            if (!p.explored[i]) {
                d[o] = 10; d[o + 1] = 13; d[o + 2] = 16;
            } else if (!p.visible[i]) {
                d[o] = d[o] * 0.45; d[o + 1] = d[o + 1] * 0.45; d[o + 2] = d[o + 2] * 0.45;
            }
        }
        const dot = (wx: number, wy: number, r: number, cr: number, cg: number, cb: number) => {
            const tx = Math.floor((wx + HALF) / TILE);
            const ty = Math.floor((wy + HALF) / TILE);
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    const x = tx + dx, y = ty + dy;
                    if (x < 0 || y < 0 || x >= size || y >= size) continue;
                    if (dx * dx + dy * dy > r * r + 0.2) continue;
                    const o = (y * size + x) * 4;
                    d[o] = cr; d[o + 1] = cg; d[o + 2] = cb;
                }
            }
        };
        for (const b of this.game.buildings) {
            if (b.dead || !this.game.isVisibleTo(p, b)) continue;
            if (b.owner === 0) dot(b.x, b.y, b.size > 2 ? 2 : 1, 120, 240, 235);
            else dot(b.x, b.y, b.size > 2 ? 2 : 1, 235, 90, 72);
        }
        for (const u of this.game.units) {
            if (u.dead || !this.game.isVisibleTo(p, u)) continue;
            if (u.owner === 0) dot(u.x, u.y, 0, 235, 250, 255);
            else dot(u.x, u.y, 0, 235, 90, 72);
        }
        const flipped = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) {
            const src = (size - 1 - y) * size * 4;
            flipped.set(d.subarray(src, src + size * 4), y * size * 4);
        }
        this.mmTex.uploadData(flipped);
        this.updateMinimapView();
    }

    private updateMinimapView() {
        if (!this.mmView || !this.cam) return;
        const g = this.mmView;
        g.clear();
        const cam = this.cam;
        const w = (cam.screenW / cam.zoom) / MAP_SIZE * this.mmSize;
        const h = (cam.screenH / cam.zoom) / MAP_SIZE * this.mmSize;
        const cx = (cam.x + HALF) / MAP_SIZE * this.mmSize - this.mmSize / 2;
        const cy = (cam.y + HALF) / MAP_SIZE * this.mmSize - this.mmSize / 2;
        g.rect(cx - w / 2, cy - h / 2, w, h);
        g.strokeColor = HEX('#f2fdff', 210);
        g.lineWidth = 1.2;
        g.stroke();
    }

    /* ------------------------------------------------------------ */
    private buildToast() {
        this.toastL = mkLabel(this.root, '', 16, PAL.cyan, true);
        alignLabel(this.toastL, 'center');
        this.toastL.node.setPosition(0, HH - 92, 0);
        this.toastL.node.active = false;
    }

    setAttackMoveMode(v: boolean) {
        this.attackMoveMode = v;
        this.btnAttackMove.setActive(v);
    }

    toast(msg: string, kind = 'info') {
        this.toastL.string = msg;
        this.toastL.color = HEX(kind === 'warn' ? PAL.red : kind === 'good' ? PAL.green : PAL.cyan);
        this.toastL.node.active = true;
        this.toastT = 1.8;
    }

    /* ------------------------------------------------------------ */
    /* cards                                                        */
    /* ------------------------------------------------------------ */
    private clearCards() {
        for (const c of this.cards) c.node.destroy();
        this.cards.length = 0;
    }

    private layoutCards(defs: Array<{ id: string; name: string; cost: number; kind: 'build' | 'unit'; icon: (g: Graphics) => void }>) {
        this.clearCards();
        const cw = 78, ch = 96, gap = 8;
        const n = defs.length;
        if (n === 0) { this.cardSig = ''; return; }
        const totalW = n * cw + (n - 1) * gap;
        let x = -30 - totalW / 2 + cw / 2;
        const y = -HH + 104;
        for (const d of defs) {
            const card = new Card(this.cardLayer, d.id, d.kind, cw, ch);
            card.node.setPosition(x, y, 0);
            card.icon.node.setPosition(0, 14, 0);
            card.icon.node.setScale(0.5, 0.5, 1);
            d.icon(card.icon);
            card.nameL.string = d.name;
            card.costL.string = `◈ ${d.cost}`;
            this.cards.push(card);
            x += cw + gap;
        }
    }

    private signature(): string {
        const g = this.game;
        if (!g) return '';
        if (g.buildMode) return 'none';
        const b = g.selectedBuilding;
        if (b && b.done && b.def.produces) {
            return 'u:' + b.id + ':' + g.availableUnits(b).map(d => d.id).join(',');
        }
        const h = g.human;
        const defs = g.availableBuildings(h);
        return 'b:' + defs.map(d => d.id + (g.missingRequirement(h, d) ? '!' : '')).join(',');
    }

    private refreshCards() {
        const g = this.game;
        if (!g) return;
        const h = g.human;
        const sig = this.signature();
        if (sig !== this.cardSig) {
            this.cardSig = sig;
            if (sig === 'none') {
                this.clearCards();
            } else if (sig.startsWith('u:')) {
                const b = g.selectedBuilding!;
                const defs = g.availableUnits(b).map<{ id: string; name: string; cost: number; kind: 'unit'; icon: (gg: Graphics) => void }>(def => ({
                    id: def.id, name: def.name, cost: def.cost, kind: 'unit',
                    icon: (gg: Graphics) => drawUnit(gg, def, h.faction),
                }));
                this.layoutCards(defs);
            } else {
                const defs = g.availableBuildings(h).map<{ id: string; name: string; cost: number; kind: 'build'; icon: (gg: Graphics) => void }>(def => ({
                    id: def.id, name: def.name, cost: def.cost, kind: 'build',
                    icon: (gg: Graphics) => drawBuilding(gg, def, h.faction, 1),
                }));
                this.layoutCards(defs);
            }
        }

        const b = g.selectedBuilding;
        for (const c of this.cards) {
            const def = c.kind === 'build' ? BUILDINGS[c.id] : UNITS[c.id];
            const missing = c.kind === 'build' ? g.missingRequirement(h, def as BuildingDef) : '';
            const affordable = h.credits >= def.cost;
            const ok = !missing && affordable;
            if (c.available !== ok) {
                c.available = ok;
                c.enabled = ok;
                c.nameL.color = HEX(missing ? '#7b8794' : PAL.white);
                c.costL.string = missing ? `缺 ${missing.replace('需要 ', '')}` : `◈ ${def.cost}`;
                c.costL.fontSize = missing ? 10 : 11;
                c.costL.color = HEX(missing ? PAL.red : affordable ? PAL.amber : PAL.red);
                c.drawBase();
            }
            const pg = c.progress;
            pg.clear();
            if (b && c.kind === 'unit') {
                const idx = b.queue.findIndex(q => q.defId === c.id);
                if (idx >= 0) {
                    const q = b.queue[idx];
                    pg.roundRect(-38, -47, 76, 94, 7);
                    pg.strokeColor = HEX(PAL.cyan, idx === 0 ? 200 : 90);
                    pg.lineWidth = idx === 0 ? 2 : 1;
                    pg.stroke();
                    if (idx === 0) {
                        const p = clamp(q.t / q.total, 0, 1);
                        pg.rect(-38, -47, 76 * p, 3);
                        pg.fillColor = HEX(PAL.cyan, 240);
                        pg.fill();
                    }
                    c.badge.string = `${idx + 1}`;
                } else {
                    c.badge.string = '';
                }
            }
        }
    }

    /* ------------------------------------------------------------ */
    /* menu                                                          */
    /* ------------------------------------------------------------ */
    private buildMenu() {
        const ov = this.menuLayer;
        this.menuBtns = [];
        const dim = mkNode(ov, 'dim').addComponent(Graphics);
        dim.rect(-HW, -HH, W + 4, H + 4);
        dim.fillColor = HEX('#0a0e13', 244);
        dim.fill();
        dim.strokeColor = HEX(PAL.cyanDim, 34);
        dim.lineWidth = 1;
        for (let i = -8; i <= 8; i++) { dim.moveTo(-HW, i * 54); dim.lineTo(HW, i * 54); }
        dim.stroke();
        dim.rect(-HW, HH - 6, W, 3);
        dim.fillColor = HEX(PAL.cyan, 60);
        dim.fill();

        const title = mkLabel(ov, '裂 沙 战 线', 54, PAL.white, true);
        title.node.setPosition(0, 250, 0);
        alignLabel(title, 'center');

        const sub = mkLabel(ov, 'R I F T S A N D   ·   沙海之上，钢铁与风的战争', 15, PAL.cyan);
        sub.node.setPosition(0, 206, 0);
        alignLabel(sub, 'center');

        this.factionCard(ov, 'BU', -196);
        this.factionCard(ov, 'DS', 196);

        const dLabel = mkLabel(ov, '难度', 14, '#93a3b0');
        dLabel.node.setPosition(-232, -152, 0);
        const diffs: Array<['easy' | 'normal' | 'hard', string]> = [['easy', '轻松'], ['normal', '标准'], ['hard', '残酷']];
        let dx = -160;
        for (const [key, text] of diffs) {
            const b = new UIButton(ov, 92, 32, text, 13, () => {
                this.selDiff = key;
                this.rebuildMenu();
            });
            b.setPosition(dx, -152);
            b.setActive(this.selDiff === key);
            this.menuBtns.push(b);
            dx += 100;
        }

        const start = new UIButton(ov, 250, 54, '开 始 战 斗', 21, () => {
            this.mode = 'game';
            this.menuLayer.active = false;
            this.hooks.onStart(this.selFaction, this.selDiff);
        }, PAL.cyan);
        start.setPosition(0, -238);
        this.menuBtns.push(start);

        const tip = mkLabel(ov, '单指拖动平移 · 双指缩放 · 点击选中与下令 · 底部卡片建造 / 生产', 12, '#8a99a6');
        tip.node.setPosition(0, -300, 0);
        alignLabel(tip, 'center');
    }

    private factionCard(ov: Node, f: Faction, x: number) {
        const fd = FACTIONS[f];
        const n = mkNode(ov, 'fc' + f);
        n.setPosition(x, 40, 0);
        const g = n.addComponent(Graphics);
        const sel = this.selFaction === f;
        g.roundRect(-172, -112, 344, 224, 12);
        g.fillColor = HEX(sel ? '#1b2530' : '#131920', 242);
        g.fill();
        g.strokeColor = sel ? HEX(fd.color, 235) : HEX('#28323c', 220);
        g.lineWidth = sel ? 2.4 : 1.2;
        g.stroke();
        g.rect(-172, 108, 344, 3);
        g.fillColor = HEX(fd.color, sel ? 235 : 80);
        g.fill();

        const em = mkNode(n, 'em').addComponent(Graphics);
        em.node.setPosition(104, 30, 0);
        circ(em, 0, 0, 34, null, HEX(fd.color, sel ? 200 : 90), 1.4);
        circ(em, 0, 0, 22, HEX(fd.color, sel ? 34 : 12), null);
        if (f === 'BU') {
            em.moveTo(-14, -12); em.lineTo(0, 18); em.lineTo(14, -12); em.close();
            em.fillColor = HEX(fd.color, 210); em.fill();
            em.rect(-6, -16, 12, 5); em.fillColor = HEX(fd.color, 150); em.fill();
        } else {
            em.moveTo(-16, 10); em.quadraticCurveTo(0, -22, 16, 10);
            em.strokeColor = HEX(fd.color, 220); em.lineWidth = 3; em.stroke();
            em.moveTo(-8, 16); em.lineTo(8, 16);
            em.strokeColor = HEX(fd.color, 160); em.lineWidth = 2; em.stroke();
        }

        const t = mkLabel(n, fd.name, 25, fd.color, true);
        t.node.setPosition(-150, 74, 0);
        const en = mkLabel(n, fd.en, 10, '#7c8b98');
        en.node.setPosition(-150, 50, 0);
        const blurb = mkLabel(n, fd.blurb, 12, '#b6c4d0');
        blurb.node.setPosition(-150, 12, 0);
        blurb.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        blurb.node.getComponent(UITransform)!.setContentSize(250, 44);
        blurb.lineHeight = 19;
        blurb.overflow = Label.Overflow.RESIZE_HEIGHT;
        const style = mkLabel(n, `▸ ${fd.style}`, 12, fd.glow);
        style.node.setPosition(-150, -40, 0);
        const motto = mkLabel(n, `「${fd.motto}」`, 12, '#8092a0');
        motto.node.setPosition(-150, -74, 0);

        const hit = new UIButton(n, 344, 224, '', 1, () => {
            this.selFaction = f;
            this.rebuildMenu();
        });
        hit.setPosition(0, 0);
        hit.g.clear();
        hit.node.setSiblingIndex(0);
        this.menuBtns.push(hit);
    }

    private rebuildMenu() {
        this.menuLayer.destroy();
        this.menuLayer = mkNode(this.root, 'menu');
        this.buildMenu();
        this.menuLayer.active = this.mode === 'menu';
    }

    showMenu() {
        this.mode = 'menu';
        this.menuLayer.active = true;
        this.hideModal();
        this.topBar.active = false;
        this.bottom.active = false;
        this.cardLayer.active = false;
    }

    hideMenu() {
        this.menuLayer.active = false;
        this.topBar.active = true;
        this.bottom.active = true;
        this.cardLayer.active = true;
        this.mode = 'game';
    }

    /* ------------------------------------------------------------ */
    /* modal (pause / result)                                        */
    /* ------------------------------------------------------------ */
    hideModal() {
        for (const c of this.modalLayer.children.slice()) c.destroy();
        this.modalBtns = [];
    }

    private modalBase(w: number, h: number, title: string, titleColor: string) {
        this.hideModal();
        const dim = mkNode(this.modalLayer, 'dim').addComponent(Graphics);
        dim.rect(-HW, -HH, W + 4, H + 4);
        dim.fillColor = HEX('#05080b', 205);
        dim.fill();
        const box = mkNode(this.modalLayer, 'box');
        const g = box.addComponent(Graphics);
        g.roundRect(-w / 2, -h / 2, w, h, 14);
        g.fillColor = HEX('#111820', 246);
        g.fill();
        g.strokeColor = HEX(PAL.cyanDim, 190);
        g.lineWidth = 1.6;
        g.stroke();
        g.rect(-w / 2, h / 2 - 3, w, 3);
        g.fillColor = HEX(titleColor, 210);
        g.fill();
        const t = mkLabel(box, title, 30, titleColor, true);
        t.node.setPosition(0, h / 2 - 52, 0);
        alignLabel(t, 'center');
        return box;
    }

    private modalButton(parent: Node, x: number, y: number, w: number, text: string, cb: () => void, color = PAL.cyanDim) {
        const b = new UIButton(parent, w, 44, text, 16, cb, color);
        b.setPosition(x, y);
        this.modalBtns.push(b);
        return b;
    }

    showPause() {
        this.mode = 'paused';
        const box = this.modalBase(420, 320, '暂 停', PAL.cyan);
        this.modalButton(box, 0, 20, 220, '继续战斗', () => this.hooks.onResume());
        this.modalButton(box, 0, -34, 220, '重新开始', () => this.hooks.onRestart());
        this.modalButton(box, 0, -88, 220, '返回主菜单', () => this.hooks.onQuit(), PAL.red);
    }

    showResult(win: boolean, stats: { time: number; kills: number; lost: number; built: number }) {
        this.mode = 'over';
        const box = this.modalBase(480, 380, win ? '战 役 胜 利' : '基 地 陷 落', win ? PAL.green : PAL.red);
        const lines = [
            `作战时长   ${fmtTime(stats.time)}`,
            `击毁敌军   ${stats.kills}`,
            `损失单位   ${stats.lost}`,
            `生产单位   ${stats.built}`,
        ];
        let y = 60;
        for (const l of lines) {
            const t = mkLabel(box, l, 15, '#c2d0dc');
            t.node.setPosition(0, y, 0);
            alignLabel(t, 'center');
            y -= 30;
        }
        this.modalButton(box, -110, -116, 190, '再战一局', () => this.hooks.onRestart());
        this.modalButton(box, 110, -116, 190, '返回主菜单', () => this.hooks.onQuit(), PAL.red);
    }

    /* ------------------------------------------------------------ */
    /* input                                                         */
    /* ------------------------------------------------------------ */
    private allButtons(): UIButton[] {
        return [this.btnPause, this.btnAll, this.btnStop, this.btnAttackMove, this.btnHarvest,
            this.btnSell, this.btnCancelBuild, this.btnZoomIn, this.btnZoomOut];
    }

    hitTest(x: number, y: number): boolean {
        if (this.mode !== 'game') return true;
        for (const b of this.allButtons()) {
            if (b.visible && Math.abs(x - b.cx) <= b.w / 2 && Math.abs(y - b.cy) <= b.h / 2) return true;
        }
        for (const c of this.cards) if (c.node.active && c.hit(x, y)) return true;
        const m = this.mmSize / 2 + 8;
        if (Math.abs(x - this.mmX) <= m && Math.abs(y - this.mmY) <= m) return true;
        if (y > HH - 60) return true;
        if (y < -HH + 228) return true;
        return false;
    }

    onTap(x: number, y: number): boolean {
        if (this.mode === 'menu') {
            for (const b of this.menuBtns) if (b.hit(x, y)) { b.onClick(); return true; }
            return true;
        }
        if (this.mode !== 'game') {
            for (const b of this.modalBtns) if (b.hit(x, y)) { b.onClick(); return true; }
            return true;
        }
        for (const b of this.allButtons()) if (b.hit(x, y)) { b.onClick(); return true; }
        const mmHalf = this.mmSize / 2;
        if (Math.abs(x - this.mmX) <= mmHalf && Math.abs(y - this.mmY) <= mmHalf) {
            const wx = ((x - this.mmX + mmHalf) / this.mmSize) * MAP_SIZE - HALF;
            const wy = ((y - this.mmY + mmHalf) / this.mmSize) * MAP_SIZE - HALF;
            this.hooks.onMinimap(wx, wy);
            return true;
        }
        for (const c of this.cards) {
            if (!c.node.active || !c.hit(x, y)) continue;
            if (!c.enabled) { this.toast('条件不足', 'warn'); return true; }
            if (c.kind === 'build') this.hooks.onBuild(c.id);
            else if (this.game?.selectedBuilding) this.hooks.onProduce(this.game.selectedBuilding, c.id);
            return true;
        }
        if (y > HH - 60 || y < -HH + 228) return true;
        return false;
    }

    /* ------------------------------------------------------------ */
    refresh(dt: number) {
        if (this.mode === 'menu' || !this.game) return;
        const g = this.game;
        const h = g.human;
        this.creditsL.string = `${Math.floor(h.credits)}`;
        const pw = g.power(h);
        this.powerL.string = `${pw.ok ? '' : '! '}${pw.used}/${pw.made}`;
        this.powerL.color = HEX(pw.ok ? PAL.sandLight : PAL.red);
        const pg = this.powerG;
        pg.clear();
        pg.rect(-22, -3, 44, 6);
        pg.fillColor = HEX('#0a0e12', 220);
        pg.fill();
        if (pw.made > 0) {
            pg.rect(-22, -3, 44 * Math.min(1, pw.used / pw.made), 6);
            pg.fillColor = HEX(pw.ok ? PAL.cyan : PAL.red, 220);
            pg.fill();
        }
        this.timeL.string = fmtTime(g.time);

        const selCount = g.selection.length;
        const hasB = !!g.selectedBuilding;
        this.btnStop.setVisible(selCount > 0);
        this.btnAttackMove.setVisible(selCount > 0);
        this.btnHarvest.setVisible(g.selection.some(u => u.isHarvester));
        this.btnSell.setVisible(hasB);
        this.btnCancelBuild.setVisible(!!g.buildMode);

        if (g.buildMode) {
            this.hintL.string = `放置 ${BUILDINGS[g.buildMode].name} · 点击地面确认`;
        } else if (hasB) {
            const b = g.selectedBuilding;
            this.hintL.string = `${b.def.name}${b.queue.length ? ` · 队列 ${b.queue.length}` : ''}${b.done ? '' : ` · 建造中 ${Math.round(b.progress * 100)}%`}`;
        } else if (selCount > 0) {
            const u = g.selection[0];
            this.hintL.string = selCount === 1
                ? `${u.def.name} · HP ${Math.ceil(u.hp)}/${u.def.hp}${u.isHarvester ? ` · 载货 ${Math.floor(u.cargo)}` : ''}`
                : `已选中 ${selCount} 个单位${this.attackMoveMode ? ' · 攻击移动' : ''}`;
        } else {
            this.hintL.string = '点击单位或建筑进行指挥，拖动平移视角';
        }

        this.refreshCards();
        this.refreshMinimap(dt);

        if (this.toastT > 0) {
            this.toastT -= dt;
            const c = this.toastL.color.clone();
            c.a = Math.round(255 * Math.min(1, this.toastT / 0.45));
            this.toastL.color = c;
            if (this.toastT <= 0) this.toastL.node.active = false;
        }
    }
}
