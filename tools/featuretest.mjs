/**
 * v0.10 feature regression: faction pick, build/sell animation, rubble, shroud.
 *
 * usage: node tools/featuretest.mjs [url]
 */
import { createRequire } from 'node:module';
const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0, fail = 0;
const check = (name, ok, note = '') => {
    if (ok) { pass++; console.log(`PASS  ${name}${note ? '  · ' + note : ''}`); }
    else { fail++; console.log(`FAIL  ${name}${note ? '  · ' + note : ''}`); }
};

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(`(() => {
    try {
        const sc = window.cc && window.cc.director.getScene();
        const cv = sc && sc.getChildByName('Canvas');
        return !!(cv && cv.getChildByName('App'));
    } catch (e) { return false; }
})()`, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 900));

const app = () => `window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp')`;

// ---- 1. faction selection by tapping the card ----
const before = await page.evaluate(`(${app()}).ui.selFaction`);
await page.mouse.click(640 + 322, 360 - 145);      // DS card (v0.11 layout)
await new Promise((r) => setTimeout(r, 300));
const after = await page.evaluate(`(${app()}).ui.selFaction`);
check('点击阵营卡能切换阵营', before === 'BU' && after === 'DS', `${before} → ${after}`);

await page.mouse.click(640 - 322, 360 - 145);      // back to BU
await new Promise((r) => setTimeout(r, 200));
const back = await page.evaluate(`({ sel: (${app()}).ui.selFaction, start: (${app()}).ui.menuBtns.length })`);
check('可以切回另一阵营', back.sel === 'BU', back.sel);

// ---- 2. start a match (BU) and inspect build/sell ----
await page.evaluate(() => {
    const a = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    a.startGame('DS', 'normal', 7000, true);
});
await page.waitForFunction('window.__riftsandGame != null', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 500));

const faction = await page.evaluate(() => {
    const g = window.__riftsandGame;
    const core = g.buildings.find((b) => b.owner === 0 && b.def.isCore);
    return { f: g.human.faction, core: core && core.def.id, ai: g.enemy.faction };
});
check('对局使用所选阵营', faction.f === 'DS', `core=${faction.core} ai=${faction.ai}`);
check('AI 使用对立阵营', faction.ai === 'BU', faction.ai);

// ---- 3. building raises over BuildStatus.buildup ----
const raise = await page.evaluate(async () => {
    const g = window.__riftsandGame;
    g.creditsBypass = true;
    g.human.credits = 20000;
    const core = g.buildings.find((b) => b.owner === 0 && b.def.isCore);
    // place a power plant right next to the core
    let spot = null;
    for (let r = 4; r <= 8 && !spot; r++) {
        for (let a = 0; a < 12; a++) {
            const tx = Math.round(core.tx + Math.cos(a) * r);
            const ty = Math.round(core.ty + Math.sin(a) * r);
            if (g.canPlace(window.__riftsandDefs.BUILDINGS.furnace, tx, ty, 0).ok) { spot = { tx, ty }; break; }
        }
    }
    if (!spot) return { err: 'no spot' };
    const b = g.place(window.__riftsandDefs.BUILDINGS.furnace, 0, spot.tx, spot.ty, false);
    const hpAtPlace = b.hp / b.maxHp;
    const t0 = g.time;
    const samples = [];
    for (let i = 0; i < 400 && !b.done; i++) {
        g.update(0.05);
        if (i % 4 === 0) samples.push({ p: +b.progress.toFixed(2), st: b.status });
    }
    samples.push({ p: +b.progress.toFixed(2), st: b.status });
    return {
        samples, id: b.id, done: b.done, status: b.status,
        buildSeconds: +(g.time - t0).toFixed(2), hpAtPlace: +hpAtPlace.toFixed(3),
    };
});
const seenMid = raise.samples?.some((s) => s.p > 0.05 && s.p < 0.95);
check('建筑有建造过程（进度 0→1）', !!seenMid, JSON.stringify(raise.samples?.slice(0, 5)));
// The retail engine finishes the structure in the sidebar; placing it only plays
// the rise animation (~BuildupTime). Anything close to def.time here means the
// old "build it twice" behaviour is back.
check('摆放后只播放升起动画（≤1.6s，不是重新建造）',
    raise.buildSeconds !== undefined && raise.buildSeconds <= 1.6,
    `${raise.buildSeconds}s`);
