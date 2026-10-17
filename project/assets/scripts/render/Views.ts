/**
 * World view layer.
 * Turns simulation entities into cc.Nodes. Everything is drawn with Graphics;
 * the fog of war and the minimap use small dynamic textures that get updated
 * a few times per second.
 */
import {
    Node, Graphics, Color, UITransform, Sprite, SpriteFrame, Texture2D, Rect, Layers, Vec3,
} from 'cc';
import {
    BUILDINGS, UNITS, TILE, HALF, MAP_SIZE, MAP_TILES, PAL, HEX, Faction, makeRng, clamp,
} from '../core/Core';
import { TerrainMap, TileKind } from '../world/Terrain';
import { Game, PlayerState } from '../game/Game';
import { Unit, Building, Entity, Projectile, Fx } from '../game/Entities';
import {
    drawUnit, drawBuilding, drawCrystal, drawRock, drawBush, drawCrate,
} from './Art';

const hex = (h: string, a = 255) => HEX(h, a);

export function gfxNode(parent: Node, name: string): Graphics {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    parent.addChild(n);
    const t = n.getComponent(UITransform) || n.addComponent(UITransform);
    t.setContentSize(0, 0);
    return n.addComponent(Graphics);
}

export function plainNode(parent: Node, name: string, x = 0, y = 0): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    parent.addChild(n);
    n.setPosition(x, y, 0);
    n.getComponent(UITransform) || n.addComponent(UITransform);
    return n;
}

/* ================================================================== */
/* TERRAIN                                                            */
/* ================================================================== */
export class TerrainView {
    root: Node;
    crystalRoot: Node;

    constructor(parent: Node, private terrain: TerrainMap, faction: Faction) {
        this.root = plainNode(parent, 'Terrain');
        this.paint();
        this.crystalRoot = plainNode(parent, 'Crystals');
        for (const n of terrain.nodes) {
            const g = gfxNode(this.crystalRoot, 'crystal' + n.id);
            g.node.setPosition(n.x, n.y, 0);
            drawCrystal(g, n.seed, 1);
            (g.node as any).__node = n;
        }
    }

    refreshCrystals() {
        const kids = this.crystalRoot.children;
        for (const k of kids) {
            const n = (k as any).__node;
            if (!n) continue;
            const g = k.getComponent(Graphics);
            if (g) drawCrystal(g, n.seed, n.amount / n.max);
            k.active = n.amount > 0;
        }
    }

