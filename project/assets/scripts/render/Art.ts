/**
 * Procedural art — a PLACEHOLDER provider.
 *
 * These functions are written against the `Pen` abstraction, not directly
 * against cc.Graphics, for one reason: the same drawing code has to serve two
 * very different backends.
 *
 *   1. GfxPen    — draws straight into a Graphics component (menus, HUD icons,
 *                  terrain: things that never change per frame).
 *   2. CanvasPen — bakes the drawing into an offscreen 2D canvas, which then
 *                  becomes a Texture2D and is rendered as a Sprite (units).
 *
 * Units go through path 2 so that the renderer is texture/sprite based, exactly
 * like the retail engine. When real SHP art arrives, nothing above this file
 * changes: the sprite frames simply come from `ShpFile` instead of from these
 * painters. See assets/Assets.ts.
 *
 * Visual language (see docs/ART_STYLE.md):
 *   warm sand ground · dark slate machinery · cyan neon strips · amber accents
 */
import { Color, Graphics } from 'cc';
import { Pen, GfxPen } from '../assets/Pen';
import { facingDeg } from './Frames';
import { PAL, HEX, Faction, UnitDef, BuildingDef, TILE, makeRng } from '../core/Core';

const C = {
    sand: HEX(PAL.sand),
    sandLight: HEX(PAL.sandLight),
    sandDark: HEX(PAL.sandDark),
    sandShadow: HEX(PAL.sandShadow),
    rock: HEX(PAL.rock),
    rockDark: HEX(PAL.rockDark),
    slate: HEX(PAL.slate),
    slateLight: HEX(PAL.slateLight),
    slateDark: HEX(PAL.slateDark),
    /** three-step hull shading: lit top, edge highlight, shaded side wall */
    hullTop: HEX('#4b5461'),
    hullEdge: HEX('#6b7688'),
    hullSide: HEX('#252a33'),
    ink: HEX(PAL.ink),
    cyan: HEX(PAL.cyan),
    cyanDim: HEX(PAL.cyanDim),
    amber: HEX(PAL.amber),
    red: HEX(PAL.red),
    green: HEX(PAL.green),
    bu: HEX(PAL.teamBU),
    ds: HEX(PAL.teamDS),
    dsDim: HEX(PAL.dsDim),
    violet: HEX(PAL.violet),
    white: HEX(PAL.white),
    shadow: new Color(0, 0, 0, 52),
    shadowSoft: new Color(0, 0, 0, 26),
};

const hexA = (c: Color, a: number) => new Color(c.r, c.g, c.b, a);
const team = (f: Faction) => (f === 'BU' ? C.bu : C.ds);
const teamDim = (f: Faction) => (f === 'BU' ? HEX(PAL.cyanDim) : C.dsDim);
const glow = (f: Faction) => (f === 'BU' ? C.cyan : C.violet);

/* ---------------- low level helpers ---------------- */
function poly(g: Pen, pts: number[][], fill?: Color, stroke?: Color, lw = 1.5) {
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.close();
    if (fill) { g.fillColor = fill; g.fill(); }
    if (stroke) { g.strokeColor = stroke; g.lineWidth = lw; g.stroke(); }
}

function rr(g: Pen, x: number, y: number, w: number, h: number, r: number, fill?: Color, stroke?: Color, lw = 1.5) {
    g.roundRect(x, y, w, h, r);
    if (fill) { g.fillColor = fill; g.fill(); }
    if (stroke) { g.strokeColor = stroke; g.lineWidth = lw; g.stroke(); }
}

function circle(g: Pen, x: number, y: number, r: number, fill?: Color, stroke?: Color, lw = 1.5) {
    g.circle(x, y, r);
    if (fill) { g.fillColor = fill; g.fill(); }
    if (stroke) { g.strokeColor = stroke; g.lineWidth = lw; g.stroke(); }
}

function line(g: Pen, x1: number, y1: number, x2: number, y2: number, color: Color, w = 2) {
    g.moveTo(x1, y1); g.lineTo(x2, y2);
    g.strokeColor = color; g.lineWidth = w; g.stroke();
}

/** neon strip: soft halo + bright core */
function neon(g: Pen, x1: number, y1: number, x2: number, y2: number, col: Color, w = 2) {
    const halo = new Color(col.r, col.g, col.b, 58);
    line(g, x1, y1, x2, y2, halo, w * 4);
    line(g, x1, y1, x2, y2, col, w);
}

function shadowEllipse(g: Pen, rx: number, ry: number, ox = 3, oy = -4, alpha = 52) {
    g.ellipse(ox, oy, rx, ry);
    g.fillColor = new Color(0, 0, 0, alpha);
    g.fill();
}

/* ================================================================== */
/* UNITS                                                              */
/* ================================================================== */
/**
 * Paint one unit image.
 * `dir8` / `turretDir8` are sprite facing indices (see Frames.ts), `frame` is
 * the index inside the current sequence.  The hull is drawn in a fixed 3/4 iso
 * view — rotating a painted 2D hull looks wrong in an isometric world, which is
 * exactly why the original ships discrete facing images instead.
 */
export function drawUnit(
    g: Pen, def: UnitDef, faction: Faction,
    dir8 = 0, frame = 0, turretDir8 = dir8,
) {
    g.clear();
    const tc = team(faction);
    const gc = glow(faction);

    if (def.kind === 'infantry') {
        drawInfantry(g, def, faction, tc, gc, dir8, frame);
        return;
    }
    if (def.kind === 'air') {
        drawAircraft(g, def, faction, tc, gc);
        return;
    }
    if (def.kind === 'harvester') {
        drawHarvester(g, def, faction, tc, gc, dir8, frame);
        return;
    }
    if (def.kind === 'mcv') {
        drawMcv(g, def, faction, tc, gc, dir8, frame);
        return;
    }
    drawHull(g, def, faction, tc, gc, dir8, frame);
    drawTurret(g, def, faction, tc, gc, turretDir8);
}

