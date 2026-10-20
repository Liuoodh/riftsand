/**
 * B6a (task system + event catalogue) regression.
 *
 * The task system is the piece of the port that is easiest to get *almost* right.
 * A wrong `TaskStatus` number, a one-tick drift in `WaitTicksTask`, or a driver
 * that only runs the head of the queue all look fine until a harvester sits
 * still for a frame or a turret twitches. So the checks are written against the
 * reference's exact contracts:
 *
 *   A. STATUS   — the five numbers, and that they are not lifecycle-ordered.
 *   B. DEFAULTS — `preventOpportunityFire` and `blocking` are TRUE; a task that
 *                 forgets to opt out must not shoot and must not be drained.
 *   C. CANCEL   — Running→Cancelling (recursive), NotStarted+children→throw,
 *                 non-cancellable→no-op.
 *   D. RUNNER   — non-blocking tasks drain in ONE tick; a blocking unfinished
 *                 task breaks the loop; the `processedTasks` set stops a
 *                 never-finishing non-blocking task from spinning.
 *   E. SPAWNED  — `!object.isSpawned` short-circuits the whole queue.
 *   F. PARKING  — `waitingForChildrenToFinish` holds a parent whose body said
 *                 "done" while a non-blocking child still runs.
 *   G. PRIMITIVES — WaitTicksTask's n+1 off-by-one, TaskGroup ordering,
 *                 CallbackTask firing once, WaitMinutesTask = 900·minutes.
 *   H. CLOCK    — GameSpeed's speed→multiplier table, including the two
 *                 special-cased speeds.
 *   I. EVENTS   — 65 classes, unique EventType, matching `type`, and the payload
 *                 field names that B5a got wrong once (`gameObject`, `prevTile`).
 *
 * usage: node tools/tasktest.mjs [url]
 */
import { createRequire } from 'node:module';

const req = createRequire('C:/Users/sixin/.workbuddy/binaries/node/workspace/node_modules/');
const puppeteer = req('puppeteer-core');

const URL = process.argv[2] || 'http://127.0.0.1:8950/index.html?auto=1';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0,
    fail = 0;
const check = (name, ok, note = '') => {
    if (ok) {
        pass++;
        console.log(`PASS  ${name}${note ? '  · ' + note : ''}`);
    } else {
        fail++;
        console.log(`FAIL  ${name}${note ? '  · ' + note : ''}`);
    }
};

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__riftsandGame != null', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
    window.__riftsandGame.aiEnabled = false;
});

const evalPage = (fn) => page.evaluate(fn);

/* ========================================================== A. statuses ==== */

const statuses = await evalPage(() => {
    const S = window.__riftsandSim;
    return {
        map: { ...S.TaskStatus },
        hasNotStarted: S.TaskStatus.NotStarted === 0,
        // guard against someone "tidying" the enum into lifecycle order
        finishedIsTwo: S.TaskStatus.Finished === 2,
        cancellingIsThree: S.TaskStatus.Cancelling === 3,
        cancelledIsFour: S.TaskStatus.Cancelled === 4,
        keys: Object.keys(S.TaskStatus).filter((k) => Number.isNaN(Number(k))),
    };
});
check(
    'TaskStatus：五个状态，数值与生命周期顺序无关',
    statuses.hasNotStarted && statuses.finishedIsTwo && statuses.cancellingIsThree && statuses.cancelledIsFour,
    `Running=${statuses.map.Running} Finished=${statuses.map.Finished} Cancelling=${statuses.map.Cancelling} Cancelled=${statuses.map.Cancelled}`,
);
check(
    'TaskStatus：五个名字且没有多余成员',
    statuses.keys.length === 5 &&
        ['NotStarted', 'Running', 'Finished', 'Cancelling', 'Cancelled'].every((k) => statuses.keys.includes(k)),
    statuses.keys.join(','),
);

/* ========================================================== B. defaults ==== */

