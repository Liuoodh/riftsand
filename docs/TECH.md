# 技术架构 · 裂沙战线

## 1. 技术选型

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 引擎 | Cocos Creator 3.8.8 | 官方支持微信/抖音小游戏导出，2D 渲染足够，包体可控 |
| 语言 | TypeScript | 类型安全，重构成本低 |
| 场景 | 单场景 `main.scene` | 全部内容代码生成，避免场景文件冲突，便于 AI/多人协作 |
| 美术 | 运行时 `Graphics` 矢量绘制 | 零贴图资源，包体最小，风格可控 |
| 资源 | 无外部图片/音频 | 首包只有脚本 + 引擎 |

## 2. 启动流程

`main.scene` 只含 `Canvas + Camera + App` 三个节点，`App` 上挂着唯一自定义组件 `RiftApp`（`Boot.ts`）。
Cocos 只有在场景中真实引用了脚本时才会把它打进构建产物，因此需要把组件的**压缩 UUID** 直接写进场景 JSON：

```json
{ "__type__": "a3634Afu59HhJ1rnkvg9ZLS" }
```

> 该值是 `Boot.ts.meta` 里 uuid 的压缩形式（`ab5f7f1f-…` → `ab5f78f0ahPY6/23VWmdHHX` 可反推验证）。
> 脚本改名、改文件夹或重新生成 meta 都会让压缩 UUID 变化，届时需要在编辑器里重新挂载组件。

`Boot.ts` 在模块加载时额外注册两个自举钩子，作为"场景组件未生效"（例如刚改名、热重载、从别的场景切入）时的兜底：

```
director.once(EVENT_AFTER_SCENE_LAUNCH, tryBoot)   // 正常路径
director.on(EVENT_AFTER_UPDATE, guard)             // 兜底：漏事件/热重载
tryBoot(): 找到 Canvas → 挂载 RiftApp 组件（全局标记防重复）
```

`RiftApp.onLoad()`：设设计分辨率 → 构建 UI → 绑定输入 → 展示主菜单。
点击「开始战斗」后 `startGame()` 创建一个新的 `Game` 实例、`WorldRenderer`、`CameraRig`。

## 3. 模块职责

```
core/Core.ts      常量、色板、解析色值、阵营/建筑/兵种/超武数据表、伤害矩阵、数学工具
world/Terrain.ts  点对称程序化地图（沙地/沙丘/岩石/矿脉）、每格速度/寻路代价、可平铺噪声
world/Path.ts     加权 A*（八向、禁止切角、地形代价、best-effort、节点上限）+ 视线平滑
game/Entities.ts  Unit / Building / Projectile / Fx / Zone / Crate / Decal / SpatialGrid（纯数据 + 少量行为）
game/Game.ts      模拟核心：队列生产、渐进扣款、建造放置、采集、战斗、老兵、超武、迷雾、胜负
game/AI.ts        建造顺序 + 经济 + 成波进攻 + 回防 + 超武 + 工程师 + 基地车扩张
render/Art.ts     所有矢量美术（单位、建筑、矿脉、岩石、灌木、木箱）
render/Views.ts   实体视图、血条、特效/碎片/烟雾、弹坑、地形渲染、战争迷雾贴图
render/CameraRig.ts  2D 相机（平移/缩放/边界钳制/平滑，双指合并运算）
ui/UI.ts          HUD、侧边栏标签与卡片队列、小地图、超武按钮、菜单、暂停、结算
ui/Overlay.ts     触屏覆盖层：编队条、长按指令盘、框选矩形
audio/Sfx.ts      WebAudio 程序化音效（浏览器 / wx.createWebAudioContext）
Boot.ts           入口：分辨率、手势状态机、生命周期、主循环、建造与超武预览
```

数据流是单向的：

```
输入 → Game 指令 → Game.update() 改数据 → WorldRenderer.sync() 读数据画节点 → UI.refresh() 读数据改控件
```

视图不持有游戏逻辑，模拟不依赖任何 `cc.Node`（`Entity.view` 仅作为弱引用）。

## 4. 主循环

```ts
update(dt) {
  dt = min(dt, 0.05);                 // 防止后台切回大步长
  game.update(dt);                    // 模拟
  cam.update(dt);                     // 相机
  renderer.sync(dt, cam.viewBounds);  // 渲染同步（带视锥剔除）
  ui.refresh(dt);                     // HUD（内部按需重建卡片/小地图节流）
}
```