check('摆放时建筑已满血（不是工地）', raise.hpAtPlace === 1, `hp=${raise.hpAtPlace}`);
check('建造完成后状态为 ready', raise.status === 'ready' && raise.done, raise.status);

// ---- 4. sell: builddown, refund on completion, rubble left ----
const sell = await page.evaluate(async () => {
    const g = window.__riftsandGame;
    const b = g.buildings.find((x) => x.owner === 0 && x.def.id === 'furnace' && x.status === 'ready');
    if (!b) return { err: 'no building' };
    g.selectedBuilding = b;
    const c0 = g.human.credits;
    const r0 = g.ruins.length;
    g.sellSelectedBuilding();
    const started = { status: b.status, credits: g.human.credits, refund: b.refund };
    g.update(0.25);
    const mid = { status: b.status, progress: +b.progress.toFixed(2) };
    for (let i = 0; i < 8; i++) g.update(0.25);
    return {
        started, mid,
        dead: b.dead,
        creditsGain: g.human.credits - c0,
        refund: b.refund,
        ruins: g.ruins.length - r0,
    };
});
check('卖出进入拆除状态而不是瞬间消失', sell.started?.status === 'builddown' && sell.dead === true,
    `start=${sell.started?.status} mid=${sell.mid?.status} p=${sell.mid?.progress}`);
check('卖出时没有立刻到账', sell.started?.credits === sell.started?.credits && sell.creditsGain > 0,
    `+${sell.creditsGain} (refund ${sell.refund})`);
check('回收金额约为成本的 50%', Math.abs(sell.creditsGain - sell.refund) <= 1, `${sell.creditsGain} vs ${sell.refund}`);
check('拆除后留下废墟', sell.ruins === 1, `ruins +${sell.ruins}`);

// ---- 5. shroud semantics: explored == visible, no dim tier ----
const shroud = await page.evaluate(() => {
    const g = window.__riftsandGame;
    const { TILE, HALF } = window.__riftsandConst;
    // put an enemy infantry on an explored tile far from any friendly unit
    let spot = null;
    const MT = window.__riftsandConst.MAP_TILES;
    for (let ty = 2; ty < MT - 2 && !spot; ty++) {
        for (let tx = 2; tx < MT - 2; tx++) {
            const i = ty * MT + tx;
            if (g.human.explored[i] && !g.human.visible[i] && !g.isBlocked(tx, ty)) { spot = { tx, ty }; break; }
        }
    }
    if (!spot) {
        let e = 0, v = 0, ev = 0;
        for (let i = 0; i < g.human.explored.length; i++) {
            if (g.human.explored[i]) e++;
            if (g.human.visible[i]) v++;
            if (g.human.explored[i] && !g.human.visible[i]) ev++;
        }
        return { err: `no tile e=${e} v=${v} ev=${ev}` };
    }
    const u = g.spawnUnit(1, window.__riftsandDefs.UNITS.pebble, spot.tx * TILE + TILE / 2 - HALF, spot.ty * TILE + TILE / 2 - HALF);
    return {
        explored: !!g.human.explored[spot.ty * window.__riftsandConst.MAP_TILES + spot.tx],
        visibleNow: !!g.human.visible[spot.ty * window.__riftsandConst.MAP_TILES + spot.tx],
        shown: g.isVisibleTo(g.human, u),
    };
});
check('已在迷雾外(explored)的敌人始终可见', shroud.explored && shroud.shown === true,
    `explored=${shroud.explored} inSight=${shroud.visibleNow} shown=${shroud.shown}`);

const unseen = await page.evaluate(() => {
    const g = window.__riftsandGame;
    const { TILE, HALF, MAP_TILES: MT } = window.__riftsandConst;
    // find a never-explored tile and drop an enemy there
    for (let ty = 30; ty < 50; ty++) {
        for (let tx = 30; tx < 50; tx++) {
            const i = ty * MT + tx;
            if (g.human.explored[i] || g.isBlocked(tx, ty)) continue;
            const u = g.spawnUnit(1, window.__riftsandDefs.UNITS.pebble, tx * TILE + TILE / 2 - HALF, ty * TILE + TILE / 2 - HALF);
            return { shown: g.isVisibleTo(g.human, u) };
        }
    }
    return { err: 'none' };
});
check('未探索区域的敌人不可见', unseen.shown === false, JSON.stringify(unseen));

console.log(`ERRORS ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 3).join('\n'));
console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
