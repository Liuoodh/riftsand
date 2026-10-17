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
core/Core.ts      常量、色板、解析色值、阵营/建筑/兵种数据表、伤害矩阵、数学工具
world/Terrain.ts  点对称程序化地图（沙地/沙丘/岩石/矿脉），确定性随机
world/Path.ts     A*（八向、禁止切角）+ 视线平滑，输出世界坐标路径点
game/Entities.ts  Unit / Building / Projectile / Fx / SpatialGrid（纯数据 + 少量行为）
game/Game.ts      模拟核心：建造、生产、采集状态机、战斗、溅射、迷雾、胜负、统计
game/AI.ts        建造顺序 + 经济 + 成波进攻 + 回防
render/Art.ts     所有矢量美术（单位、建筑、矿脉、岩石、灌木、木箱）
render/Views.ts   实体视图、血条、特效、地形渲染、战争迷雾贴图、小地图数据
render/CameraRig.ts  2D 相机（平移/缩放/边界钳制/平滑，双指合并运算）
ui/UI.ts          HUD、卡片、小地图、菜单、暂停、结算
ui/Overlay.ts     触屏覆盖层：编队条、长按指令盘、框选矩形
Boot.ts           入口：分辨率、手势状态机、生命周期、主循环、建造预览
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

模拟顺序：建筑（建造/生产/炮塔）→ 单位（指令/采集/开火）→ 分离力 → 弹道 → 特效 → AI → 迷雾(5Hz) → 清理死亡 → 胜负。

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

## 6. 性能预算（目标：微信小游戏中端机 50～60 FPS）

| 项 | 预算 | 现状 |
| --- | --- | --- |
| 同屏单位 | 120 | 单局峰值约 60～80 |
| DrawCall | < 350 | 每个实体 3 个 Graphics（本体/选中环/血条），靠 `active` 与视锥剔除压到 ~120 |
| 模拟耗时 | < 6ms/帧 | 空间网格（96px 单元）做邻近查询，A* 仅在需要时重算 |
| 迷雾贴图 | 64×64 RGBA 上传，5Hz | 约 16KB/次 |
| 小地图 | 64×64 RGBA，3.5Hz | 复用地形底图 + 叠加迷雾/单位点 |

优化点（已验证稳定，仍可继续）：
- 血条仅在本体掉血或选中时重绘；
- 卡片仅在"列表签名"变化时重建；
- 屏幕外实体跳过位置更新（但仍在模拟中）。

## 7. 小程序适配

- **输入**：只用 `input` 上的 TOUCH/MOUSE/KEY 事件，微信/抖音的环境由引擎适配；多点触控用 `event.getID()` 区分。
- **分辨率**：`view.setDesignResolutionSize(1280, 720, SHOW_ALL)`，超宽屏自动留黑边，UI 不被裁切。
- **无本地存储依赖**：v0.1 未做存档，因此不受小游戏 `wx.setStorage` 差异影响。
- **包体**：无图片/音频，构建产物主要是引擎 + 脚本。
- **待补**：抖音/微信的分享、震动反馈、性能分级（低端机降单位上限）在 v0.2 处理。

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

`tools/` 下两个脚本用 puppeteer-core + 本机 Chrome headless 跑真实构建产物，无需手动点击：

```bash
# 静态检查：能否启动、开局单位/建筑数量、帧率、控制台错误、关键界面截图
node tools/smoke.mjs

# 动态检查：?auto=1 进对局并用 window.__riftsandGame 快进模拟，输出各时间点经济/兵力/胜负
node tools/battletest.mjs

# 触屏手势：用 CDP 真实派发触摸事件，回归框选/双击/双指/长按/编队/批量生产/吸附
node tools/inputtest.mjs
```

`inputtest.mjs` 通过 `canvas/App` 上的 `RiftApp` 实例直接读取 `game`、`cam`、`ui.overlay` 状态，
断言 14 项手势行为；失败时返回非零退出码，可直接进 CI。

为此保留两个开发钩子（不会影响正常玩家）：

| 钩子 | 作用 |
| --- | --- |
| `?auto=1` | 跳过主菜单，直接以「磐岩联合 / 标准」开局 |
| `window.__riftsandGame` | 暴露当前 `Game` 实例，供脚本快进与读取统计 |

## 9. 已知限制

1. 单位之间用"分离力"而非完整避障，狭窄路口可能轻微挤压。
2. 空中单位直线飞行，不做高度层与绕行。
3. AI 不做侦查与兵种克制决策，只按价值出兵。
4. 没有音效与音乐（v0.2 计划用 WebAudio 合成，保持零资源包体）。