    private paint() {
        const g = gfxNode(this.root, 'ground');
        const T = TILE;
        // outside-the-map backdrop (reads as deeper desert)
        g.rect(-MAP_SIZE, -MAP_SIZE, MAP_SIZE * 2, MAP_SIZE * 2);
        g.fillColor = hex(PAL.sandShadow);
        g.fill();

        // main sand plate with a soft vignette-ish gradient of tiles
        g.rect(-HALF, -HALF, MAP_SIZE, MAP_SIZE);
        g.fillColor = hex(PAL.sand);
        g.fill();

        const rng = makeRng(90210);
        // dune patches
        for (let ty = 0; ty < MAP_TILES; ty++) {
            for (let tx = 0; tx < MAP_TILES; tx++) {
                const kind = this.terrain.kind[ty * MAP_TILES + tx];
                if (kind !== TileKind.Dune) continue;
                const x = tx * T + T / 2 - HALF;
                const y = ty * T + T / 2 - HALF;
                g.ellipse(x, y, T * (0.55 + rng() * 0.35), T * 0.42);
                g.fillColor = rng() > 0.5 ? hex(PAL.sandLight, 46) : hex(PAL.sandDark, 38);
                g.fill();
            }
        }

        // rock clusters
        for (let ty = 0; ty < MAP_TILES; ty++) {
            for (let tx = 0; tx < MAP_TILES; tx++) {
                const kind = this.terrain.kind[ty * MAP_TILES + tx];
                if (kind !== TileKind.Rock) continue;
                const x = tx * T + T / 2 - HALF;
                const y = ty * T + T / 2 - HALF;
                this.rockAt(g, x, y, rng);
            }
        }

        // fine sand speckles + wind ripples give the ground some tooth
        for (let i = 0; i < 1100; i++) {
            const x = -HALF + rng() * MAP_SIZE;
            const y = -HALF + rng() * MAP_SIZE;
            const r = 0.8 + rng() * 1.6;
            g.circle(x, y, r);
            g.fillColor = rng() > 0.45 ? hex(PAL.sandLight, 34) : hex(PAL.sandShadow, 26);
            g.fill();
        }
        for (let i = 0; i < 130; i++) {
            const x = -HALF + rng() * MAP_SIZE;
            const y = -HALF + rng() * MAP_SIZE;
            const w = 40 + rng() * 90;
            g.moveTo(x - w / 2, y);
            g.quadraticCurveTo(x, y + 6 + rng() * 8, x + w / 2, y + (rng() - 0.5) * 6);
            g.strokeColor = rng() > 0.5 ? hex(PAL.sandLight, 30) : hex(PAL.sandShadow, 26);
            g.lineWidth = 1.4;
            g.stroke();
        }

        // scatter props on open sand
        for (let i = 0; i < 420; i++) {
            const tx = Math.floor(rng() * MAP_TILES);
            const ty = Math.floor(rng() * MAP_TILES);
            const idx = ty * MAP_TILES + tx;
            if (this.terrain.kind[idx] !== TileKind.Sand) continue;
            const x = tx * T + rng() * T - HALF;
            const y = ty * T + rng() * T - HALF;
            const roll = rng();
            if (roll < 0.34) {
                this.bushAt(g, x, y, 0.8 + rng() * 0.5, rng);
            } else if (roll < 0.52) {
                this.crateAt(g, x, y, rng);
            } else if (roll < 0.78) {
                g.ellipse(x, y, 4 + rng() * 3, 2 + rng() * 2);
                g.fillColor = hex(PAL.sandDark, 70);
                g.fill();
            } else {
                this.rockAt(g, x, y, rng);
            }
        }

        // tyre tracks across the map (nods to the reference sheet)
        for (let i = 0; i < 6; i++) {
            const y0 = -HALF + rng() * MAP_SIZE;
            const y1 = -HALF + rng() * MAP_SIZE;
            g.moveTo(-HALF + 80, y0);
            g.bezierCurveTo(-400, y0 + (rng() - 0.5) * 500, 200, y1 + (rng() - 0.5) * 500, HALF - 80, y1);
            g.strokeColor = hex(PAL.sandShadow, 55);
            g.lineWidth = 9;
            g.stroke();
            g.moveTo(-HALF + 80, y0 + 7);
            g.bezierCurveTo(-400, y0 + 7 + (rng() - 0.5) * 500, 200, y1 + 7 + (rng() - 0.5) * 500, HALF - 80, y1 + 7);
            g.strokeColor = hex(PAL.sandShadow, 40);
            g.lineWidth = 9;
            g.stroke();
        }

        // map border
        g.rect(-HALF, -HALF, MAP_SIZE, MAP_SIZE);
        g.strokeColor = new Color(0, 0, 0, 90);
        g.lineWidth = 10;
        g.stroke();
    }

    private rockAt(g: Graphics, x: number, y: number, rng: () => number) {
        const n = 3 + Math.floor(rng() * 3);
        g.ellipse(x + 3, y - 5, 18, 8);
        g.fillColor = new Color(0, 0, 0, 40);
        g.fill();
        for (let i = 0; i < n; i++) {
            const ox = x + (rng() - 0.5) * 18;
            const oy = y + (rng() - 0.5) * 12;
            const r = 6 + rng() * 9;
            g.moveTo(ox - r, oy);
            g.lineTo(ox - r * 0.5, oy + r * 0.9);
            g.lineTo(ox + r * 0.55, oy + r * 0.75);
            g.lineTo(ox + r, oy - r * 0.1);
            g.close();
            g.fillColor = hex(PAL.rock);
            g.fill();
            g.strokeColor = hex(PAL.rockDark);
            g.lineWidth = 1.4;
            g.stroke();
            // lit face
            g.moveTo(ox - r * 0.5, oy + r * 0.9);
            g.lineTo(ox + r * 0.55, oy + r * 0.75);
            g.lineTo(ox + r * 0.1, oy + r * 0.35);
            g.close();
            g.fillColor = hex('#b49b78', 190);
            g.fill();
        }
    }

