/**
 * World view layer.
 * Turns simulation entities into cc.Nodes. Everything is drawn with Graphics;
 * the fog of war and the minimap use small dynamic textures that get updated
 * a few times per second.
 */
import {
    Node, Graphics, Color, UITransform, Sprite, SpriteFrame, Texture2D, Rect, Layers, Vec3, UIOpacity,
} from 'cc';
import {
    BUILDINGS, UNITS, TILE, HALF, MAP_SIZE, MAP_TILES, PAL, HEX, Faction, FACTIONS, makeRng, clamp,
} from '../core/Core';
import { TerrainMap, TileKind } from '../world/Terrain';
import { worldToProj, ISO_HW, ISO_HH, HEIGHT_PX, PROJ_HALF_X, PROJ_HALF_Y } from '../world/Iso';
import { Anim, Seq, facingIndex, facingDeg } from './Frames';
import { Game, PlayerState } from '../game/Game';
import { Unit, Building, Entity, Projectile, Fx, Zone, Crate, Decal } from '../game/Entities';
import {
    drawUnit, drawBuilding, drawCrystal, drawRock, drawBush, drawCrate,
    drawChevron, drawPickup, paintTurret, pen,
} from './Art';
import { unitBodyFrame, FRAME_W, FRAME_H } from '../assets/Assets';

const hex = (h: string, a = 255) => HEX(h, a);