function drawInfantry(
    g: Pen, def: UnitDef, faction: Faction, tc: Color, gc: Color,
    dir8: number, frame: number,
) {
    const isRocket = def.id === 'breaker' || def.id === 'stinger';
    const isEngineer = !!def.engineer;
    const isStealth = !!def.cloak;
    const ta = (facingDeg(dir8) * Math.PI) / 180;
    // > 0 means walking away from the camera, so the visor is hidden
    const away = Math.sin(ta) > 0.35;
    shadowEllipse(g, isStealth ? 9 : 10, 4.5, 1, -1, 46);
    // legs swing out of phase across the 4 walk frames
    const ph = (frame / 4) * Math.PI * 2;
    const l1 = Math.max(0, Math.sin(ph)) * 1.9;
    const l2 = Math.max(0, Math.sin(ph + Math.PI)) * 1.9;
    rr(g, -4, -2 + l1, 4, 7 - l1 * 0.35, 1.5, C.slateDark);
    rr(g, 1, -2 + l2, 4, 7 - l2 * 0.35, 1.5, C.slateDark);

    if (isEngineer) {
        // hi-vis vest and a tool pack instead of a rifle
        poly(g, [[-6, 4], [5, 5], [7, 11], [-6, 11]], C.slate, C.slateLight, 1);
        rr(g, -5, 6, 11, 3, 1, C.amber);
        rr(g, -8, 2, 5, 7, 1.5, C.slateLight, C.slateDark, 0.8);
        line(g, -7.5, 5, -3.5, 5, C.amber, 1.4);
        circle(g, 1, 14, 4.2, HEX(PAL.amber, 230), C.slateDark, 1);
        line(g, 2, 15, 5, 15, C.white, 1.6);
        return;
    }

    // torso
    poly(g, [[-6, 4], [5, 5], [7, 11], [-6, 11]], C.slate, C.slateLight, 1);
    // shoulder pads in team colour
    rr(g, -7, 8, 5, 4, 1.5, tc);
    // helmet
    circle(g, 1, 14, isStealth ? 3.6 : 4.2, isStealth ? C.slateDark : C.slateLight, C.slateDark, 1);
    // visor only reads from the front
    if (!away) line(g, 2, 15, 5, 15, isStealth ? HEX(PAL.violet, 220) : gc, 1.8);
    if (isStealth) {
        // folded cloak silhouette
        g.moveTo(-8, 6);
        g.quadraticCurveTo(-11, 2, -6, -1);
        g.strokeColor = new Color(gc.r, gc.g, gc.b, 120);
        g.lineWidth = 1.6;
        g.stroke();
        rr(g, 4, 7.5, 8, 2, 1, C.slateDark);
        line(g, 11, 8.5, 13, 8.5, HEX(PAL.violet, 190), 1.4);
    } else if (isRocket) {
        rr(g, 4, 7, 11, 3.4, 1.4, C.slateDark, C.slateLight, 0.8);
        line(g, 12, 8.7, 16, 8.7, C.amber, 2);
    } else {
        rr(g, 4, 7.5, 9, 2.2, 1, C.slateDark);
        line(g, 10, 8.6, 14, 8.6, C.slateLight, 1.6);
    }
}

/** mobile construction vehicle: a tracked hull carrying a folded command core */
function drawMcv(g: Pen, def: UnitDef, faction: Faction, tc: Color, gc: Color, dir8: number, frame: number) {
    const w = 40, h = 26;
    shadowEllipse(g, w * 0.6, h * 0.5, 3, -4, 60);
    rr(g, -w / 2, -h / 2 - 2, w, 6, 2.4, C.slateDark);
    rr(g, -w / 2, h / 2 - 4, w, 6, 2.4, C.slateDark);
    for (let i = -3; i <= 3; i++) {
        line(g, i * 5.4, -h / 2 - 1.5, i * 5.4, -h / 2 + 2.5, C.ink, 1.1);
        line(g, i * 5.4, h / 2 - 3.5, i * 5.4, h / 2 + 0.5, C.ink, 1.1);
    }
    rr(g, -w / 2 + 2, -h / 2 + 3, w - 4, h - 6, 3, C.slate, C.slateLight, 1.3);
    // folded core module
    poly(g, [[-9, -6], [8, -6], [10, 4], [0, 9], [-10, 3]], C.slateLight, C.slateDark, 1.2);
    circle(g, 0, 0, 4.4, hexA(gc, 40), hexA(gc, 200), 1.4);
    circle(g, 0, 0, 1.8, hexA(gc, 230));
    // crane arm
    line(g, -13, 2, -19, 11, C.slateDark, 2.6);
    line(g, -19, 11, -12, 13, C.slateDark, 2);
    circle(g, -12, 13, 1.8, C.amber);
    neon(g, -w / 2 + 5, 4, -w / 2 + 5, h / 2 - 5, gc, 1.4);
    rr(g, w / 2 - 12, -3, 8, 5, 1.2, tc);
}

/** iso scale factors: world units -> projected pixels (28/32, 14/32) */
const ISO_SX = 28 / 32;
const ISO_SY = 14 / 32;

/**
 * Draw a rotated box as an isometric solid: two visible side walls plus a top
 * face. This is the cheap equivalent of the reference's 8-facing voxel/sprite
 * hull — a flat painted footprint simply does not read as a vehicle in an
 * isometric world.
 */
function isoBody(
    g: Pen, L: number, W: number, H: number, dirDeg: number,
    topFill: Color, topLine: Color, sideFill: Color,
) {
    const a = (dirDeg * Math.PI) / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const local: number[][] = [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]];
    const proj = (lx: number, ly: number, lift: number) => {
        const dx = lx * ca - ly * sa;
        const dy = lx * sa + ly * ca;
        // Screen y grows upward, so a lift (roof height) must be ADDED. With the
        // old minus sign every hull hung below the ground point it stood on, and
        // its roof faced the floor.
        return { x: (dx - dy) * ISO_SX, y: (dx + dy) * ISO_SY + lift };
    };
    const top = local.map(([x, y]) => proj(x, y, H));
    const bot = local.map(([x, y]) => proj(x, y, 0));
    for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        g.moveTo(top[i].x, top[i].y);
        g.lineTo(top[j].x, top[j].y);
        g.lineTo(bot[j].x, bot[j].y);
        g.lineTo(bot[i].x, bot[i].y);
        g.close();
        g.fillColor = sideFill;
        g.fill();
    }
    g.moveTo(top[0].x, top[0].y);
    for (let i = 1; i < 4; i++) g.lineTo(top[i].x, top[i].y);
    g.close();
    g.fillColor = topFill;
    g.fill();
    g.strokeColor = topLine;
    g.lineWidth = 1.2;
    g.stroke();
    return { top, proj };
}

/**
 * Hull only — the part that gets baked into a sprite frame.
 * Kept free of the turret so the two can animate independently and so the bake
 * cache only needs (facing, walk frame) instead of (facing, frame, turret).
 */
export function drawHull(
    g: Pen, def: UnitDef, faction: Faction, tc: Color, gc: Color,
    dir8: number, frame: number,
) {
    const heavy = def.armor === 'heavy';
    const L = heavy ? 33 : 28;
    const W = heavy ? 21 : 18;
    const H = heavy ? 12 : 9.5;

    // contact shadow on the ground plane
    g.ellipse(3, -4, L * 0.58, W * 0.5);
    g.fillColor = new Color(0, 0, 0, 58);
    g.fill();

    const body = isoBody(g, L, W, H, facingDeg(dir8), C.hullTop, C.hullEdge, C.hullSide);

    // treads run along the hull sides; the link offset scrolls with the frame
    const sc = (frame / 4) * 4;
    for (const side of [-1, 1]) {
        const off = (W / 2 - 2.6) * side;
        const p0 = body.proj(-L / 2 + 1.5 + sc, off, H + 0.6);
        const p1 = body.proj(L / 2 - 1.5 + sc, off, H + 0.6);
        g.moveTo(p0.x, p0.y);
        g.lineTo(p1.x, p1.y);
        g.strokeColor = C.ink;
        g.lineWidth = 3.6;
        g.stroke();
        g.moveTo(p0.x, p0.y);
        g.lineTo(p1.x, p1.y);
        g.strokeColor = C.slateDark;
        g.lineWidth = 2;
        g.stroke();
    }

    // team stripe down the spine of the hull
    const s0 = body.proj(-L * 0.3, -W * 0.16, H + 0.5);
    const s1 = body.proj(L * 0.16, -W * 0.16, H + 0.5);
    g.moveTo(s0.x, s0.y);
    g.lineTo(s1.x, s1.y);
    g.strokeColor = tc;
    g.lineWidth = 2.6;
    g.stroke();

    // headlight marks the hull heading
    const hl = body.proj(L * 0.42, 0, H + 1.2);
    g.circle(hl.x, hl.y, 1.6);
    g.fillColor = C.amber;
    g.fill();
}

