# 原版全量移植矩阵

> 目标：**除「原创内容」与「明确不做」之外，原版 `src/` 的每一行逻辑都要在本工程有等价实现。**
> 判定口径不是"功能像不像"，而是"这个文件里的每个函数，在我们代码里有没有一段逐行对应的实现"。

原版规模：**1,207 个 TS 文件 / 125,799 行**。
本工程现状：**59 个 sim 文件 / 7,512 行**（`project/assets/scripts/sim/`）。

---

## 0. 三条判定原则

| 原则 | 含义 | 例子 |
|---|---|---|
| **引擎归原版** | 任何"规则、公式、状态机、时序、判定"都移植 | 护甲×弹头伤害表、寻路代价、生产时钟、C4 引信 |
| **内容归我们** | 任何"具体数值、名字、组合"由我们定义 | 铁砧装甲车 cost 700、射程 5、武器 X |
| **表现归引擎契约、资产归我们** | 逻辑层算出的偏移/帧号/角度移植；绘制与素材不移植 | `getTurretOffset()` 移植，贴图不移植 |
| **落后载体只对齐能力**（用户 2026-10-20 定） | 原版实现方式明显落后时，**能力必须完整对齐，载体换成先进方案** | SHP/VXL 调色板动画 → PNG 帧序列（已跑通）；INI 文本 → TS 对象 |

### 0.1 "只对齐能力"清单（实现不移植，能力必须完整）

| 原版载体 | 落后点 | 我们的先进方案 | 必须保留的能力 |
|---|---|---|---|
| `data/vxl` + `data/shp` + `data/pal`（6,153 行） | 8-bit 调色板索引、每一帧重复解码、VXL 体素软渲染 | PNG 帧序列 + 图集（已跑通） | 帧序列驱动、炮塔与车身分离、履带/转子/后坐力分段、色盘阵营色替换、遮挡排序键 |
| `game/ini/`（84 行） | 文本解析、字段名字符串匹配、无类型检查 | TS 对象 + 编译期类型（本次决策） | 规则字段语义与默认值 100% 对齐 |
| `gui/`（25,939 行） | React + DOM | Cocos 2D 自绘 UI | 交互语义对齐（指令反馈、队列可视化、快捷键） |
| `engine/renderable`（25,372 行） | three.js 即时 3D | Cocos 2D 等轴精灵 | 深度排序、相机、屏幕↔世界投影、单位姿态（pitch/roll/yaw） |

> 判据：**"逻辑上的每一帧做了什么"必须一样；"这一帧怎么画出来"允许不同。**

---

## 1. 豁免清单（不移植）

| 目录 | 文件 | 行数 | 豁免理由 |
|---|---|---|---|
| `game/trigger/` | 90 | 1,992 | **战役模式**（用户明确"暂且保留不开发"） |
| `gui/` | 180 | 25,939 | **UI 完全原创**（我们已有 `ui/` 自绘） |
| `engine/` | 210 | 25,372 | three.js 3D 渲染管线；我们用 Cocos 2D 等轴 |
| `network/` | 33 | 4,583 | **多人对战平台**（用户明确"暂且保留不开发"） |
| `data/` | 68 | 6,153 | VFS / VXL / SHP / TMP / INI 资源解析；我们已有 `assets/` 自研管线 |
| `tools/` | 16 | 9,275 | 地图编辑器 / 资源导出工具链 |
| `App.tsx` `main.tsx` `shell/` `test/` `performance/` | 8 | 846 | 宿主壳与压测脚手架 |
| **合计豁免** | **605** | **74,160** | 占原版 59% |

> 其中 `game/ini/`（84 行）暂列"待定"，取决于数据格式决策，见 §5-Q1。

---

## 2. 移植清单（引擎机制）

### 2.1 顶层逻辑（`game/*.ts`，29 文件 / 4,035 行）