/** multiply a palette colour — used for height shading and face darkening */
function shade(h: string, f: number, a = 255): Color {
    const s = h.replace('#', '');
    const r = Math.min(255, (parseInt(s.substring(0, 2), 16) * f) | 0);
    const g2 = Math.min(255, (parseInt(s.substring(2, 4), 16) * f) | 0);
    const b = Math.min(255, (parseInt(s.substring(4, 6), 16) * f) | 0);
    return new Color(r, g2, b, a);
}

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
            const p = worldToProj(n.x, n.y, terrain.heightAt(n.x, n.y));
            g.node.setPosition(p.x, p.y, 0);
            (g.node as any).__depth = p.y;
            drawCrystal(pen(g), n.seed, 1);
            (g.node as any).__node = n;
        }
    }

    refreshCrystals() {
        const kids = this.crystalRoot.children;
        for (const k of kids) {
            const n = (k as any).__node;
            if (!n) continue;
            const g = k.getComponent(Graphics);
            if (g) drawCrystal(pen(g), n.seed, n.amount / n.max);
            k.active = n.amount > 0;
        }
    }

    private paint() {
        const g = gfxNode(this.root, 'ground');
        const rng = makeRng(90210);
        const N = MAP_TILES;

        // Backdrop beyond the map rim. It only shows through at the map edge,
        // where the fog void does not quite line up with the tile diamonds, so
        // it is kept close to the void colour instead of reading as a bright rim.
        const bx = PROJ_HALF_X + 1600, by = PROJ_HALF_Y + 1600;
        g.rect(-bx, -by, bx * 2, by * 2);
        g.fillColor = hex('#1c1a17');
        g.fill();

        // terrain diamonds, far-to-near so nearer tiles overlap the ones behind
        for (let s = 0; s <= 2 * (N - 1); s++) {
            for (let tx = 0; tx < N; tx++) {
                const ty = s - tx;
                if (ty >= 0 && ty < N) this.groundTile(g, tx, ty);
            }
        }

        // fine sand speckles give the ground some tooth
        for (let i = 0; i < 900; i++) {
            const wx = (rng() - 0.5) * MAP_SIZE;
            const wy = (rng() - 0.5) * MAP_SIZE;
            const p = worldToProj(wx, wy, this.terrain.heightAt(wx, wy));
            const r = 0.8 + rng() * 1.5;
            g.circle(p.x, p.y, r);
            g.fillColor = rng() > 0.45 ? hex(PAL.sandLight, 38) : hex(PAL.sandShadow, 30);
            g.fill();
        }

        // scatter props on open sand
        for (let i = 0; i < 340; i++) {
            const tx = Math.floor(rng() * N);
            const ty = Math.floor(rng() * N);
            if (this.terrain.kind[ty * N + tx] !== TileKind.Sand) continue;
            const wx = tx * TILE + rng() * TILE - HALF;
            const wy = ty * TILE + rng() * TILE - HALF;
            const p = worldToProj(wx, wy, this.terrain.heightAt(wx, wy));
            const roll = rng();
            if (roll < 0.42) {
                this.bushAt(g, p.x, p.y, 0.8 + rng() * 0.5, rng);
            } else if (roll < 0.62) {
                this.crateAt(g, p.x, p.y, rng);
            } else if (roll < 0.84) {
                g.ellipse(p.x, p.y, 4 + rng() * 3, 2 + rng() * 1.6);
                g.fillColor = hex(PAL.sandDark, 70);
                g.fill();
            } else {
                this.rockAt(g, p.x, p.y, rng);
            }
        }
    }

    /** one isometric ground diamond, lifted by its four shared corner heights */
    private groundTile(g: Graphics, tx: number, ty: number) {
        const T = TILE, H = HALF, N = MAP_TILES;
        const kind = this.terrain.kind[ty * N + tx];
        const wx = tx * T - H, wy = ty * T - H;
        const p00 = worldToProj(wx, wy, this.terrain.vhAt(tx, ty));
        const p10 = worldToProj(wx + T, wy, this.terrain.vhAt(tx + 1, ty));
        const p11 = worldToProj(wx + T, wy + T, this.terrain.vhAt(tx + 1, ty + 1));
        const p01 = worldToProj(wx, wy + T, this.terrain.vhAt(tx, ty + 1));

        const lv = this.terrain.levelAt(tx, ty);
        let base = PAL.sand;
        if (kind === TileKind.Dune) base = PAL.sandLight;
        else if (kind === TileKind.Crystal) base = '#8a9459';
        else if (kind === TileKind.Rock) base = PAL.rock;

        const jitter = 0.94 + (this.terrain.tint[ty * N + tx] || 0) * 0.14;
        const lift = 1 + lv * 0.05;

        // raised tiles show a bit of side wall, which sells the height
        if (lv > 0) {
            const drop = HEIGHT_PX * 0.55;
            g.moveTo(p01.x, p01.y); g.lineTo(p11.x, p11.y);
            g.lineTo(p11.x, p11.y + drop); g.lineTo(p01.x, p01.y + drop); g.close();
            g.fillColor = shade(base, jitter * 0.72);
            g.fill();
            g.moveTo(p10.x, p10.y); g.lineTo(p11.x, p11.y);
            g.lineTo(p11.x, p11.y + drop); g.lineTo(p10.x, p10.y + drop); g.close();
            g.fillColor = shade(base, jitter * 0.6);
            g.fill();
        }

        g.moveTo(p00.x, p00.y);
        g.lineTo(p10.x, p10.y);
        g.lineTo(p11.x, p11.y);
        g.lineTo(p01.x, p01.y);
        g.close();
        g.fillColor = shade(base, jitter * lift);
        g.fill();
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
    private g: Graphics;
    private timer = 0;
    private lastSig = 0;

    constructor(parent: Node) {
        // colour the whole diamond-outside region near-black so the desert never
        // leaks; the four corner triangles fill the gaps around the map diamond
        const W = PROJ_HALF_X, H = PROJ_HALF_Y, BIG = 3000;
        this.node = plainNode(parent, 'Fog');
        const vg = gfxNode(this.node, 'void');
        vg.fillColor = new Color(9, 12, 15, 255);
        vg.rect(-BIG, H, BIG * 2, BIG);
        vg.fill();
        vg.rect(-BIG, -H - BIG, BIG * 2, BIG);
        vg.fill();
        vg.rect(-BIG, -H, BIG - W, H * 2);
        vg.fill();
        vg.rect(W, -H, BIG - W, H * 2);
        vg.fill();
        // Graphics.fill() consumes the current path, so each corner needs its own
        const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
            vg.moveTo(ax, ay); vg.lineTo(bx, by); vg.lineTo(cx, cy); vg.close();
            vg.fill();
        };
        tri(-W, -H, 0, -H, -W, 0);
        tri(0, -H, W, -H, W, 0);
        tri(W, 0, W, H, 0, H);
        tri(-W, 0, -W, H, 0, H);
        vg.moveTo(0, -H); vg.lineTo(W, 0); vg.lineTo(0, H); vg.lineTo(-W, 0); vg.close();
        vg.strokeColor = new Color(63, 217, 236, 26);
        vg.lineWidth = 3;
        vg.stroke();

        this.g = gfxNode(this.node, 'shroud');
    }

    update(p: PlayerState, dt = 1) {
        this.timer -= dt;
        if (this.timer > 0) return;
        this.timer = 0.18;
        // cheap signature: skip the rebuild when visibility did not change
        let sig = 0;
        for (let i = 0; i < p.visible.length; i += 5) {
            sig = (sig * 33 + (p.visible[i] ? 3 : p.explored[i] ? 1 : 0)) | 0;
        }
        if (sig === this.lastSig) return;
        this.lastSig = sig;
        this.rebuild(p);
    }

    /**
     * One parallelogram per run of same-state tiles in a row.  Runs keep the
     * rebuild down to a few hundred polys instead of 4096 diamonds, and hard
     * edges are what the retail shroud sprite looks like anyway.
     */
    private rebuild(p: PlayerState) {
        const g = this.g;
        g.clear();
        const N = MAP_TILES, T = TILE, H = HALF;
        const dark = new Color(8, 11, 14, 236);
        const dim = new Color(8, 11, 14, 138);
        for (let ty = 0; ty < N; ty++) {
            let tx = 0;
            while (tx < N) {
                const i0 = ty * N + tx;
                const st = p.visible[i0] ? 0 : p.explored[i0] ? 1 : 2;
                let tx2 = tx + 1;
                if (st !== 0) {
                    while (tx2 < N) {
                        const j = ty * N + tx2;
                        const s2 = p.visible[j] ? 0 : p.explored[j] ? 1 : 2;
                        if (s2 !== st) break;
                        tx2++;
                    }
                    // The union of the diamonds in a run is a HEXAGON, not a
                    // parallelogram. Using the bounding quad left hairline gaps
                    // along every row boundary (visible as diagonal seams).
                    const v = (gx: number, gy: number) => worldToProj(gx * T - H, gy * T - H, 0);
                    const q0 = v(tx, ty + 0.5);
                    const q1 = v(tx + 0.5, ty);
                    const q2 = v(tx2 - 0.5, ty);
                    const q3 = v(tx2, ty + 0.5);
                    const q4 = v(tx2 - 0.5, ty + 1);
                    const q5 = v(tx + 0.5, ty + 1);
                    g.moveTo(q0.x, q0.y);
                    g.lineTo(q1.x, q1.y);
                    g.lineTo(q2.x, q2.y);
                    g.lineTo(q3.x, q3.y);
                    g.lineTo(q4.x, q4.y);
                    g.lineTo(q5.x, q5.y);
                    g.close();
                    g.fillColor = st === 2 ? dark : dim;
                    g.fill();
                }
                tx = tx2;
            }
        }
    }
}