const defaults = await evalPage(() => {
    const S = window.__riftsandSim;
    const t = new S.Task();
    return {
        status: t.status,
        cancellable: t.cancellable,
        blocking: t.blocking,
        preventOpportunityFire: t.preventOpportunityFire,
        preventLanding: t.preventLanding,
        useChildTargetLines: t.useChildTargetLines,
        waitingForChildrenToFinish: t.waitingForChildrenToFinish,
        isAttackMove: t.isAttackMove,
        children: Array.isArray(t.children) && t.children.length === 0,
    };
});
check('Task 默认：NotStarted / 可取消 / 空子任务', defaults.status === 0 && defaults.cancellable && defaults.children);
check(
    'Task 默认：blocking / preventOpportunityFire / preventLanding 都是 true',
    defaults.blocking && defaults.preventOpportunityFire && defaults.preventLanding,
    `blocking=${defaults.blocking} opportunityFire=${!defaults.preventOpportunityFire} landing=${!defaults.preventLanding}`,
);
check(
    'Task 默认：useChildTargetLines / waitingForChildren / isAttackMove 都是 false',
    !defaults.useChildTargetLines && !defaults.waitingForChildrenToFinish && !defaults.isAttackMove,
);

const chain = await evalPage(() => {
    const S = window.__riftsandSim;
    const t = new S.Task();
    return t.setCancellable(false) === t && t.setBlocking(false) === t && t.cancellable === false && t.blocking === false;
});
check('setCancellable / setBlocking 返回 this（链式）', chain);

/* ========================================================= C. cancelling ==== */

const cancelRunning = await evalPage(() => {
    const S = window.__riftsandSim;
    const child = new S.Task();
    child.status = S.TaskStatus.Running;
    const parent = new S.Task();
    parent.status = S.TaskStatus.Running;
    parent.children.push(child);
    parent.cancel();
    return { parent: parent.status, child: child.status };
});
check(
    'cancel：Running → Cancelling，且递归到子任务',
    cancelRunning.parent === 3 && cancelRunning.child === 3,
    `parent=${cancelRunning.parent} child=${cancelRunning.child}`,
);

const cancelIdle = await evalPage(() => {
    const S = window.__riftsandSim;
    const t = new S.Task();
    t.cancel();
    return t.status;
});
check('cancel：NotStarted 且无子任务 → 状态不变（不静默取消）', cancelIdle === 0, `status=${cancelIdle}`);

const cancelIdleWithChildren = await evalPage(() => {
    const S = window.__riftsandSim;
    const t = new S.Task();
    t.children.push(new S.Task());
    let threw = false;
    try {
        t.cancel();
    } catch (e) {
        threw = /children/i.test(e.message);
    }
    return { threw, status: t.status };
});
check(
    'cancel：NotStarted 却有子任务 → 置 Cancelled 并抛错（参考实现如此）',
    cancelIdleWithChildren.threw && cancelIdleWithChildren.status === 4,
    `status=${cancelIdleWithChildren.status}`,
);

const cancelLocked = await evalPage(() => {
    const S = window.__riftsandSim;
    const t = new S.Task().setCancellable(false);
    t.status = S.TaskStatus.Running;
    t.cancel();
    return t.status;
});
check('cancel：不可取消的任务保持 Running', cancelLocked === 1, `status=${cancelLocked}`);

/* ============================================================ D. runner ==== */

const drain = await evalPage(() => {
    const S = window.__riftsandSim;
    const runner = new S.TaskRunner();
    const obj = { isSpawned: true };
    const fired = [];
    const mk = (i) => {
        const t = new S.CallbackTask(() => fired.push(i));
        t.setBlocking(false);
        return t;
    };
    const list = [mk(0), mk(1), mk(2)];
    runner.tick(list, obj);
    return { fired, left: list.length };
});
check(
    'Runner：三个非阻塞任务在同一 tick 内全部排空',
    drain.fired.length === 3 && drain.left === 0,
    `fired=[${drain.fired}] left=${drain.left}`,
);