/**
 * Turret only — drawn live on top of the hull sprite every frame. It is two
 * primitives, so keeping it out of the bake cache is cheaper than exploding the
 * cache to (facing x frame x turretFacing).
 */
export function drawTurret(
    g: Pen, def: UnitDef, faction: Faction, tc: Color, gc: Color,
    turretDir8: number,
) {
    const heavy = def.armor === 'heavy';
    const L = heavy ? 33 : 28;
    const H = heavy ? 12 : 9.5;
    // The roof is at +H in the same space the baked hull uses (y up). This was
    // negative, a leftover from when the baked frame was still flipped, which
    // parked every turret under the hull instead of on top of it.
    const c = { x: 0, y: H - 0.5 };
    const ta = (facingDeg(turretDir8) * Math.PI) / 180;
    const tdx = Math.cos(ta), tdy = Math.sin(ta);
    const bx = (tdx - tdy) * ISO_SX;
    const by = (tdx + tdy) * ISO_SY;

    if (def.id === 'mortar' || def.id === 'squall') {
        g.ellipse(c.x, c.y, 8, 5);
        g.fillColor = C.slateLight;
        g.fill();
        g.strokeColor = C.slateDark;
        g.lineWidth = 1;
        g.stroke();
        for (let i = -1; i <= 1; i++) {
            const nxp = -by * i * 2.6;
            const nyp = bx * i * 2.6;
            g.moveTo(c.x + bx * 3 + nxp, c.y + by * 3 + nyp);
            g.lineTo(c.x + bx * L * 0.5 + nxp, c.y + by * L * 0.5 + nyp);
            g.strokeColor = C.slateDark;
            g.lineWidth = 2;
            g.stroke();
        }
        return;
    }

    g.ellipse(c.x, c.y, heavy ? 7.5 : 6, heavy ? 4.8 : 4);
    g.fillColor = C.slateLight;
    g.fill();
    g.strokeColor = C.slateDark;
    g.lineWidth = 1.1;
    g.stroke();

    const len = L * 0.66;
    g.moveTo(c.x + bx * 2, c.y + by * 2);
    g.lineTo(c.x + bx * len, c.y + by * len);
    g.strokeColor = C.slateDark;
    g.lineWidth = 3.8;
    g.stroke();
    g.moveTo(c.x + bx * 3, c.y + by * 3);
    g.lineTo(c.x + bx * (len - 1.5), c.y + by * (len - 1.5));
    g.strokeColor = C.slateLight;
    g.lineWidth = 1.5;
    g.stroke();
    g.circle(c.x + bx * len, c.y + by * len, 1.9);
    g.fillColor = gc;
    g.fill();
}

function drawHarvester(g: Pen, def: UnitDef, faction: Faction, tc: Color, gc: Color, dir8: number, frame: number) {
    const w = 34, h = 22;
    shadowEllipse(g, w * 0.6, h * 0.52, 3, -4, 58);
    // wheels
    rr(g, -w / 2, -h / 2 - 2, w * 0.22, 5, 2, C.slateDark);
    rr(g, w * 0.12, -h / 2 - 2, w * 0.22, 5, 2, C.slateDark);
    rr(g, -w / 2, h / 2 - 3, w * 0.22, 5, 2, C.slateDark);
    rr(g, w * 0.12, h / 2 - 3, w * 0.22, 5, 2, C.slateDark);
    // chassis
    rr(g, -w / 2 + 2, -h / 2, w - 4, h, 3, C.slate, C.slateLight, 1.2);
    // cargo bin (crystal hold)
    rr(g, -w * 0.28, -h * 0.3, w * 0.42, h * 0.6, 2, C.slateDark);
    for (let i = 0; i < 3; i++) {
        circle(g, -w * 0.22 + i * 5, -3 + (i % 2) * 5, 2.2, HEX(PAL.cyan, 210));
    }
    // intake scoop at the front
    poly(g, [[w / 2 - 2, -h / 2 + 2], [w / 2 + 6, -h / 2 + 6], [w / 2 + 6, h / 2 - 6], [w / 2 - 2, h / 2 - 2]],
        C.slateLight, C.slateDark, 1);
    neon(g, w / 2 + 4, -h / 2 + 7, w / 2 + 4, h / 2 - 7, gc, 1.4);
    // cab
    rr(g, -w / 2 + 4, h * 0.08, 8, h * 0.32, 2, teamDim(faction));
}

function drawAircraft(g: Pen, def: UnitDef, faction: Faction, tc: Color, gc: Color) {
    const s = def.radius / 12;
    shadowEllipse(g, 16 * s, 7 * s, 4, -14, 38);
    // wings
    poly(g, [[-2 * s, 0], [6 * s, -16 * s], [10 * s, -16 * s], [8 * s, 0]], C.slateLight, C.slateDark, 1);
    poly(g, [[-2 * s, 0], [6 * s, 16 * s], [10 * s, 16 * s], [8 * s, 0]], C.slateLight, C.slateDark, 1);
    // fuselage
    poly(g, [[18 * s, 0], [6 * s, -5 * s], [-12 * s, -5 * s], [-14 * s, 0], [-12 * s, 5 * s], [6 * s, 5 * s]],
        C.slate, C.slateLight, 1.2);
    // cockpit
    circle(g, 9 * s, 0, 3.2 * s, HEX(PAL.cyan, 230));
    // tail
    poly(g, [[-12 * s, 0], [-16 * s, -7 * s], [-9 * s, 0], [-16 * s, 7 * s]], C.slateLight, null);
    // team accents
    line(g, 4 * s, -13 * s, 9 * s, -13 * s, tc, 2);
    line(g, 4 * s, 13 * s, 9 * s, 13 * s, tc, 2);
    neon(g, -8 * s, 0, 14 * s, 0, gc, 1.4);
    // rotor hint
    if (def.id === 'warden' || def.id === 'gnat') {
        g.ellipse(0, 0, 15 * s, 15 * s);
        g.strokeColor = new Color(gc.r, gc.g, gc.b, 70);
        g.lineWidth = 1;
        g.stroke();
    }
}

/* ================================================================== */
/* BUILDINGS                                                          */
/* ================================================================== */
/**
 * Structures are isometric boxes, not flat plates.
 *
 * A building occupies `size` x `size` cells, so on screen it covers a diamond of
 * half-width `size*13` and half-height `size*6.5` (2:1 iso). The roof carries the
 * type-specific silhouette; the two walls facing the camera give it volume.
 * The old flat-plate drawing read as a sticker lying on a sloped floor.
 */
