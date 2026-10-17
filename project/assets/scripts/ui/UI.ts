/**
 * HUD / UI layer — built entirely in code so the whole game ships as scripts.
 * Designed for 1280x720 landscape (WeChat / Douyin mini-game default).
 *
 * Layout follows the classic sidebar idea, adapted to a phone:
 *   top bar      resources, power, clock, contextual hint
 *   left bottom  radar / minimap
 *   tab row      structures / infantry / vehicles / aircraft
 *   card row     the production queue for the active tab
 *   right edge   super weapon buttons (visible once the building exists)
 */
import {
    Node, Graphics, Label, UITransform, Layers, Color, Sprite, SpriteFrame, Texture2D, Rect,
} from 'cc';
import {
    PAL, HEX, BuildingDef, UnitDef, UNITS, BUILDINGS, Faction, FACTIONS,
    MAP_TILES, MAP_SIZE, HALF, TILE, fmtTime, clamp, QUEUE_MAX, ProdCat, SuperWeaponId, SUPER_WEAPONS,
} from '../core/Core';
import { Game } from '../game/Game';
import { Building } from '../game/Entities';
import { drawBuilding, drawUnit, pen } from '../render/Art';
import { Overlay } from './Overlay';

const W = 1280;
const H = 720;
const HW = W / 2;
const HH = H / 2;

export interface UIHooks {
    /** queue a structure in the sidebar */
    onBuild: (defId: string) => void;
    /** place a finished structure */
    onPlace: (defId: string) => void;
    /** queue units in a category */
    onProduce: (cat: ProdCat, defId: string, times: number) => void;
    onSell: () => void;
    onRepair: () => void;
    onStance: () => void;
    onScatter: () => void;
    onDeploy: () => void;
    onSelectAll: () => void;
    onStop: () => void;
    onAttackMove: () => void;
    onHarvest: () => void;
    onPause: () => void;
    onResume: () => void;
    onStart: (faction: Faction, diff: 'easy' | 'normal' | 'hard', credits: number, superWeapons: boolean) => void;
    onRestart: () => void;
    onQuit: () => void;
    onMinimap: (wx: number, wy: number) => void;
    onCancelBuild: () => void;
    onZoom: (dir: number) => void;
    onSuperWeapon: (id: SuperWeaponId) => void;
    onToggleSound: (muted: boolean) => void;
    onCancelQueue: (cat: ProdCat, index: number) => void;
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
        if (this.enabled === v) return;
        this.enabled = v;
        if (this.label) this.label.color = HEX(v ? PAL.white : '#6b7783');
        this.draw();
    }

    setActive(v: boolean) {
        if (this.active === v) return;
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
    lastSig = '';
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
        this.drawBase(false);
    }

    drawBase(ready: boolean, locked = false) {
        const g = this.g;
        g.clear();
        g.roundRect(-this.w / 2, -this.h / 2, this.w, this.h, 7);
        g.fillColor = HEX(ready ? '#243021' : locked ? '#14181d' : '#171d25', 238);
        g.fill();
        g.strokeColor = ready ? HEX(PAL.green, 230) : locked ? HEX('#2a333d', 150) : HEX(PAL.cyanDim, 140);
        g.lineWidth = ready ? 2 : 1.2;
        g.stroke();
        g.rect(-this.w / 2 + 5, this.h / 2 - 5, this.w - 10, 2);
        g.fillColor = ready ? HEX(PAL.green, 220) : HEX(PAL.cyan, locked ? 55 : 110);
        g.fill();
        // icon plate keeps the dark vector art readable on a dark card
        const iy = this.h / 2 - 34;
        g.roundRect(-this.w / 2 + 7, iy - 20, this.w - 14, 42, 6);
        g.fillColor = HEX(locked ? '#1c232a' : '#26313c', 255);
        g.fill();
        g.strokeColor = HEX(PAL.cyanDim, locked ? 45 : 90);
        g.lineWidth = 1;
        g.stroke();
    }

    hit(x: number, y: number) {
        const p = this.node.position;
        return Math.abs(x - p.x) <= this.w / 2 && Math.abs(y - p.y) <= this.h / 2;
    }
}