| 文件 | 行数 | 承载机制 | 现状 |
|---|---:|---|---|
| `Game.ts` | 942 | 世界主循环、帧调度、胜负判定 | 🔶 部分（本项目 `Game.ts` 自研，需按原版重构） |
| `Warhead.ts` | 567 | **弹头：Verses 伤害表、溅射、地形改造、子武器** | ❌ |
| `Weapon.ts` | 428 | **武器：射程/冷却/弹道/报告音/多弹头** | ❌ |
| `ConstructionWorker.ts` | 384 | 建造范围推进、地形平整 | ❌ |
| `WeaponTargeting.ts` | 214 | 目标筛选、可攻击判定、优先度 | ❌ |
| `GameMap.ts` | 211 | 地图元数据、玩家出生点、触发归属 | ❌ |
| `GameFactory.ts` | 182 | 对象工厂（按 rules 造 GameObject） | 🔶 |
| `Player.ts` | 179 | 玩家：信用点、电力、生产、超武、结盟 | 🔶 `PlayerState` |
| `Alliances.ts` | 150 | 结盟矩阵、共享视野、友军判定 | ❌ |
| `BotManager.ts` | 122 | Bot 装载 | ❌（随 AI 决策） |
| `Target.ts` | 98 | 目标抽象（对象/地块/坐标） | ❌ |
| `Traits.ts` | 59 | trait 类型注册与组合 | ❌ |
| `SuperWeapon.ts` | 58 | 超武基类 | 🔶 |
| `Country.ts` | 50 | 国家修正（我们用于阵营修正） | ❌ |
| `Coords.ts` | 47 | 定点坐标、等轴投影 | 🔶 `world/Iso.ts` |
| `StartingUnitsGenerator.ts` | 47 | 开局部队生成 | ❌ |
| `GameTurnManager.ts` | 43 | 回合/帧推进 | ❌ |
| `PlayerList.ts` | 41 | 玩家列表与真人/AI 混排 | ❌ |
| `CountdownTimer.ts` | 39 | 倒计时 | 🔶 `sim/Timer.ts` |
| `Prng.ts` | 29 | **确定性随机（联机同步基础）** | ❌ |
| `GameSpeed.ts` | 16 | 速度档位 | ❌ |
| `SideType.ts` | 10 | 阵营枚举 | ❌ |
| `AttackerInfo.ts` | 4 | 击杀归属 | ❌ |
| `WeaponInfo.ts` | 2 | 武器来源信息 | ❌ |
| `WeaponType.ts` | 5 | 武器类型枚举 | ❌ |
| `GameEventBus.ts` | 60 | 事件总线 | 🔶 `events` |
| `Hashable.ts` | 2 | 哈希键 | ❌ |
| `Building.ts` | 1 | 转发 | — |

### 2.2 `game/gameobject/`（177 文件 / 16,251 行）

| 子目录 | 文件 | 行数 | 现状 |
|---|---:|---:|---|
| `trait/` | 69 | 6,930 | 🔶 **已移 25 个，待移 44 个**（清单见 §2.2.1） |
| `task/` | 43 | 6,015 | 🔶 已移 3 个（采集三件套），待移 40 个 |
| `locomotor/` | 9 | 1,343 | 🔶 已移 `Locomotor`/`Drive`/`Foot` 骨架，待移`Hover`/`Winged`/`Jumpjet`/`Missile`/`Chrono` |
| `unit/` | 14 | 1,128 | 🔶 已移 `Timer`/`ZoneType`，待移 `RangeHelper`/`LosHelper`/`MovePositionHelper`/`ScatterPositionHelper`/`CollisionHelper`/`FacingUtil`/`TargetUtil`/`VeteranLevel` 等 |
| `selection/` | 5 | 187 | ❌ |
| `infantry/` | 4 | 217 | 🔶 枚举已移，待移 `sequenceMap` |
| `common/` | 2 | 62 | 🔶 `DeathType` 已移 |
| 根 | 17 | 2,469 | 🔶 `GameObject`/`Techno`/`Vehicle`/`Building` 已移，待移 **`Projectile`(948)**/`Debris`/`Overlay`/`ObjectFactory`/`ObjectPosition`/`Aircraft`/`Infantry` |

