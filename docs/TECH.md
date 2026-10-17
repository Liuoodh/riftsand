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

`main.scene` 只有 `Canvas + Camera`，不含自定义组件（避免场景内脚本 UUID 绑定问题）。
`Boot.ts` 在模块加载时注册两个自举钩子：

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
render/CameraRig.ts  2D 相机（平移/缩放/边界钳制/平滑）
ui/UI.ts          HUD、卡片、小地图、菜单、暂停、结算
Boot.ts           入口：分辨率、输入（触摸/鼠标/键盘）、生命周期、主循环、建造预览
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

## 5. 性能预算（目标：微信小游戏中端机 50～60 FPS）

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

## 6. 小程序适配

- **输入**：只用 `input` 上的 TOUCH/MOUSE/KEY 事件，微信/抖音的环境由引擎适配；多点触控用 `event.getID()` 区分。
- **分辨率**：`view.setDesignResolutionSize(1280, 720, SHOW_ALL)`，超宽屏自动留黑边，UI 不被裁切。
- **无本地存储依赖**：v0.1 未做存档，因此不受小游戏 `wx.setStorage` 差异影响。
- **包体**：无图片/音频，构建产物主要是引擎 + 脚本。
- **待补**：抖音/微信的分享、震动反馈、性能分级（低端机降单位上限）在 v0.2 处理。

## 7. 构建与验证

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

## 8. 已知限制

1. 单位之间用"分离力"而非完整避障，狭窄路口可能轻微挤压。
2. 空中单位直线飞行，不做高度层与绕行。
3. AI 不做侦查与兵种克制决策，只按价值出兵。
4. 没有音效与音乐（v0.2 计划用 WebAudio 合成，保持零资源包体）。