interface SwButton {
    id: SuperWeaponId;
    node: Node;
    g: Graphics;
    name: Label;
    time: Label;
    cx: number;
    cy: number;
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
    private btnStance: UIButton;
    private btnScatter: UIButton;
    private btnHarvest: UIButton;
    private btnSell: UIButton;
    private btnRepair: UIButton;
    private btnDeploy: UIButton;
    private btnCancelBuild: UIButton;
    private btnZoomIn: UIButton;
    private btnZoomOut: UIButton;
    private tabBtns: UIButton[] = [];

    private cards: Card[] = [];
    private cardSig = '';
    tab: ProdCat = 'structure';

    private swButtons: SwButton[] = [];

    private mmSize = 176;
    private mmX = -HW + 18 + 88;
    private mmY = -HH + 16 + 88;
    private mmTex: Texture2D | null = null;
    private mmData: Uint8Array | null = null;
    private mmBase: Uint8Array | null = null;
    private mmView: Graphics | null = null;
    private mmOff: Label | null = null;
    private mmTimer = 0;
    private mmNoiseT = 0;

    private menuBtns: UIButton[] = [];
    private modalBtns: UIButton[] = [];

    private selFaction: Faction = 'BU';
    private selDiff: 'easy' | 'normal' | 'hard' = 'normal';
    private selCredits = 4200;
    private selSuper = true;
    attackMoveMode = false;
    /** which group strip cell is highlighted, -1 = none */
    activeGroup = -1;
    /** touch affordances: group strip, command wheel, box rectangle */
    overlay: Overlay;

    constructor(private canvas: Node, private hooks: UIHooks) {
        this.root = mkNode(canvas, 'UI');
        this.topBar = mkNode(this.root, 'top');
        this.bottom = mkNode(this.root, 'bottom');
        this.cardLayer = mkNode(this.root, 'cards');
        this.menuLayer = mkNode(this.root, 'menu');
        this.modalLayer = mkNode(this.root, 'modal');
        this.buildTop();
        this.buildBottom();
        this.buildTabs();
        this.buildMinimap();
        this.buildToast();
        this.buildMenu();
        this.overlay = new Overlay(canvas);
        this.overlay.setGroupsVisible(false);
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

        this.creditsL = mkLabel(this.topBar, '4200', 19, PAL.white, true);
        this.creditsL.node.setPosition(-HW + 58, HH - 36, 0);

        this.powerG = mkNode(this.topBar, 'pwr').addComponent(Graphics);
        this.powerG.node.setPosition(-HW + 196, HH - 36, 0);
        this.powerL = mkLabel(this.topBar, '', 13, PAL.sandLight);
        this.powerL.node.setPosition(-HW + 230, HH - 36, 0);

        this.timeL = mkLabel(this.topBar, '0:00', 16, PAL.sandLight, true);
        this.timeL.node.setPosition(-HW + 356, HH - 36, 0);

        // contextual hint uses the free middle of the bar
        this.hintL = mkLabel(this.topBar, '', 13, PAL.sandLight);
        alignLabel(this.hintL, 'center');
        this.hintL.node.setPosition(30, HH - 36, 0);

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

        const y = -HH + 186;
        this.btnStop = new UIButton(this.bottom, 74, 30, '停止', 12, () => this.hooks.onStop());
        this.btnAttackMove = new UIButton(this.bottom, 74, 30, '攻移', 12, () => {
            this.setAttackMoveMode(!this.attackMoveMode);
        });
        this.btnStance = new UIButton(this.bottom, 74, 30, '姿态', 12, () => this.hooks.onStance());
        this.btnScatter = new UIButton(this.bottom, 74, 30, '散开', 12, () => this.hooks.onScatter());
        this.btnHarvest = new UIButton(this.bottom, 74, 30, '采集', 12, () => this.hooks.onHarvest());
        this.btnRepair = new UIButton(this.bottom, 74, 30, '维修', 12, () => this.hooks.onRepair(), PAL.green);
        this.btnSell = new UIButton(this.bottom, 74, 30, '拆除', 12, () => this.hooks.onSell(), PAL.red);
        this.btnDeploy = new UIButton(this.bottom, 74, 30, '部署', 12, () => this.hooks.onDeploy(), PAL.amber);
        this.btnCancelBuild = new UIButton(this.bottom, 88, 30, '取消放置', 12, () => this.hooks.onCancelBuild(), PAL.red);
        for (const b of [this.btnStop, this.btnAttackMove, this.btnStance, this.btnScatter, this.btnHarvest,
            this.btnRepair, this.btnSell, this.btnDeploy, this.btnCancelBuild]) {
            b.setPosition(HW - 50, y);
            b.setVisible(false);
        }
    }

