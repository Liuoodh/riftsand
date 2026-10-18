/**
 * Real-match locomotion probe.
 *
 * Unlike steertest (which clears the map and drives one hull in a straight
 * line), this runs the actual opening state — real base, real ore, real squad —
 * orders the whole group somewhere and samples every unit every tick:
 *
 *   face, faceTarget, the 8-way image index, speed, path left
 *
 * From that it derives the two things the player reports:
 *   - wobble    : 8-way image changes while the unit is not at a corner
 *   - reversals : the heading turning one way and then immediately back
 *
 * It also dumps the path arm directions, so a zig-zag path can be told apart
 * from a steering bug.
 *
 * usage: node tools/walktest.mjs [url]
 */
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');
const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';

const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__riftsandGame != null', { timeout: 60000 });
await page.evaluate(() => window.__riftsandArtReady);

const out = await page.evaluate(() => {
    const g = window.__riftsandGame;
    g.aiEnabled = false;
    const { TILE, HALF } = window.__riftsandConst;
    const w = (tx, ty) => ({ x: tx * TILE + TILE / 2 - HALF, y: ty * TILE + TILE / 2 - HALF });
    const dir8Of = (rad) => Math.round((((rad * 180 / Math.PI) - 45 + 360) % 360) / 360 * 8) % 8;

    /* the real opening army plus a tank squad, like a player who has built some */
    const tanks = [];
    for (let i = 0; i < 6; i++) {
        const p = w(21 + i * 2, 45);
        const u = g.spawnUnit(0, window.__riftsandDefs.UNITS.rampart, p.x, p.y);
        u.order = { k: 'idle' };
        u.face = 0;
        u.turretFace = 0;
        tanks.push(u);
    }
    for (let i = 0; i < 12; i++) g.update(0.05);

    const squad = g.units
        .filter((u) => !u.dead && u.owner === 0 && u.def.kind !== 'air')
        .slice(0, 16);
    const ids = squad.map((u) => u.id);

    /* somewhere far but legal, same way a player would click */
    const dest = w(46, 30);
    for (const u of squad) {
        g.applyOrder(u, { k: 'move', x: dest.x, y: dest.y });
    }
    const orderTarget = squad.map((u) => ({ x: u.order.x, y: u.order.y }));

    const arms = squad.map((u) => {
        const a = [];
        for (let i = 0; i < Math.min(u.path.length, 12); i++) {
            const p0 = i === 0 ? { x: u.x, y: u.y } : u.path[i - 1];
            const p1 = u.path[i];
            a.push(+((Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI).toFixed(1));
        }
        return a;
    });

    const rec = squad.map((u) => ({
        id: u.id, kind: u.def.kind, face: u.face, ft: u.faceTarget,
        dir: dir8Of(u.face), sp: u.speedCur, pathLen: u.path.length,
        turned: 0, flips: 0, reversals: 0,
        /** turns that happened while the demanded heading did NOT change */
        idleTurns: 0, ftChanges: 0,
        /** image changes while driving straight at speed */
        straightFlips: 0,
    }));
    const prevDirSign = squad.map(() => 0);
    const trace = squad.map(() => []);
    // frames left before a freshly demanded heading counts as settled
    const settle = squad.map(() => 0);

    for (let t = 0; t < 900; t++) {          // 45 s
        g.update(0.05);
        for (let k = 0; k < squad.length; k++) {
            const u = squad[k];
            if (u.dead) continue;
            const r = rec[k];
            const d = dir8Of(u.face);
            const delta = u.face - r.face;
            const ftMoved = Math.abs(u.faceTarget - r.ft) > 1e-4;
            if (ftMoved) { r.ftChanges++; settle[k] = 40; }
            if (settle[k] > 0) settle[k]--;
            const deg = Math.abs(delta) * 180 / Math.PI;
            r.turned += deg;
            if (d !== r.dir) {
                r.flips++;
                if (!ftMoved && u.speedCur > 18) r.straightFlips++;
            }
            /*
             * Wobble is turning while the *demanded* heading is standing still:
             * the hull is chasing noise rather than following the route.
             */
            if (!ftMoved && settle[k] === 0 && deg > 0.05) r.idleTurns += deg;
            if (!ftMoved && settle[k] === 0 && deg > 0.3 && trace[k].length < 40) {
                trace[k].push({
                    t: +(t * 0.05).toFixed(1),
                    f: +(u.face * 57.3).toFixed(1),
                    ft: +(u.faceTarget * 57.3).toFixed(1),
                    d: +(delta * 57.3).toFixed(1),
                    sp: +u.speedCur.toFixed(0),
                    p: u.path.length,
                    c: [u.cellX, u.cellY],
                });
            }
            const sign = Math.abs(delta) < 0.002 ? 0 : Math.sign(delta);
            if (sign !== 0) {
                if (prevDirSign[k] !== 0 && sign !== prevDirSign[k]) r.reversals++;
                prevDirSign[k] = sign;
            }
            r.face = u.face;
            r.ft = u.faceTarget;
            r.dir = d;
            r.sp = u.speedCur;
            r.pathLen = u.path.length;
        }
    }

    const result = squad.map((u, k) => ({
        id: u.id,
        kind: u.def.kind,
        flips: rec[k].flips,
        straightFlips: rec[k].straightFlips,
        turnedDeg: +rec[k].turned.toFixed(0),
        idleTurns: +rec[k].idleTurns.toFixed(1),
        ftChanges: rec[k].ftChanges,
        reversals: rec[k].reversals,
        dist: +Math.hypot(u.x - dest.x, u.y - dest.y).toFixed(0),
        distOrder: Math.hypot(u.x - orderTarget[k].x, u.y - orderTarget[k].y).toFixed(0),
        pathLeft: u.path.length,
        order: u.order.k,
        arms: arms[k],
        trace: trace[k],
    }));
    return { result, dest: { x: +dest.x.toFixed(0), y: +dest.y.toFixed(0) } };
});

console.log('dest', JSON.stringify(out.dest));
for (const r of out.result) {
    console.log(
        `${r.kind.padEnd(9)} id=${String(r.id).padEnd(3)} img=${String(r.flips).padEnd(3)} `
        + `straight=${String(r.straightFlips).padEnd(3)} turned=${String(r.turnedDeg).padEnd(5)} `
        + `idleTurn=${String(r.idleTurns).padEnd(5)} ftChg=${String(r.ftChanges).padEnd(4)} `
        + `rev=${String(r.reversals).padEnd(3)} dGoal=${String(r.dist).padEnd(4)} `
        + `dOrd=${String(r.distOrder).padEnd(4)} left=${String(r.pathLeft).padEnd(3)} ${r.order}`,
    );
    console.log('   arms', JSON.stringify(r.arms));
    if (r.idleTurns > 30) for (const q of r.trace) console.log('     ', JSON.stringify(q));
}
console.log('page errors', errs.length, errs.slice(0, 2).join(' | '));
await browser.close();