export function drawBuilding(
    g: Pen, def: BuildingDef, faction: Faction, progress = 1, damaged = false,
) {
    g.clear();
    const tc = team(faction);
    const gc = glow(faction);
    const size = Math.max(1, def.size);
    const hw = size * 13;
    const hh = hw * 0.5;
    const p = Math.max(0.04, Math.min(1, progress));
    const fullH = (def.isCore ? 22 : 11) + size * 3;
    const H = fullH * p;

    // footprint: contact shadow over a levelled concrete pad
    g.ellipse(0, -hh * 0.22, hw * 1.08, hh * 1.08);
    g.fillColor = new Color(0, 0, 0, 62);
    g.fill();
    g.ellipse(0, -hh * 0.1, hw * 0.98, hh * 0.98);
    g.fillColor = HEX(PAL.sandShadow, 120);
    g.fill();

    // the two walls the camera can see
    const wall = (ax: number, shade: Color) => {
        g.moveTo(ax, H);
        g.lineTo(0, -hh + H);
        g.lineTo(0, -hh);
        g.lineTo(ax, 0);
        g.close();
        g.fillColor = shade;
        g.fill();
    };
    wall(-hw, damaged ? new Color(44, 41, 38, 255) : new Color(58, 66, 80, 255));
    wall(hw, damaged ? new Color(24, 22, 21, 255) : new Color(31, 36, 44, 255));

    // roof diamond
    g.moveTo(0, hh + H);
    g.lineTo(hw, H);
    g.lineTo(0, -hh + H);
    g.lineTo(-hw, H);
    g.close();
    g.fillColor = damaged ? new Color(56, 54, 52, 255) : new Color(76, 85, 99, 255);
    g.fill();
    g.strokeColor = damaged ? new Color(84, 78, 72, 255) : new Color(112, 124, 145, 255);
    g.lineWidth = 1.5;
    g.stroke();

    // wall detailing: a lit band low on the wall reads as a doorway strip
    g.moveTo(-hw * 0.62, -hh * 0.58);
    g.lineTo(0, -hh * 1.02);
    g.strokeColor = HEX(PAL.slateLight, 150);
    g.lineWidth = 2;
    g.stroke();

    const cx = 0;
    const cy = H;
    const rx = hw;
    const ry = hh;

    switch (def.id) {
        case 'core':
        case 'nest': {
            g.ellipse(cx, cy, rx * 0.52, ry * 0.52);
            g.fillColor = C.slateLight;
            g.fill();
            g.ellipse(cx, cy, rx * 0.52, ry * 0.52);
            g.strokeColor = HEX(PAL.cyan, 210);
            g.lineWidth = 2;
            g.stroke();
            g.ellipse(cx, cy, rx * 0.27, ry * 0.27);
            g.fillColor = HEX(PAL.cyanDim, 255);
            g.fill();
            g.ellipse(cx, cy, rx * 0.11, ry * 0.11);
            g.fillColor = HEX(PAL.cyan, 255);
            g.fill();
            // antenna mast
            g.moveTo(cx, cy + ry * 0.5);
            g.lineTo(cx, cy + ry * 1.15);
            g.strokeColor = C.slateLight;
            g.lineWidth = 2;
            g.stroke();
            circle(g, cx, cy + ry * 1.15, 2.4, HEX(PAL.cyan, 230));
            break;
        }
        case 'furnace':
        case 'sunwell': {
            // two tilted solar/plasma panels
            for (const sgn of [-1, 1]) {
                g.moveTo(cx + sgn * rx * 0.12, cy + ry * 0.34);
                g.lineTo(cx + sgn * rx * 0.56, cy + ry * 0.06);
                g.lineTo(cx + sgn * rx * 0.5, cy - ry * 0.2);
                g.lineTo(cx + sgn * rx * 0.08, cy + ry * 0.06);
                g.close();
                g.fillColor = HEX(PAL.cyanDim, 235);
                g.fill();
                g.strokeColor = HEX(PAL.cyan, 190);
                g.lineWidth = 1.2;
                g.stroke();
            }
            g.ellipse(cx, cy - ry * 0.32, rx * 0.2, ry * 0.2);
            g.fillColor = glowColorOf(gc);
            g.fill();
            break;
        }
        case 'sluice':
        case 'market': {
            // storage drums + a stack
            for (let i = -1; i <= 1; i++) {
                g.ellipse(cx + i * rx * 0.28, cy + ry * 0.12, rx * 0.15, ry * 0.3);
                g.fillColor = C.slateLight;
                g.fill();
                g.ellipse(cx + i * rx * 0.28, cy + ry * 0.12, rx * 0.15, ry * 0.3);
                g.strokeColor = HEX(PAL.cyan, 120);
                g.lineWidth = 1;
                g.stroke();
            }
            g.moveTo(cx - rx * 0.66, cy + ry * 0.1);
            g.lineTo(cx - rx * 0.66, cy + ry * 0.62);
            g.strokeColor = C.slateDark;
            g.lineWidth = 5;
            g.stroke();
            break;
        }
        case 'barracks':
        case 'tent': {
            // ridged roof + door
            for (let i = -1; i <= 1; i++) {
                g.moveTo(cx + i * rx * 0.22 - rx * 0.1, cy + ry * 0.42);
                g.lineTo(cx + i * rx * 0.22 + rx * 0.1, cy + ry * 0.42);
                g.strokeColor = HEX(PAL.slateLight, 200);
                g.lineWidth = 2.4;
                g.stroke();
            }
            rr(g, cx - rx * 0.18, cy - ry * 0.42, rx * 0.36, ry * 0.34, 1.5, C.slateDark);
            break;
        }
        case 'foundry':
        case 'workshop': {
            // roller door + gantry
            for (let i = 0; i < 3; i++) {
                g.moveTo(cx - rx * 0.5, cy - ry * 0.06 + i * ry * 0.14);
                g.lineTo(cx + rx * 0.34, cy - ry * 0.06 + i * ry * 0.14);
                g.strokeColor = HEX(PAL.slateLight, 170);
                g.lineWidth = 1.6;
                g.stroke();
            }
            g.moveTo(cx + rx * 0.1, cy + ry * 0.2);
            g.lineTo(cx + rx * 0.1, cy + ry * 0.62);
            g.lineTo(cx + rx * 0.44, cy + ry * 0.62);
            g.strokeColor = C.slateDark;
            g.lineWidth = 2.6;
            g.stroke();
            break;
        }
        case 'airpad':
        case 'strip': {
            // landing ring
            g.ellipse(cx, cy, rx * 0.46, ry * 0.46);
            g.strokeColor = HEX(PAL.cyan, 190);
            g.lineWidth = 2;
            g.stroke();
            g.moveTo(cx - rx * 0.1, cy + ry * 0.16);
            g.lineTo(cx + rx * 0.1, cy + ry * 0.16);
            g.lineTo(cx + rx * 0.1, cy - ry * 0.16);
            g.lineTo(cx + rx * 0.2, cy - ry * 0.16);
            g.moveTo(cx - rx * 0.1, cy + ry * 0.16);
            g.lineTo(cx - rx * 0.24, cy + ry * 0.16);
            g.moveTo(cx - rx * 0.1, cy - ry * 0.16);
            g.lineTo(cx - rx * 0.24, cy - ry * 0.16);
            g.strokeColor = HEX(PAL.cyan, 150);
            g.lineWidth = 1.8;
            g.stroke();
            break;
        }
        case 'turret':
        case 'spike': {
            g.ellipse(cx, cy, rx * 0.3, ry * 0.3);
            g.fillColor = C.slateLight;
            g.fill();
            g.strokeColor = C.slateDark;
            g.lineWidth = 1.2;
            g.stroke();
            g.moveTo(cx, cy);
            g.lineTo(cx, cy + ry * 0.9);
            g.strokeColor = C.slateDark;
            g.lineWidth = 4;
            g.stroke();
            g.moveTo(cx, cy);
            g.lineTo(cx, cy + ry * 0.85);
            g.strokeColor = C.slateLight;
            g.lineWidth = 1.8;
            g.stroke();
            circle(g, cx, cy, 2, gc);
            break;
        }
        case 'archive':
        case 'vault': {
            g.ellipse(cx, cy, rx * 0.4, ry * 0.4);
            g.fillColor = C.slateLight;
            g.fill();
            g.strokeColor = HEX(PAL.amber, 190);
            g.lineWidth = 1.6;
            g.stroke();
            for (let i = -1; i <= 1; i++) {
                circle(g, cx + i * rx * 0.22, cy, 2, HEX(PAL.amber, 220));
            }
            break;
        }
        default: {
            // dome + dish for the superweapons and anything unclassified
            g.ellipse(cx, cy, rx * 0.44, ry * 0.44);
            g.fillColor = C.slateLight;
            g.fill();
            g.ellipse(cx, cy, rx * 0.44, ry * 0.44);
            g.strokeColor = HEX(PAL.violet, 190);
            g.lineWidth = 1.8;
            g.stroke();
            g.ellipse(cx, cy, rx * 0.18, ry * 0.18);
            g.fillColor = HEX(PAL.violet, 210);
            g.fill();
            g.moveTo(cx, cy + ry * 0.4);
            g.lineTo(cx, cy + ry * 1.0);
            g.strokeColor = C.slateLight;
            g.lineWidth = 1.6;
            g.stroke();
            break;
        }
    }

    if (damaged) {
        // scorched patches and structural cracks: the silhouette has to change,
        // a health bar alone does not read at this zoom level
        for (let i = 0; i < 3; i++) {
            const ox = (i - 1) * rx * 0.32;
            g.ellipse(cx + ox, cy + ry * (0.05 + (i % 2) * 0.28), rx * 0.19, ry * 0.24);
            g.fillColor = new Color(18, 16, 14, i === 1 ? 190 : 130);
            g.fill();
        }
        g.moveTo(cx - rx * 0.62, cy + ry * 0.34);
        g.lineTo(cx - rx * 0.22, cy + ry * 0.02);
        g.lineTo(cx - rx * 0.3, cy - ry * 0.26);
        g.lineTo(cx + rx * 0.08, cy - ry * 0.52);
        g.moveTo(cx - rx * 0.22, cy + ry * 0.02);
        g.lineTo(cx + rx * 0.24, cy + ry * 0.18);
        g.moveTo(cx + rx * 0.3, cy + ry * 0.46);
        g.lineTo(cx + rx * 0.52, cy + ry * 0.1);
        g.strokeColor = new Color(14, 12, 11, 220);
        g.lineWidth = 1.7;
        g.stroke();
    }

    // team marking on the roof edge nearest the camera
    g.moveTo(cx - rx * 0.34, cy - ry * 0.72);
    g.lineTo(cx + rx * 0.34, cy - ry * 0.72);
    g.strokeColor = tc;
    g.lineWidth = 3;
    g.stroke();

    if (progress < 1) {
        // scaffolding while under construction
        g.strokeColor = new Color(C.amber.r, C.amber.g, C.amber.b, 180);
        g.lineWidth = 1.4;
        for (let i = -1; i <= 1; i++) {
            g.moveTo(i * rx * 0.5, -hh);
            g.lineTo(i * rx * 0.5, hh + H * 0.4);
        }
        g.stroke();
    }
}