/* ================================================================== */
/* ENTITY VIEWS                                                       */
/* ================================================================== */
/** map a logic-space facing (radians, cartesian) to a screen angle in an iso world */
export function isoAngle(face: number) {
    const dx = Math.cos(face), dy = Math.sin(face);
    const px = (dx - dy) * ISO_HW;
    const py = (dx + dy) * ISO_HH;
    return (-Math.atan2(py, px) * 180) / Math.PI;
}

export class EntityView {
    node: Node;
    /** Graphics body — structures only */
    body: Graphics;
    /** Sprite body — units, fed by baked or SHP frames */
    spriteNode: Node;
    sprite: Sprite;
    /** live turret overlay (two primitives, cheaper than baking every combo) */
    turret: Graphics;
    ring: Graphics;
    hp: Graphics;
    chev: Graphics;
    deco: Graphics;
    private op: UIOpacity;
    private lastHp = -1;
    private lastProgress = -1;
    private lastDamaged = false;
    private lastOwner = -2;
    private lastLevel = -1;
    private lastRepair = false;
    private lastPrimary = false;
    private wasSelected = false;
    private hpTimer = 0;
    /** sprite facing / frame cache: only repaint when one of them changes */
    private anim = new Anim();
    private dir8 = -1;
    private tDir8 = -1;
    private frame = -1;

    constructor(parent: Node, public e: Entity, private terrain: TerrainMap) {
        this.node = plainNode(parent, (e.isBuilding ? 'B:' : 'U:') + e.id);
        const p0 = worldToProj(e.x, e.y, terrain.heightAt(e.x, e.y));
        this.node.setPosition(p0.x, p0.y, 0);
        (this.node as any).__depth = p0.y;
        this.ring = gfxNode(this.node, 'ring');
        this.body = gfxNode(this.node, 'body');
        this.spriteNode = plainNode(this.node, 'sprite');
        this.sprite = this.spriteNode.addComponent(Sprite);
        this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.sprite.type = Sprite.Type.SIMPLE;
        const st = this.spriteNode.getComponent(UITransform)!;
        st.setContentSize(FRAME_W, FRAME_H);
        this.turret = gfxNode(this.node, 'turret');
        this.hp = gfxNode(this.node, 'hp');
        this.chev = gfxNode(this.node, 'chev');
        this.deco = gfxNode(this.node, 'deco');
        this.op = this.spriteNode.addComponent(UIOpacity);
        if (e instanceof Unit) {
            this.body.node.active = false;
            this.applyFrame(e, factionOf(e.owner));
        } else if (e instanceof Building) {
            this.spriteNode.active = false;
            this.turret.node.active = false;
            this.lastDamaged = e.hp / e.maxHp < 0.5;
            drawBuilding(pen(this.body), e.def, factionOf(e.owner), e.progress, this.lastDamaged);
        }
        this.lastOwner = e.owner;
    }