const blocking = await evalPage(() => {
    const S = window.__riftsandSim;
    const runner = new S.TaskRunner();
    const obj = { isSpawned: true };
    const first = new S.Task();
    first.status = S.TaskStatus.Running;
    first.onTick = () => false;
    let secondRan = false;
    const second = new S.CallbackTask(() => (secondRan = true));
    const list = [first, second];
    runner.tick(list, obj);
    return { secondRan, left: list.length };
});
check(
    'Runner：未完成的阻塞任务中断队列（后面的任务本 tick 不跑）',
    !blocking.secondRan && blocking.left === 2,
    `left=${blocking.left}`,
);

const processed = await evalPage(() => {
    const S = window.__riftsandSim;
    const runner = new S.TaskRunner();
    const obj = { isSpawned: true };
    let ticksOnFirst = 0;
    const stuck = new S.Task();
    stuck.status = S.TaskStatus.Running;
    stuck.setBlocking(false);
    stuck.onTick = () => {
        ticksOnFirst++;
        return false;
    };
    let secondRan = false;
    const second = new S.CallbackTask(() => (secondRan = true));
    second.setBlocking(false);
    const list = [stuck, second];
    runner.tick(list, obj);
    return { ticksOnFirst, secondRan, left: list.length };
});
check(
    'Runner：卡住的非阻塞任务本 tick 只 tick 一次，且不挡住后面的任务',
    processed.ticksOnFirst === 1 && processed.secondRan && processed.left === 1,
    `ticks=${processed.ticksOnFirst} second=${processed.secondRan} left=${processed.left}`,
);

/* =========================================================== E. spawned ==== */

const despawned = await evalPage(() => {
    const S = window.__riftsandSim;
    const runner = new S.TaskRunner();
    const obj = { isSpawned: false };
    let ran = false;
    const t = new S.CallbackTask(() => (ran = true));
    const list = [t];
    const allFinished = runner.tickChildren(list, obj);
    return { ran, allFinished, left: list.length, status: t.status };
});
check(
    'Runner：对象未 spawn 时整队不跑，任务保持 NotStarted',
    !despawned.ran && despawned.left === 1 && despawned.status === 0,
    `left=${despawned.left} status=${despawned.status}`,
);

/* =========================================================== F. parking ==== */

const parked = await evalPage(() => {
    const S = window.__riftsandSim;
    const runner = new S.TaskRunner();
    const obj = { isSpawned: true };

    const parent = new S.Task();
    parent.blocking = true;
    parent.onTick = () => true; // body claims "done" on the first tick

    // a non-blocking child that needs three ticks
    const child = new S.Task();
    child.setBlocking(false);
    let childTicks = 0;
    child.onTick = () => ++childTicks >= 3;
    parent.children.push(child);

    runner.startTask(parent, obj);
    const trace = [];
    for (let i = 0; i < 6 && parent.status !== S.TaskStatus.Finished; i++) {
        const done = runner.tickTask(parent, obj);
        trace.push({ done, waiting: parent.waitingForChildrenToFinish, status: parent.status });
    }
    return { trace, status: parent.status, childTicks };
});
check(
    'Runner：父任务 onTick 提前返回 true 时被挂着等子任务（waitingForChildrenToFinish）',
    parked.trace.length >= 2 && parked.trace[0].waiting === true && parked.trace[0].done === false,
    `ticks=${parked.trace.length} firstWaiting=${parked.trace[0]?.waiting}`,
);
check(
    'Runner：子任务跑完后父任务才 Finish',
    parked.status === 2 && parked.childTicks === 3,
    `status=${parked.status} childTicks=${parked.childTicks}`,
);

/* ======================================================== G. primitives ==== */

