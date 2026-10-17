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

`tools/` 下两个脚本用 puppeteer-core + 本机 Chrome headless 跑真实构建产物，无需手动点击：

```bash
# 静态检查：能否启动、开局单位/建筑数量、帧率、控制台错误、关键界面截图
node tools/smoke.mjs

# 动态检查：?auto=1 进对局，内置脚本玩家 + AI 快进 6 分钟，输出经济/兵力/超武/老兵
node tools/battletest.mjs

# 触屏与系统：CDP 真实触摸事件 + 直接调用模拟 API，回归 20 项
node tools/inputtest.mjs

# 物理：地形/碰撞/碾压/弹道/防空/防穿模，回归 10 项
node tools/phystest.mjs

# 物理截图：交火爆炸与矿区作业
node tools/physshowcase.mjs
```

`inputtest.mjs` 通过 `canvas/App` 上的 `RiftApp` 实例读取 `game`、`cam`、`ui` 状态，覆盖：
框选 / 双击同类 / 双指平移与缩放 / 指令盘 / 编队 / 批量生产 / 矿脉吸附 /
姿态与路径开关 / 建筑队列就绪与放置 / 超级武器充能与伤害 / 工兵接管。
失败时返回非零退出码，可直接进 CI。

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
