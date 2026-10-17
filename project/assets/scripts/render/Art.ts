/**
 * Procedural vector art.
 * Everything the player sees is drawn at runtime with cc.Graphics — no external
 * textures, so the build stays tiny for WeChat / Douyin mini-game budgets and
 * the whole look is 100% original.
 *
 * Visual language (see docs/ART_STYLE.md):
 *   warm sand ground · dark slate machinery · cyan neon strips · amber accents
 */
import { Color, Graphics } from 'cc';
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
function poly(g: Graphics, pts: number[][], fill?: Color, stroke?: Color, lw = 1.5) {
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.close();
    if (fill) { g.fillColor = fill; g.fill(); }
    if (stroke) { g.strokeColor = stroke; g.lineWidth = lw; g.stroke(); }
}

function rr(g: Graphics, x: number, y: number, w: number, h: number, r: number, fill?: Color, stroke?: Color, lw = 1.5) {
    g.roundRect(x, y, w, h, r);
    if (fill) { g.fillColor = fill; g.fill(); }
    if (stroke) { g.strokeColor = stroke; g.lineWidth = lw; g.stroke(); }
}

function circle(g: Graphics, x: number, y: number, r: number, fill?: Color, stroke?: Color, lw = 1.5) {
    g.circle(x, y, r);
    if (fill) { g.fillColor = fill; g.fill(); }
    if (stroke) { g.strokeColor = stroke; g.lineWidth = lw; g.stroke(); }
}

function line(g: Graphics, x1: number, y1: number, x2: number, y2: number, color: Color, w = 2) {
    g.moveTo(x1, y1); g.lineTo(x2, y2);
    g.strokeColor = color; g.lineWidth = w; g.stroke();
}

/** neon strip: soft halo + bright core */
function neon(g: Graphics, x1: number, y1: number, x2: number, y2: number, col: Color, w = 2) {
    const halo = new Color(col.r, col.g, col.b, 58);
    line(g, x1, y1, x2, y2, halo, w * 4);
    line(g, x1, y1, x2, y2, col, w);
}

function shadowEllipse(g: Graphics, rx: number, ry: number, ox = 3, oy = -4, alpha = 52) {
    g.ellipse(ox, oy, rx, ry);
    g.fillColor = new Color(0, 0, 0, alpha);
    g.fill();
}

/* ================================================================== */
/* UNITS                                                              */
/* ================================================================== */
export function drawUnit(g: Graphics, def: UnitDef, faction: Faction) {
    g.clear();
    const tc = team(faction);
    const gc = glow(faction);

    if (def.kind === 'infantry') {
        drawInfantry(g, def, faction, tc, gc);
        return;
    }
    if (def.kind === 'air') {
        drawAircraft(g, def, faction, tc, gc);
        return;
    }
    if (def.kind === 'harvester') {
        drawHarvester(g, def, faction, tc, gc);
        return;
    }
    if (def.kind === 'mcv') {
        drawMcv(g, def, faction, tc, gc);
        return;
    }
    drawVehicle(g, def, faction, tc, gc);
}