const waitTicks = await evalPage(() => {
    const S = window.__riftsandSim;
    const runner = new S.TaskRunner();
    const obj = { isSpawned: true };
    const counts = [];
    for (const n of [1, 3, 10]) {
        const t = new S.WaitTicksTask(n);
        runner.startTask(t, obj);
        let calls = 0;
        while (!runner.tickTask(t, obj) && calls < 100) calls++;
        counts.push({ n, calls: calls + 1 });
    }
    return counts;
});
check(
    'WaitTicksTask：n 个 tick 的任务第 n+1 次 onTick 才结束（参考实现的 off-by-one）',
    waitTicks.every((c) => c.calls === c.n + 1),
    waitTicks.map((c) => `${c.n}→${c.calls}`).join(' '),
);

const waitCancel = await evalPage(() => {
    const S = window.__riftsandSim;
    const runner = new S.TaskRunner();
    const obj = { isSpawned: true };
    const t = new S.WaitTicksTask(9999);
    runner.startTask(t, obj);
    t.cancel();
    return { cancelledStatus: t.status, doneOnNextTick: runner.tickTask(t, obj), after: t.status };
});
check(
    'WaitTicksTask：取消后立刻结束，不烧完剩余 tick',
    waitCancel.doneOnNextTick === true && waitCancel.after === 4,
    `status=${waitCancel.after}`,
);

const group = await evalPage(() => {
    const S = window.__riftsandSim;
    const runner = new S.TaskRunner();
    const obj = { isSpawned: true };
    const order = [];
    const a = new S.CallbackTask(() => order.push('a'));
    const b = new S.CallbackTask(() => order.push('b'));
    const c = new S.CallbackTask(() => order.push('c'));
    const g = new S.TaskGroup(a, b, c);
    runner.tick([g], obj);
    return order;
});
check('TaskGroup：子任务按声明顺序执行', group.join('') === 'abc', group.join(','));

const callbackOnce = await evalPage(() => {
    const S = window.__riftsandSim;
    const runner = new S.TaskRunner();
    const obj = { isSpawned: true };
    let calls = 0;
    const t = new S.CallbackTask(() => calls++);
    // One array, ticked twice: the runner splices the finished task out of it,
    // so the second tick sees an empty queue. Handing it a *fresh* `[t]` would
    // (correctly) throw "Unhandled task status Finished".
    const list = [t];
    runner.tick(list, obj);
    runner.tick(list, obj);
    return { calls, left: list.length };
});
check(
    'CallbackTask：只调用一次（第二个 tick 时已出队）',
    callbackOnce.calls === 1 && callbackOnce.left === 0,
    `calls=${callbackOnce.calls} left=${callbackOnce.left}`,
);

const minutes = await evalPage(() => {
    const S = window.__riftsandSim;
    const out = {};
    for (const m of [0.5, 1, 3]) {
        const t = new S.WaitMinutesTask(m);
        // `ticks` is private at compile time only; read it through the instance
        out[m] = t.ticks;
    }
    return out;
});
check(
    'WaitMinutesTask：按 base 15 tick/s 折算，与游戏速度无关',
    minutes['0.5'] === 450 && minutes[1] === 900 && minutes[3] === 2700,
    `0.5→${minutes['0.5']} 1→${minutes[1]} 3→${minutes[3]}`,
);

/* ============================================================= H. clock ==== */

const clock = await evalPage(() => {
    const S = window.__riftsandSim;
    const speeds = [1, 2, 3, 4, 5, 6];
    return { base: S.GameSpeed.BASE_TICKS_PER_SECOND, mult: speeds.map((s) => S.GameSpeed.computeGameSpeed(s)) };
});
const expectMult = [0.8, 1.0, 1.3333, 2.0, 3.0, 4.0];
check('GameSpeed：BASE_TICKS_PER_SECOND = 15', clock.base === 15, String(clock.base));
check(
    'GameSpeed：速度 1–6 的倍率表（5/6 特判，其余 60/(6-speed)/15）',
    clock.mult.every((m, i) => Math.abs(m - expectMult[i]) < 1e-3),
    clock.mult.map((m) => m.toFixed(3)).join(' '),
);

/* ============================================================ I. events ==== */