    /** fetch the sprite frame for this unit's current facing / walk frame */
    private applyFrame(u: Unit, faction: Faction) {
        const sf = unitBodyFrame(u.def, faction, Math.max(0, this.dir8), Math.max(0, this.frame));
        if (sf) this.sprite.spriteFrame = sf;
    }

    redraw(selFaction: Faction) {
        if (this.e instanceof Unit) {
            this.applyFrame(this.e, selFaction);
        } else if (this.e instanceof Building) {
            const b = this.e as Building;
            drawBuilding(pen(this.body), b.def, selFaction, b.progress, b.hp / b.maxHp < 0.5);
        }
        this.lastOwner = this.e.owner;
    }

    update(dt: number, selected: boolean, faction: Faction, otherFaction: Faction, cloaked = false, primary = false) {
        const e = this.e;
        if (e instanceof Unit) {
            const u = e;
            const air = u.isAir;
            const lift = this.terrain.heightAt(u.x, u.y);
            const p = worldToProj(u.x, u.y, lift);
            this.node.setPosition(p.x, p.y + (air ? u.altitude + Math.sin(u.bob * 2) * 1.6 : 0), 0);
            (this.node as any).__depth = p.y + (e.isBuilding ? 2 : 0);
            if (air) {
                // aircraft are continuous 3D models in the reference, so a real
                // rotation (plus bank) is correct for them
                const bank = Math.max(-18, Math.min(18, u.turnDelta * 7));
                this.node.angle = isoAngle(u.face) + bank;
                this.spriteNode.setScale(1, 1, 1);
                this.spriteNode.setPosition(0, 0, 0);
                // air art is painted from one fixed view; only the node rotates
                if (this.dir8 !== 0 || this.frame !== 0) {
                    this.dir8 = 0;
                    this.frame = 0;
                    this.applyFrame(u, factionOf(u.owner));
                }
            } else {
                // ground units use discrete facing images: never spin the node
                this.node.angle = 0;
                const deg = (u.face * 180) / Math.PI;
                const dir8 = facingIndex(deg);
                const tDir8 = facingIndex((u.turretFace * 180) / Math.PI);

                // sequence clock: moving plays Walk, standing holds Ready
                this.anim.play(u.speedCur > 4 ? Seq.Walk : Seq.Ready);
                this.anim.step(dt);

                const flip = u.def.kind === 'infantry'
                    && Math.cos((facingDeg(dir8) * Math.PI) / 180) < -0.15;
                const S = u.hitFlash > 0 ? 1.04 : 1;
                this.spriteNode.setScale(flip ? -S : S, S, 1);
                this.spriteNode.setPosition(-u.recoil * 26, 0, 0);

                if (dir8 !== this.dir8 || this.anim.frame !== this.frame) {
                    this.dir8 = dir8;
                    this.frame = this.anim.frame;
                    this.applyFrame(u, factionOf(u.owner));
                }

                // turret overlay: only repaint when its heading actually changed
                if (tDir8 !== this.tDir8 || u.owner !== this.lastOwner) {
                    this.tDir8 = tDir8;
                    const tp = pen(this.turret);
                    tp.clear();
                    if (u.def.kind === 'vehicle') paintTurret(tp, u.def, factionOf(u.owner), tDir8);
                }
                this.turret.node.setPosition(-u.recoil * 26, 0, 0);
            }

            // own cloaked units read as a ghost so the player can still command them
            const target = cloaked ? 120 : 255;
            if (this.op.opacity !== target) this.op.opacity = target;
            if (u.level !== this.lastLevel) {
                this.lastLevel = u.level;
                this.chev.clear();
                if (u.level > 0) {
                    drawChevron(pen(this.chev), u.level, u.radius + (air ? 30 : 20), HEX(PAL.amber, 235));
                }
            }
        } else if (e instanceof Building) {
            const b = e as Building;
            if (b.owner !== this.lastOwner) this.redraw(factionOf(b.owner));
            const hurt = b.hp / b.maxHp < 0.5;
            if (Math.abs(b.progress - this.lastProgress) > 0.02 || hurt !== this.lastDamaged) {
                this.lastProgress = b.progress;
                this.lastDamaged = hurt;
                drawBuilding(pen(this.body), b.def, factionOf(b.owner), b.progress, hurt);
            }
            if (b.repairing !== this.lastRepair) {
                this.lastRepair = b.repairing;
                this.drawRepair(b);
            }
            if (primary !== this.lastPrimary) {
                this.lastPrimary = primary;
                this.drawPrimary(b);
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

    private drawRepair(b: Building) {
        const g = this.chev;
        g.clear();
        if (!b.repairing) return;
        const y = b.radius + 8;
        // little wrench + cross above the roof
        g.circle(0, y, 7);
        g.fillColor = new Color(10, 16, 20, 190);
        g.fill();
        g.strokeColor = HEX(PAL.green, 230);
        g.lineWidth = 1.5;
        g.stroke();
        g.moveTo(-3.4, y - 3.4);
        g.lineTo(3.4, y + 3.4);
        g.strokeColor = HEX(PAL.green, 240);
        g.lineWidth = 1.8;
        g.stroke();
        g.circle(-3.6, y - 3.6, 2.1);
        g.strokeColor = HEX(PAL.green, 240);
        g.lineWidth = 1.4;
        g.stroke();
    }

    /** small star on the structure that actually trains units */
    private drawPrimary(b: Building) {
        const g = this.deco;
        g.clear();
        if (!this.lastPrimary) return;
        const x = b.radius * 0.62;
        const y = b.radius * 0.62;
        g.circle(x, y, 6.5);
        g.fillColor = new Color(10, 16, 20, 190);
        g.fill();
        g.strokeColor = HEX(PAL.amber, 235);
        g.lineWidth = 1.2;
        g.stroke();
        for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
            const a2 = a + Math.PI / 5;
            g.moveTo(x + Math.cos(a) * 4.4, y + Math.sin(a) * 4.4);
            g.lineTo(x + Math.cos(a2) * 1.8, y + Math.sin(a2) * 1.8);
        }
        g.strokeColor = HEX(PAL.amber, 230);
        g.lineWidth = 1.3;
        g.stroke();
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
const factionOf = (owner: number): Faction => (owner === 1 ? otherFaction : gameFaction);

/* ================================================================== */
/* WORLD RENDERER                                                     */
/* ================================================================== */
export class WorldRenderer {
    root: Node;
    terrainLayer: Node;
    decalLayer: Node;
    rallyLayer: Node;
    crateLayer: Node;
    worldLayer: Node;
    buildingLayer: Node;
    unitLayer: Node;
    zoneLayer: Node;
    projLayer: Node;
    fxLayer: Node;
    fogLayer: Node;

    terrain: TerrainView;
    fog: FogView;

    private rallyG: Graphics;
    views = new Map<number, EntityView>();
    projViews = new Map<Projectile, Node>();
    fxViews = new Map<Fx, Graphics>();
    zoneViews = new Map<Zone, Graphics>();
    crateViews = new Map<Crate, Graphics>();
    decalViews = new Map<Decal, Graphics>();

    private tmpColor = new Color();
    private primIds = new Set<number>();
    private primTimer = 0;

    constructor(canvas: Node, public game: Game) {
        this.root = plainNode(canvas, 'WorldRoot');
        this.terrainLayer = plainNode(this.root, 'L0_Terrain');
        this.decalLayer = plainNode(this.root, 'L0b_Decals');
        this.rallyLayer = plainNode(this.root, 'L1_Rally');
        this.crateLayer = plainNode(this.root, 'L2_Crates');
        // buildings and units share one layer so the isometric painter's sort can
        // interleave them — a tank behind a refinery must be drawn behind it
        this.worldLayer = plainNode(this.root, 'L2_World');
        this.buildingLayer = this.worldLayer;
        this.unitLayer = this.worldLayer;
        this.zoneLayer = plainNode(this.root, 'L4_Zones');
        this.projLayer = plainNode(this.root, 'L5_Projectiles');
        this.fxLayer = plainNode(this.root, 'L6_Fx');
        this.fogLayer = plainNode(this.root, 'L7_Fog');

        gameFaction = game.human.faction;
        otherFaction = game.enemy.faction;

        this.rallyG = gfxNode(this.rallyLayer, 'rally');
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
        const v = new EntityView(this.worldLayer, e, this.game.terrain);
        this.views.set(e.id, v);
    }

    /**
     * Painter's algorithm for an isometric scene: sort the shared world layer by
     * projected depth so nearer sprites cover farther ones. Only touches sibling
     * indices when the order actually changed, to avoid a per-frame UI rebuild.
     */
    private sortWorld() {
        const kids = this.worldLayer.children;
        if (kids.length < 2) return;
        const arr = kids.slice().sort((a, b) =>
            (((a as any).__depth as number) || 0) - (((b as any).__depth as number) || 0));
        let dirty = false;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i] !== kids[i]) { dirty = true; break; }
        }
        if (!dirty) return;
        for (let i = 0; i < arr.length; i++) arr[i].setSiblingIndex(i);
    }

    removeEntity(e: Entity) {
        const v = this.views.get(e.id);
        if (v) { v.destroy(); this.views.delete(e.id); }
    }

    addFx(f: Fx) {
        const g = gfxNode(this.fxLayer, 'fx');
        const p = worldToProj(f.x, f.y, this.game.terrain.heightAt(f.x, f.y));
        g.node.setPosition(p.x, p.y, 0);
        this.fxViews.set(f, g);
    }

    private drawFx(g: Graphics, f: Fx) {
        g.clear();
        g.node.angle = 0;
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
            // debris streaks make a big strike read as an explosion, not a disc
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2 + k * 0.6;
                g.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
                g.lineTo(Math.cos(a) * r * (1.25 + k * 0.5), Math.sin(a) * r * (1.25 + k * 0.5));
            }
            g.strokeColor = new Color(255, 205, 130, Math.floor(160 * (1 - k)));
            g.lineWidth = 2;
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
        } else if (f.kind === 'target') {
            // incoming orbital strike: shrinking crosshair
            const r = 110 * (1 - k * 0.55);
            g.circle(0, 0, r);
            g.strokeColor = new Color(255, 90, 70, Math.floor(220 * (0.4 + 0.6 * k)));
            g.lineWidth = 2.4;
            g.stroke();
            g.moveTo(-r * 1.15, 0); g.lineTo(-r * 0.5, 0);
            g.moveTo(r * 0.5, 0); g.lineTo(r * 1.15, 0);
            g.moveTo(0, -r * 1.15); g.lineTo(0, -r * 0.5);
            g.moveTo(0, r * 0.5); g.lineTo(0, r * 1.15);
            g.strokeColor = new Color(255, 140, 100, Math.floor(220 * (0.5 + 0.5 * k)));
            g.lineWidth = 2;
            g.stroke();
        } else if (f.kind === 'debris') {
            // tumbling hull fragments: position is the ground point, z is height
            g.node.angle = (f.t * f.spin * 57.3) % 360;
            const s = 2.2 * f.scale;
            g.rect(-s, -s * 0.5 + f.z, s * 2, s);
            g.fillColor = new Color(58, 54, 48, Math.floor(240 * (1 - k * 0.7)));
            g.fill();
            g.moveTo(-s, f.z);
            g.lineTo(s, f.z);
            g.strokeColor = new Color(150, 120, 82, Math.floor(160 * (1 - k)));
            g.lineWidth = 1;
            g.stroke();
        } else if (f.kind === 'smoke') {
            const r = (5 + k * 16) * f.scale;
            g.circle(0, f.z, r);
            g.fillColor = new Color(96, 92, 86, Math.floor(110 * (1 - k)));
            g.fill();
        } else if (f.kind === 'fire') {
            const flick = 0.6 + Math.abs(Math.sin(f.t * 17 + f.scale * 9)) * 0.5;
            const h = (10 + k * 6) * f.scale * flick;
            g.moveTo(-5, 0); g.lineTo(-2, h * 0.7); g.lineTo(0, h); g.lineTo(3, h * 0.55); g.lineTo(5, 0); g.close();
            g.fillColor = new Color(255, 150, 60, Math.floor(220 * (1 - k)));
            g.fill();
            g.moveTo(-2.5, 0); g.lineTo(0, h * 0.6); g.lineTo(2.2, 0); g.close();
            g.fillColor = new Color(255, 230, 140, Math.floor(230 * (1 - k)));
            g.fill();
        } else if (f.kind === 'dust') {
            const r = (8 + k * 22) * f.scale;
            g.ellipse(0, 0, r, r * 0.5);
            g.fillColor = new Color(201, 161, 115, Math.floor(75 * (1 - k)));
            g.fill();
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

    private drawRally(game: Game) {
        const g = this.rallyG;
        g.clear();
        const b = game.selectedBuilding;
        if (!b || b.dead || !b.rally) return;
        const T = game.terrain;
        const a0 = worldToProj(b.x, b.y, T.heightAt(b.x, b.y));
        const a1 = worldToProj(b.rally.x, b.rally.y, T.heightAt(b.rally.x, b.rally.y));
        const dx = a1.x - a0.x, dy = a1.y - a0.y;
        const len = Math.hypot(dx, dy);
        if (len < 10) return;
        const ux = dx / len, uy = dy / len;
        const start = Math.min(len * 0.35, b.radius * 0.75);
        for (let d = start; d < len - 6; d += 14) {
            const e = Math.min(len, d + 7);
            g.moveTo(a0.x + ux * d, a0.y + uy * d);
            g.lineTo(a0.x + ux * e, a0.y + uy * e);
        }
        g.strokeColor = HEX(PAL.cyan, 120);
        g.lineWidth = 1.4;
        g.stroke();
        // flag sits on the projected ground point, mast stays screen-vertical
        g.ellipse(a1.x, a1.y, 9, 5);
        g.strokeColor = HEX(PAL.cyan, 190);
        g.lineWidth = 1.6;
        g.stroke();
        g.moveTo(a1.x, a1.y);
        g.lineTo(a1.x, a1.y + 20);
        g.strokeColor = HEX(PAL.white, 200);
        g.lineWidth = 1.6;
        g.stroke();
        g.moveTo(a1.x, a1.y + 20);
        g.lineTo(a1.x + 13, a1.y + 14);
        g.lineTo(a1.x, a1.y + 9);
        g.close();
        g.fillColor = HEX(PAL.cyan, 210);
        g.fill();
    }

    private drawDecal(g: Graphics, d: Decal) {
        g.clear();
        const fade = 1 - Math.max(0, (d.k - 0.6) / 0.4);
        const a = d.alpha * fade;
        g.ellipse(0, 0, d.r, d.r * 0.62);
        g.fillColor = new Color(24, 18, 13, Math.floor(a * 0.7));
        g.fill();
        g.ellipse(0, 0, d.r * 0.68, d.r * 0.42);
        g.fillColor = new Color(12, 9, 7, Math.floor(a * 0.55));
        g.fill();
        g.ellipse(0, 0, d.r, d.r * 0.62);
        g.strokeColor = new Color(128, 100, 68, Math.floor(a * 0.55));
        g.lineWidth = 1.4;
        g.stroke();
    }

    private drawZone(g: Graphics, z: Zone) {
        g.clear();
        const c = HEX(z.color);
        const fade = z.t < 0.6 ? z.t / 0.6 : (1 - z.k) < 0.2 ? (1 - z.k) / 0.2 : 1;
        const a = (v: number) => Math.max(0, Math.min(255, Math.round(v * fade)));
        g.circle(0, 0, z.r);
        g.fillColor = new Color(c.r, c.g, c.b, a(z.kind === 'sandstorm' ? 46 : 26));
        g.fill();
        g.circle(0, 0, z.r);
        g.strokeColor = new Color(c.r, c.g, c.b, a(210));
        g.lineWidth = 2.4;
        g.stroke();

        if (z.kind === 'sandstorm') {
            for (let i = 0; i < 4; i++) {
                const rr = z.r * (0.35 + i * 0.17);
                const spin = z.t * (1.1 + i * 0.25) + i;
                for (let k = 0; k < 3; k++) {
                    const a0 = spin + (k / 3) * Math.PI * 2;
                    g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr * 0.6);
                    g.quadraticCurveTo(
                        Math.cos(a0 + 0.5) * rr * 1.2, Math.sin(a0 + 0.5) * rr * 0.7,
                        Math.cos(a0 + 0.9) * rr, Math.sin(a0 + 0.9) * rr * 0.55,
                    );
                    g.strokeColor = new Color(c.r, c.g, c.b, a(150 - i * 22));
                    g.lineWidth = 2.2;
                    g.stroke();
                }
            }
        } else if (z.kind === 'aegis') {
            for (let i = 0; i < 2; i++) {
                const rr = z.r * (0.62 + i * 0.3) + Math.sin(z.t * 2 + i) * 4;
                g.circle(0, 0, rr);
                g.strokeColor = new Color(c.r, c.g, c.b, a(150 - i * 50));
                g.lineWidth = 1.8;
                g.stroke();
            }
            for (let i = 0; i < 6; i++) {
                const ang = (i / 6) * Math.PI * 2 + z.t * 0.3;
                g.moveTo(Math.cos(ang) * z.r * 0.7, Math.sin(ang) * z.r * 0.7);
                g.lineTo(Math.cos(ang) * z.r, Math.sin(ang) * z.r);
                g.strokeColor = new Color(c.r, c.g, c.b, a(110));
                g.lineWidth = 1.4;
                g.stroke();
            }
        } else {
            for (let i = 0; i < 5; i++) {
                const rr = z.r * (0.3 + i * 0.16);
                const a0 = z.t * 0.8 + i * 1.1;
                g.arc(0, 0, rr, a0, a0 + 1.1, false);
                g.strokeColor = new Color(c.r, c.g, c.b, a(120 - i * 15));
                g.lineWidth = 2;
                g.stroke();
            }
        }
    }

