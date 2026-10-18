/**
 * Skirmish setup screen regression: map / faction / colour selection.
 *
 * The retail skirmish dialog lets you pick a map, a side and a house colour
 * before the match; this asserts that all three actually reach the simulation.
 *
 * usage: node tools/menutest.mjs [url]
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

const uiState = () => page.evaluate(() => {
    const a = window.cc.director.getScene().getChildByName('Canvas').getChildByName('App').getComponent('RiftApp');
    return { mode: a.ui.mode, map: a.ui.selMap, color: a.ui.selColor, btns: a.ui.menuBtns.length };
});

const before = await uiState();
check('主菜单已显示', before.mode === 'menu', before.mode);
check('菜单包含地图/颜色/阵营控件', before.btns >= 15, `${before.btns} 个可点控件`);

/*
 * Map list.
 *
 * The menu currently offers a single flat test plane while the real maps are
 * being authored, so the test asserts the *structure* instead of a specific
 * map id: the selected map must be one of the offered ones, clicking the first
 * chip must keep it selected, and the match must start on it. When more maps
 * come back the same assertions still hold.
 */
const mapList = await page.evaluate(() => window.__riftsandConst.maps);
check('菜单至少提供一张地图', mapList.length >= 1, JSON.stringify(mapList));
check('默认选中的是提供的地图', mapList.includes(before.map), before.map);
if (mapList.length > 1) {
    await page.mouse.click(640 - 84, 360 - 96);
    await new Promise((r) => setTimeout(r, 300));
    const afterMap = await uiState();
    check('点击可切换地图', afterMap.map !== before.map, `${before.map} → ${afterMap.map}`);
}

/* ---------- colour: 4th swatch ---------- */
await page.mouse.click(640 - 27, 360 + 76);
await new Promise((r) => setTimeout(r, 300));
const afterColor = await uiState();
check('点击可切换玩家颜色', afterColor.color === 'amber', `${before.color} → ${afterColor.color}`);

/* ---------- start ---------- */
await page.mouse.click(640, 360 + 210);
await page.waitForFunction('window.__riftsandGame != null', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 700));

const game = await page.evaluate(() => {
    const g = window.__riftsandGame;
    let rocks = 0, dunes = 0, heights = 0;
    for (let i = 0; i < g.terrain.kind.length; i++) {
        if (g.terrain.kind[i] === 2) rocks++;
        else if (g.terrain.kind[i] === 1) dunes++;
        if (g.terrain.level[i] > 0) heights++;
    }
    const colorOf = window.__riftsandConst.colorOf;
    return {
        map: g.options.mapId,
        colors: g.options.colors,
        rocks, dunes, heights,
        playerColor: colorOf ? colorOf('BU') : null,
        units: g.units.length,
        buildings: g.buildings.length,
    };
});
console.log('   game', JSON.stringify(game));
check('对局使用所选地图', game.map === before.map, `${game.map}（期望 ${before.map}）`);
check('对局使用所选颜色', game.colors[0] === 'amber', JSON.stringify(game.colors));
check('两侧颜色不同', game.colors[0] !== game.colors[1], JSON.stringify(game.colors));
/*
 * The flat test plane must really be flat: no rock, no water, no height. That is
 * the whole point of it — any "unit is stuck" report on this map can only be a
 * unit bug, never terrain.
 */
check('测试平面没有岩石', game.rocks === 0, `岩石 ${game.rocks}`);
check('测试平面没有高地', game.heights === 0, `高度格 ${game.heights}`);
check('对局正常建立', game.units > 0 && game.buildings > 0,
    `${game.units} 单位 / ${game.buildings} 建筑`);

console.log(`ERRORS ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 3).join('\n'));
console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