/** keeps the glow readable on the roof without importing extra helpers */
function glowColorOf(c: Color) {
    return new Color(c.r, c.g, c.b, 210);
}

function buildCore(g: Pen, half: number, h: number, tc: Color, gc: Color, faction: Faction, organic: boolean) {
    const R = half * 0.74;
    // main keep (chamfered octagon)
    poly(g, [
        [-R, -half * 0.56], [R, -half * 0.56], [R, half * 0.34],
        [R * 0.62, half * 0.58], [-R * 0.62, half * 0.58], [-R, half * 0.34],
    ], C.slate, C.slateLight, 1.6);
    // raised roof plate
    poly(g, [
        [-R * 0.86, -half * 0.4], [R * 0.86, -half * 0.4], [R * 0.86, half * 0.26],
        [R * 0.5, half * 0.46], [-R * 0.5, half * 0.46], [-R * 0.86, half * 0.26],
    ], C.slateLight, null);

    // central command dome
    circle(g, 0, h * 0.5, R * 0.4, C.slate, null);
    circle(g, 0, h * 0.5, R * 0.4, null, hexA(gc, 120), 1.4);
    circle(g, 0, h * 0.5, R * 0.22, organic ? HEX(PAL.dsDim) : C.cyanDim, null);
    circle(g, 0, h * 0.5, R * 0.1, hexA(gc, 210), null);

    // neon corner braces (the signature look from the reference sheet)
    const bx = R * 0.92;
    const by = half * 0.46;
    const L = R * 0.5;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = sx * bx, y = sy * by;
        neon(g, x, y, x - sx * L, y, gc, 2.2);
        neon(g, x, y, x, y - sy * L * 0.7, gc, 2.2);
    }

    // side wings
    rr(g, -R * 1.18, -half * 0.2, R * 0.36, half * 0.5, 3, C.slate, C.slateLight, 1);
    rr(g, R * 0.82, -half * 0.2, R * 0.36, half * 0.5, 3, C.slate, C.slateLight, 1);
    neon(g, -R * 1.14, -half * 0.17, -R * 0.86, -half * 0.17, gc, 1.8);
    neon(g, R * 0.86, -half * 0.17, R * 1.14, -half * 0.17, gc, 1.8);

    // vents along the south face
    for (let i = 0; i < 3; i++) {
        line(g, -18 + i * 18, -half * 0.52, -18 + i * 18, -half * 0.34, HEX(PAL.slateDark, 210), 3.4);
    }

    // command mast
    line(g, 0, half * 0.46, 0, half * 0.86, C.slateDark, 2.6);
    circle(g, 0, half * 0.88, 2.6, tc);
    line(g, 0, half * 0.78, 10, half * 0.7, C.slateDark, 1.4);
}