    private bushAt(g: Graphics, x: number, y: number, s: number, rng: () => number) {
        g.ellipse(x + 2, y - 3, 9 * s, 3 * s);
        g.fillColor = new Color(0, 0, 0, 26);
        g.fill();
        for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + (rng() - 0.5) * 1.8;
            const len = (8 + rng() * 10) * s;
            g.moveTo(x, y);
            g.bezierCurveTo(
                x + Math.cos(a) * len * 0.4, y + Math.sin(a) * len * 0.6,
                x + Math.cos(a) * len * 0.7, y + Math.sin(a) * len * 0.9,
                x + Math.cos(a) * len, y + Math.sin(a) * len,
            );
            g.strokeColor = hex('#6b5335');
            g.lineWidth = 1.5 * s;
            g.stroke();
        }
    }

    private crateAt(g: Graphics, x: number, y: number, rng: () => number) {
        const w = 14 + rng() * 5, h = 9 + rng() * 3;
        g.ellipse(x + 2, y - 4, w * 0.7, 4);
        g.fillColor = new Color(0, 0, 0, 34);
        g.fill();
        g.roundRect(x - w / 2, y - h / 2, w, h, 1.5);
        g.fillColor = hex('#8a6740');
        g.fill();
        g.strokeColor = hex('#5d4529');
        g.lineWidth = 1;
        g.stroke();
        g.moveTo(x - w / 2, y);
        g.lineTo(x + w / 2, y);
        g.stroke();
    }
}

/* ================================================================== */
/* FOG OF WAR                                                         */
/* ================================================================== */
export class FogView {
    node: Node;
    private data: Uint8Array;
    private tex: Texture2D;
    private texSize = MAP_TILES * 2;
    private sprite: Sprite;
    private timer = 0;
    /** texture rows are uploaded bottom-up */
    private flipY = true;

    constructor(parent: Node) {
        // opaque void outside the playable map so the desert never leaks through
        const voidG = gfxNode(parent, 'void');
        const M = MAP_SIZE * 2;
        voidG.rect(-M, -M, M * 2, HALF);
        voidG.rect(-M, HALF, M * 2, M);
        voidG.rect(-M, -HALF, M - HALF, MAP_SIZE);
        voidG.rect(HALF, -HALF, M, MAP_SIZE);
        voidG.fillColor = new Color(9, 12, 15, 255);
        voidG.fill();
        // map rim
        voidG.rect(-HALF, -HALF, MAP_SIZE, MAP_SIZE);
        voidG.strokeColor = new Color(63, 217, 236, 26);
        voidG.lineWidth = 3;
        voidG.stroke();

        this.node = plainNode(parent, 'Fog');
        const n = this.texSize;
        this.data = new Uint8Array(n * n * 4);
        this.tex = new Texture2D();
        this.tex.reset({ width: n, height: n, format: Texture2D.PixelFormat.RGBA8888, mipmapLevel: 0 });
        this.tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
        this.tex.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
        this.tex.uploadData(this.data);
        const sf = new SpriteFrame();
        sf.texture = this.tex;
        sf.rect = new Rect(0, 0, n, n);
        sf.packable = false;
        const sp = this.node.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;
        sp.spriteFrame = sf;
        this.sprite = sp;
        const t = this.node.getComponent(UITransform)!;
        t.setContentSize(MAP_SIZE, MAP_SIZE);
        t.setAnchorPoint(0.5, 0.5);
        this.node.setPosition(0, 0, 0);
    }

    private field = new Float32Array(0);