    sync(dt: number, cameraBounds: { x0: number; y0: number; x1: number; y1: number }) {
        const g = this.game;
        const human = g.human;
        const sel = g.selection;

        this.primTimer -= dt;
        if (this.primTimer <= 0) {
            this.primTimer = 1;
            this.primIds.clear();
            for (const cat of ['structure', 'infantry', 'vehicle', 'aircraft'] as const) {
                const f = g.primaryFactory(human, cat);
                if (f) this.primIds.add(f.id);
            }
        }

        // entities
        for (const [id, v] of this.views) {
            const e = v.e;
            if (e.dead) { v.destroy(); this.views.delete(id); continue; }
            const vis = g.isVisibleTo(human, e);
            if (v.node.active !== vis) v.node.active = vis;
            if (!vis) continue;
            // cull far off-screen entities from the update loop (bounds are in
            // projected screen space now, so compare against the projected point)
            const cpp = worldToProj(e.x, e.y, 0);
            const inView = cpp.x > cameraBounds.x0 - 140 && cpp.x < cameraBounds.x1 + 140
                && cpp.y > cameraBounds.y0 - 140 && cpp.y < cameraBounds.y1 + 140;
            const selected = e.isBuilding
                ? g.selectedBuilding === e
                : sel.indexOf(e as Unit) >= 0;
            if (!selected && !inView) continue;
            const cloaked = e instanceof Unit && e.owner === human.id && e.cloaked;
            v.update(dt, selected, human.faction, g.enemy.faction, cloaked, this.primIds.has(e.id));
        }

        this.sortWorld();

        // rally marker for the selected structure
        this.drawRally(g);

        // craters left by explosions
        for (const d of g.decals) {
            let gg = this.decalViews.get(d);
            if (!gg) {
                gg = gfxNode(this.decalLayer, 'decal');
                this.decalViews.set(d, gg);
            }
            const dp = worldToProj(d.x, d.y, g.terrain.heightAt(d.x, d.y));
            gg.node.setPosition(dp.x, dp.y, 0);
            this.drawDecal(gg, d);
        }
        for (const [d, gg] of this.decalViews) {
            if (d.dead || g.decals.indexOf(d) < 0) { gg.node.destroy(); this.decalViews.delete(d); }
        }

        // super weapon fields
        for (const z of g.zones) {
            let gg = this.zoneViews.get(z);
            if (!gg) {
                gg = gfxNode(this.zoneLayer, 'zone');
                this.zoneViews.set(z, gg);
            }
            const zp = worldToProj(z.x, z.y, g.terrain.heightAt(z.x, z.y));
            gg.node.setPosition(zp.x, zp.y, 0);
            this.drawZone(gg, z);
        }
        for (const [z, gg] of this.zoneViews) {
            if (z.dead || g.zones.indexOf(z) < 0) { gg.node.destroy(); this.zoneViews.delete(z); }
        }

        // supply crates
        for (const c of g.crates) {
            let gg = this.crateViews.get(c);
            if (!gg) {
                gg = gfxNode(this.crateLayer, 'crate');
                this.crateViews.set(c, gg);
            }
            const cp = worldToProj(c.x, c.y, g.terrain.heightAt(c.x, c.y));
            gg.node.setPosition(cp.x, cp.y, 0);
            drawPickup(pen(gg), c.kind, c.t);
        }
        for (const [c, gg] of this.crateViews) {
            if (c.dead || g.crates.indexOf(c) < 0) { gg.node.destroy(); this.crateViews.delete(c); }
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
            const pp = worldToProj(pr.x, pr.y, g.terrain.heightAt(pr.x, pr.y));
            n.setPosition(pp.x, pp.y + pr.z, 0);
            n.angle = pr.kind === 'bullet' ? 0 : isoAngle(pr.heading);
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