模拟顺序：建筑（施工/维修/炮塔）→ 生产队列 → 单位（指令/采集/开火/隐身）→ 分离力 → 弹道 → 特效 → 超武区域 → 超武充能 → 补给箱 → AI → 矿脉再生(0.5Hz) → 迷雾(≈4.5Hz) → 清理死亡 → 胜负。

### 4.1 生产模型

四条队列（structure / infantry / vehicle / aircraft）各自维护 `items[]`：

```ts
// 每帧
const speed = powerFactor * Math.min(2.4, Math.pow(1.25, factoryCount - 1));
const want = Math.min(item.cost - item.spent, item.cost / item.time * speed * dt);
const spend = Math.min(player.credits, want);
item.spent += spend; item.progress = item.spent / item.cost;
```

- 建筑完成进入 `ready`，由玩家放置或 AI 的 `placeStructure()` 选址落地；
- 单位完成立即在**主工厂**（最早建成的同类工厂）出口生成，安全出生点会绕开被占用的格子；
- 取消队列只返还 `spent`，未支付部分不返还。

### 4.2 老兵与伤害

`damage(target, amount, type, owner, source)` 统一入口：先判无敌（力场），再乘目标老兵的减伤系数，再查伤害矩阵。击杀时若 `source` 是单位，按其击杀目标造价发放经验。`Projectile.source` 让弹道击杀也能正确归属。

### 4.3 物理步进

```
每帧：
  1. 地形采样      terrainMul = terrain.speedAt(所在格, 兵种)
  2. 移动          加速度逼近目标速度，按 turnRate 转向，急转弯削速
  3. 分离          空间网格取邻居，按质量分配位移；重车碾压敌方步兵
  4. 对冲让位      相对速度指向对方时，按 id 侧移
  5. 世界解算      落入实心格/建筑 → 向 8 方向找 1–3 格空地，失败则回滚
  6. 卡住检测      1.1s 无位移 → 重规划（±35px 抖动）/ 采集车重新选矿
  7. 弹丸          制导转向 → 积分 → 边界/墙体/扫掠命中/落地
  8. 爆炸          溅射按距离衰减 → 弹坑/碎片/烟雾/震动
```

所有地面单位共用一条管线；飞行器跳过 3–6（不受地形与碾压影响），但仍参与弹丸扫掠。

### 4.4 超武区域

持续型超武（护盾/沙暴/蜃楼）是 `Zone` 对象，每帧对范围内单位刷新 `invulnUntil / slowUntil / mirageUntil`；单位离开后 0.3 秒内失效，不需要额外的进入/离开事件。轨道打击走 `strikeQueue` 延迟 1.4 秒结算，并生成 `target` 特效做预警。

## 5. 输入层

`Boot.ts` 维护一个极简手势状态机，每个触点是一个 `Pointer`，没有第三方手势库。
参数集中在 `core/Core.ts`：`TAP_MAX_MS=320`、`TAP_SLOP=10`、`LONG_PRESS_MS=400`、`BOX_MIN_PX=18`、`SNAP_PX=28`。

```
按下 ──┬─ 落在 HUD ──────────────► 抬起 = HUD 点击（长按卡片 = 批量生产）
       ├─ 落在编队条 ────────────► 抬起 = 选队 / 长按 = 编入
       └─ 落在战场 ──┬─ 移动 ≥18px ─► 框选框，抬起结算
                     ├─ 停 400ms ──► 指令盘，滑动选择、抬手执行
                     └─ 抬起 ≤320ms ► 点选 / 移动 / 攻击
两指：任何时刻按下第二指 → 取消单指手势 → 中点平移 + 间距缩放
```

几个必须踩过才知道的点：

1. **单指拖动让给框选**，平移交给双指。建造模式下例外：此时单指拖动改为平移，因为放置建筑时需要移动取景，框选没有意义。
2. **双指必须一次算完**。最初分别调用 `zoomAt()` 和 `panBy()`：`zoomAt` 会用当前实际相机位置重算 `tx`，把刚 `panBy` 累加的位移覆盖掉，导致"能缩放、不能平移"。现在合并为 `CameraRig.pinch()`，以旧中点为锚一次求出 `tx/ty`。
3. **长按后抬手不立刻关菜单**：如果手指没有滑动，指令盘保持打开，等第二次点选；滑动了则抬手即执行。两种操作习惯都成立。
4. **拾取半径按屏幕像素换算**（`16/zoom`），否则放大后点击单位会变得过于容易、缩小后几乎点不中。
5. **吸附兜底**：点空处前先找屏幕 28px 内的敌人（转攻击）和矿脉（采集车转采集），显著降低小屏误操作。
6. **框选优先作战单位**，框内没有作战单位时才选采集车；框空则清空选择。
7. **超武瞄准是第二种子模式**：点右侧超武按钮进入 `swTargeting`，再点地面发射；此模式下单指拖动改为平移，取消按钮/ESC 退出。
8. **路径模式**下点地不再替换指令，而是追加到 `orderQueue`（上限 6），当前指令结束后依次执行。