    /** production tabs — buildings / infantry / vehicles / aircraft */
    private buildTabs() {
        const defs: Array<[ProdCat, string]> = [
            ['structure', '建筑'], ['infantry', '步兵'], ['vehicle', '车辆'], ['aircraft', '空军'],
        ];
        let x = -400;
        for (const [cat, name] of defs) {
            const b = new UIButton(this.bottom, 68, 30, name, 13, () => {
                this.tab = cat;
                this.cardSig = '';
                this.refreshTabButtons();
                this.refreshCards();
            });
            b.setPosition(x, -HH + 186);
            (b as any).cat = cat;
            this.tabBtns.push(b);
            x += 76;
        }
        this.refreshTabButtons();
    }

    private refreshTabButtons() {
        for (const b of this.tabBtns) {
            b.setActive((b as any).cat === this.tab);
        }
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
        this.mmOff = mkLabel(n, '雷达离线', 15, PAL.red, true);
        alignLabel(this.mmOff, 'center');
        this.mmOff.node.setPosition(0, 0, 0);
        this.mmOff.node.active = false;
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
        const p = this.game.human;
        const online = this.game.radarOnline(p);
        if (this.mmOff) this.mmOff.node.active = !online;
        this.mmTimer -= dt;
        if (this.mmTimer > 0) { this.updateMinimapView(online); return; }
        this.mmTimer = 0.28;
        const size = MAP_TILES;
        const d = this.mmData;

        if (!online) {
            // dead radar: static instead of a battlefield map
            this.mmNoiseT -= dt;
            for (let i = 0; i < size * size; i++) {
                const o = i * 4;
                const v = 18 + ((i * 37 + Math.floor(this.game.time * 60) * 13) % 26);
                d[o] = v; d[o + 1] = v + 4; d[o + 2] = v + 6;
            }
            for (let y = 0; y < size; y += 6) {
                for (let x = 0; x < size; x++) {
                    const o = (y * size + x) * 4;
                    d[o] = 58; d[o + 1] = 66; d[o + 2] = 72;
                }
            }
            this.uploadMinimap(d);
            this.updateMinimapView(false);
            return;
        }

        this.buildMinimapBase();
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
        for (const c of this.game.crates) dot(c.x, c.y, 0, 240, 210, 90);
        this.uploadMinimap(d);
        this.updateMinimapView(true);
    }