#### 2.2.1 待移植 trait（44 个）

**战斗（4）**：`AttackTrait`(504) `ArmedTrait`(218) `VeteranTrait`(236) `AmmoTrait`(18)
**护甲与生命（5）**：`HealthTrait`(135) `AutoRepairTrait`(87) `SelfHealingTrait`(21) `InvulnerableTrait`(19) `DelayedKillTrait`(26)
**形态与特殊（11）**：`CloakableTrait`(54) `DisguiseTrait`(98) `TemporalTrait`(82) `WarpedOutTrait`(57) `MagnetizedTrait`(72) `BerserkTrait`(113) `DeployerTrait`(184) `TntChargeTrait`(65) `BridgeTrait`(70) `CabHutTrait`(102) `SpawnDebrisTrait`(54)
**精神与寄生（3）**：`MindControllerTrait`(54) `MindControllableTrait`(55) `ParasiteableTrait`(240)
**进驻（5）**：`GarrisonTrait`(135) `OpenToppedTrait`(98) `TankBunkerTrait`(113) `DockableTrait`(33) `HospitalTrait`(88)
**资源与地形（4）**：`TiberiumTrait`(52) `TiberiumTreeTrait`(62) `OilDerrickTrait`(30) `SlaveMinerTrait`(107)
**生产与建造（2）**：`FactoryTrait` 扩展段 / `CrewedTrait` 已移
**空军（4）**：`AirSpawnTrait`(246) `AirstrikeTrait`(198) `Aircraft` 相关 `AirportBoundTrait` 已移
**探测与干扰（4）**：`GapGeneratorTrait`(101) `PsychicDetectorTrait`(83) `SensorsTrait`(2) `RobotControlTrait`(51)
**杂项（4）**：`GattlingTrait`(54) `UnitOrderTrait`(229) `PipCount`/`TurretTrait` 已移

> `SuppressionTrait` `IdleActionTrait` `AgentTrait` `CrashableTrait` `HelipadTrait` `UnitReloadTrait` `HoverBobTrait` `RockingTrait`(非原版) `TilterTrait` `TransportTrait` `GunnerTrait` `SubmergibleTrait` `SuperWeaponTrait` `OverpoweredTrait` `UnitRepairTrait` `WallTrait` `SpawnLinkTrait` `MissileSpawnTrait` `UnlandableTrait` `C4ChargeTrait` `FreeUnitTrait` `DockTrait` `RallyTrait` `PoweredTrait` `HarvesterTrait` —— **已移，共 25 个**。

### 2.3 `game/rules/`（37 文件 / 2,635 行）—— ✅ **B2 已全部移植**

| 分层 | 文件 | 行数 | 承载 |
|---|---|---:|---|
| 规则容器 | `Rules.ts`(555) `TechnoRules`(703) `ObjectRules`(48) `ObjectRulesFactory`(28) | 1,334 | 总规则表、单位/建筑规则字段全集 |
| 战斗 | `WarheadRules`(81) `WeaponRules`(80) `CombatDamageRules`(40) `ProjectileRules`(57) `RadiationRules`(25) | 283 | **护甲×弹头表和伤害公式的家** |
| 地形 | `TerrainRules`(75) `LandRules`(33) `TiberiumRules`(7) `OverlayRules`(39) `SmudgeRules`(19) `DebrisRules`(46) | 219 | 通行速度、矿价、地表覆盖 |
| 通用 | `GeneralRules`(183) + `general/*`(12 文件 / 265) | 448 | 全局常量、老兵、维修、雷达、超武 |
| 其它 | `AiRules` `CountryRules` `CrateRules` `ElevationModelRules` `PowerupsRules` `SuperWeaponRules` `MpDialogSettings` `AudioVisualRules` `mpAllowedColors` | 351 | — |