const events = await evalPage(() => {
    const S = window.__riftsandSim;
    const EventType = S.EventType;
    // every exported *Event class, keyed by name
    const classes = Object.keys(S)
        .filter((k) => k.endsWith('Event') && k !== 'EventType' && k !== 'EventMap')
        .filter((k) => typeof S[k] === 'function');
    const problems = [];
    const seenTypes = new Map();
    for (const name of classes) {
        const C = S[name];
        // EventType member name is the class name minus the "Event" suffix,
        // except RadarEvent, whose class and enum member share the name.
        const member = name === 'RadarEvent' ? 'RadarEvent' : name.replace(/Event$/, '');
        const expected = EventType[member];
        if (expected === undefined) {
            problems.push(`${name}: EventType.${member} missing`);
            continue;
        }
        // construct with just enough args to inspect `type`
        const inst = new C('', '', '', '', '');
        if (inst.type !== expected) problems.push(`${name}: type=${inst.type} want ${expected}`);
        if (seenTypes.has(expected)) problems.push(`${name} & ${seenTypes.get(expected)} share ${expected}`);
        seenTypes.set(expected, name);
        if (typeof inst.type !== 'number') problems.push(`${name}: type is not a number`);
    }
    return {
        count: classes.length,
        problems,
        enumSize: Object.keys(EventType).filter((k) => Number.isNaN(Number(k))).length,
        hasEventMap: typeof S.EventMap === 'object',
    };
});
check('Event 目录：65 个事件类全部导出', events.count === 65, `count=${events.count}`);
check('Event 目录：EventType 65 项，无重复占用', events.enumSize === 65, `enumSize=${events.enumSize}`);
check(
    'Event 目录：每个类的 `type` 都等于自己的 EventType 成员',
    events.problems.length === 0,
    events.problems.slice(0, 4).join(' | ') || 'all ok',
);
check('Event 目录：EventMap 存在（网络层注册锚点）', events.hasEventMap);

const payloads = await evalPage(() => {
    const S = window.__riftsandSim;
    const keys = (o) => Object.getOwnPropertyNames(o).filter((k) => k !== 'type');
    return {
        land: keys(new S.ObjectLandEvent('GO')),
        liftOff: keys(new S.ObjectLiftOffEvent('GO')),
        teleport: keys(new S.ObjectTeleportEvent('T', true, 'TILE')),
        spawn: keys(new S.ObjectSpawnEvent('GO')),
        unspawn: keys(new S.ObjectUnspawnEvent('GO')),
        crashing: keys(new S.ObjectCrashingEvent('GO')),
        resigned: keys(new S.PlayerResignedEvent('P')),
        resignedValue: new S.PlayerResignedEvent('P').assetsRedistributed,
        destroy: keys(new S.ObjectDestroyEvent('T', 'INFO', false)),
    };
});
check(
    'Event 载荷：ObjectLand / ObjectLiftOff 的字段是 gameObject（B5a 曾误写成 target）',
    payloads.land[0] === 'gameObject' && payloads.liftOff[0] === 'gameObject',
    `${payloads.land[0]} / ${payloads.liftOff[0]}`,
);
check(
    'Event 载荷：ObjectTeleport 带 prevTile；ObjectDestroy 带 attackerInfo',
    payloads.teleport.join(',') === 'target,isChronoshift,prevTile' &&
        payloads.destroy.join(',') === 'target,attackerInfo,incidental',
    payloads.teleport.join(','),
);
check(
    'Event 载荷：ObjectSpawn / Unspawn / Crashing 同样用 gameObject',
    [payloads.spawn, payloads.unspawn, payloads.crashing].every((p) => p[0] === 'gameObject'),
);
check(
    'Event 载荷：PlayerResigned 的 assetsRedistributed 可省略（属性在、值为 undefined）',
    payloads.resigned.join(',') === 'target,assetsRedistributed' && payloads.resignedValue === undefined,
    `${payloads.resigned.join(',')} → ${payloads.resignedValue}`,
);

/* ============================================================== wrapping ==== */

check('运行期无 pageerror', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