    private uploadMinimap(d: Uint8Array) {
        const size = MAP_TILES;
        const flipped = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) {
            const src = (size - 1 - y) * size * 4;
            flipped.set(d.subarray(src, src + size * 4), y * size * 4);
        }
        this.mmTex!.uploadData(flipped);
    }

    private updateMinimapView(online: boolean) {
        if (!this.mmView || !this.cam) return;
        const g = this.mmView;
        g.clear();
        if (!online) return;
        const cam = this.cam;
        const w = (cam.screenW / cam.zoom) / MAP_SIZE * this.mmSize;
        const h = (cam.screenH / cam.zoom) / MAP_SIZE * this.mmSize;
        const cx = (cam.x + HALF) / MAP_SIZE * this.mmSize - this.mmSize / 2;
        const cy = (cam.y + HALF) / MAP_SIZE * this.mmSize - this.mmSize / 2;
        g.rect(cx - w / 2, cy - h / 2, w, h);
        g.strokeColor = HEX('#f2fdff', 210);
        g.lineWidth = 1.2;
        g.stroke();

        // radar pings on structures that took damage in the last few seconds
        const t = this.game.time;
        for (const b of this.game.buildings) {
            if (b.dead || b.owner !== 0) continue;
            const age = t - b.lastHit;
            if (age > 2.5 || age < 0) continue;
            const k = age / 2.5;
            const bx = (b.x + HALF) / MAP_SIZE * this.mmSize - this.mmSize / 2;
            const by = (b.y + HALF) / MAP_SIZE * this.mmSize - this.mmSize / 2;
            g.circle(bx, by, 3 + k * 9);
            g.strokeColor = HEX(PAL.red, Math.floor(220 * (1 - k)));
            g.lineWidth = 1.6;
            g.stroke();
        }
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

    private layoutCards(defs: Array<{ id: string; name: string; cost: number; kind: 'build' | 'unit'; scale?: number; icon: (g: Graphics) => void }>) {
        this.clearCards();
        const cw = 78, ch = 96, gap = 8;
        const n = defs.length;
        if (n === 0) { this.cardSig = ''; return; }
        const totalW = n * cw + (n - 1) * gap;
        let x = -20 - totalW / 2 + cw / 2;
        const y = -HH + 104;
        for (const d of defs) {
            const card = new Card(this.cardLayer, d.id, d.kind, cw, ch);
            card.node.setPosition(x, y, 0);
            card.icon.node.setPosition(0, 14, 0);
            const sc = d.scale ?? 0.5;
            card.icon.node.setScale(sc, sc, 1);
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
        const h = g.human;
        if (this.tab === 'structure') {
            const ready = g.readyStructure(h);
            return 's:' + (ready ? ready.defId : '-') + '|' + g.availableStructures(h)
                .map(d => d.id + (g.lockReason(h, d) ? '!' : '')).join(',');
        }
        return this.tab + ':' + g.availableUnitsFor(h, this.tab)
            .map(d => d.id + (g.lockReason(h, d) ? '!' : '')).join(',');
    }

    private refreshCards() {
        const g = this.game;
        if (!g) return;
        const h = g.human;
        const sig = this.signature();
        if (sig !== this.cardSig) {
            this.cardSig = sig;
            if (this.tab === 'structure') {
                const defs = g.availableStructures(h).map<{ id: string; name: string; cost: number; kind: 'build'; icon: (gg: Graphics) => void }>(def => ({
                    id: def.id, name: def.name, cost: def.cost, kind: 'build', scale: 0.46,
                    icon: (gg: Graphics) => drawBuilding(pen(gg), def, h.faction, 1),
                }));
                this.layoutCards(defs);
            } else {
                const defs = g.availableUnitsFor(h, this.tab).map<{ id: string; name: string; cost: number; kind: 'unit'; icon: (gg: Graphics) => void }>(def => ({
                    id: def.id, name: def.name, cost: def.cost, kind: 'unit',
                    scale: def.kind === 'infantry' ? 1.15 : def.kind === 'mcv' ? 0.72
                        : def.kind === 'air' ? 0.85 : def.kind === 'harvester' ? 0.9 : 0.95,
                    icon: (gg: Graphics) => drawUnit(pen(gg), def, h.faction),
                }));
                this.layoutCards(defs);
            }
        }

        const q = g.queueInfo(h, this.tab);
        const ready = this.tab === 'structure' ? g.readyStructure(h) : null;
        for (const c of this.cards) {
            const def = c.kind === 'build' ? BUILDINGS[c.id] : UNITS[c.id];
            const lock = g.lockReason(h, def as any);
            const affordable = h.credits >= def.cost * 0.15;
            const isReady = !!ready && ready.defId === c.id;
            const idx = q.items.findIndex(it => it.defId === c.id);
            const queuedCount = q.items.filter(it => it.defId === c.id).length;
            const isFirst = idx === 0;
            const prog = isFirst ? q.items[0].progress : 0;

            const stateSig = `${lock}|${affordable}|${isReady}|${c.kind === 'build' && idx < 0 ? 'idle' : ''}`;
            if (c.lastSig !== stateSig) {
                c.lastSig = stateSig;
                c.enabled = !lock;
                c.nameL.color = HEX(lock ? '#6f7c89' : PAL.white);
                c.costL.string = lock ? lock.replace('需要 ', '缺 ') : `◈ ${def.cost}`;
                c.costL.fontSize = lock ? 9 : 11;
                c.costL.color = HEX(lock ? PAL.red : affordable ? PAL.amber : '#9aa6b2');
                c.drawBase(isReady, !!lock);
            }

            const pg = c.progress;
            pg.clear();
            if (prog > 0) {
                // vertical fill from the bottom of the card
                pg.rect(-c.w / 2 + 4, -c.h / 2 + 4, (c.w - 8) * clamp(prog, 0, 1), 3);
                pg.fillColor = HEX(isReady ? PAL.green : PAL.cyan, 235);
                pg.fill();
            }
            if (isReady) {
                c.badge.string = '就绪';
                c.badge.color = HEX(PAL.green);
            } else if (c.kind === 'unit' && queuedCount > 0) {
                c.badge.string = queuedCount > 1 ? `×${queuedCount}` : `${Math.round(prog * 100)}%`;
                c.badge.color = HEX(PAL.cyan);
            } else if (c.kind === 'build' && idx === 0) {
                c.badge.string = `${Math.round(prog * 100)}%`;
                c.badge.color = HEX(PAL.cyan);
            } else {
                c.badge.string = '';
            }
        }
    }

    /* ------------------------------------------------------------ */
    /* super weapon buttons                                          */
    /* ------------------------------------------------------------ */
    private refreshSwButtons() {
        const g = this.game;
        if (!g) return;
        const list = g.human.sw;
        // rebuild when the set changes
        if (list.length !== this.swButtons.length) {
            for (const b of this.swButtons) b.node.destroy();
            this.swButtons = [];
            for (let i = 0; i < list.length; i++) {
                const id = list[i].id;
                const node = mkNode(this.root, 'sw');
                const gfx = node.addComponent(Graphics);
                const name = mkLabel(node, SUPER_WEAPONS[id].short, 12, PAL.white, true);
                alignLabel(name, 'center');
                name.node.setPosition(0, 6, 0);
                const time = mkLabel(node, '', 10, PAL.cyan);
                alignLabel(time, 'center');
                time.node.setPosition(0, -10, 0);
                const cx = HW - 46;
                const cy = HH - 112 - this.swButtons.length * 74;
                node.setPosition(cx, cy, 0);
                this.swButtons.push({ id, node, g: gfx, name, time, cx, cy });
            }
        }
        for (let i = 0; i < this.swButtons.length; i++) {
            const b = this.swButtons[i];
            const st = list.find(s => s.id === b.id);
            if (!st) continue;
            const def = SUPER_WEAPONS[b.id];
            const online = g.radarOnline(g.human);
            const prog = st.t / st.total;
            const gg = b.g;
            gg.clear();
            gg.circle(0, 0, 30);
            gg.fillColor = HEX(st.ready && online ? '#1d3a33' : '#12181f', 240);
            gg.fill();
            gg.strokeColor = st.ready && online ? HEX(PAL.green, 240) : HEX(PAL.cyanDim, 120);
            gg.lineWidth = st.ready && online ? 2.4 : 1.3;
            gg.stroke();
            // charge ring
            if (!st.ready) {
                gg.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(prog, 0, 1), false);
                gg.strokeColor = HEX(def.color, 220);
                gg.lineWidth = 3;
                gg.stroke();
            }
            if (st.ready && online) {
                gg.circle(0, 0, 34 + Math.sin(g.time * 3) * 2);
                gg.strokeColor = HEX(PAL.green, 90);
                gg.lineWidth = 1.4;
                gg.stroke();
            }
            b.time.string = !online ? '断电' : st.ready ? '就绪' : fmtTime(st.total - st.t);
            b.time.color = HEX(!online ? PAL.red : st.ready ? PAL.green : '#9fb0bc');
            b.name.color = HEX(st.ready && online ? PAL.white : '#8f9daa');
        }
    }

    private swAt(x: number, y: number): SuperWeaponId | null {
        for (const b of this.swButtons) {
            if (Math.hypot(x - b.cx, y - b.cy) <= 34) return b.id;
        }
        return null;
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
        title.node.setPosition(0, 258, 0);
        alignLabel(title, 'center');

        const sub = mkLabel(ov, 'R I F T S A N D   ·   沙海之上，钢铁与风的战争', 15, PAL.cyan);
        sub.node.setPosition(0, 214, 0);
        alignLabel(sub, 'center');

        this.factionCard(ov, 'BU', -196);
        this.factionCard(ov, 'DS', 196);

        const dLabel = mkLabel(ov, '难度', 14, '#93a3b0');
        dLabel.node.setPosition(-330, -152, 0);
        const diffs: Array<['easy' | 'normal' | 'hard', string]> = [['easy', '轻松'], ['normal', '标准'], ['hard', '残酷']];
        let dx = -266;
        for (const [key, text] of diffs) {
            const b = new UIButton(ov, 84, 32, text, 13, () => {
                this.selDiff = key;
                this.rebuildMenu();
            });
            b.setPosition(dx, -152);
            b.setActive(this.selDiff === key);
            this.menuBtns.push(b);
            dx += 90;
        }

        // skirmish options, like the classic set-up screen
        const cLabel = mkLabel(ov, '资金', 14, '#93a3b0');
        cLabel.node.setPosition(20, -152, 0);
        let cx = 84;
        for (const amount of [4200, 7000, 10000]) {
            const b = new UIButton(ov, 76, 32, `${amount / 1000}k`, 13, () => {
                this.selCredits = amount;
                this.rebuildMenu();
            });
            b.setPosition(cx, -152);
            b.setActive(this.selCredits === amount);
            this.menuBtns.push(b);
            cx += 82;
        }

        const sw = new UIButton(ov, 150, 32, `超级武器 ${this.selSuper ? '开' : '关'}`, 13, () => {
            this.selSuper = !this.selSuper;
            this.rebuildMenu();
        }, this.selSuper ? PAL.cyan : PAL.cyanDim);
        sw.setPosition(432, -152);
        sw.setActive(this.selSuper);
        this.menuBtns.push(sw);

        const start = new UIButton(ov, 250, 54, '开 始 战 斗', 21, () => {
            this.mode = 'game';
            this.menuLayer.active = false;
            this.hooks.onStart(this.selFaction, this.selDiff, this.selCredits, this.selSuper);
        }, PAL.cyan);
        start.setPosition(0, -238);
        this.menuBtns.push(start);

        const tip = mkLabel(ov, '单击选中 · 拖拽框选 · 双指平移缩放 · 长按呼出指令盘', 12, '#8a99a6');
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
        this.overlay.setGroupsVisible(false);
        this.overlay.hideRadial();
        this.overlay.hideBox();
        for (const b of this.swButtons) b.node.active = false;
    }

    hideMenu() {
        this.menuLayer.active = false;
        this.topBar.active = true;
        this.bottom.active = true;
        this.cardLayer.active = true;
        this.overlay.setGroupsVisible(true);
        this.mode = 'game';
        this.cardSig = '';
        for (const b of this.swButtons) b.node.active = true;
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
        const box = this.modalBase(480, 470, '暂 停', PAL.cyan);
        this.modalButton(box, 0, 118, 250, '继续战斗', () => this.hooks.onResume());
        this.toggleButton(box, 0, 58, 250, '保持阵型', !!this.game?.holdFormation, () => {
            if (!this.game) return;
            this.game.holdFormation = !this.game.holdFormation;
            this.showPause();
        });
        this.toggleButton(box, 0, 14, 250, '采集车警报', !!this.game?.autoReplace, () => {
            if (!this.game) return;
            this.game.autoReplace = !this.game.autoReplace;
            this.showPause();
        });
        this.toggleButton(box, 0, -30, 250, '音效', !this.soundMuted, () => {
            this.soundMuted = !this.soundMuted;
            this.hooks.onToggleSound(this.soundMuted);
            this.showPause();
        });
        this.modalButton(box, 0, -92, 250, '重新开始', () => this.hooks.onRestart());
        this.modalButton(box, 0, -148, 250, '返回主菜单', () => this.hooks.onQuit(), PAL.red);
    }

    soundMuted = false;

    /** on/off switch used by the optional assists inside the pause panel */
    private toggleButton(parent: Node, x: number, y: number, w: number, text: string, on: boolean, cb: () => void) {
        const b = new UIButton(parent, w, 40, `${text}   ${on ? '开' : '关'}`, 14, cb, on ? PAL.cyan : PAL.cyanDim);
        b.setPosition(x, y);
        b.setActive(on);
        this.modalBtns.push(b);
        return b;
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
    private actionButtons(): UIButton[] {
        return [this.btnStop, this.btnAttackMove, this.btnStance, this.btnScatter, this.btnHarvest,
            this.btnRepair, this.btnSell, this.btnDeploy, this.btnCancelBuild];
    }

    private staticButtons(): UIButton[] {
        return [this.btnPause, this.btnAll, this.btnZoomIn, this.btnZoomOut];
    }

    hitTest(x: number, y: number): boolean {
        if (this.mode !== 'game') return true;
        if (this.overlay.radialOpen) return true;
        if (this.overlay.groupAt(x, y) >= 0) return true;
        if (this.swAt(x, y)) return true;
        for (const b of this.staticButtons()) {
            if (b.visible && Math.abs(x - b.cx) <= b.w / 2 && Math.abs(y - b.cy) <= b.h / 2) return true;
        }
        for (const b of this.actionButtons()) {
            if (b.visible && b.enabled && Math.abs(x - b.cx) <= b.w / 2 && Math.abs(y - b.cy) <= b.h / 2) return true;
        }
        for (const b of this.tabBtns) {
            if (Math.abs(x - b.cx) <= b.w / 2 && Math.abs(y - b.cy) <= b.h / 2) return true;
        }
        for (const c of this.cards) if (c.node.active && c.hit(x, y)) return true;
        const m = this.mmSize / 2 + 8;
        if (Math.abs(x - this.mmX) <= m && Math.abs(y - this.mmY) <= m) return true;
        if (y > HH - 60) return true;
        if (y < -HH + 228) return true;
        return false;
    }

    /** card under the finger, used for long-press = fill the queue */
    private cardAt(x: number, y: number): Card | null {
        for (const c of this.cards) if (c.node.active && c.hit(x, y)) return c;
        return null;
    }

    /**
     * Long-press on a production card fills the whole queue (batch build).
     * Returns true when the gesture was consumed.
     */
    handleLongPress(x: number, y: number): boolean {
        const c = this.cardAt(x, y);
        if (!c || !this.game) return false;
        if (c.kind === 'unit') {
            this.hooks.onProduce(this.tab, c.id, QUEUE_MAX);
            return true;
        }
        // long press on a structure card cancels the queued / ready item
        const q = this.game.human.queues.structure;
        const idx = q.items.findIndex(it => it.defId === c.id);
        if (idx >= 0) {
            this.hooks.onCancelQueue('structure', idx);
            this.toast('已取消建造并返还已投入晶体', 'info');
            return true;
        }
        return false;
    }

    onTap(x: number, y: number): boolean {
        if (this.mode === 'menu') {
            for (const b of this.menuBtns) {
                if (b.visible && Math.abs(x - b.cx) <= b.w / 2 && Math.abs(y - b.cy) <= b.h / 2) { b.onClick(); return true; }
            }
            return true;
        }
        if (this.mode !== 'game') {
            for (const b of this.modalBtns) {
                if (b.visible && Math.abs(x - b.cx) <= b.w / 2 && Math.abs(y - b.cy) <= b.h / 2) { b.onClick(); return true; }
            }
            return true;
        }
        for (const b of this.staticButtons()) if (b.hit(x, y)) { b.onClick(); return true; }
        for (const b of this.actionButtons()) if (b.hit(x, y)) { b.onClick(); return true; }
        for (const b of this.tabBtns) {
            if (Math.abs(x - b.cx) <= b.w / 2 && Math.abs(y - b.cy) <= b.h / 2) { b.onClick(); return true; }
        }
        const sw = this.swAt(x, y);
        if (sw) { this.hooks.onSuperWeapon(sw); return true; }
        if (this.overlay.groupAt(x, y) >= 0) return true;
        const mmHalf = this.mmSize / 2;
        if (Math.abs(x - this.mmX) <= mmHalf && Math.abs(y - this.mmY) <= mmHalf) {
            if (!this.game || !this.game.radarOnline(this.game.human)) {
                this.toast('雷达离线：电力不足', 'warn');
                return true;
            }
            const wx = ((x - this.mmX + mmHalf) / this.mmSize) * MAP_SIZE - HALF;
            const wy = ((y - this.mmY + mmHalf) / this.mmSize) * MAP_SIZE - HALF;
            this.hooks.onMinimap(wx, wy);
            return true;
        }
        for (const c of this.cards) {
            if (!c.node.active || !c.hit(x, y)) continue;
            if (!c.enabled) { this.toast(c.costL.string, 'warn'); return true; }
            if (c.kind === 'build') {
                const g = this.game;
                if (!g) return true;
                const ready = g.readyStructure(g.human);
                if (ready && ready.defId === c.id) this.hooks.onPlace(c.id);
                else this.hooks.onBuild(c.id);
            } else {
                this.hooks.onProduce(this.tab, c.id, 1);
            }
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
        const hasHarvester = g.selection.some(u => u.isHarvester);
        const hasCombat = g.selection.some(u => !u.isHarvester && !u.isEngineer && !u.isMcv);
        const hasMcv = g.selection.some(u => u.isMcv);
        this.btnStop.setVisible(selCount > 0);
        this.btnAttackMove.setVisible(hasCombat);
        this.btnStance.setVisible(hasCombat);
        this.btnScatter.setVisible(selCount > 0 && !hasB);
        this.btnHarvest.setVisible(hasHarvester);
        this.btnRepair.setVisible(hasB);
        this.btnSell.setVisible(hasB);
        this.btnDeploy.setVisible(hasMcv);
        if (hasB) {
            const b = g.selectedBuilding!;
            this.btnRepair.setEnabled(b.done && b.hp < b.maxHp - 0.5);
            this.btnSell.setEnabled(b.done);
        }
        this.btnCancelBuild.setVisible(!!g.placeMode || !!g.swTargeting);
        this.btnAttackMove.setActive(this.attackMoveMode);

        // right-align the visible action buttons in a single row
        const visible = this.actionButtons().filter(b => b.visible);
        let ax = HW - 50;
        for (const b of visible) {
            b.setPosition(ax, -HH + 186);
            ax -= b.w + 8;
        }

        if (g.swTargeting) {
            this.hintL.string = `选择 ${SUPER_WEAPONS[g.swTargeting].name} 目标 · 点地面发射`;
        } else if (g.placeMode) {
            this.hintL.string = `放置 ${BUILDINGS[g.placeMode].name} · 点击地面确定`;
        } else if (hasB) {
            const b = g.selectedBuilding;
            this.hintL.string = `${b.def.name} · ${Math.ceil(b.hp)}/${Math.round(b.maxHp)}${b.repairing ? ' · 维修中' : ''}`;
        } else if (selCount > 0) {
            const u = g.selection[0];
            const lv = u.level > 0 ? (u.level >= 2 ? ' · 精锐' : ' · 老兵') : '';
            const st = u.isHarvester || u.isEngineer || u.isMcv ? ''
                : ` · ${u.stance === 'aggressive' ? '主动' : u.stance === 'hold' ? '坚守' : '警戒'}`;
            this.hintL.string = selCount === 1
                ? `${u.def.name}${lv}${st} · HP ${Math.ceil(u.hp)}`
                : `已选中 ${selCount} 个单位${g.waypointMode ? ' · 路径模式' : ''}`;
        } else {
            this.hintL.string = g.waypointMode
                ? '路径模式：依次点击追加路径点 · 长按关闭'
                : `部队 ${g.units.filter(u => u.owner === 0 && !u.isHarvester).length} · 建筑 ${g.buildings.filter(b => b.owner === 0).length} · 击毁 ${h.kills}`;
        }

        const counts: number[] = [];
        for (let i = 0; i < g.groupIds.length; i++) counts.push(g.groupUnits(i).length);
        this.overlay.refreshGroups(counts, this.activeGroup);

        this.refreshCards();
        this.refreshSwButtons();
        this.refreshMinimap(dt);
        this.refreshTabButtons();

        if (this.toastT > 0) {
            this.toastT -= dt;
            const c = this.toastL.color.clone();
            c.a = Math.round(255 * Math.min(1, this.toastT / 0.45));
            this.toastL.color = c;
            if (this.toastT <= 0) this.toastL.node.active = false;
        }
    }
}