    update(p: PlayerState, dt = 1) {
        this.timer -= dt;
        if (this.timer > 0) return;
        this.timer = 0.16;
        const n = this.texSize;
        if (this.field.length !== n * n) this.field = new Float32Array(n * n);
        const f = this.field;

        // 1) per-texel visibility strength: 0 unexplored / 0.5 explored / 1 visible
        for (let y = 0; y < n; y++) {
            const ty = y >> 1;
            for (let x = 0; x < n; x++) {
                const i = ty * MAP_TILES + (x >> 1);
                f[y * n + x] = p.visible[i] ? 1 : p.explored[i] ? 0.5 : 0;
            }
        }

        // 2) separable box blur (radius 2) so the shroud edge stays soft
        const tmp = this.blurTmp.length === n * n ? this.blurTmp : (this.blurTmp = new Float32Array(n * n));
        const R = 2;
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                let sum = 0, cnt = 0;
                for (let k = -R; k <= R; k++) {
                    const xx = x + k;
                    if (xx < 0 || xx >= n) continue;
                    sum += f[y * n + xx]; cnt++;
                }
                tmp[y * n + x] = sum / cnt;
            }
        }
        for (let x = 0; x < n; x++) {
            for (let y = 0; y < n; y++) {
                let sum = 0, cnt = 0;
                for (let k = -R; k <= R; k++) {
                    const yy = y + k;
                    if (yy < 0 || yy >= n) continue;
                    sum += tmp[yy * n + x]; cnt++;
                }
                f[y * n + x] = sum / cnt;
            }
        }

        // 3) pack RGBA (texture rows go bottom-up)
        const d = this.data;
        for (let y = 0; y < n; y++) {
            const srcY = this.flipY ? n - 1 - y : y;
            for (let x = 0; x < n; x++) {
                const s0 = f[srcY * n + x];
                const o = (y * n + x) * 4;
                d[o] = 8; d[o + 1] = 11; d[o + 2] = 14;
                d[o + 3] = Math.max(0, Math.min(255, Math.round(238 * (1 - s0))));
            }
        }
        this.tex.uploadData(d);
    }
    private blurTmp = new Float32Array(0);
}

/* ================================================================== */
/* ENTITY VIEWS                                                       */
/* ================================================================== */
export class EntityView {
    node: Node;
    body: Graphics;
    ring: Graphics;
    hp: Graphics;
    private lastHp = -1;
    private lastProgress = -1;
    private wasSelected = false;
    private hpTimer = 0;

    constructor(parent: Node, public e: Entity) {
        this.node = plainNode(parent, (e.isBuilding ? 'B:' : 'U:') + e.id);
        this.node.setPosition(e.x, e.y, 0);
        this.ring = gfxNode(this.node, 'ring');
        this.body = gfxNode(this.node, 'body');
        this.hp = gfxNode(this.node, 'hp');
        if (e instanceof Unit) {
            drawUnit(this.body, e.def, (e.owner === 0 ? gameFaction : otherFaction));
            // world art is a touch small on phones; scale the body only so the
            // selection ring and hp bar keep their true footprint
            this.body.node.setScale(1.28, 1.28, 1);
        } else if (e instanceof Building) {
            drawBuilding(this.body, e.def, e.def.faction, e.progress);
        }
        this.node.setSiblingIndex(0);
    }

    redraw(selFaction: Faction) {
        if (this.e instanceof Unit) drawUnit(this.body, this.e.def, selFaction);
        else if (this.e instanceof Building) drawBuilding(this.body, this.e.def, this.e.def.faction, (this.e as Building).progress);
    }

    update(dt: number, selected: boolean, faction: Faction, otherFaction: Faction) {
        const e = this.e;
        if (e instanceof Unit) {
            const u = e;
            const air = u.isAir;
            this.node.setPosition(u.x, u.y + (air ? 14 + Math.sin(u.bob * 2) * 2 : 0), 0);
            if (!air && u.def.kind !== 'infantry') {
                this.node.angle = (-u.face * 180) / Math.PI;
            } else if (u.def.kind === 'infantry') {
                const flip = u.face > Math.PI / 2 || u.face < -Math.PI / 2;
                this.node.setScale(flip ? -1 : 1, u.hitFlash > 0 ? 1.06 : 1, 1);
                this.hp.node.setScale(flip ? -1 : 1, 1, 1);
            }
        } else if (e instanceof Building) {
            if (Math.abs((e as Building).progress - this.lastProgress) > 0.02) {
                this.lastProgress = (e as Building).progress;
                drawBuilding(this.body, (e as Building).def, (e as Building).def.faction, (e as Building).progress);
            }
        }

        // selection ring
        if (selected !== this.wasSelected) {
            this.wasSelected = selected;
            this.ring.clear();
            if (selected) {
                const r = e.isBuilding ? (e as Building).radius : (e as Unit).radius + 4;
                this.ring.ellipse(0, -2, r + 3, (r + 3) * 0.55);
                this.ring.strokeColor = new Color(80, 240, 210, 230);
                this.ring.lineWidth = 2;
                this.ring.stroke();
                this.ring.ellipse(0, -2, r + 6, (r + 6) * 0.55);
                this.ring.strokeColor = new Color(80, 240, 210, 60);
                this.ring.lineWidth = 4;
                this.ring.stroke();
            }
        }

        // health bar
        const hpRatio = Math.max(0, e.hp / e.maxHp);
        const showHp = hpRatio < 0.999 || selected;
        const changed = Math.abs(hpRatio - this.lastHp) > 0.01;
        if (changed || (selected !== (this.lastHp >= 0 && this.hp.node.active))) {
            this.lastHp = hpRatio;
            this.drawHp(hpRatio, selected);
        }
        if (!showHp) {
            if (this.hp.node.active) this.hp.node.active = false;
        } else {
            if (!this.hp.node.active) this.hp.node.active = true;
            // keep bars upright for rotated vehicles
            this.hp.node.angle = 0;
        }
    }