function drawInfantry(g: Graphics, def: UnitDef, faction: Faction, tc: Color, gc: Color) {
    const isRocket = def.id === 'breaker' || def.id === 'stinger';
    const isEngineer = !!def.engineer;
    const isStealth = !!def.cloak;
    shadowEllipse(g, isStealth ? 9 : 10, 4.5, 1, -1, 46);
    // legs
    rr(g, -4, -2, 4, 7, 1.5, C.slateDark);
    rr(g, 1, -2, 4, 7, 1.5, C.slateDark);

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
    // visor
    line(g, 2, 15, 5, 15, isStealth ? HEX(PAL.violet, 220) : gc, 1.8);
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
function drawMcv(g: Graphics, def: UnitDef, faction: Faction, tc: Color, gc: Color) {
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

function drawVehicle(g: Graphics, def: UnitDef, faction: Faction, tc: Color, gc: Color) {
    const heavy = def.armor === 'heavy';
    const w = heavy ? 30 : 26;
    const h = heavy ? 19 : 16;
    shadowEllipse(g, w * 0.62, h * 0.55, 3, -4, 56);

    // treads
    rr(g, -w / 2, -h / 2 - 2.5, w, 5, 2.2, C.slateDark);
    rr(g, -w / 2, h / 2 - 2.5, w, 5, 2.2, C.slateDark);
    for (let i = -2; i <= 2; i++) {
        line(g, i * 5.4, -h / 2 - 2.2, i * 5.4, -h / 2 + 2.2, C.ink, 1.2);
        line(g, i * 5.4, h / 2 - 2.2, i * 5.4, h / 2 + 2.2, C.ink, 1.2);
    }

    // hull
    rr(g, -w / 2 + 1, -h / 2, w - 2, h, 3, C.slate, C.slateLight, 1.2);
    // front wedge
    poly(g, [[w / 2 - 4, -h / 2 + 1], [w / 2 + 2, 0], [w / 2 - 4, h / 2 - 1]], C.slateLight, null);
    // team stripe
    rr(g, -w / 2 + 3, -2, w * 0.42, 4, 1.5, teamDim(faction));
    rr(g, -w / 2 + 3, -1, w * 0.3, 2, 1, tc);
    // turret
    if (def.id === 'mortar' || def.id === 'squall') {
        rr(g, -4, -5, 12, 10, 2, C.slateLight, C.slateDark, 1);
        for (let i = 0; i < 3; i++) {
            line(g, 6, -3 + i * 3, 16, -3 + i * 3, C.slateDark, 2.2);
        }
        neon(g, 12, -4, 12, 4, gc, 1.2);
    } else {
        circle(g, 0, 0, heavy ? 7 : 5.6, C.slateLight, C.slateDark, 1.2);
        rr(g, 2, -1.6, w * 0.5, 3.2, 1.2, C.slateDark, C.slateLight, 0.8);
        line(g, w * 0.32, 0, w * 0.55, 0, C.slateLight, 2.4);
        circle(g, 0, 0, 2, gc);
    }
    // side lights
    circle(g, -w / 2 + 5, h / 2 - 3, 1.2, C.amber);
}

function drawHarvester(g: Graphics, def: UnitDef, faction: Faction, tc: Color, gc: Color) {
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

function drawAircraft(g: Graphics, def: UnitDef, faction: Faction, tc: Color, gc: Color) {
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
export function drawBuilding(g: Graphics, def: BuildingDef, faction: Faction, progress = 1) {
    g.clear();
    const S = def.size * TILE;
    const half = S / 2;
    const tc = team(faction);
    const gc = glow(faction);

    // ground plate / concrete pad
    poly(g, [[-half, -half + 6], [half, -half + 6], [half + 4, half - 12], [-half - 4, half - 12]],
        new Color(0, 0, 0, 46), null);
    rr(g, -half + 2, -half + 2, S - 4, S - 4, 6, HEX(PAL.sandShadow, 90));

    const h = Math.max(8, S * 0.12); // fake extrusion height
    const topY = half - 10;

    // body block
    rr(g, -half + 8, -half + 10, S - 16, S - 22, 5, C.slate, null);
    // front face (extrusion)
    poly(g, [[-half + 8, -half + 10], [half - 8, -half + 10], [half - 12, -half + 10 - h], [-half + 12, -half + 10 - h]],
        C.slateDark, null);
    // top plate
    rr(g, -half + 12, -half + 10 + h * 0.2, S - 24, S - 30, 4, C.slateLight, C.slate, 1);

    switch (def.id) {
        case 'core':
        case 'nest': buildCore(g, half, h, tc, gc, faction, def.id === 'nest');
            break;
        case 'furnace':
        case 'sunwell': buildPower(g, half, h, tc, gc, def.id === 'sunwell');
            break;
        case 'sluice':
        case 'market': buildRefinery(g, half, h, tc, gc, def.id === 'market');
            break;
        case 'barracks':
        case 'tent': buildBarracks(g, half, h, tc, gc, def.id === 'tent');
            break;
        case 'foundry':
        case 'workshop': buildFactory(g, half, h, tc, gc, def.id === 'workshop');
            break;
        case 'airpad':
        case 'strip': buildAirpad(g, half, h, tc, gc);
            break;
        case 'turret':
        case 'spike': buildTurret(g, half, h, tc, gc, def.id === 'spike');
            break;
        case 'archive':
        case 'vault': buildTech(g, half, h, tc, gc, def.id === 'vault');
            break;
        case 'orbital': buildOrbital(g, half, tc, gc);
            break;
        case 'aegis': buildAegis(g, half, tc, gc);
            break;
        case 'storm': buildStorm(g, half, tc, gc);
            break;
        case 'mirage': buildMirage(g, half, tc, gc);
            break;
        default: break;
    }

    if (progress < 1) {
        // scaffolding while under construction
        g.strokeColor = new Color(C.amber.r, C.amber.g, C.amber.b, 190);
        g.lineWidth = 1.5;
        for (let i = -1; i <= 1; i++) {
            g.moveTo(-half + 10, i * (half / 3)); g.lineTo(half - 10, i * (half / 3));
        }
        g.stroke();
    }

    // corner lights
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        circle(g, sx * (half - 10), sy * (half - 10), 2.2, HEX(PAL.cyan, 200));
    }
    // team colour marking
    rr(g, -12, -half + 4, 24, 4, 1.5, tc);
}

function buildCore(g: Graphics, half: number, h: number, tc: Color, gc: Color, faction: Faction, organic: boolean) {
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

function buildPower(g: Graphics, half: number, h: number, tc: Color, gc: Color, solar: boolean) {
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

function buildRefinery(g: Graphics, half: number, h: number, tc: Color, gc: Color, blackMarket: boolean) {
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

function buildBarracks(g: Graphics, half: number, h: number, tc: Color, gc: Color, tent: boolean) {
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

function buildFactory(g: Graphics, half: number, h: number, tc: Color, gc: Color, workshop: boolean) {
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

function buildAirpad(g: Graphics, half: number, h: number, tc: Color, gc: Color) {
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

function buildTurret(g: Graphics, half: number, h: number, tc: Color, gc: Color, spike: boolean) {
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

function buildTech(g: Graphics, half: number, h: number, tc: Color, gc: Color, vault: boolean) {
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
function buildOrbital(g: Graphics, half: number, tc: Color, gc: Color) {
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

function buildAegis(g: Graphics, half: number, tc: Color, gc: Color) {
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

function buildStorm(g: Graphics, half: number, tc: Color, gc: Color) {
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

function buildMirage(g: Graphics, half: number, tc: Color, gc: Color) {
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
export function drawChevron(g: Graphics, level: number, y: number, color: Color) {
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
export function drawPickup(g: Graphics, kind: 'credits' | 'repair' | 'promote', bob: number) {
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
export function drawCrystal(g: Graphics, seed: number, ratio: number) {
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

export function drawRock(g: Graphics, seed: number, scale = 1) {
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

export function drawBush(g: Graphics, seed: number, scale = 1) {
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

export function drawCrate(g: Graphics, seed: number) {
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
export function drawUnitIcon(g: Graphics, def: UnitDef, faction: Faction) {
    drawUnit(g, def, faction);
}

export function drawBuildingIcon(g: Graphics, def: BuildingDef, faction: Faction) {
    drawBuilding(g, def, faction, 1);
}