> 原有三个裁剪版已按原版字段全集重写并无缝替换：`GeneralRules.ts`（自研 `GENERAL` 常量 → 原版
> `GeneralRules` 类，常量拆解去向见 `REFERENCE-PARITY.md` §24.3）、`TerrainRules.ts`
> （自研混合体 → 原版 `TerrainRules` + `LandRules` 两个类 + 内容表）。`BuildStatus.ts` 是本项目
> 的枚举，不属于本目录，保留。
> 数值内容集中在 `sim/rules/rulesContent.ts`（相当于本项目的 `rules.ini`）。

### 2.4 `game/map/`（21 文件 / 2,863 行）

| 文件 | 行数 | 承载 | 现状 |
|---|---:|---|---|
| `Terrain.ts` | 532 | **地形总类：高度图、地表类型、覆盖物、桥梁分层** | 🔶 我们自研 `world/Terrain.ts`，需重写 |
| `Bridges.ts` | 555 | **桥梁：桥面/桥墩、摧毁与修复、通行切换** | ❌ |
| `TileCollection.ts` | 319 | 地块集合、矩形遍历、环形遍历 | 🔶 `sim/Tiles.ts` |
| `MapShroud.ts` | 307 | **迷雾：按玩家分层的已探索/可见/未知** | 🔶 我们按视野位图，需按格重写 |
| `TileOccupation.ts` | 162 | 占位（1×1 与 N×N） | 🔶 `sim/TileOccupation.ts` |
| `MapBounds.ts` | 141 | 地图边界 | 🔶 |
| `PathFinder.ts`+`NodeHeap`+`SearchStatePool` | 265 | **A\* + 二叉堆 + 搜索状态池** | 🔶 `sim/Graph.ts` 自研 |
| `tileFinder/*`（6） | 362 | 环形/径向/洪泛/随机/Cardinal/方向 | 🔶 部分 |
| `BridgeOverlayTypes` `OreOverlayTypes` `OreSpread`(30) `TileOcclusion`(55) `wallTypes` | 219 | 覆盖物枚举、矿蔓延、遮挡 | 🔶 部分 |

### 2.5 其它 game 子目录

| 目录 | 文件 | 行数 | 承载 | 现状 |
|---|---:|---:|---|---|
| `order/` | 19 | 1,406 | 全部指令（移动/攻击/建造/进驻/维修/卖/集结…） | 🔶 我们用 `Order` 联合类型，需按原版类层次重写 |
| `action/` | 34 | 1,366 | 动作（下单/寻路/部署/超武投放） | ❌ |
| `player/` | 7 | 668 | `Player` 完整字段 + `Production` + `PowerTrait` + `ProductionQueue` | 🔶 四件套已移骨架 |
| `superweapon/` | 11 | 748 | 11 种超武（核弹/闪电/铁幕/超时空/基因/心灵/伞兵/侦察/力场/…） | 🔶 只有状态机，无效果实现 |
| `trait/`（非 gameobject） | 30 | 1,902 | `DamageTrait` 族 / `SellTrait` / `CaptureManager` / `Veterancy` / `SpawnDebris` 等**对象级 trait** | ❌ |
| `math/` | 14 | 1,245 | 定点数、向量、插值、曲线、几何 | 🔶 `sim/Math2.ts`/`Curves.ts` |
| `art/` | 6 | 742 | 炮塔偏移、炮口坐标、动画帧号、履带滚动 | 🔶 `render/Art.ts` 部分 |
| `event/` | 68 | 529 | 事件类型定义（trait 全靠它） | 🔶 部分 |
| `type/` | 11 | 164 | 通用类型 | 🔶 |
| `theater/` | 6 | 432 | 剧场（温带/雪地/沙漠）抽象 | ❌ 只留抽象，具体剧场是我们要原创的 |
| `gameopts/` | 4 | 217 | 对局选项 | ❌ |
| `bot/` | 4 | 159 | Bot 基类 | ❌ |

### 2.6 `util/`（31 文件 / 1,242 行）

`math` / `geometry` / `typeGuard` / `disposable` / `event` / `timer` / `dom`（后者豁免）。
核心是 `math`（定点插值、角度归一化、`clamp`）与 `geometry`（矩形/线段相交、点到线段距离）。