function buildPower(g: Pen, half: number, h: number, tc: Color, gc: Color, solar: boolean) {
    if (solar) {
        // solar array: angled panels
        for (let i = 0; i < 3; i++) {
            poly(g, [
                [-half * 0.8, -half * 0.55 + i * half * 0.5],
                [half * 0.5, -half * 0.7 + i * half * 0.5],
                [half * 0.72, -half * 0.3 + i * half * 0.5],
                [-half * 0.6, -half * 0.16 + i * half * 0.5],
            ], HEX(PAL.slate, 255), HEX(PAL.violet, 150), 1);
        }
        neon(g, -half * 0.7, -half * 0.46, half * 0.66, -half * 0.2, gc, 1.6);
    } else {
        // furnace: boiler tanks + chimney
        circle(g, -half * 0.34, -half * 0.1, half * 0.36, C.slate, C.slateLight, 1.4);
        circle(g, -half * 0.34, -half * 0.1, half * 0.16, HEX(PAL.amber, 170));
        rr(g, half * 0.05, -half * 0.5, half * 0.5, half * 0.78, 4, C.slate, C.slateLight, 1.2);
        // chimney
        rr(g, half * 0.18, half * 0.2, half * 0.24, half * 0.5, 3, C.slateDark);
        circle(g, half * 0.3, half * 0.68, half * 0.12, HEX(PAL.ink, 190));
        // hot pipe
        g.moveTo(-half * 0.34, half * 0.26);
        g.bezierCurveTo(0, half * 0.5, half * 0.1, half * 0.34, half * 0.3, half * 0.32);
        g.strokeColor = HEX(PAL.amber, 190); g.lineWidth = 3; g.stroke();
        neon(g, half * 0.12, -half * 0.4, half * 0.12, half * 0.1, gc, 1.6);
    }
}

function buildRefinery(g: Pen, half: number, h: number, tc: Color, gc: Color, blackMarket: boolean) {
    // silos
    circle(g, -half * 0.45, half * 0.15, half * 0.3, C.slate, C.slateLight, 1.4);
    circle(g, -half * 0.45, half * 0.15, half * 0.16, HEX(PAL.sandDark, 220));
    circle(g, half * 0.1, -half * 0.35, half * 0.26, C.slate, C.slateLight, 1.4);
    // conveyor
    poly(g, [[-half * 0.2, -half * 0.55], [half * 0.7, -half * 0.2], [half * 0.7, -half * 0.02], [-half * 0.2, -half * 0.34]],
        C.slateLight, C.slateDark, 1);
    for (let i = 0; i < 5; i++) {
        const t = i / 5;
        circle(g, -half * 0.2 + t * half * 0.85, -half * 0.48 + t * half * 0.3, 2.4, HEX(PAL.cyan, 200));
    }
    // office block
    rr(g, half * 0.12, half * 0.05, half * 0.55, half * 0.5, 4, C.slate, C.slateLight, 1.2);
    neon(g, half * 0.16, half * 0.12, half * 0.62, half * 0.12, gc, 1.6);
    if (blackMarket) {
        // awnings
        for (let i = 0; i < 3; i++) {
            poly(g, [[-half * 0.7 + i * 22, -half * 0.8], [-half * 0.55 + i * 22, -half * 0.8], [-half * 0.5 + i * 22, -half * 0.7], [-half * 0.75 + i * 22, -half * 0.7]],
                HEX(PAL.violet, 200));
        }
    }
}

function buildBarracks(g: Pen, half: number, h: number, tc: Color, gc: Color, tent: boolean) {
    if (tent) {
        poly(g, [[-half * 0.8, -half * 0.5], [0, half * 0.55], [half * 0.8, -half * 0.5]], C.sandDark, C.slateDark, 1.4);
        line(g, 0, half * 0.55, 0, -half * 0.5, HEX(PAL.sandShadow), 2);
        poly(g, [[-half * 0.22, -half * 0.5], [0, half * 0.1], [half * 0.22, -half * 0.5]], HEX(PAL.ink, 200));
    } else {
        rr(g, -half * 0.78, -half * 0.6, half * 1.56, half * 1.0, 5, C.slate, C.slateLight, 1.4);
        // roof ribs
        for (let i = -2; i <= 2; i++) {
            line(g, i * half * 0.3, half * 0.4, i * half * 0.3, -half * 0.6, HEX(PAL.slateLight, 150), 1.5);
        }
        // door
        rr(g, -half * 0.22, -half * 0.62, half * 0.44, half * 0.3, 2, HEX(PAL.ink, 220), C.slateLight, 1);
        neon(g, -half * 0.22, -half * 0.34, half * 0.22, -half * 0.34, gc, 1.6);
    }
    // flag pole
    line(g, half * 0.62, -half * 0.5, half * 0.62, half * 0.6, C.slateDark, 2);
    poly(g, [[half * 0.62, half * 0.6], [half * 0.95, half * 0.48], [half * 0.62, half * 0.36]], tc);
}

function buildFactory(g: Pen, half: number, h: number, tc: Color, gc: Color, workshop: boolean) {
    rr(g, -half * 0.85, -half * 0.15, half * 1.7, half * 0.75, 5, C.slate, C.slateLight, 1.4);
    // hangar door
    rr(g, -half * 0.45, -half * 0.62, half * 0.9, half * 0.5, 3, HEX(PAL.ink, 230), C.slateLight, 1);
    for (let i = -2; i <= 2; i++) {
        line(g, i * half * 0.17, -half * 0.6, i * half * 0.17, -half * 0.15, HEX(PAL.slateLight, 120), 1);
    }
    neon(g, -half * 0.45, -half * 0.14, half * 0.45, -half * 0.14, gc, 2);
    // crane / roof gear
    if (workshop) {
        poly(g, [[-half * 0.9, half * 0.5], [half * 0.2, half * 0.5], [half * 0.2, half * 0.62], [-half * 0.9, half * 0.62]], C.slateDark);
        line(g, half * 0.1, half * 0.6, half * 0.1, half * 0.95, C.slateDark, 2.5);
        circle(g, half * 0.1, half * 0.95, 3, HEX(PAL.violet, 220));
    } else {
        rr(g, -half * 0.3, half * 0.45, half * 0.6, half * 0.3, 3, C.slateDark);
        circle(g, 0, half * 0.6, half * 0.12, HEX(PAL.amber, 220));
        for (let i = 0; i < 3; i++) line(g, -half * 0.7 + i * 14, half * 0.35, -half * 0.7 + i * 14, half * 0.5, C.slateDark, 4);
    }
}

function buildAirpad(g: Pen, half: number, h: number, tc: Color, gc: Color) {
    rr(g, -half * 0.9, -half * 0.9, half * 1.8, half * 1.8, 6, C.slateDark, C.slateLight, 1.2);
    // landing circle
    g.ellipse(0, 0, half * 0.55, half * 0.55);
    g.strokeColor = HEX(PAL.cyan, 120); g.lineWidth = 6; g.stroke();
    g.ellipse(0, 0, half * 0.55, half * 0.55);
    g.strokeColor = HEX(PAL.cyan, 230); g.lineWidth = 2; g.stroke();
    // H mark
    line(g, -half * 0.18, -half * 0.28, -half * 0.18, half * 0.28, HEX(PAL.cyan, 200), 3);
    line(g, half * 0.18, -half * 0.28, half * 0.18, half * 0.28, HEX(PAL.cyan, 200), 3);
    line(g, -half * 0.18, 0, half * 0.18, 0, HEX(PAL.cyan, 200), 3);
    // corner stripes
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        line(g, sx * half * 0.82, sy * half * 0.82, sx * half * 0.55, sy * half * 0.82, tc, 4);
        line(g, sx * half * 0.82, sy * half * 0.82, sx * half * 0.82, sy * half * 0.55, tc, 4);
    }
}