    private drawHp(ratio: number, selected: boolean) {
        const g = this.hp;
        g.clear();
        const w = this.e.isBuilding ? Math.min(86, (this.e as Building).size * TILE * 0.8) : 30;
        const y = this.e.isBuilding ? (this.e as Building).radius * 0.72 : ((this.e as Unit).isAir ? 26 : (this.e as Unit).radius + 10);
        g.roundRect(-w / 2 - 1, y - 1, w + 2, 5, 2);
        g.fillColor = new Color(6, 9, 12, 190);
        g.fill();
        const col = ratio > 0.55 ? hex(PAL.green) : ratio > 0.28 ? hex(PAL.amber) : hex(PAL.red);
        g.rect(-w / 2, y, w * ratio, 3);
        g.fillColor = col;
        g.fill();
        if (this.e.isBuilding && !(this.e as Building).done) {
            const b = this.e as Building;
            g.rect(-w / 2, y + 6, w * b.progress, 3);
            g.fillColor = hex(PAL.cyan, 220);
            g.fill();
        }
    }

    destroy() {
        this.node.destroy();
    }
}

/** Set by WorldRenderer so EntityView can pick faction colours on first draw */
let gameFaction: Faction = 'BU';
let otherFaction: Faction = 'DS';

/* ================================================================== */
/* WORLD RENDERER                                                     */
/* ================================================================== */
export class WorldRenderer {
    root: Node;
    terrainLayer: Node;
    buildingLayer: Node;
    unitLayer: Node;
    projLayer: Node;
    fxLayer: Node;
    fogLayer: Node;

    terrain: TerrainView;
    fog: FogView;

    views = new Map<number, EntityView>();
    projViews = new Map<Projectile, Node>();
    fxViews = new Map<Fx, Graphics>();

    private tmpColor = new Color();

    constructor(canvas: Node, public game: Game) {
        this.root = plainNode(canvas, 'WorldRoot');
        this.terrainLayer = plainNode(this.root, 'L0_Terrain');
        this.buildingLayer = plainNode(this.root, 'L1_Buildings');
        this.unitLayer = plainNode(this.root, 'L2_Units');
        this.projLayer = plainNode(this.root, 'L3_Projectiles');
        this.fxLayer = plainNode(this.root, 'L4_Fx');
        this.fogLayer = plainNode(this.root, 'L5_Fog');

        gameFaction = game.human.faction;
        otherFaction = game.enemy.faction;

        this.terrain = new TerrainView(this.terrainLayer, game.terrain, game.human.faction);
        this.fog = new FogView(this.fogLayer);

        game.events.onSpawn = (e) => this.addEntity(e);
        game.events.onDeath = (e) => this.removeEntity(e);
        game.events.onFx = (f) => this.addFx(f);

        for (const b of game.buildings) this.addEntity(b);
        for (const u of game.units) this.addEntity(u);
        this.fog.update(game.human);
    }

    addEntity(e: Entity) {
        if (this.views.has(e.id)) return;
        const layer = e.isBuilding ? this.buildingLayer : this.unitLayer;
        const v = new EntityView(layer, e);
        this.views.set(e.id, v);
    }

    removeEntity(e: Entity) {
        const v = this.views.get(e.id);
        if (v) { v.destroy(); this.views.delete(e.id); }
    }

    addFx(f: Fx) {
        const g = gfxNode(this.fxLayer, 'fx');
        g.node.setPosition(f.x, f.y, 0);
        this.fxViews.set(f, g);
    }