## 6. 性能预算（目标：微信小游戏中端机 50～60 FPS）

| 项 | 预算 | 现状 |
| --- | --- | --- |
| 同屏单位 | 120 | 单局峰值约 60～90（含双方采集车） |
| DrawCall | < 350 | 每个实体 3 个 Graphics（本体/选中环/血条），靠 `active` 与视锥剔除压到 ~120 |
| 模拟耗时 | < 6ms/帧 | 空间网格（96px 单元）做邻近查询，A* 仅在需要时重算 |
| 迷雾贴图 | 64×64 RGBA 上传，5Hz | 约 16KB/次 |
| 小地图 | 64×64 RGBA，3.5Hz | 复用地形底图 + 叠加迷雾/单位点 |

优化点（已验证稳定，仍可继续）：
- 血条仅在本体掉血或选中时重绘；
- 卡片仅在"列表签名"变化时重建；
- 屏幕外实体跳过位置更新（但仍在模拟中）；
- 待命单位索敌按 0.22–0.34s 随机节流，避免 100 个单位每帧做网格查询；
- 超武区域、补给箱数量极少（≤4 / ≤3），逐帧遍历成本可忽略；
- 特效硬上限 240（超出丢弃最旧并标记销毁），弹坑上限 64，避免长局无限堆积；
- A* 单次最多展开 5200 个节点，找不到路时返回最接近目标的可达点；
- 碰撞只处理空间网格内的邻居对，且每对只解算一次（`id` 排序）。

## 7. 小程序适配

- **输入**：只用 `input` 上的 TOUCH/MOUSE/KEY 事件，微信/抖音的环境由引擎适配；多点触控用 `event.getID()` 区分。
- **分辨率**：`view.setDesignResolutionSize(1280, 720, SHOW_ALL)`，超宽屏自动留黑边，UI 不被裁切。
- **音频**：优先 `wx.createWebAudioContext()`，回退 `AudioContext/webkitAudioContext`；首次触摸/点击后初始化，满足移动端自动播放限制；所有调用包在 try/catch 中，音频失败不影响游戏。
- **无本地存储依赖**：当前未做存档，因此不受小游戏 `wx.setStorage` 差异影响。
- **包体**：无图片/音频资源，构建产物主要是引擎 + 脚本。
- **待补**：分享卡片、性能分级（低端机降单位上限）在 v0.4 处理。

## 8. 构建与验证

```bash
# 类型检查（用 Cocos 自带 tsc）
node "<Cocos>/resources/app.asar.unpacked/node_modules/typescript/bin/tsc" -p tsconfig.json --noEmit

# 构建 web-mobile（用于浏览器验证）
"CocosCreator.exe" --project <project> --build "platform=web-mobile;debug=true;buildPath=build"

# 小游戏
"CocosCreator.exe" --project <project> --build "platform=wechatgame;debug=false"
"CocosCreator.exe" --project <project> --build "platform=bytedance-mini-game;debug=false"
```

> Windows 下若通过 Electron 宿主终端调用，需先清除 `ELECTRON_RUN_AS_NODE`，否则 `CocosCreator.exe` 会以 node 模式启动并报 `bad option`。
> 命令行构建退出码为 `36` 属正常结束（Electron 的既有行为），以 `build/web-mobile/index.html` 是否刷新为准。

### 8.1 自动回归

所有脚本都是 puppeteer-core + 本机 Chrome headless，跑真实构建产物，无需手动点击。
先起一个静态服务（默认端口 8950，脚本的默认 URL 指向它）：

```bash
cd project/build/web-mobile && python -m http.server 8950 --bind 127.0.0.1
```

**端到端**

```bash
# 静态检查：能否启动、开局单位/建筑数量、帧率、控制台错误、关键界面截图
node tools/smoke.mjs

# 动态检查：?auto=1 进对局，内置脚本玩家 + AI 快进 6 分钟，输出经济/兵力/超武/老兵
node tools/battletest.mjs
```