function buildTurret(g: Pen, half: number, h: number, tc: Color, gc: Color, spike: boolean) {
    circle(g, 0, 4, half * 0.62, C.slate, C.slateLight, 1.4);
    circle(g, 0, 4, half * 0.34, C.slateLight);
    if (spike) {
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            line(g, Math.cos(a) * half * 0.4, 4 + Math.sin(a) * half * 0.4,
                Math.cos(a) * half * 0.85, 4 + Math.sin(a) * half * 0.85, HEX(PAL.violet, 200), 2);
        }
    } else {
        rr(g, -4, 2, 20, 6, 2.4, C.slateDark, C.slateLight, 1);
        line(g, 14, 5, 24, 5, C.slateLight, 3);
    }
    circle(g, 0, 4, half * 0.16, gc);
    neon(g, -half * 0.5, -half * 0.44, half * 0.5, -half * 0.44, gc, 1.6);
    circle(g, 0, 4 + half * 0.5, 2, tc);
}

function buildTech(g: Pen, half: number, h: number, tc: Color, gc: Color, vault: boolean) {
    // dome observatory
    circle(g, 0, half * 0.1, half * 0.5, C.slate, C.slateLight, 1.4);
    g.ellipse(0, half * 0.1, half * 0.5, half * 0.5);
    g.strokeColor = new Color(gc.r, gc.g, gc.b, 60); g.lineWidth = 8; g.stroke();
    g.ellipse(0, half * 0.1, half * 0.5, half * 0.5);
    g.strokeColor = gc; g.lineWidth = 1.6; g.stroke();
    // antenna dishes
    for (let i = 0; i < (vault ? 2 : 3); i++) {
        const x = -half * 0.5 + i * half * 0.5;
        line(g, x, -half * 0.1, x, -half * 0.6, C.slateDark, 2);
        g.ellipse(x, -half * 0.62, 7, 3.5);
        g.strokeColor = HEX(PAL.slateLight); g.lineWidth = 1.6; g.stroke();
        circle(g, x, -half * 0.62, 1.6, tc);
    }
    rr(g, -half * 0.75, -half * 0.85, half * 1.5, half * 0.26, 3, C.slateDark, C.slateLight, 1);
    neon(g, -half * 0.7, -half * 0.72, half * 0.7, -half * 0.72, gc, 1.6);
}

/* ---------------- super weapon structures ---------------- */
function buildOrbital(g: Pen, half: number, tc: Color, gc: Color) {
    // ground ring
    g.ellipse(0, -half * 0.1, half * 0.8, half * 0.34);
    g.strokeColor = new Color(gc.r, gc.g, gc.b, 110);
    g.lineWidth = 2;
    g.stroke();
    // central emitter tower
    poly(g, [[-half * 0.2, -half * 0.5], [half * 0.2, -half * 0.5], [half * 0.12, half * 0.4], [-half * 0.12, half * 0.4]],
        C.slate, C.slateLight, 1.4);
    circle(g, 0, half * 0.46, half * 0.16, C.slateLight, gc, 1.4);
    circle(g, 0, half * 0.46, half * 0.07, hexA(gc, 210));
    // three receiving dishes
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const x = Math.cos(a) * half * 0.55;
        const y = Math.sin(a) * half * 0.3 - half * 0.05;
        g.ellipse(x, y, 10, 5);
        g.fillColor = C.slateLight;
        g.fill();
        g.strokeColor = HEX(PAL.cyan, 160);
        g.lineWidth = 1.2;
        g.stroke();
        line(g, x, y, x * 1.15, y + 8, C.slateDark, 1.6);
        circle(g, x, y, 1.6, tc);
    }
    // uplink beam
    neon(g, 0, half * 0.55, 0, half * 0.95, gc, 2.4);
}

function buildAegis(g: Pen, half: number, tc: Color, gc: Color) {
    poly(g, [[0, half * 0.72], [half * 0.42, half * 0.2], [half * 0.3, -half * 0.55],
        [0, -half * 0.72], [-half * 0.3, -half * 0.55], [-half * 0.42, half * 0.2]],
        C.slate, C.slateLight, 1.6);
    for (let i = 1; i <= 2; i++) {
        g.ellipse(0, 0, half * 0.22 * i, half * 0.22 * i);
        g.strokeColor = hexA(gc, 150 - i * 30);
        g.lineWidth = 1.6;
        g.stroke();
    }
    circle(g, 0, 0, half * 0.1, hexA(gc, 220));
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        neon(g, Math.cos(a) * half * 0.3, Math.sin(a) * half * 0.3,
            Math.cos(a) * half * 0.48, Math.sin(a) * half * 0.48, gc, 1.6);
    }
    rr(g, -half * 0.5, -half * 0.8, half, 6, 2, tc);
}

function buildStorm(g: Pen, half: number, tc: Color, gc: Color) {
    // funnel tower
    poly(g, [[-half * 0.34, -half * 0.62], [half * 0.34, -half * 0.62],
        [half * 0.16, half * 0.62], [-half * 0.16, half * 0.62]], C.slate, C.slateLight, 1.4);
    for (let i = 0; i < 4; i++) {
        const y = -half * 0.5 + i * half * 0.36;
        const w = half * (0.3 - i * 0.05);
        g.moveTo(-w, y);
        g.quadraticCurveTo(0, y + 10, w, y + 3);
        g.strokeColor = hexA(gc, 190 - i * 30);
        g.lineWidth = 2.2;
        g.stroke();
    }
    // vortex ring at the top
    g.ellipse(0, half * 0.66, half * 0.4, half * 0.14);
    g.strokeColor = HEX(PAL.violet, 200);
    g.lineWidth = 2.4;
    g.stroke();
    g.ellipse(0, half * 0.66, half * 0.24, half * 0.08);
    g.strokeColor = HEX(PAL.violet, 120);
    g.lineWidth = 1.6;
    g.stroke();
    rr(g, -half * 0.55, -half * 0.78, half * 1.1, 7, 2, tc);
}

function buildMirage(g: Pen, half: number, tc: Color, gc: Color) {
    // prism crystal on a ring base
    poly(g, [[0, half * 0.8], [half * 0.34, half * 0.1], [half * 0.18, -half * 0.62],
        [-half * 0.18, -half * 0.62], [-half * 0.34, half * 0.1]], hexA(gc, 60), gc, 1.6);
    poly(g, [[0, half * 0.8], [half * 0.1, half * 0.05], [0, -half * 0.5], [-half * 0.1, half * 0.05]],
        hexA(gc, 120), null);
    g.ellipse(0, -half * 0.55, half * 0.6, half * 0.2);
    g.strokeColor = hexA(gc, 140);
    g.lineWidth = 2;
    g.stroke();
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        line(g, Math.cos(a) * half * 0.5, -half * 0.55 + Math.sin(a) * half * 0.14,
            Math.cos(a) * half * 0.5, -half * 0.7 + Math.sin(a) * half * 0.14, C.slateDark, 2);
        circle(g, Math.cos(a) * half * 0.5, -half * 0.7 + Math.sin(a) * half * 0.14, 1.8, tc);
    }
}