---

## 3. 现状汇总

| 分类 | 文件 | 行数 |
|---|---:|---:|
| 原版总计 | 1,207 | 125,799 |
| 豁免（不做 / 原创） | 605 | 74,160 |
| **应移植** | **602** | **51,639** |
| 其中已移植 | 279 | 24,038 |
| **待移植** | **323** | **≈27,601** |

> 已移植的 24,038 行 = B1 数学地基（40 / 1,411）+ B2 规则全表（37 / 2,635）
> + B3 战斗数学（33 / 3,258）+ B4 地图地形（20 / 4,074）+ B5a 对象模型（33 / 3,004）
> + B6a 任务系统与事件目录（81 / 785）+ B6b 移动子系统（15 / 2,770）
> + 此前 19 / 6,101。
> B4 多出的 1,200 行是注释与 duck-type 接口，其内容层 `sim/content/`（2 / 273）
> 是原创代码，不计入移植；同时删掉了 ≈1,000 行自研旧实现（`Tiles` / `Passability`）。
> B5a 同理多出 ≈550 行注释；它的 `factory()` 装配（约 700 行）随 trait 批次落地，
> 因此计入 B6d 而非本批。
>
> **计数口径修正（v0.25-B6a）**：B5/B6 的原始估算基于目录列表，未逐文件核对，
> 偏低约 60%。本轮复核后按实测重划：`gameobject/trait` 实为 **69 实现文件 /
> 6,671 行**（原估 44 / 3,800），`gameobject/task` 实为 **43 / 4,439**
> （原估 40 / 5,700），`event` 只有 **68 / 529**（原估计入 B10 的 68 文件未给行数）。
> 另外原版 `game/gameobject/` 根还有 `Debris`(117) 此前漏列。
>
> 也就是说：**剩余工作量仍略大于此前全部工作**，且集中在 `trait/`（B6d）
> 与 `Game.ts` 编排层（B9）——"对象行为"与"装配"两块，行数密度和耦合度都高于
> 已完成的七批。

---

## 4. 分批计划（严格自底向上，每批可独立验收）