**按子系统**（失败即非零退出码，可直接进 CI）

| 脚本 | 覆盖 | 条数 |
|---|---|---:|
| `mathtest` | 数学地基：查表三角、取整、区间 | 40 |
| `rulestest` | 规则全表：陆地速度、护甲、驻军、超武 | 63 |
| `combattest` | 战斗数学：computeDamage / detonate / 事件链 | 71 |
| `maptest` | 地图生成与地形语义 | 21 |
| `maptest2` | 地图层专项：五个矩形 / 八向表 / 通行图 / 地表派生 / 迷雾 / 遮挡 / 桥链 | 63 |
| `movetest` | 移动与互堵：对向、让路、容量、可抵达性 | 18 |
| `crowdtest` | 人群挤压与分离 | 7 |
| `phystest` | 地形/碰撞/碾压/弹道/防空/防穿模 | 10 |
| `occltest` | 建筑遮挡 | 5 |
| `dirtest` | 八向行驶的图块朝向抖动 | 9 |
| `speedtest` | 速度与减速 | 12 |
| `menutest` | 菜单/建造面板 | 11 |
| `assettest` | 资产加载与图集 | 20 |
| `inputtest` | 框选/指令盘/编队/生产/超武/工兵接管 | 20 |
| `featuretest` | 玩法特性 | 14 |
| `harvesttest` | 采矿三件套 | 6 |
| `buildingtest` | 建筑 trait 族 | 13 |
| `objecttest` | 对象模型：type 谓词 / Traits 双路径 / tick 快照 / 位置派生 / 三态建筑 / 视线与碰撞 | 88 |
| `tasktest` | 任务系统：TaskStatus 数值 / TaskRunner 排空与挂起 / 原语 off-by-one / 事件目录自洽 | 32 |

**合计 19 套件 / 523 条。**

另有探针型脚本（输出 JSON 不判定）：`steertest` / `walktest` / `pathsim` / `physshowcase`。

> `inputtest` 通过 `canvas/App` 上的 `RiftApp` 实例读取 `game`、`cam`、`ui` 状态。
> 失败时返回非零退出码，可直接进 CI。

为此保留两个开发钩子（不会影响正常玩家）：

| 钩子 | 作用 |
| --- | --- |
| `?auto=1` | 跳过主菜单，直接以「磐岩联合 / 标准」开局 |
| `window.__riftsandGame` | 暴露当前 `Game` 实例，供脚本快进与读取统计 |

## 9. 已知限制

1. 单位避障是"质量分离 + 对冲让位 + 卡住重规划"，不是完整 RVO，极端拥堵仍可能短暂推挤。
2. 空中单位直线飞行，不做高度层与绕行；没有山体遮挡视线。
3. AI 不做主动侦查，兵种搭配按固定权重，尚未根据玩家部队组成做克制切换。
4. 尚无运输载具 / 建筑驻防 / 围墙 / 战役 / 联机 / 存档（见 ROADMAP 覆盖矩阵）。
5. 音效为程序化合成，没有背景音乐与语音播报（避免版权风险，也控制包体）。
6. 建筑队列只有 1 格，连续建造同一建筑需要重复点击。
7. 没有桥梁/高低差/水域，弹道只在 2D 平面 + 高度上结算。

---

## 5. 等距渲染管线（v0.5）

### 5.1 分层与职责

```
Core / Terrain / Path       纯数据，不知道屏幕是斜的
   │
   ├─ world/Iso.ts          唯一的投影知识：worldToProj / projToWorld
   │
Game (模拟)                 直角世界坐标：寻路、射程、碰撞、AI
   │
Views (渲染)                投影后写节点位置；L2_World 按投影 y 排序
   │
Boot (输入)                 screenToWorld → projToWorld → 按高度迭代修正
```

关键约束：**模拟层不 import Iso**。任何"屏幕方向"的概念只允许出现在 Views 与 Boot 里。

### 5.2 投影常量

| 常量 | 值 | 含义 |
|---|---|---|
| `ISO_W / ISO_H` | 56 / 28 | 菱形宽高（2:1） |
| `ISO_HW / ISO_HH` | 28 / 14 | 半宽 / 半高 |
| `HEIGHT_PX` | 16 | 每层地形抬升像素 |
| `PROJ_HALF_X/Y` | 1792 / 896 | 投影空间半边界，用于相机 clamp |