    private drawFx(g: Graphics, f: Fx) {
        g.clear();
        const k = f.k;
        if (f.kind === 'boom') {
            const r = (10 + k * 34) * f.scale;
            g.circle(0, 0, r);
            g.fillColor = new Color(255, 190, 90, Math.floor(190 * (1 - k)));
            g.fill();
            g.circle(0, 0, r * 0.55);
            g.fillColor = new Color(255, 240, 200, Math.floor(220 * (1 - k)));
            g.fill();
            g.circle(0, 0, r * 1.5);
            g.strokeColor = new Color(255, 160, 80, Math.floor(120 * (1 - k)));
            g.lineWidth = 3;
            g.stroke();
        } else if (f.kind === 'muzzle') {
            const r = (5 + k * 9) * f.scale;
            g.circle(0, 0, r);
            g.fillColor = new Color(255, 225, 150, Math.floor(220 * (1 - k)));
            g.fill();
        } else if (f.kind === 'spark') {
            const r = (3 + k * 10) * f.scale;
            g.circle(0, 0, Math.max(0.5, r * (1 - k)));
            g.fillColor = new Color(120, 230, 255, Math.floor(200 * (1 - k)));
            g.fill();
        } else if (f.kind === 'build') {
            const r = (12 + k * 30) * f.scale;
            g.ellipse(0, 0, r, r * 0.5);
            g.strokeColor = new Color(63, 217, 236, Math.floor(180 * (1 - k)));
            g.lineWidth = 2;
            g.stroke();
        } else if (f.kind === 'spawn') {
            const r = (8 + k * 26) * f.scale;
            g.ellipse(0, 0, r, r * 0.55);
            g.strokeColor = new Color(120, 240, 200, Math.floor(200 * (1 - k)));
            g.lineWidth = 2.5;
            g.stroke();
        } else {
            const r = (6 + k * 12) * f.scale;
            g.circle(0, 0, r);
            g.fillColor = new Color(200, 190, 160, Math.floor(120 * (1 - k)));
            g.fill();
        }
    }

    sync(dt: number, cameraBounds: { x0: number; y0: number; x1: number; y1: number }) {
        const g = this.game;
        const human = g.human;
        const sel = g.selection;

        // entities
        for (const [id, v] of this.views) {
            const e = v.e;
            if (e.dead) { v.destroy(); this.views.delete(id); continue; }
            const vis = g.isVisibleTo(human, e);
            if (v.node.active !== vis) v.node.active = vis;
            if (!vis) continue;
            // cull far off-screen entities from the update loop
            const inView = e.x > cameraBounds.x0 - 80 && e.x < cameraBounds.x1 + 80
                && e.y > cameraBounds.y0 - 80 && e.y < cameraBounds.y1 + 80;
            const selected = e.isBuilding
                ? g.selectedBuilding === e
                : sel.indexOf(e as Unit) >= 0;
            if (!selected && !inView) continue;
            v.update(dt, selected, human.faction, g.enemy.faction);
        }

        // projectiles
        for (const pr of g.projectiles) {
            let n = this.projViews.get(pr);
            if (!n) {
                const gg = gfxNode(this.projLayer, 'pr');
                if (pr.kind === 'bullet') {
                    gg.circle(0, 0, 1.8);
                    gg.fillColor = new Color(255, 236, 170, 230);
                } else if (pr.kind === 'shell') {
                    gg.circle(0, 0, 3);
                    gg.fillColor = new Color(255, 210, 130, 240);
                } else if (pr.kind === 'rocket') {
                    gg.circle(0, 0, 2.4);
                    gg.fillColor = new Color(255, 150, 110, 240);
                    gg.circle(0, 0, 5);
                    gg.fillColor = new Color(255, 120, 80, 70);
                } else {
                    gg.circle(0, 0, 3);
                    gg.fillColor = new Color(120, 220, 255, 240);
                }
                n = gg.node;
                this.projViews.set(pr, n);
            }
            n.setPosition(pr.x, pr.y + pr.height, 0);
        }
        for (const [pr, n] of this.projViews) {
            if (pr.dead || g.projectiles.indexOf(pr) < 0) {
                n.destroy();
                this.projViews.delete(pr);
            }
        }

        // fx
        for (const [f, gg] of this.fxViews) {
            if (f.dead) {
                gg.node.destroy();
                this.fxViews.delete(f);
                continue;
            }
            this.drawFx(gg, f);
        }

        // crystals & fog
        this.terrain.refreshCrystals();
        this.fog.update(human, dt);
    }
}