| 批次 | 内容 | 文件 | 行数 | 依赖 | 状态 |
|---|---|---:|---:|---|---|
| **B1 地基** | `util/math`+`geometry`、`game/math/*`、`game/type/*`、`Prng`、`Coords` | 40 | 1,411 | 无 | ✅ `8dd4d08` |
| **B2 规则全表** | `game/rules/**` 全部 37 文件（含 WarheadRules 的 Verses 表） | 37 | 2,635 | B1 | ✅ |
| **B3 战斗数学** | `Warhead`、`Weapon`、`WeaponTargeting`、`Target`、`trait/DamageTrait` 族 | 33 | 2,600 | B2 | ✅ 完成 |
| **B4 地图地形** | `game/map/**` 21 文件（Terrain 重写、Bridges、MapShroud、PathFinder、OreSpread、TileOcclusion） | 21 | 2,863 | B2 | ✅ 完成 |
| **B5a 对象模型** | `gameobject/` 根 13（`GameObject`/`Techno`/四个兵种/`Overlay`/`Smudge`/`Terrain`/`Bridge`/`Weapon`/`ObjectPosition`）+ `locomotor` 7 + `unit` 8 + `selection` 5 + `Traits` + `rampHeights` | 33 | 3,004 | B3 B4 | ✅ 完成 |
| **B5b 装配与弹道** | `Projectile`(948) + `ObjectFactory`(266) + `Debris`(117)。`Projectile.factory` 与 `ObjectFactory` 的装配清单本身就是 trait 目录，故整批后置（两个 aircraft locomotor 已随 B6b 落地） | 3 | 1,331 | B5a → **B6d** | ⏳ |
| **B6a 任务系统与事件** | `task/system` 8（`Task`/`TaskRunner`/`TaskStatus`/`TaskGroup`/`CallbackTask`/`WaitTicks`/`WaitMinutes`/`TargetLinesConfig`）+ `event/**` 68 + `GameSpeed` | 81 | 785 | B5a | ✅ 完成 |
| **B6b 移动子系统** | `MoveTrait`(301) + `task/move` 8（`MoveTask` 1,037、`MoveInWeaponRange` 286、`MoveAside`/`MoveTarget`/`MoveInside`/`MoveOutside`/`MoveToBlock`/`AttackMove`）+ `MoveToDock`(151) + `ScatterTask`(40) + `Winged`/`Jumpjet` locomotor(659) + 2 个 `Notify*` 接口。`ExitFactoryTask`/`AttackMoveTargetTask` 依赖 `AttackTask`，后移到 B6c | 15 | 2,770 | B6a | ✅ 完成 |
| **B6c 其余任务** | `task` 其余 21（`AttackTask` 682、`harvester/*`、`morph/*`、`Enter*Task`、`GarrisonBuildingTask`、`ExitFactoryTask`、`AttackMoveTargetTask` …）+ `UnitOrderTrait` 接线 | 21 | ≈2,212 | B6b | ⏳ |
| **B6d trait 全族** | 剩余 63 个 `gameobject/trait/*` + 14 个 `interface` + 四个兵种类与 `ObjectFactory` 的 `factory()` 装配（≈700 行） | 63 | ≈6,100 | B6c | ⏳ |
| **B7 指令与动作** | `order/**` 19 + `action/**` 34 | 53 | 2,772 | B6d | ⏳ |
| **B8 玩家与超武** | `player/**` 7 + `superweapon/**` 11 + `ConstructionWorker` + `GameFactory` + `Alliances` + `StartingUnitsGenerator` + `Country` | 28 | 3,700 | B7 | ⏳ |
| **B9 编排层** | `Game.ts` 重构 + `World` + `GameMap` + `GameTurnManager` + 事件分发接线 | 90 | ≈3,300 | B8 | ⏳ |
| **B10 AI（可选）** | `ai/thirdpartbot/**` 59 | 59 | 11,481 | B9 | ❌ 不做（保留现有 AI） |

**B1–B9 合计：≈374 文件 / ≈27,600 行。**

> 批次编号在 v0.25-B6a 重排过一次：原 B6「trait 补齐」与 B7「Task 全族」
> 的依赖方向是反的（每个 trait 都 `import` task），因此拆成 B6a→B6d 四段，
> 并接上原来的 B7–B11。原文的 `event/**` 68 从 B10 前移到 B6a，
> 因为它是 task/trait 的公共依赖。

每批的验收铁律：
1. `tsc -p tsconfig.check.json` **0 error**
2. 该批涉及的旧自研代码必须**删除**，不留双份实现（否则等于没移植）
3. 全量回归脚本全绿（19 个 + 每批新增的专项脚本）
4. 该批交付后立即 commit + push `dev-liu`，附"逐行对应表"到 `REFERENCE-PARITY.md`

---

## 5. 两个待拍板的决策

**Q1 · 数据格式**：原版所有数值来自 `rules.ini`，由 `game/ini/` + `data/` 解析成 `TechnoRules`。
我们的数值现在是 `Core.ts` 的 TS 对象（属于"原创内容"）。

- A（推荐）保留 TS 数据对象，但把字段语义与 `TechnoRules`/`ObjectRules` **逐字段对齐**；
  移植 `rules/*` 的定义与计算逻辑，不移植 INI 解析器。
- B 移植 INI 解析器，把 `Core.ts` 的 100+ 单位/建筑重写成 `rules.ini` 文本（更贴近原版，但等于把原创内容翻译一遍）。

**Q2 · AI**：原版 `ai/thirdpartbot` 是 11,481 行的完整 Bot 框架（经济/建造序列/威胁评估/小队指挥）。
- A（推荐）保留现有 `AI.ts`，只对齐它的接口到新引擎；B11 不做。
- B 完整移植，我们的 AI 会变成原版风格（稳健、会攒兵、会侦察）。

这两条的答案会决定 B1–B10 里几百个文件的 import 形态，先定再开工。