### 5.3 地形绘制成本

- 4096 个菱形，一次性画入单个 `Graphics`（`TerrainView.paint`），不逐帧重建。
- 抬升格额外画 2 个侧壁四边形。
- 装饰物（草丛/箱子/碎石）投影后绘制，一次性。
- 迷雾按行合并同态连续段：通常 100~300 个平行四边形，0.18s 重建一次，且有签名早退。

### 5.4 单位绘制成本

- 每单位 1 个 `Graphics`，只在 `dir8` / `frame` / `turretDir8` 变化时重绘。
- 移动中最多 9 fps 重绘（Walk 序列），静止时不重绘。
- `isoBody` 每次 4 个侧壁 + 1 个顶面 + 履带 2 段线 + 炮塔 3 段线，约 30 个绘制调用。

### 5.5 排序

- `L2_World` 内建筑与单位混排，`__depth` = 投影 y。
- 每帧检测顺序是否变化，只有变化时才 `setSiblingIndex`，避免 UI 重建。
- 代价：N 个实体的 `slice().sort()`，N ≈ 40 时可忽略。

### 5.6 已知限制

| 限制 | 影响 | 计划 |
|---|---|---|
| 建筑仍是直角俯视方块 | 贴菱形地基上略显不协调 | v0.6 做等距立面 |
| 迷雾不随高度投影 | 高台边缘的迷雾会盖住台面 | v0.6 引入 `sx = rx - z/2 + pad` |
| 单层地面迷雾 | 无桥/多层共存 | 随桥梁系统一起做 |
| 车辆 8 方向靠程序化绘制 | 细节不如真正的 SHP | 换 `FrameSource` 实现即可 |

---

## 6. 移动、占位与相机（v0.9）

### 6.1 一帧的移动链路

```
updateUnits
  └─ 每种指令调 u.moveStep(dt, mul)
       ├─ waitT > 0         → 原地等（不消耗路径点）
       ├─ 取路径点、限速、转向（大角度先转不走）
       ├─ canOccupy(x+dx, y+dy)?   ← 圆盘 vs 格子
       │     ├─ 是 → 直接走
       │     ├─ 否 → 单轴滑动（先 x 后 y）
       │     └─ 两轴都不行 → 停住 + blockedNow（交给卡住升级链）
       └─ 位移永远 ≤ speedCur·dt

applySeparation(u, dt)
  ├─ 每单位 pushAcc 归零
  ├─ 成对判定 → push(u, dx, dy)
  │     ├─ 目标位置不可站 → 单轴退化
  │     └─ 每帧预算 40·dt（多个邻居不会叠加成瞬移）
  └─ resolveWorldCollision(u, dt)   ← 只处理「已在实心格内」，≤110px/s 走出
```

**硬规则：任何代码都不允许把单位坐标直接设到远处的空格。** 位置只能被「速度 × 时间」或「受预算约束的推挤」改变。

### 6.2 占位查询

`Game.worldBlockedAt(x, y, r)`：把圆盘与格子求交（`r²·0.86` 容差），任一被 `isBlocked` 的格子重叠即不可站。
`PathFinder.discFree(x, y, r)` 是同一套逻辑的寻路版本，用于 `lineClear` 采样与 `clear()`。

两者必须保持一致 —— 一边允许、一边禁止，就会出现「路径穿过墙」或「明明能走却被判卡住」。

### 6.3 相机钳制

```ts
span = halfW / (2·ISO_HW) + halfH / (2·ISO_HH)   // 可见矩形在 tile 空间的半跨
rx   = (tx/ISO_HW + ty/ISO_HH) / 2                // 相机中心 → tile 坐标
rx   = clamp(rx, -N/2 + span, N/2 - span)         // 可见矩形必须在图内
tx   = (rx - ry) · ISO_HW ; ty = (rx + ry) · ISO_HH
```

因为投影对 `rx`、`ry` 可分，这个钳制是精确的：屏幕矩形的四个角反算回世界坐标后一定落在 `0..N` 内。

`minZoom` 取 1.0，保证 16:9 视口在最小缩放下仍能被钳制进地图（否则整个地图比屏幕小，必然露边）。

### 6.4 迷雾绘制