/* ---------------- overlays ---------------- */

/** veteran chevrons drawn above a unit: one for veteran, two for elite */
export function drawChevron(g: Pen, level: number, y: number, color: Color) {
    if (level <= 0) return;
    for (let i = 0; i < level; i++) {
        const yy = y + i * 4.5;
        g.moveTo(-5, yy);
        g.lineTo(0, yy + 3.6);
        g.lineTo(5, yy);
        g.strokeColor = color;
        g.lineWidth = 1.8;
        g.stroke();
    }
}

/** supply crate pickup */
export function drawPickup(g: Pen, kind: 'credits' | 'repair' | 'promote', bob: number) {
    g.clear();
    const y = Math.sin(bob * 2.4) * 2;
    g.ellipse(2, -8, 15, 5);
    g.fillColor = new Color(0, 0, 0, 60);
    g.fill();
    const col = kind === 'credits' ? HEX(PAL.cyan) : kind === 'repair' ? HEX(PAL.green) : HEX(PAL.violet);
    rr(g, -12, y - 9, 24, 18, 3, C.slate, col, 1.6);
    rr(g, -12, y - 2, 24, 5, 1, hexA(col, 200));
    if (kind === 'credits') {
        circle(g, 0, y + 4, 3.6, hexA(col, 230));
    } else if (kind === 'repair') {
        line(g, -5, y + 4, 5, y + 4, col, 2.4);
        line(g, 0, y - 1, 0, y + 9, col, 2.4);
    } else {
        poly(g, [[0, y + 9], [4, y + 2], [0, y - 4], [-4, y + 2]], hexA(col, 230));
    }
}


/* ================================================================== */
/* TERRAIN PROPS                                                      */
/* ================================================================== */
export function drawCrystal(g: Pen, seed: number, ratio: number) {
    g.clear();
    const rng = makeRng(seed);
    const n = 5 + Math.floor(rng() * 3);
    // glowing ground
    g.ellipse(0, -2, 26, 14);
    g.fillColor = new Color(63, 217, 236, 26);
    g.fill();
    for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const rad = rng() * 12;
        const x = Math.cos(a) * rad;
        const y = Math.sin(a) * rad * 0.55 - 2;
        const hgt = (10 + rng() * 18) * (0.5 + ratio * 0.5);
        const w = 3 + rng() * 3;
        poly(g, [[x - w, y], [x - w * 0.4, y + hgt], [x + w * 0.5, y + hgt * 0.86], [x + w, y]],
            HEX(PAL.cyan, 205), HEX('#7ef0ff', 220), 1);
        poly(g, [[x - w * 0.4, y + hgt], [x + w * 0.5, y + hgt * 0.86], [x + w * 0.1, y + hgt * 0.4]],
            HEX('#bff7ff', 170));
    }
    for (let i = 0; i < 4; i++) {
        const a = rng() * Math.PI * 2;
        circle(g, Math.cos(a) * 18, Math.sin(a) * 10 - 2, 1 + rng() * 1.6, HEX(PAL.cyan, 150));
    }
}

export function drawRock(g: Pen, seed: number, scale = 1) {
    const rng = makeRng(seed);
    g.clear();
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
        const x = (rng() - 0.5) * 20 * scale;
        const y = (rng() - 0.5) * 12 * scale;
        const r = (5 + rng() * 7) * scale;
        g.ellipse(x + 2, y - 3, r, r * 0.5);
        g.fillColor = new Color(0, 0, 0, 34); g.fill();
        poly(g, [[x - r, y], [x - r * 0.5, y + r * 0.85], [x + r * 0.6, y + r * 0.7], [x + r, y - r * 0.1]],
            C.rock, C.rockDark, 1);
    }
}

export function drawBush(g: Pen, seed: number, scale = 1) {
    const rng = makeRng(seed);
    g.clear();
    g.ellipse(2, -3, 9 * scale, 3 * scale);
    g.fillColor = new Color(0, 0, 0, 26); g.fill();
    for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (rng() - 0.5) * 1.6;
        const len = (8 + rng() * 10) * scale;
        g.moveTo(0, 0);
        g.bezierCurveTo(Math.cos(a) * len * 0.4, Math.sin(a) * len * 0.6,
            Math.cos(a) * len * 0.7, Math.sin(a) * len * 0.9,
            Math.cos(a) * len, Math.sin(a) * len);
        g.strokeColor = HEX('#6b5335'); g.lineWidth = 1.6 * scale; g.stroke();
    }
}

export function drawCrate(g: Pen, seed: number) {
    const rng = makeRng(seed);
    const w = 16 + rng() * 4, h = 10 + rng() * 3;
    g.ellipse(2, -4, w * 0.7, 4);
    g.fillColor = new Color(0, 0, 0, 34); g.fill();
    rr(g, -w / 2, -h / 2, w, h, 1.5, HEX('#8a6740'), HEX('#5d4529'), 1);
    line(g, -w / 2, 0, w / 2, 0, HEX('#5d4529'), 1);
    line(g, -w / 2, -h / 2, w / 2, h / 2, HEX('#5d4529'), 1);
    rr(g, -w / 2 + 2, -h / 2 + 2, 3, h - 4, 1, HEX('#a8825a'));
}

/* ================================================================== */
/* UI ICONS                                                           */
/* ================================================================== */
/**
 * Icons reuse the world art. cc.Graphics has no transform stack, so the caller
 * scales the host node instead (see ui/UI.ts).
 */
export function drawUnitIcon(g: Pen, def: UnitDef, faction: Faction) {
    drawUnit(g, def, faction);
}

export function drawBuildingIcon(g: Pen, def: BuildingDef, faction: Faction) {
    drawBuilding(g, def, faction, 1);
}


/* ------------------------------------------------------------------ */
/* Graphics -> Pen bridge                                              */
/* ------------------------------------------------------------------ */
const penCache = new WeakMap<Graphics, GfxPen>();

/** reuse one adapter per Graphics instance so per-frame calls allocate nothing */
export function pen(g: Graphics): Pen {
    let p = penCache.get(g);
    if (!p) {
        p = new GfxPen(g);
        penCache.set(g, p);
    }
    return p;
}


/* ------------------------------------------------------------------ */
/* Bake-friendly entry points                                          */
/* ------------------------------------------------------------------ */
/** hull only, with palette colours resolved internally (used by the frame baker) */
export function paintHull(g: Pen, def: UnitDef, faction: Faction, dir8: number, frame: number) {
    drawHull(g, def, faction, team(faction), glow(faction), dir8, frame);
}

/** whole unit in one image, turret aligned with the hull */
export function paintUnit(g: Pen, def: UnitDef, faction: Faction, dir8: number, frame: number) {
    drawUnit(g, def, faction, dir8, frame, dir8);
}

/** turret overlay with palette colours resolved internally */
export function paintTurret(g: Pen, def: UnitDef, faction: Faction, turretDir8: number) {
    drawTurret(g, def, faction, team(faction), glow(faction), turretDir8);
}