- 状态场 `st`：0 可见 / 1 已探索 / 2 边界环 / 3 次边界环 / 4 未探索。
- 按行合并连续段画**格角平行四边形**（不是边中点菱形）。
- 未探索 alpha 255；边界环 255 + 边缘外扩 0.5px + 逐格噪声小菱形。
- 段边界用同色 `stroke(1.1px)` 盖住抗锯齿缝。
- 重建节流 0.18s，并有按位签名早退。

### 6.5 性能

| 项 | 数值 |
|---|---|
| 地形菱形 | 80×80 = 6400，一次性绘制 |
| 迷雾多边形 | 每行 1–3 段 + 边界格，约 300–600 |
| 单位帧 | 8 方向 × 4 帧 / 单位 / 阵营，LRU 900 |
| 分离 | 空间网格 `query(r+36)`，成对解算一次 |

---

## 7. 移动与碰撞实现（v0.11）

### 7.1 一帧的顺序

```
update(dt)
  grid.rebuild()            // 上一帧位置，够用
  updateBuildings()         // buildup / builddown 计时
  updateUnits()             // 每种指令调用 moveStep
  resolveCollisions()       // 出墙、子格铺开、同步占格表、blocked 链
  updateProjectiles / fx
```

`moveStep` 只负责"这一步能不能走"，不负责解决阻挡。

### 7.2 步进许可

```ts
canStepTo(x, y) =
    !terrainBlockedAt(x, y, steerRadius)     // 岩石/建筑，格子判定
 && !stepBlockedByUnit(this, x, y)           // 格子容量 + 车体互穿
```

- `steerRadius = radius * 0.45`：车体贴图允许压住墙角，和原版一致。用完整半径会让
  "贴着建筑那一行的格心"（距墙正好 16px）恒定非法，采集车直接卡死。
- 车体互穿只对**车辆之间**生效；步兵靠格子容量与子格，车辆可以开进有步兵的格子
  （随后散射/碾压）。给步兵加半径判定会让一个路过的步枪兵把卡车永久顶住。

`moveStep` 依次尝试 `(x+ax, y+ay)`、`(x+ax, y)`、`(x, y+ay)`；三者都被拒时置
`blockedNow` 并记录想进入的格子，交给 `resolveCollisions`。

### 7.3 blocked 链

| 时间 | 动作 |
|---|---|
| 前方单位在移动 | 等待（`trafficT` ≤ 2.6s），不重算 |
| 0.3s | 友军静止 → `requestAside`（下一条侧移指令）；步兵 vs 步兵 → `sidestepInfantry` |
| 0.6s | `repathAround`：挡路者 3×3 加入 `avoid` 重算 |
| 1.2s | 第二次重算 |
| 1.8s | 目标附近找最近可达点 |
| 2.4s | `failMove`：清路径，`repathHold=1.5`，move/attackmove 结束指令 |

计时用**目标距离**是否缩短来复位（2px / 0.2s），而不是逐帧 `blockedNow`——后者会被
子格铺开造成的微小抖动反复清零，导致链条永不触发。

### 7.4 采集车的独立策略

采集车不进入通用 blocked 链（`order.k === 'harvest'` 直接跳过），因为它的目标会随
矿点/卸货点变化：

| 阶段 | 卡住时的处理 |
|---|---|
| toMine | 1.2s：友军挡路→让路；对方也是采集车→后退一格；否则换矿点（冷却 5s） |
| toBase | 2.2s：重新在建筑四周找卸货格 |

卸货目标是**建筑脚印外围的可用格**，并按该格已有采集车数量加权（×70），避免六台车
挤同一格。到达判定是"贴在建筑轮廓 0.95 格内"，不再要求精确点位。

### 7.5 路径后处理

- `find()` 对 `bestEffort` 的结果做**终点校验**：终点离目标超过阈值即视为不可达，
  避免"原地一步"被当成成功（曾导致单位对着墙反复起步）。
- `smooth()` 的视线检测半径 = `radius + 0.32 格`：A* 只需保证格子可站，但拉直后的
  线段会切角，用同样的半径会贴着建筑墙角切过去，单位撞上去就停。
- `avoid` 集合只在单次查询内有效，且**排除自身周围 3×3**，否则 A* 连起点都不合法。

### 7.6 主界面

- 5 张地图 = 5 组生成参数（`Core.MAPS`），选择即改 `terrain.generate(seed, preset)`。
- 8 色队色（`Core.PLAYER_COLORS`）→ `setActiveTeamColor`，作用于所有绘制函数。
- 队色写入烘焙帧缓存键：`u|id|faction|color|dir8|frame`；换局 `clearFrameCache()`。
