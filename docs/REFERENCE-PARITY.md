# 原版实现对照（REFERENCE PARITY）

> 参考对象：`RedAlert2-Android-main/redalert2/src`（Chrono Divide 血统的 TypeScript 引擎，12.6 万行）。
> 本文只记录**读代码得到的事实**与**我们当前的偏差**，不含推测。所有原版结论均带 `文件:行号`。
> 路径前缀简写：`R/` = `RedAlert2-Android-main/redalert2/src/`。

---

## 0. 结论先行：四处方向性错误

v0.4 我按"给它加物理"的思路写了成对圆形碰撞、质量位移分摊、侧向让位、速度阈值碾压。**这不是红警的模型**，是另一种游戏（更像《帝国时代》的软推挤）。手感不对不是因为参数没调好，而是模型本身选错了。

| # | 方向性错误 | 本质 |
|---|---|---|
| **E1** | **红警的"物理"是网格占用 + 离散状态机，不是连续刚体** | 单位没有半径、没有质量、没有成对物理检测；互斥靠"格子里有没有别人"，冲突时**停车等待**或**推它让路**。我做的连续互推是另一套东西。 |
| **E2** | **转向是移动的前置条件，不是伴随行为** | 车体朝向不达路径方向时 `velocity = 0` 并先跑 `TurnTask`。这一条直接决定"坦克看起来像坦克"还是"像被平移的贴图"。 |
| **E3** | **单位是"帧序列 + 8 方向"的位图，不是每帧矢量重绘** | 步兵 SHP 8 向 × N 帧，车辆 SHP 8 向（或 VXL 真 3D），帧号 = `startFrame + facingMult*facingNumber + animFrame`。矢量重算永远没有步态、没有车体侧倾、没有炮塔独立转动。 |
| **E4** | **地图是等距投影 + 整数高度层 + 坡道插值** | 30px 屏幕格 / 256 lepton，`z` 为整数层，格内 `rampType 1..20` 双线性插值出**平滑斜坡**。我们是 64×64 直角俯视网格、零高度。 |

> 一句话：**红警是"等距网格上的离散代理人"，我做的是"俯视平面上的连续刚体"。** 这是两种架构，不是两档参数。

---

## 1. 地图与坐标（`game/map/`、`game/Coords.ts`、`engine/IsoCoords.ts`）

### 事实

- 屏幕瓦片 30px、世界 256 lepton/格、`ISO_WORLD_SCALE = 256/30 ≈ 8.533`（`R/game/Coords.ts:5-7`）。
- 等距投影（世界→屏幕）：`xs = x/scale; ys = y/scale; screen = (xs - ys, (xs + ys) / 2)`（`R/engine/IsoCoords.ts:20-25`），逆变换在 `:31-34`。
- 相机是**真 3D 正交**：`alpha = π/6, beta = π/4`，`zScale = cos45 / cos30 ≈ 0.8165`（`R/game/Coords.ts:8-11`、`R/engine/renderable/WorldScene.ts:106-113`）。
- 高度：`tile.z` 为 **uint8 整数**，地图实际按 **2 的步进**使用（`R/data/MapFile.ts:182`、`R/game/GameMap.ts:164-168`）。世界高度 = `z * 128 * zScale ≈ 104.5 / 级`（`R/game/Coords.ts:24-29`）。
- **坡道是格内浮点插值**：`rampType 1..20` 在格内双线性混合四角高度 0/1/2（`R/game/gameobject/ObjectPosition.ts:184-192` + `R/game/theater/rampHeights.ts:1-23`）。单位世界高度 = `tileHeightToWorld(tile.z + rampHeight + tileElevation)`（`R/game/gameobject/ObjectPosition.ts:199-205`）。
- **sub-tile 不是 4×4 网格**：每格定位是"格 + 5 个偏移点"——0=格中心，1..4=四角 `±1/4` 格（`R/game/gameobject/ObjectPosition.ts:171-183`）。步兵只用其中 3 个：`SUB_CELLS = [2,4,3]`（`R/game/gameobject/Infantry.ts:15`）。
- 占用表是二维 `Set<obj>`，一格可挂多个对象，**不是位掩码**（`R/game/map/TileOccupation.ts:11,63-74`）；建筑 footprint = `art.foundation` 矩形。
- 地形类型来自 **TMP 图块头**的 `height / terrainType / rampType` 三字节（`R/data/TmpImage.ts:44-46`），不是地图文件。
- 两层地形分类：`TerrainType` 14 种（`R/engine/type/TerrainType.ts:1-14`）→ `LandType` 11 种（Clear/Road/Rock/Beach/Rough/Railroad/Weeds/Water/Wall/Tiberium/Cliff，`R/game/type/LandType.ts:2-14`）。
- 通行/速度/建造全部读 rules.ini 的 `[LandType]` 段（`R/game/rules/Rules.ts:246-254`、`LandRules.ts:9-14`），且**按 8 种移动类型各配一个速度**：`SpeedType = Foot/Track/Wheel/Hover/Float/FloatBeach/Amphibious/Winged`（`R/game/type/SpeedType.ts`）。同一块沙丘，履带和步兵的速度衰减是**两个独立数值**。
- 迷雾：每格 1 字节，低 3 位是类型（Unexplored / TemporaryReveal / Explored）；尺寸含 `padding(maxHeight/2)`，坐标 `sx = rx - z/2 + padding` —— **迷雾是按高度投影的 2D 位图**（`R/game/map/MapShroud.ts:5-12,64-94`）。

### 我们的偏差

| 项 | 原版 | 我们 v0.4 |
|---|---|---|
| 投影 | 等距 30px + 正交 3D 相机 | 直角俯视 32px（`Core.ts:133 TILE=32`，`MAP_TILES=64`） |
| 高度 | 整数 z 层 + `rampType` 格内插值斜坡 | 不存在 |
| sub-tile | 格 + 5 点，步兵 3 格位 | 不存在（只有浮点 x/y） |
| 占用 | `Set<obj>` 一格可多对象 | 不存在（用圆形碰撞代替） |
| 地形 | 11 类 LandType × 8 种 SpeedType 速度表 | 4 种地形 × 手写倍率（`Terrain.speed`） |
| 迷雾 | 高度投影位图 + 三态 + 临时揭示 | 直角格布尔可见 |

---

## 2. 移动（`game/gameobject/locomotor/`、`task/move/MoveTask.ts`）

### 事实

- 速度单位是 **leptons / tick**：`min(256, 256 * speed / frameRate)`，1 格 = 256 leptons，基准 15 tick/s（`R/game/rules/ObjectRules.ts:17-18`、`R/game/Coords.ts:6`）。
- 单帧推进就是**直线插值**：`actualDistance = min(|target - pos|, speed)`，方向向量 `setLength(actualDistance)`（`R/game/gameobject/locomotor/DriveLocomotor.ts:146-161`）。没有加速度积分（只有 `rules.accelerates` 的单位走一条特殊的加速/刹车曲线）。
- **facing 是 0–360 度**，不是 0–255。每 tick 最多转 `rot` 度（`R/game/gameobject/unit/FacingUtil.ts:4-18`；`rot = ROT/256*360`，`R/game/rules/ObjectRules.ts:20-22`）。
- **起步必须先转到位**：`facing` 不等于路径方向时 `velocity = 0`，返回 `[new TurnTask(facing)]`（`R/game/gameobject/locomotor/DriveLocomotor.ts:86-93`）。`TurnTask` 每 tick 只转 `rot` 度（`R/game/gameobject/task/TurnTask.ts:10-19`）。
- 路径是**瓦片序列，且终点排在数组最前**（`PathFinder` 从终点回溯，`R/game/map/pathFinder/PathFinder.ts:39-47`）。
- 到达判定**没有半径阈值**：`distance < speed` 即本帧走完（`DriveLocomotor.ts:146-161`）；终点用瓦片距离 `closeEnoughTiles` 比较（`MoveTask.ts:384-397`）。
- 速度是**一串乘子**：`rules.speed × 老兵 × 箱子 × (车辆血量≤50 且非 Hover → 0.75) × (1 - speedPenalty)`（`R/game/gameobject/trait/MoveTrait.ts:110-120`），地形系数再乘一次（`DriveLocomotor.ts:113-120`）。`speedPenalty = 0.5` 由攻击/停止指令写入。
- 唯一"平滑驾驶"：夹角 < 90° 且有动量时，构造 **直线 + 二次贝塞尔 + 直线** 的曲线，按弧长推进（`DriveLocomotor.ts:44-69,129-144`）。

### 我们的偏差

- 我们做的是**加速度逼近 + 转向限幅 + 边走边转**（`Unit.moveStep`）。原版是**先停机转向、再直线位移**。这是手感差异的第一来源。
- 我们用 `px/s`，原版是 `lepton/tick`。数值不可比，导致地形/武器/速度三套数值无法互相校准。
- 我们有路径平滑与 `lineClear`；原版**完全没有平滑**，靠"转向惩罚 + 逐格 waypoint"自然形成折线。

---

## 3. 碰撞、让路、碾压（`MoveTask.ts`、`MoveTrait.ts`、`MoveAsideTask.ts`）

### 事实

- **没有单位半径、没有成对物理检测、没有质量位移、没有位置分离**。互斥靠瓦片占用表 + `QuadTree technosByTile`（`R/game/map/TileOccupation.ts:11,66-88`、`R/game/GameMap.ts:79,100-108`）。
- 阻挡只在与 waypoint 相关时检查 `map.terrain.findObstacles(node, unit)`（`MoveTask.ts:605-608`），不是每帧全量两两。
- 重叠时**只停车等待**，不改坐标：置 `collisionState = CollisionState.Waiting` 并 `velocity = 0`（`MoveTask.ts:839-845`）。状态只有 `Waiting / Resolved`（`MoveTrait.ts:88-91`）。
- **显式推挤**存在：挡路者空闲时给它压一个 `MoveAsideTask`（`MoveTask.ts:788-794`），该任务以 **45° 扇区**找空位，可**链式**推同格友军（`MoveAsideTask.ts:33-60,84-90`）。
- 堵死降级链：友军忙 → `WaitTicksTask(40)`；头对头（facing 差 180°）→ **直接停车等待**；前方慢车同向 ≤45° → 尝试回退 5 格绕行；planning 超 `MAX_PLANNING_TICKS = 200` 强制重算；**连续 5 次不可达才 Fail**（`MoveTask.ts:34-36,500-505,544-553,760-786,810-838`）。
- 步兵每格最多 3 人、按 subCell 错位，同格超 2 人或同 subCell 则不可停（`MoveTask.ts:362-373,985-1009`）；车辆**整格独占**（`MovePositionHelper.ts:113-121`）。
- **碾压不看速度**：在**换瓦片的那一刻**判定 `if (gameObject.crusher)`（`MoveTrait.ts:240-259`）。被碾方要求 `rules.crushable`（默认仅步兵为真，`ObjectRules.ts:33`），排除空降姿态与友军。寻路阶段把可碾物体视为**可通行**（`MoveTask.ts:615-620`）。
- `weight` 只用于沉船判定，**不参与推挤**（`Vehicle.ts:76-77`）。
- 无斥力向量场、无局部 steering（`MoveAsideTask` 之外）。

### 我们的偏差（这是 E1 的核心）

我们写了 `applySeparation`：成对解算、质量加权位移、对冲侧向让位。原版**完全没有这一层**。我们把"挤开"做成了位置修正，原版把"挤不过去"做成了**状态和时序**（等待 40 tick、推它走 45°、头对头就僵住）。

结论：v0.4 的碰撞要**删掉重写**，不是调参。碰撞层应改为：`TileOccupation`（`Set<obj>`）+ `subCell` 分配 + `CollisionState` + `MoveAsideTask` + `Crusher 换格判定`。

---

## 4. 寻路与地形（`game/map/Terrain.ts`、`pathFinder/`）

### 事实

- A* + 二叉堆（`pathFinder/NodeHeap.ts:20-31`）。
- 8 邻居，代价 = **八角距离** `dx + dy + (√2-2)*min`（`Terrain.ts:72-76`）；启发式同式 **再 +0.2 转向惩罚**（`Terrain.ts:89-97`）——因此**启发式故意不可采纳**，用来让路径更直。
- **不禁止切角**（`Terrain.ts:366-376` 只检查目标格）。
- **按移动类型分层建图**：`speedType + onBridge` 各一张图（`Terrain.ts:132-134`），桥节点 id 加 `_bridge` 后缀。这解决了"履带能走、步兵不能走"的差异化寻路，而不是一个全局代价场。
- 相邻格连通要求 `|Δz| ≤ 1`；**有桥的一侧必须 Δz = 0**（`Terrain.ts:350-365`）。
- 无 zone/subzone，改用地块"**岛**" flood-fill（`Terrain.ts:381-403`）；起终点不同岛 → 直接返回空或就近兜底。
- 预算：默认 `maxExpandedNodes = Infinity` + `bestEffort = true`；MoveTask 全阻塞时 `min(300,...)`；局部绕行 `15`；AI `1500`（`Terrain.ts:149`、`MoveTask.ts:294-305,718,824`）。
- 终点不可达时先 `RadialTileFinder` 半径 **5 / 15** 找替代终点且要求 `|Δz| < 2`（`Terrain.ts:195-203`）。
- 路径是**瓦片序列** `{tile, onBridge}[]`，无平滑无拉直。

### 我们的偏差

| 项 | 原版 | 我们 |
|---|---|---|
| 切角 | 不禁止 | 禁止 |
| 启发 | 八角 + 0.2 转向惩罚（不可采纳） | 严格可采纳 |
| 分层 | 按 speedType/onBridge 多张图 | 单图 + 代价场 |
| 平滑 | 无 | 有视线平滑 |
| 高度 | `Δz ≤ 1` 连通约束 | 无高度 |
| 兜底 | 半径 5/15 找替代终点 | `bestEffort` 走最近可达点 |

---

## 5. 渲染与动画（`engine/renderable/`、`game/art/`、`data/`）

### 事实（E3 的证据）

- **步兵 = SHP 位图帧序列**（`R/engine/renderable/entity/Infantry.ts:532`，解码 `R/data/ShpFile.ts:29-96`）。
- **车辆默认 SHP，`Voxel=yes` 才走 VXL**（`R/game/art/ObjectArt.ts:237`、`R/engine/renderable/entity/Vehicle.ts:739-745`）；**飞机一律 VXL**（`Aircraft.ts:330-350`）。
- **建筑 = 主 SHP（单图）+ 多个动画 SHP 聚合**（`Building.ts:239-268`、`builder/ShpAggregator.ts:11-36`）。
- VXL **不是预渲染精灵，是真 3D 网格**：span 扫描生成三角面，顶点色 = 调色板索引，法线按模式选 16/36/64/245 条表（`builder/vxlGeometry/VxlGeometryMonotoneBuilder.ts:6-159`、`data/vxl/Section.ts:66-76`）。几何按 section 缓存（`VxlGeometryPool.ts:36-43`）。HVA 每 125ms 一帧控制 section 的 4×3 矩阵（`Section.ts:77-87`）。
- **朝向 → 帧号**（步兵 8 向，facing 用度）：
  ```ts
  computeFacingNumber(direction) {
      return Math.round((((direction - 45 + 360) % 360) / 360) * 8) % 8;
  }
  frameIndex = startFrame + facingMult * facingNumber + animFrame;
  ```
  （`R/engine/renderable/entity/Infantry.ts:465-479`）
- 车辆朝向帧数由 `art.facings` 决定（默认 8），帧号分 `stand / walk / firing` 三套（`Vehicle.ts:669-686`）；VXL 车辆**无朝向帧**，直接 `rotation.y` 连续旋转（`Vehicle.ts:513-514`）；**炮塔与炮管独立旋转/俯仰**（`Vehicle.ts:516-546`）。
- 帧率：`Sequence = Start,Count,FacingMult,OnlyFacing`；`Rate` 单位是**帧/分钟**，`rate = Rate/60`，默认 900 → **15fps**（`R/game/art/SequenceReader.ts:3-27`、`R/engine/AnimProps.ts:31-42`）。序列类型 **35 种**（Ready/Walk/FireUp/Die1…，`SequenceType.ts:1-37`）。
- 建筑主图 4 帧：正常 / 受损 / 进驻 / 废墟（`Building.ts:748-759`）；动画类型 IDLE/PRODUCTION/ACTIVE/SPECIAL/SUPER/BUILDUP（`BuildingAnimArtProps.ts:5-36`），`ActiveAnimX/Y` 是**像素 drawOffset**（`Building.ts:967-975`）。
- **影子 = 同一张 SHP 的后半帧**（`numImages/2 + frameNo`），纯黑调色板、`opacity 0.5`、`flat` 贴地（`ShadowRenderable.ts:23-30,71-95`）。VXL 走真实 shadow map；飞行器用圆形 `BlobShadow` 贴地（`BlobShadow.ts:22-60`）。
- **受伤没有白闪**：建筑靠换帧，选中/高亮是 `extraLight` uniform 增亮（`HighlightAnimRunner.ts:25-27`、`ExtraLightHelper.ts:4-6`）；铁幕 = 红光脉冲。
- 排序：地面精灵按 `(x+z)` → `(x-z)` → `frameNo` 画家序重排（`MapSpriteBatchLayer.ts:106-117`）；单位/建筑靠 **3D 深度缓冲**；桥低层 `renderOrder=-1`、高层 `1` 且 `depthTest=false`、桥上单位 `2`（`Overlay.ts:268-285`）。
- 后端：Three.js WebGL + 正交等距相机；SHP = quad + R8 图集，单批 10000 精灵一次 drawcall（`BatchShpBuilder.ts:56,102-150`）；VXL 用 `PalettePhongMaterial` 复刻零售版光照 `(0.8 + 1.3*dotNL) * cellLight`（`paletteShaderLib.ts:101-122`）。
- 特效：爆炸 = SHP 动画对象播完自删（`WarheadDetonateFxHandler.ts:34-58`）；烟雾 = SPE 粒子；碎片 = VXL 刚体 + 角速度（`Debris.ts:60-90`）。**伤害不由动画帧触发**——模拟层先结算（`Infantry.ts:237-286`）。

### 我们的偏差

| 项 | 原版 | 我们 v0.4 |
|---|---|---|
| 单位表示 | SHP 帧 / VXL 网格 | `Graphics` 每帧矢量重绘 |
| 朝向 | 8 方向帧索引 | `node.angle = atan2` 连续旋转 |
| 帧序列 | 35 种 × Rate 帧率 | 无（只有程序化起伏/后坐） |
| 炮塔 | 独立朝向 + 俯仰 | 整机一起转 |
| 建筑动画 | 主图 4 态 + 多段 ActiveAnim 聚合 | 单一绘制 + 进度蒙层 |
| 影子 | SHP 后半帧 / shadow map / Blob | 无 |
| 排序 | 画家序 `(x+z)` + 深度缓冲 + 桥分层 | 固定图层 L0/L1/L2/L3 |
| 高亮 | `extraLight` 增亮 | 描边 |

---

## 6. 武器、伤害、爆炸（`game/Weapon.ts`、`Projectile.ts`、`Warhead.ts`）

### 事实

- 弹道**不是枚举**，是 INI 里 `Projectile=` 指向的对象 + 布尔标志组合：`Arcing / Inviso / ROT / Vertical / Level / FlakScatter / Inaccurate`（`R/game/rules/ProjectileRules.ts:37-55`）。
- **直线/瞬发弹的速度是 `Infinity`**：`!rot || inviso || isLaser || isElectricBolt` 时 `computeSpeed` 返回 `Infinity`（`R/game/Weapon.ts:206-217`）。也就是"子弹"根本没有飞行时间。
- 追踪：`isHoming() = !!rot && !arcing`（`Projectile.ts:510-512`）；抛物：`arcing`，逐帧按重力公式重算 y（`Projectile.ts:386-403`）。
- 弹丸是**独立 GameObject 逐 tick 积分**（`Projectile.ts:239-465`）。
- **命中判定是"点/格"，不是线段扫掠**：目标距离 < 本帧步长，或在"新位置所在格"判定（`Projectile.ts:332-364`、`CollisionHelper.ts:25-75`）。只有声波武器做逐点扫掠。
- 伤害公式（`Warhead.ts:273-330`）：
  ```
  dmg = baseDamage
  if (prone && !radiation && !chrono) dmg *= ProneDamage
  armorType = isTerrain ? Wood : rules.armor
  dmg *= Verses[armorType] ?? 1
  dmg /= veteranArmorMultiplier
  dmg /= crateArmorBonus
  dmg = dmg > 0 ? floor(dmg) : ceil(dmg)
  ```
- **`ArmorType` 10 种**：None / Flak / Plate / Light / Medium / Heavy / Wood / Steel / Concrete / Special（`R/game/type/ArmorType.ts:1-13`）。
- 溅射：`CellSpread` 单位是**格**；衰减 `lerp(damage, PercentAtMax*damage, distance/cellSpread)`（`Warhead.ts:468-472`）。**`AffectsAllies` 默认 true —— 会误伤友军**，也能自伤（`WarheadRules.ts:46`、`Warhead.ts:461-465`）。
- 连发间隔：无配置时 `random(3,5)` tick；整轮冷却 `rof` tick（`Weapon.ts:328-340,264-272`）。
- 射程：**中心到中心、含 z**，除 256 得格；打大型建筑加 `ceil(min(w,h)/2)`（`RangeHelper.ts:113-169`）。
- 视线：`LosHelper` Bresenham 检查 Wall/Cliff（`LosHelper.ts:41-80`）。
- 前摇：`art.fireUp` 帧数 → `AttackState.FireUp`，不是独立字段（`AttackTask.ts:636-640`）。
- 爆炸动画按伤害档选：`AnimList[floor(damage/25)]`（`Warhead.ts:552-565`）。
- 受伤状态：`health > 100*ConditionYellow` 绿 / `> 100*ConditionRed` 黄 / 否则红（`HealthTrait.ts:26-32`）；`health < 50` 挂冒烟粒子（`DamageSmokePlugin.ts:25-49`）。
- 老兵：伤害乘、ROF 除、**受方装甲除**、**射程不变**、精英换武器（`Projectile.ts:591-603`、`Warhead.ts:307-312`、`Weapon.ts:235-262`、`VeteranTrait.ts:125-130`）。

### 我们的偏差

- 我们有速度 1050 的"子弹"，原版子弹是瞬发（`Infinity`）。我们多算了一次飞行时间。
- 我们**没有 Verses × ArmorType 矩阵**，只有 `armor` 标签 + 手写倍率。这是红警战斗深度的根。
- 我们用线段扫掠命中，原版是点/格判定。我们更"准"，但与原版手感不同（原版会漏、会打偏）。
- 我们默认不误伤友军，原版**默认误伤**。
- 我们没有 `LosHelper` 式墙体/悬崖视线遮挡（只有弹道 z 的粗略判定）。

---

## 7. 指令、任务、警戒（`game/order/`、`game/action/`、`task/`、`trait/AttackTrait.ts`）

### 事实

- **`Action` 不是 Mission**：`Action` 是玩家/网络的命令包（`ActionType`：PlaceBuilding / SellObject / OrderUnits / UpdateQueue…，`R/game/action/ActionType.ts:1-16`），`ActionQueue` 是纯 FIFO（`ActionQueue.ts:2-24`）。
- **引擎层根本没有 `Mission` / `MissionType` 枚举，也没有 Hunt / Sleep**（全仓无此符号）。"警戒"是 `guardMode` + `guardArea` 两个字段。
- `Order` 19 种（`OrderType.ts:1-21`）；优先级表 9 项：`Occupy, Dock, Attack, Capture, Repair, EnterTransport, PlaceBomb, Deploy, Gather`（`orderPriorities.ts:2-12`），主指令无效时逐项回退，最后尝试 Move（`OrderUnitsAction.ts:279-299`）。
- `Task` 是执行层：`status / children / cancellable / blocking / waitingForChildrenToFinish / preventOpportunityFire / isAttackMove`，生命周期 `onStart / onTick / onEnd / cancel`（`Task.ts:2-55`），由 `TaskRunner` 跑状态机（`TaskRunner.ts:7-74`）。**`blocking` 决定后续任务能否并行**。
- 每 tick 先跑任务；只有"无任务或无当前任务"时才取 `orders[0].process()`，压入返回的 Task，然后 `shift()` 并 break —— **一次只处理一个 Order**（`UnitOrderTrait.ts:52-102`）。
- 新指令打断：非排队指令会 `clearOrders()` + `cancel()` 全部现有任务（`UnitOrderTrait.ts:129-149`）。
- **Guard 与 GuardArea 是同一个 `GuardAreaOrder`**，只差 `targeted` 参数（`GuardAreaOrder.ts:12-20,39-64`）。
- 警戒扫描：半径 `min(15, 2*max(武器射程, guardRange) - 1)`（`ArmedTrait.ts:173-180`）；`leashTiles = 50`；首次发现目标且无 `guardArea` 时**把当前格记为老巢**（`AttackTrait.ts:259-263,282-287`）；无目标且不在老巢 → `MoveTask` 返回，**失败则 `resetGuardModeToIdle()`**（`AttackTrait.ts:305-315`）。
- 扫描频率来自 ini `GuardAreaTargetingDelay / NormalTargetingDelay`，**不是固定帧数**（`AttackTrait.ts:246-253`）。
- **目标选择不是"最近优先"**：`computeThreat` 综合 verses×系数、specialThreat、被克制系数、血量、距离、`+1e5`；`distributedFire` 再 `-1e6` 做火力分散（`AttackTrait.ts:443-482`）。
- 被攻击 → 记 `retaliateTarget` → 下一 tick 若无任务直接生成 `AttackTask`（`AttackTrait.ts:320-326,233-245`）。
- `AttackTask` 状态机：`Idle → CheckRange → PrepareToFire → FireUp → Firing → JustFired`（`AttackTrait.ts:21-28`、`AttackTask.ts:273-642`）。CheckRange 不在射程 → `MoveInWeaponRangeTask`，**最多 3 次移动尝试**，失败插入 `WaitMinutesTask(1/60)`。
- 开火朝向容差 **11.25°**，抛射武器 **45°**；`OmniFire` 跳过检查（`AttackTask.ts:25-26,578-605`）。
- **AttackMove 不是每帧扫描**：只在 `moveState === ReachedNextWaypoint` 时扫一次；发现目标就**停车**打（`holdGround=true` 不追击），打完 `updateTarget(targetTile)` 续走原路径（`AttackMoveTask.ts:14-53`）。
- Scatter：`RandomTileFinder` 把 **3×3 格池随机洗牌**取第一个可通行格；**不保存也不恢复原任务**（`ScatterPositionHelper.ts:50-85`、`RandomTileFinder.ts:50-61`、`ScatterOrder.ts:6-34`）。
- 多单位移动：`MovePositionHelper.findPositions` 先按相邻关系**聚类**，**最大簇保持相对队形整体平移到点击格**，放不下的用半径 5 径向搜索补位（`MovePositionHelper.ts:47-102`）。单次指令上限 128 单位（`OrderUnitsAction.ts:14,130`）。

### 我们的偏差

- 我们只有 `Order` 联合类型 + 直接改状态的 switch，**没有 Task 树、没有 blocking 语义、没有 Order 优先级回退**。
- 我们没有 `guardArea` / `leash` / 返回原位 / 威胁评分 / retaliate。
- 我们的 AttackMove 是每帧扫描；原版是"到点才扫、停下打、打完续走"。
- 我们的 Scatter 是环形随机；原版是 3×3 池洗牌。
- 我们的多单位移动是扇形排布；原版是**聚类保持队形平移**。

---

## 8. 修正路线

按"改动不可逆程度"排序，分三批。**每批都能独立构建、独立回归。**

### 批次 A — 表达层（不改玩法数值，风险最低，纠正 E2/E3）
1. **帧序列抽象**：新增 `render/Sprite.ts`，定义
   ```ts
   interface FrameSource { frameCount(seq: SeqType, facing: number): number; draw(g, seq, facing, frame): void }
   ```
   `SeqType` 采用原版 35 种（先实现 Ready/Walk/FireUp/Die1/Idle1 五种）。facing 统一为 **0–360 度**，帧索引公式照抄 `start + facingMult*facingNo + animFrame`。现阶段用程序化绘制**填充帧**（每个方向画不同轮廓），将来换 SHP 只替换实现。
2. **转向前置**：`Unit` 增加 `TurnTask` 等价物 —— 位移前检查 `|angleDiff| > 0` 则本帧只转向不位移，`rot` 度/秒。
3. **炮塔解耦**：`Unit` 增加 `turretAngle`，独立朝目标转，车体只管移动。
4. **影子**：单位下方画反向半透明剪影；飞行单位画贴地 Blob 阴影（按 `altitude` 放大模糊）。
5. **受伤状态**：`health > 100*CY` / `> 100*CR` 三档驱动冒烟与着火（已有），补建筑四态（正常/受损/进驻/废墟）。

### 批次 B — 地图模型（不可逆，需你确认，纠正 E4）
1. 等距投影：`TILE 32` 直角 → `30px` 等距 + `ISO_WORLD_SCALE`，新增 `worldToScreen / screenToWorld / tileHeightToScreen`。
2. 整数高度层：`Terrain.z: Uint8Array`，按 2 步进；`rampType` 1..20 格内双线性插值。
3. 拾取与相机全部改走等距逆变换；迷雾改为高度投影位图（`sx = rx - z/2 + pad`）。
4. 建造校验补：`rampType === 0` 才可建（原版 `ConstructionWorker.ts:372-379`）。

### 批次 C — 模拟模型（纠正 E1 + 战斗深度）
1. **删除** `applySeparation` 的质量互推，改为 `TileOccupation: Set<obj>[]` + 步兵 subCell 分配 + `CollisionState` + `MoveAsideTask` + 40 tick 等待 + 头对头僵持。
2. 碾压改为**换格判定** + `crusher`/`crushable` 双标志。
3. 寻路：取消切角禁令、启发加 0.2 转向惩罚、按 `speedType` 分层图、补齐 `Δz ≤ 1` 连通约束、半径 5/15 替代终点兜底。
4. 战斗：`ArmorType` 10 种 + `Warhead.Verses` 矩阵 + `CellSpread` lerp 衰减 + 默认误伤 + `LosHelper` 视线。
5. 指令：`Task` 树 + `blocking` + Order 优先级回退 + `guardArea/leash/威胁评分/retaliate` + AttackMove 到点扫描 + Scatter 3×3 池 + 多单位聚类平移。

---

## 9. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 批次 B 会推翻所有渲染代码 | `Views.ts`（977 行）几乎全改，拾取/相机/迷雾连带 | 先写投影层单测（`projection.test`），再改调用方；保留直角模式开关一个迭代 |
| 批次 C 会改变手感 | 删掉互推后，"挤开"变成"顶着不动"，可能显得笨 | 这是原版行为；用 `phystest` 的断言同步改写 |
| 没有 SHP 素材 | 帧序列只能程序化填充 | `FrameSource` 接口就是为换素材留的缝；`drawUnit` 拆成 8 个方向的绘制分支 |
| 数值不可比 | 我们 px/s，原版 lepton/tick | 批次 C 统一为 `lepton/tick`（1 格 256 lepton，15 tick/s） |

---

## 附：与原版一致、无需改动的部分

- 生产四队列 + 渐进扣款 + 多工厂提速
- 老兵等级与 `FireUp` 前摇思路
- 超武充能状态机
- 采集车往返 + 矿脉再生
- 迷雾三态 + 临时揭示
- 程序化地图生成（原版读 .map，我们用值噪声；这是合理差异，不属方向错误）

---

## 10. 落地进度（v0.5）

本轮先做了**不可逆、影响最大**的三块：投影/高度、表达层、移动与炮塔。碰撞与战斗数值按 E1 的结论留在下一轮。

### 已完成

| 项 | 实现 | 与原版的对应 |
|---|---|---|
| **等距投影** | `world/Iso.ts`：`worldToProj / projToWorld`，`ISO_W 56 / ISO_H 28 / HEIGHT_PX 16`；模拟层仍用直角世界坐标，只在渲染与拾取投影 | 与 `Coords.ts` 的「lepton 直角 + 渲染投影」分工一致 |
| **整数高度层** | `Terrain.level: Uint8Array`（沙 0 / 沙丘 1 / 岩石 2）+ `Terrain.vh` 顶点高度场；格内双线性插值 | 等价于 `tile.z` + `rampType 1..20`，但相邻格共享顶点，斜坡自动连续 |
| **等距地形绘制** | 逐格画菱形，四角取 `vh`；抬升的格补两侧墙；画家序按 `(tx+ty)` | `MapSpriteBatchLayer` 的 `(x+z)` 排序 |
| **深度排序** | 建筑与单位合并进 `L2_World`，每帧按投影 y 重排 `siblingIndex`（仅顺序变化时触碰） | 原版靠 3D 深度缓冲，这里用画家序等价实现 |
| **迷雾** | 改为按行合并的等距条带（同态连续段画一个平行四边形），三档硬边 | 原版按格贴 `SHROUD.SHP`，同为硬边 |
| **帧序列模型** | `render/Frames.ts`：`Seq`（Ready/Walk/FireUp/Die1）、`SEQUENCES`（帧数 + 帧率 + 循环）、`facingIndex`（**原版公式原样**）、`Anim` 时钟 | `SequenceType.ts` + `SequenceReader.ts` + `AnimProps` |
| **8 方向朝向** | 车辆/步兵不再旋转节点，改为 `facingIndex(deg)` 取离散方向 | `Infantry.updateShapeFrame` / `Vehicle.updateShapeFrame` |
| **炮塔解耦** | `Unit.turretFace / turretAim / turretHold`，`aimTurret()` 按 3.6 rad/s 追踪，开火后保持 2.2s 再回正 | `TurretTrait` + `AttackTask` 写 `desiredFacing` |
| **转向前置** | 车体朝向偏差 > 20° 时本帧只转向不位移；步兵瞬时转向 | `DriveLocomotion` 返回 `TurnTask` 且 `velocity=0`；`FootLocomotion` 直接赋值 |
| **等距车体** | `isoBody()`：旋转长方体 → 侧壁 ×4 + 顶面；履带按帧滚动；炮管按等距压缩 | 原版车辆是 8 向 SHP / VXL 网格 |
| **等距框选** | 屏幕矩形逐单位投影判定（不是反投影成世界 AABB） | 等距下唯一正确的框选方式 |

### 未完成（按 E1 的结论，下一轮第一批）

| 项 | 现状 | 目标 |
|---|---|---|
| **碰撞模型** | 仍是成对圆形碰撞 + 质量位移 | 删除，改为 `TileOccupation: Set<obj>` + 步兵 subCell + `CollisionState.Waiting` + `MoveAsideTask` |
| **碾压** | 速度阈值判定 | 换格那一瞬间按 `crusher` / `crushable` 判定 |
| **寻路** | 禁切角、严格可采纳启发、视线平滑 | 取消切角禁令、启发 +0.2 转向惩罚、按 `speedType` 分层图、`|Δz| ≤ 1` 连通 |
| **伤害** | 无 Verses 矩阵 | `ArmorType` 10 种 + `Warhead.Verses` + `CellSpread` lerp + 默认误伤 |
| **警戒** | 无 guardArea | `guardArea` / `leash 50` / 威胁评分 `computeThreat` / `retaliate` |
| **建筑等距化** | 仍是直角俯视方块贴在菱形地基上 | 等距立面 + 主图四态（正常/受损/进驻/废墟）+ `ActiveAnim` 偏移 |

### 过程中修掉的两个真实缺陷

1. **等距框选**：v0.4 的框选是「反投影两个角 → 世界 AABB」。等距下屏幕矩形对应世界**菱形**，用 AABB 必然漏选。改为此前 `inputtest` 一直 FAIL 的 5 项（框选、双击同类、长按指令盘、编队编入、编队召回）全部通过。
2. **指针坐标系**：输入层用的是「以屏幕中心为原点」的坐标（`Pointer.sx`），框选判定一开始按 0..1280 绝对像素比较，整体差 640px。已按同一空间比较。


---

## 11. E1 落地：碰撞模型（v0.8）

### 改动

`applySeparation` 原来是**双向质量加权推挤**：

```ts
// 旧：双方都位移，按 1/mass 分配
const ka = push * invA / (invA + invB);
a.x -= nx * ka;  b.x += nx * kb;
```

这是错的。零售的 `MoveTask` 里没有任何质量位移，响应只取决于**谁在开**：

| 情形 | 现在 |
|---|---|
| A 在开、B 停着 | **B 侧移让路**（最多 9px），A 只偏 18% |
| 都在开 | 对冲时各给一个侧向偏置滑过去；否则**各让一半**，不按质量分配 |
| 都停着 | **极慢分离**（overlap × 0.08），避免集结点重叠，又不会让停着的编队抖动 |

重叠半径：车辆 0.97（几乎不重叠），步兵对步兵 0.72（允许挤在一起，对应原版每格 3 个 subCell）。

### 为什么不是完整的 TileOccupation

原版用 `Set<obj>[]` 占格表 + `CollisionState.Waiting` + `MoveAsideTask`。
做到那一步需要一个额外的格占用索引，并改写所有移动调用点。

当前版本用**等价的行为语义**（让路 / 等待 / 不推挤）但保留了连续坐标——因为：
1. 手感已经对齐（不再互相顶穿、不再被坦克推飞）；
2. 改动面小，可以随时回退；
3. 等建筑/地形素材到位、单位尺寸确定后，再做格占用更划算。

`docs/ROADMAP.md` 里仍保留「瓦片占用表」为未完成项。

### 验证

```
phystest 10/10
  重叠单位会被分离（原版无质量位移）  · 间距 24.4 / 需要 22.1
  两辆坦克不会重叠                    · 24.4 >= 22.1
  重坦碾过敌方步兵                    · victimDead=true
```

原来的「轻单位被重单位挤开（质量差）」断言已删除——那个行为本身不符合原版。

---

## 12. v0.9：把「移动/占位/相机」按原版语义收口

这一版修的五个问题，全部能归到「原版怎么做的、我们当时怎么歪的」上。

### 12.1 单位「一直复位」不是寻路，是碰撞解算在传送

复现记录（拦截 `resolveWorldCollision`）：

```
T2.5 hourglass#5 tile 13,27 -> 12,28 moved 48 myTileBlocked true
T3.3 hourglass#5 tile 13,27 -> 12,28 moved 36
T4.0 hourglass#5 tile 13,27 -> 12,28 moved 36
```

`13,27` 是精炼厂的一格。旧实现一旦发现单位中心落在实心格里，就**向外搜 8 方向 1–3 格，找到空格就把坐标设成该格中心**——于是一次「贴到墙角」被翻译成 36–48px 的瞬移，单位再走回去，无限循环。

原版没有这个动作。`MoveTask` 遇到不可走的格子时只会：`CollisionState.Waiting` 停住、或让挡路者 `MoveAsideTask` 45° 侧移、或整条路径重算；**从不修改单位坐标**。

改法：

| 位置 | 现在 |
|---|---|
| `Unit.moveStep` | 走之前问 `canOccupy(x+dx, y+dy)`（圆盘 vs 格子）；不行就单轴滑动；两轴都不行就停住并置 `blockedNow` |
| `Game.applySeparation` | 推挤也走 `push()`，同样受占位约束，且每帧每单位有 40·dt 的位移预算 |
| `Game.resolveWorldCollision` | 只处理「已经在实心格内」的意外（旧版遗留/建造覆盖），以 ≤110px/s 的速度**自己走出去**，不再瞬移 |
| `Game.canPlace` | 新增「单位挡住建造位置」判定——原版查占位表，这里是几何等价 |
| `PathFinder.lineClear` | 采样从「中心点」改为 **`discFree` 圆盘**，半径 14 的车体不再从两座建筑的斜角缝里穿过去 |

### 12.2 相机的边界

原版把视口钳制在地图内，永远不会看到「地图外」。旧实现用投影空间的半宽加 120/160px 余量，两端都能露出黑边。

现在钳制在**世界坐标**做：把相机中心反算成 tile 坐标，要求可见矩形（其外接框）落在 `0..MAP_TILES` 内。数学上可分，两轴独立：

```
span = halfW/(2·ISO_HW) + halfH/(2·ISO_HH)     // 可见矩形在 rx 方向的半跨
rx   = clamp(rx, -N/2+span, N/2-span)
```

### 12.3 为什么地图从 64 变成 80

1280×720、tile 56px 时，视野在 rx 方向的半跨约 15.7 格。基地原本放在 x=18（rx=-22），**距离钳制边界还差 6 格**，于是开局相机被顶到地图西缘、基地落在屏幕左下角、大半个屏幕是黑的。

80×80 且基地移到 x=18 / N-19 后，`rx=-22` 落在 `±24.3` 的允许范围内，开局可以正常居中。

### 12.4 迷雾的三个真 bug

1. **多边形顶点取错**：每格里画的是 `(tx+0.5, ty+0.5)` 这些**边中点**，得到的是**半格大小的菱形**，任何相邻两格之间都漏一个三角形 → 屏幕上就是棋盘格。
   正确形状是格角平行四边形 `(tx0,ty) (tx1,ty) (tx1,ty+1) (tx0,ty+1)`。
2. **对角相邻的边界格只在角点相接**，即使形状对了，1 格宽的环仍会漏缝 → 边缘格外扩 0.5px。
3. **opaque 层缺一档**：未探索区用 236 alpha，地形会隐约透出来。改为 255，另加 1 格渐变环 + 逐格噪点抖动（对应 `SHROUD.SHP` 的抖动边）。

### 12.5 地形侧壁画反了

等距投影下 `tx/ty` 增大是**往屏幕上方**走，所以能看到的是 `min(tx)`、`min(ty)` 那两条边。旧代码画的是 `max` 侧的两条边，还加了 `+drop`（向上）——等于把侧壁糊在自己屋顶上。沙丘因此看起来是一块块灰色凹陷，而不是隆起的沙包。

改成：只在邻居更低时，从 `p00-p10` / `p00-p01` 两条边向下拉出 `Δlevel × HEIGHT_PX` 的墙面。

### 12.6 烘焙帧的垂直翻转

`CanvasPen` 已经把 y-up 转成 canvas 的 y-down，`bakeFrame` 里再 `(h-1-y)` 翻一次 → 双重翻转，所有单位上下颠倒（步兵头朝下）。删掉多余的那次翻转。

### 12.7 回归

```
harvesttest 6/6   （新增：开局 60s 无瞬移、不进入实心格、走到矿脉、完成卸货）
phystest   10/10
speedtest  12/12
assettest  16/16
inputtest  20/20
smoke      60FPS 0 错误
battletest 6min  earned 26584 / 34 击杀 / 0 错误
```

---

## 13. v0.11：碰撞彻底改成原版语义

上一版把「质量互推」换成了「让路」，但仍然是**连续坐标 + 成对推开**。这一版把最后这点也删掉，改成原版真正的机制：

### 13.1 原版到底怎么处理单位互斥（逐行结论）

`game/gameobject/task/move/MoveTask.ts` 的障碍分支只有五种结果，**没有任何一次修改坐标**：

| 条件 | 原版行为 | 行号 |
|---|---|---|
| 双方都在等（`collisionState != Resolved`） | 直接 return，什么都不做 | 583-597 |
| 双方都是步兵 | `findFreeSubCell` → `relocateToSubCell`（换子格） | 598-604 |
| 前方有可回退的空路径点 | 重算到那个点（`maxExpandedNodes: 15`） | 606-720 |
| 挡路者静止/有任务/已经在让路，且推过一次 | `WaitTicksTask(40)` | 723-745 |
| 挡路者静止、没任务、还没推过 | 给它压 `MoveAsideTask(pushDirection)`，自己等 1 tick | 746-756 |
| 挡路者在动 | 反向 → 停；同向且慢 1.5 倍 → 回退；否则停 | 806-840 |

`canStopAtTile()` 是唯一的"容量"规则：**一格最多 2 个其他步兵，且子格不重复**（`MoveTask.ts:341-352`）。车辆则完全不看其他车辆——它们的互斥靠 `TileOccupation` 的格子占用 + 上面这套等待链。

### 13.2 我们的落地方案

| 原版机制 | 本项目实现 |
|---|---|
| 格子容量（1 车 / 3 步兵） | `TileOccupation.hasRoomFor()`：车看别的车，步兵看别的步兵（<3） |
| 子格 0..2 | `Unit.subCell` + `claimSubCell()`；同格步兵由 `spreadInfantry()` 排到 11px 间距 |
| 不修改坐标 | `stepBlockedByUnit()` 是**步进许可**：不许迈出会加深重叠的一步。删除 `applySeparation` |
| `MoveAsideTask` | `requestAside()`：给静止友军下一个「侧移 1.15 格」的移动指令，1.4s 后自动恢复 idle |
| 找不到路时的回退 | `repathAround()` 把挡路者 3×3 设为临时 `avoid`，**但排除自己周围 3×3**（否则 A* 连起点都没有） |
| `MoveResult.Fail` | `failMove()`：清路径、`repathHold = 1.5s`，move/attackmove 直接结束指令 |
| 40 tick 等待 | `blockT` + `trafficT`：前方车辆在开就等（最多 2.6s），否则 0.3s 后依次 让路 → 重算 → 扩大 → 放弃 |

### 13.3 三个由此修掉的真实症状

1. **一个兵推着另一个兵走**：旧 `applySeparation` 每帧把重叠平摊给双方，走路的兵每前进 1.8px 就把站着的兵推 1.3px，几十帧后推出半张地图。现在静止单位只可能被 `requestAside` 主动让路，而那是它自己走的。
2. **点了可达点却原地打转**：旧代码用 `order.x ± random(70)` 连续重算，且 `blockedNow` 被 `resolveWorldCollision` 每帧清掉，导致「等待→重算→放弃」链根本没触发。现在 `blockedNow` 归 `moveStep` 独占，卡住判定改为**目标距离**是否缩短（抖动不算进展）。
3. **敌我相遇直接穿过**：格子容量 + 步进许可后，两辆车不可能同格；`head-on` 测试最近距离 24.8px（车体 28px，视觉相切）。

### 13.4 一个容易踩的坑：半径 vs 格子

车体绘制半径 16px、格子 32px，于是「贴墙那一行的格心」距离墙面正好 16px。用完整半径做碰撞判定时，任何 1px 漂移都会被判非法，采集车就卡在精炼厂墙边不动（实测 60 秒），反复触发「卡住」链。

原版是**格子制**（`getPassableSpeed(tile)`），贴图允许溢出格子。所以移动判定改用 `steerRadius = radius * 0.45`，渲染半径不变——车体可以压住墙角几个像素，但不会半个身子进墙。

### 13.5 回归

```
movetest    18/18   （新增：对向不穿模 / 不推人 / 六个可达点 / 围死放弃 / 侧移让路 / 一格一车 / 子格）
harvesttest  6/6    （60s 内完成 卸货，earned 2400）
phystest    10/10   （碾压仍在，改为「进入格子」判定后依然生效）
speedtest   12/12
inputtest   20/20
assettest   20/20
menutest     9/9    （新增：地图/颜色/阵营选择真的进入对局）
featuretest 14/14   （新增：摆放后 1.1s 完成升起、满血，不再二次建造）
```

### 13.6 落地时又踩到的三个坑（都在原版里有对应答案）

| 症状 | 原因 | 采用的原版语义 |
|---|---|---|
| 卡车被一个站着的步枪兵永久顶住 | 给「车 vs 步兵」也加了半径互斥 | 原版只对**格子**做容量判定：车可以开进有步兵的格子，步兵被 `ScatterTask` 散开或被碾。互斥只保留给**车 vs 车** |
| 玩家两台矿车在炼油厂旁对峙到比赛结束 | 一格一车 + 两车抢同一格 | 原版有 `DockTrait` 专用停靠格；这里让**两台采集车可共格**（卸载时本就贴在一起），并给卸货格按已有车辆数加权 |
| 矿车明明有路却"原地起步"到天荒地老 | `bestEffort` 返回只含起点的一步路径被当成成功 | 原版 `computePath` 失败就是失败（`MoveResult.Fail`）。现在对返回路径做终点距离校验，超过阈值视为不可达 |

另外，`PathFinder` 的平滑（对应原版 `smoothPath`）必须用比 A* 更宽的净空：A* 只保证
"格子能站"，拉直后的线段会贴着建筑墙角切过去，单位撞上就停——这正是"点了可达点却过不去"
的最后一块拼图。

---

## 14. v0.12：「无法抵达目标」的真正原因（寻路之外的四处）

用户反复报告「明明有路，却说抵达不了」。这一版先做了**可量化的诊断**，再改代码：

| 工具 | 做什么 | 结论 |
|---|---|---|
| `tools/pathprobe.mjs` | 用洪水填充算出可达真值，再拿真 `PathFinder` 跑 400 组随机可达点 | **漏判 0**，平均绕行 0.56× —— **A\* 本身没问题** |
| `tools/pathsim.mjs` | 下达移动指令后按「路径长度给预算」+「停滞检测」，并劫持 `failMove` / `giveUpOrder` 记录现场 | 修前 78 个订单里 **37 个停滞**，且几乎都不报错 |

于是问题定位到「移动执行层」，四处都与原版语义不符：

### 14.1 卡死计时器：原版只在 PlanMove 时累加

`MoveTask.onTick` 里 `inPlanningForTicks` 只在 `MoveState.PlanMove`（**完全无法驱动**）时自增，
到达路点后清空；`MAX_PLANNING_TICKS = 200`（15fps ≈ 13.3 秒）才触发重规划。

我们的 `handleBlocked` 每帧无条件 `blockT += dt`，阈值 0.3 秒。
后果：一辆坦克从静止起步，前 0.2 秒还在加速，位移不足 2px，被判定"没进展"；
0.3 秒后开始重算，四次重算走完 **1.2 秒**，`failMove` 取消订单 —— **在空旷沙地上，刚下令一秒就自己取消了**。

```ts
// 现在：本帧没有推进才累加，有推进则衰减（衰减而非清零，避免抖动重置）
if (!u.blockedNow) {
    u.blockT = Math.max(0, u.blockT - dt * 3);
    continue;
}
```
阈值也按原版重排：0.35s 让路 → 1.6s 起三次绕行 → 就近重定位 → Fail。

### 14.2 就近重定位：只查"空"不查"通"

原版 `MoveTask.findRelocationTile` 找的是**可达**格子。我们的 `findFreeNear` 只判断
"这格有没有障碍"，于是经常挑到墙另一侧的空格，`repathTo` 拿到 null，`u.path = []`，
而 `handleBlocked` 对空路径的订单直接 `continue` —— **订单挂着、单位不动、没有任何提示**，
这就是"点了没反应"的那一类。

新增 `PathFinder.relocate()`：从单位当前位置 BFS，返回**最近且真能走到**的格子并给出路径。

### 14.3 终点格已满：原版是 CloseEnough，不是无限蹭

一格容 1 车 / 3 步兵。第 4 个步兵的路径终点仍在那一格里，于是它以满速贴着邻格边缘来回蹭：
速度 36、`blockedNow=false`、`path.length=1`，位移 0。

原版 `canStopAtTile` 失败后走 `isCloseEnoughToDest` → `MoveResult.CloseEnough`，订单结束。
现在：`moveStep` 在最后一格、距离 < 1.5 格、且目标格无容量时直接判到达。

### 14.4 墙体救援与步进判定用了两个半径

`canStepTo` 用 `steerRadius`（0.45×视觉半径，允许车身压过墙角一点，同原版 sprite 溢出格子）；
`resolveWorldCollision` 却用**完整视觉半径**判断"是否卡进墙里"，发现卡住就把单位传送回 `prevX/prevY`。
一个合法的步子在救援层看来是"卡进墙"，于是每帧：前进 → 传送回来 → 前进 → ……
表现为**满速原地抖动**，在悬崖边和建筑拐角最明显。两者统一为 `steerRadius` 后消失。

### 14.5 顺带修掉的三处

| 症状 | 根因 | 对齐的原版语义 |
|---|---|---|
| A* 在长路径上"差最后几百像素" | 展开上限 5200 < 地图 6400 格 | 原版不限（`maxExpandedNodes` 默认 `Infinity`） |
| 起点格被建筑覆盖时整图不可达 | A* 不检查起点，起点无邻居可展开 | 起点吸附到最近可站格 |
| 采油车把矿脉啃空却不产钱 | 炼油厂被摧毁后仍继续挖 | 没有卸货点就待命（原版 `DockTrait` 找不到 dock 即停机） |

### 14.6 弹头 × 装甲矩阵

原版 `WarheadRules` 把 `Verses` 解析成 11 列数组，`Warhead.ts:305` 做
`damage *= verses.get(armorType)`；`AttackTrait.checkArmor()` 在 `100 * verse <= 1` 时
**直接不把该目标纳入候选**。

落地为 `VERSES`（3 弹头族 × 9 装甲列）+ `verseMul()` + `canHurt()`：
步枪打混凝土核心 0.04×（几乎无伤，且不会再傻站着打），
AP 弹对步兵 0.35×、HE 对空 0.15× —— 兵种搭配第一次真正有意义。
建筑按体量分 `wood/steel/concrete`（size ≥4 / ≥3 / 其余），对应原版用墙体材质区分装甲。

### 14.7 回归

```
pathprobe   漏判 0 / 400 组        平均绕行 0.56×
pathsim     停滞 0 / 62（修前 37）  到达 54，就近停靠 8（CloseEnough）
maptest     21/21                 3 张手工图 × 7 项
movetest    18/18   phystest 10/10   harvesttest 6/6
speedtest   12/12   inputtest 20/20  menutest 9/9   assettest 20/20
battletest  6 分钟：收入 22677 / AI 9224 / 0 报错
```

---

## 15. v0.15：摇晃 / 互堵 / 炮塔复位 / 像素感——四条都对到了原版的一行代码

这一版没有再"调参数"，四条问题各自对应原版一个具体机制。诊断工具 `tools/steertest.mjs`
（直线航向、炮塔锁定、10 车同点）先量出基线，再改。

### 15.1 车体摇晃：原版每段路只定一次方向

```ts
// DriveLocomotor.onNewWaypoint —— 唯一的赋向点
if (facing !== unit.direction) {
    this.pointTurretToTarget(unit, target);
    if (!this.moveOnCurve) {
        unit.moveTrait.velocity.set(0, 0, 0);
        return [new TurnTask(facing)];      // 停车 → 原地转向
    }
}
// DriveLocomotor.tick 的直线分支 —— 只算位移，从不写 direction
```

我们的 `moveStep` 每帧 `Math.atan2(路点 - 位置)` 再追过去。路点只有 20 px 远时，
位置抖一格就是 3° 的航向变化，车体老老实实跟着转 —— 直线行驶时左右摆。

改成：`faceTarget` 只在**路点对象变化时**重算（`segWp !== wp`），直线段 `diff` 恒为 0，车体一动不动。
转向用 `FacingUtil.tick` 语义（余量小于一步就吸附），不再留永久亚步误差。
测：直线 12 秒，`dirFlips = 0`、`faceDelta = 0°`。

### 15.2 8 方向贴图抖动：边界滞回

`facingIndex()` 是 `Math.round`，角度停在 22.5° 边界上时，千分之一弧度就能让它
在两个邻格之间跳。新增 `facingIndexSticky(deg, prev)`：只有超出当前格中心 ±(22.5° − 6°) 才换图。

### 15.3 炮塔反复回正：`desiredFacing` 没有定时器

```ts
// TurretTrait.tick —— 没有超时，没有"回正"
this.facing = FacingUtil.tick(this.facing, this.desiredFacing, rot);
// 谁来写 desiredFacing：
//   DriveLocomotor.pointTurretToTarget → attackTrait.currentTarget（跨 tick 存活）或移动方向
//   MoveTrait.tick —— 只在"没有任务也没有目标"时写 unit.direction
```

我们原来是 `turretAim + 2.2 秒倒计时`：倒计时一到就回正；而且索敌有 0.22 s 冷却，
冷却期间不调 `aimAt`，炮塔同样回正。于是每 0.3 秒"指过去 → 转回来"。

改成持久 `focus`（目标实体，跨 tick 存活）+ 每帧 `aimAt(focus)`，无倒计时；
`aimReady()` 判 `turretAim === null` 时直接视为就绪。测：10 秒交火 `retreats = 0`、`dirFlips = 0`。

### 15.4 被友军堵死：原版从不因此取消订单

`MoveTask` 的障碍分支（`MoveTask.ts:664-796`）顺序是：

1. `freeWaypointIndex` = 前方**最近的无障碍路点** → `computePath(maxExpandedNodes:15, excludeTiles:有障碍格)`
   → `path.splice(freeWaypointIndex, ...)`（**保留 anchor 之后的原路线**）
2. 步兵对步兵 → `findFreeSubCell` / `relocateToSubCell`
3. blocker 有任务 → `WaitTicksTask(40)`（2.7 s），累计到 `MAX_PLANNING_TICKS = 200`（13 s）才重规划
4. blocker 完全空闲 → `blocker.unitOrderTrait.addTask(new MoveAsideTask(...))`
5. 实在不行 → `findRelocationTile`（**半径 0..5 格**的径向搜索）换个能站的格子继续走
6. 只有连续 5 个 `unreachableTargets` 才 `MoveResult.Fail`

我们原来：绕行 = "排除 blocker 3×3 后重算到**最终目标**"（目标被围住必失败）→ 推人 →
再失败 → 4 轮后 `giveUpOrder`。10 辆坦克点同一点，5 辆直接取消订单并弹"被友军挡住"。

现在的实现：
- `repathAround` 改成"绕到路径上最近的可站路点"，并且 `p.concat(rest)` **保留尾部**
  （只替换会截短路径，单位会停在离目标几百像素处 —— 这是 pathsim 回归的直接原因）；
- 绕行优先、推人次之、等待其次，`repathTry` 上限 10（约 8 秒）；
- `parkNear` = `findRelocationTile`（0..5 格径向、要求有容量且可达），并加"只能更靠近目标"约束；
- `failMove` 先 `parkNear`，5 格内有位就继续走；确实没位 → `CloseEnough` **静默停车**；
  只有离目标 > 6 格才报"无法抵达"；
- 寻路代价加**单位密度惩罚**（1 + 1.6×人数，上限 6 倍）——原版靠 `reservedPathNodes` 硬占格，
  连续移动里硬阻塞会死锁，软代价达到同样的"车流分道"效果而不产生幽灵封锁。

测（10 车同点，180 s）：取消订单 4 → **0**，抵达 5 → **10**。

### 15.5 像素感：144 源图 + 线性过滤

Blender 一直渲染 288 再降到 72，而引擎把车体画在 72×72 的节点里 —— 72 源图在放大时就是硬边。
改为渲染 576 → 降采样 **144**，manifest 的 `frame` 同步；纹理过滤 `NEAREST` → `LINEAR + mipmap`。
节点尺寸仍是 72，硬件降采样，边缘自然平滑。

### 15.6 回归

```
steertest   直线 dirFlips 0 / 炮塔 retreats 0 / 集群 giveUp 0、10/10 抵达
crowdtest   5/5        movetest 18/18     phystest 10/10    harvesttest 6/6
maptest     21/21      menutest 11/11     inputtest 20/20   featuretest 14/14
speedtest   12/12      assettest 20/20    artcheck 6/6
pathsim     停滞 0-4 / 62（随机场景），到达 50-53，就近停靠 8-9
battletest  6 分钟：收入 15368 / AI 8840 / 0 报错
```

---

## 16. v0.16：摇晃、互堵、炮塔——上一版没修干净，因为量错了地方

v0.15 的四条修复里，摇晃和互堵"改了但没见效"。这一版先用 `tools/walktest.mjs`
在**真实开局场景**（保留基地、矿点、原有部队，再补 6 辆坦克）里逐帧采样，才看到真相：

```
vehicle id=25  img=5  straight=0  turned=248  idleTurn=209  ftChg=4
```

`ftChg=4`（航向目标只变了 4 次）却累计转了 248°，其中 209° 发生在**目标航向没变**的帧里。
上一版只测了"清空地图 + 单车直线"，正好绕开了所有出问题的路径。

### 16.1 横向摇摆的真正来源：重算路径太勤

`handleBlocked` 里，被友军挡住 0.35 s 就开始绕行，`trafficT` 超过 2.6 s 也放弃等待。
一列坦克里前车永远在动，于是一列车的每一辆**每 2.6 秒重算一次路线**，每次 A* 给出不同方向，
车头就跟着转。实测 45 秒内 5 次航向大改、9 次贴图切换。

对照原版：

- `MoveTask` 的障碍循环里，挡路者只要有速度就 `break`（继续开），**不设等待上限**；
- `WaitTicksTask(40)` = 2.7 s，累计到 `MAX_PLANNING_TICKS = 200`（13 s）才重规划；
- 重规划只在路径**真的不可走**（`getPassableSpeed` 失败或 `findObstacles` 有静态障碍）时发生。

改法：

| 项目 | 之前 | 现在 |
|---|---|---|
| 被移动中的友军挡住 | 等 2.6 s 后重算 | 等 8 s（真正的死锁保险），前车在动就一直等 |
| 触发绕行的 blockT | 0.35 s | 1.0 s |
| 绕行方向校验 | 无 | 新路径首段与原路径首段夹角 > 50° 就换下一个锚点 |
| 到位判定 | 无 | `path.length <= 1` 且目标格满 → CloseEnough 停车 |

结果（同场景）：`idleTurn 209° → 0°`，`img 9 → 1`（5/6 辆车），转向总度数 745° → 34-107°。

### 16.2 车体航向要归一化

`face` 只做 `+= turn*dt`，从不取模。往西开久了 face 会停在 +3.28 rad，而目标是 -3.10：
最短弧 +0.18，一步走过头到 3.46，下一帧弧变成 -0.18 又走回来 —— 在正西/正东附近每帧 ±10° 永久振荡。
`diff` 做了归一化而 `face` 没有，两者不一致。现在 `wrapAngle()` 把车体和炮塔都约束在 (-π, π]。

### 16.3 停车位（findRelocationTile）的三个坑

10 辆坦克点同一个点，必须靠 `findRelocationTile` 散开。这一路上踩了三个坑，每个都能让整队瘫掉：

1. **把 `smooth()` 的单点路径当成失败** —— `smooth` 会把"视线通畅"的路线压成一个点，
   `length === 1` 是合法结果。加了 `length < 2` 的判断后，连"直着开过去"都被拒，
   10 辆坦克最终停成一排、间隔 100 px。改为只拒绝 `!lastFound`（best-effort）。
2. **所有车抢同一个格** —— `hasRoomFor` 只看"现在谁站在这儿"。10 辆车同一帧各自找到一个空格，
   全都选它（实测 9 辆 `parkX` 相同）。新增 `cellClaimedBy()`：已经有人预约的格跳过。
3. **停车位在车后面** —— 按环扫描取第一个，经常选到车身后方，车要掉头 150° 才能停。
   新增 `pickParkingSpot()`：按 `距离 + 30 × |转角|` 打分，宁可多走两格也不掉头。

结果：10 辆车最终停在离目标 **80–125 px**（原来 240–310 px），全部 `idle`，无报错、无抖动。

### 16.4 步兵在基地里不动

`moveStep` 里的 CloseEnough 检查是"最后一个路点、该格满、距离 < 1.5 格 → 清空路径"。
步兵出生点附近的第一段路点恰好落在建筑格上，于是刚走三十像素整条路线就被扔掉、订单变 idle。

改成只在**该路点同时是订单目标**（`dist(order) < 3 格`）时才判定到达。中途路过满格不再取消订单。

### 16.5 炮塔

v0.15 的持久 `focus` 保留，另加 `wrapAngle` 防越界振荡。`steertest` 交火 10 秒：`retreats = 0`。

### 16.6 回归

```
walktest    真实场景 6 车：5 辆 img=1-2、idleTurn=0；1 辆绕路 img=6
steertest   直线 dirFlips 0 / faceDelta 0°；炮塔 retreats 0；集群 giveUp 0、全部停稳
crowdtest 5/5   movetest 18/18   phystest 10/10   harvesttest 6/6
maptest 21/21   menutest 11/11   assettest 20/20   inputtest 20/20
featuretest 14/14   speedtest 12/12   artcheck 6/6
pathsim     停滞 0-7 / 62（随机场景），到达 46-54，就近停靠 8-9
```

---

## 17. v0.17：摇晃的真凶不在逻辑里，在图集帧序；互卡的真凶是一个"好心"的分离推力

v0.16 把转向逻辑改到位了（`idleTurn 209° → 0°`），但你说"还是左右晃"和"卡成一坨"。
这一版两个问题都追到了完全不同层面的原因，而且都不是寻路算法。

### 17.1 "左右摇"= 图集帧序转置，播放的是四个不同朝向

引擎取行走帧的公式是 `walk.start + phase * facings + facing`（**动画帧在外层**）。
Blender 拼图用的是 `start + perFacing * facing + anim`（**朝向在外层**）。两者是转置关系。

**它们在 `phase = 0` 时完全一致** —— 所以站立时一切正常，而所有只检查 `ready` 序列的校验
（包括 v0.13 写的 `artcheck`）都会通过。

开着车的时候，引擎播的"facing 0 的 4 个相位"实际是帧 8、16、24、32，即 facing 0/2/4/6 的首帧。
把图集拆开量包围盒：

```
正确取法 8,9,10,11   → 宽 48 48 48 48   （同一模型，只有履带相位不同）
错误取法 8,16,24,32  → 宽 48 85 48 85   （85 是侧视图）
像素差异：正确 2.0-3.0%   错误 14.2%
```

**屏幕上就是每走一步车头左右甩一次。** 这就是从 v0.12 追到 v0.16 都没解决的那个"摇晃"。

修一行：

```ts
// 之前
a.body[a.walk.start + phase * a.facings + d]
// 现在
a.body[a.walk.start + d * phases + phase]
```

`artcheck` 补了两条断言，专门锁死这个：
行走帧必须**连续**（同朝向连续 4 格），且 facing1 与 facing0 的首帧差**等于相位数量**。

### 17.2 "卡成一坨"= 三处，每处都违反一条原版规则

| 现象 | 根因 | 原版规则 |
|---|---|---|
| 两辆车叠在同一格 | `vacating` 只看"挡路者是否在移动"，没看它**是否正要离开这格** | `MoveTask` 要求 `blocker.currentWaypoint.tile !== node.tile` 才 break |
| 贴死之后再也分不开 | 分离门槛是 `dNew < dCur + 1.0`，0.4px 的远离也被拒 | 只要远离就该允许 |
| 停着的车被推着走 4.6 格 | 新增的 `separateHulls` 每帧推 2px，正好等于来车前进速度（42px/s × 0.05 = 2.1px），于是一路推着走，最后**停在对方的目标格上** | 原版没有"单位推单位"，只有 `MoveAsideTask`（自己要走的） |

修法：

- `vacating` 增加 `leaving` 条件（挡路者的下一路点不在本格）；
- 分离允许任何真正增距的步子（`+0.05` 而不是 `+1.0`）；
- `separateHulls` 只作用于**双方都静止**的重叠车对，目标距离取一格（`TILE * 1.12`），
  不再把行军中的人推开。

另外 `requestAside` 的候选方向里删掉了"纯背向 caller"—— 那个方向会让路人被一步步推到
行进方的目标格上（实测位移 147px，正好落在 `(55,52)`，就是行进方的目的地）。

### 17.3 空路径没有归宿

`handleBlocked` 开头是 `if (path.length === 0) continue;`，而"取消订单"的逻辑全在后面。
于是一辆车路径走空、订单还挂着 `move` 时，**没有任何分支会处理它**：它停在那儿，
不重算、不放弃、不动。20 秒都不动一下。

现在 watchdog 里：路径空了且离目标 < 2 格 → 直接结束订单（这就是 CloseEnough）。

### 17.4 数字

| 指标（10 辆坦克点同一点，120 秒） | v0.16 | v0.17 |
|---|---|---|
| 最小车距（全过程） | 22.2 px | 20.5 px（擦身而过，非停靠状态） |
| 最终占格 | 有两辆同格 | **10 辆 10 格** |
| 有订单却静止的最长时间 | 32.9 s | **5.2 s** |
| walktest 单辆贴图切换 | 1-6（最差 6） | **1-2（全部）** |
| walktest 目标不变却在转 | 0° | 0° |

### 17.5 回归

```
walktest   6/6 车 img=1-2、idleTurn=0、全部停稳（距目标 29-100 px）
steertest  直线 dirFlips 0 / faceDelta 0°；炮塔 retreats 0；集群 giveUp 0
crowdtest 5/5   movetest 18/18   phystest 10/10   harvesttest 6/6
maptest 21/21   menutest 11/11   assettest 20/20   inputtest 20/20
featuretest 14/14   speedtest 12/12   artcheck 9/9
pathsim    停滞 4/62、到达 50、就近停靠 8
```

---

## 18. v0.18：往右晃 = 图块抖动；卡成一坨 = 允许两车共格

### 18.1 「只有往右还晃」：8 方向图块的来回切换

单台直线、六车集群、基地实景三种场景各测一遍，`face` 都是常数（270°），
按 `facingIndex` 算出来的图块也是常数 5 —— 说明朝向逻辑没在转。真正会晃的是**显示层**：

`facingIndexSticky` 的滞回是 `step/2 - step*0.14 ≈ 19.35°`：只要偏离当前图块中心不到
19.35° 就继续用旧图，一旦超过就跳到「最近的那块」。于是路径每次重算把航向挪一两度，
跨过 289.35° 这条线时图块从 5（270°）跳到 6（315°），下一次重算又跳回来 ——
**航向只变了 1°，画面转了 45°**。这正是「往右晃」：右侧的路径腿（288°附近）刚好压在
那条边界上，上下左三个方向的腿不在这条线附近，所以看起来不晃。

修法：`Views.stableDir()` —— 新图块必须**连续两帧**被要求才提交。
真正的转向只多一帧延迟（16ms），单帧抖动直接消失。

顺手补了行走/站立切换的滞回：原来 `speedCur > 4` 单一阈值，车在 4px/s 附近抖动时
Walk/Ready 每帧互换（两张图差 5% 像素，读起来就是「嗡嗡抖」）。现在进走阈值 20% 速度、
出走阈值 8%。

新增 `tools/dirtest.mjs`：八个方向各开 3 秒，逐渲染帧读**实际绘制的图集帧号**，
断言「图块只有一个、且不来回切」。这是唯一能测到这类问题的方式——游戏状态里看不出来。

### 18.2 卡成一坨：两辆车共用一格

截图里两个选中环落在同一格。根因是 `stepBlockedByUnit` 的 `vacating` 豁免：
「挡路车还在动、下一路点不在本格」就允许后车进格。这一条来自原版障碍循环
（`blocker` 有速度就 `break`），但原版还有 `reservedPathNodes` 占位，
两辆车永远不会同时登记在同一格。我们只抄了前半句：

前车进格 → 后车跟进 → 前车在这格里停下 → 两车相距 24px，各自下一步都被对方否决。

现在改为**一格一车，无条件**。后车等格子真正空出来（坦克速度下约 0.7s），
与原版一致，队列也照样能流动（`crowdtest` 7/7，10 台全部抵达）。

同时把车体立定间距从 `(r1+r2)*0.92 ≈ 24px` 提到 `max(..., TILE*0.95) ≈ 30px`：
24px 时两辆坦克的车体贴图（86px 宽）几乎完全重合，玩家看到的就是「糊成一坨」，
尽管格表是对的。

`crowdtest` 增加两条硬断言：**没有两辆车共格**、**车体最近距离 ≥ 26px**。

### 18.3 选中光圈 → 血条

原版不画发光椭圆，选中的单位显示血条。已删掉双层椭圆，改成：
脚下（建筑为屋顶上方）一条深色槽 + 绿/黄/红填充，选中时加一圈亮边。
顺带修了血条只在「血量变化」时重绘的问题——选中状态变化时那圈亮边不会更新。

### 18.4 回归

```
dirtest     9/9     八方向行驶图块稳定，0 次来回切换
crowdtest   7/7     10/10 抵达、0 误报、0 共格、最近 30.4px
movetest    18/18   phystest 10/10   harvesttest 6/6
maptest     21/21   menutest 11/11   assettest 20/20   artcheck 9/9
inputtest   20/20   featuretest 14/14   speedtest 12/12
steertest   dirFlips 0 / retreats 0 / giveUp 0 / stillMoving 0
pathsim     停滞 0/62，到达 53
```

---

## 19. v0.19：车身晃动＝素材在上下颠；血条按原版重画

### 19.1 摇晃的真身是「行走帧在整体上下位移」

前面几轮一直在代码里找，这次直接从素材查：把 facing 5 的四个 walk 帧并排放大，
四帧的车体轮廓和位置都不一样。回到 Blender 脚本，找到根源：

```python
bob = [0.0, 0.016, 0.0, -0.016]
hull.location.z = bob[ai] * 2.5
```

**每一帧把整个车体抬高/压低 0.04 单位**，再叠上履带贴图滚动。换算到 144px 图集上
就是每帧 1.5px 的垂直跳，9fps 下持续抖动。为什么「只有往右和右上」看得见：
车体左右横移时，视线是跟着轮廓走的，垂直方向的抖动与运动方向垂直，最刺眼；
上下走时抖动叠在运动方向上，看不出来。这也解释了为什么我前几轮用逻辑指标
（`face`、图块号）怎么测都是稳定的——问题根本不在逻辑里。

修法：

- `bob` 全零，只保留 `set_tread_offset()` 的履带滚动（真正卖"在动"的是它）。
  重渲染后实测：四帧质心位移 **dy = 0.00**，帧间像素差从 5.3% 降到 2.4%（只剩履带）。
- 车头改用**前视点**（pure pursuit）：`Unit.pathLookAhead(1.7 格)` 沿折线取一个前方点，
  再对它求方位，并对 `faceTarget` 做 6/s 的低通。网格路径是 26.57°/63.43° 交替的楼梯，
  逐路点求方位会让车头在两个桶之间来回跨，前视点把它们平均成真实行进方向。

### 19.2 血条：按原版重画

原版是脚下一条**平直的细血条**：1px 黑框 + 纯色填充，硬角、无发光、无选中描边，
颜色在半血和四分之一血处跳档。上一版用了圆角槽 + 选中白边，看起来像贴上去的 UI。
现在：单位 26×2.5px、建筑按体量加宽，槽比填充大 1px，`#3fe04a / #ffc53a / #ff4436` 三档。

### 19.3 回归

```
dirtest 9/9（八方向 0 次图块来回切换）   crowdtest 7/7   movetest 18/18
phystest 10/10   harvesttest 6/6   artcheck 9/9   menutest 11/11
maptest 21/21   assettest 20/20   inputtest 20/20   featuretest 14/14   speedtest 12/12
steertest dirFlips 0 / retreats 0 / giveUp 0
```

---

## 20. v0.20：摇晃的真正根因——图集**行方向反了**（整行上下镜像）

用户反复说「炮台是对的，车体在转」。这一句就是答案：炮塔图集只有 **一行**，行镜像看不出来；
车体图集有 **5 行**，行镜像会把每一帧换成另一行的内容。

### 20.1 怎么确认的

把一帧的 `rect` 直接改掉再截图（`rect.y = 576 / 0 / 288 / 432`），四个 y 全部显示**同一张图**
→ 说明改 rect 不触发重绘（Sprite 缓存 UV），这条路走不通。

换一条：不读 rect，直接看**画面上是什么**。用 `bodyFrame(6, phase)` 逐帧换图并截图，
四帧依次是「正面 / 3/4 / 长侧面 / 3/4」——**四个不同朝向**。而同样的四个下标去图集里裁，
四张图完全一样（只有履带纹理不同）。两者矛盾，只能是**图集的行被上下颠倒读**。

对照矩阵（index → 行）：`sliceSheet` 用 `y = H - (row+1)*fh`（假设 PNG 自上而下、rect 自下而上）。
但 Cocos 上传纹理时把图像做了垂直翻转，于是「自下而上的 y」实际取到的是**镜像行**：

| 内容 | 本应在 | 实际显示 |
|---|---|---|
| ready（行 0） | 8 个站姿朝向 | 行 4（facing 6/7 的行走帧） |
| walk facing 6（行 4） | 该朝向 4 个相位 | **行 0 = ready 的 4 个朝向** |
| walk facing 2/3（行 2） | 正确 | 正确（中间行镜像后仍是自己） |

所以往右下（facing 6/7）行驶时，四个行走帧播的是 **ready 行的四个不同朝向**——
画面就是「车体每帧转一次」，而炮台（单行图集）纹丝不动。正好对应用户说的
「往右和右上晃、炮台是对的」。

### 20.2 修法

```ts
const y = row * fh;        // 行号从上往下，rect.y 也从图像顶部量
```

一处改动同时修好站姿和行走：站姿此前也是错的（facing d 显示的是 facing 6/7 的走姿）。

顺带：
- `frameIndexFromRect()`、`tools/artcheck.mjs` 里同样的反向假设一起改掉；
- `artcheck` 新增的两条断言（行走帧连续、跨块=相位数）现在才能真正验证帧序。

### 20.3 顺带修掉的两个问题

1. **前视点转向的 EMA 去掉**。加了低通后，车头还没对准，「先转向再行驶」的判定就一直不通过，
   单位带着一条正常路径原地不动（pathsim 出现 9–11 个永久停滞，`blockT=0`、`repathTry=0`，
   连放弃链都没进）。前视点本身已经把楼梯路径平滑了，不需要再加低通。
2. **「有路不走」看门狗**：`blockedNow` 只覆盖「这一步被拒绝」。单位也可能在**没尝试迈步**时停住
   （转向判定、终点格被占）。新增：有路径但 1.5 秒没位移 → 绕行 → 重定位 → 停车。

### 20.4 验证

```
换图实验   bodyFrame(6, 0..3) 四帧同一朝向（修复前是四个朝向）
artcheck   9/9（含行走四帧底边跨度 0）
dirtest    9/9（八方向 0 次图块来回切）
pathsim    停滞 0/62、到达 53（修复中一度 9–11，去掉 EMA + 看门狗后归零）
crowdtest  7/7   movetest 18/18   harvesttest 6/6   phystest 10/10
maptest 21/21   menutest 11/11   assettest 20/20   inputtest 20/20
featuretest 14/14   speedtest 12/12   battletest 6 分钟 收入 13906 / 击杀 29 / 0 报错
```

---

## 21. v0.23：七大系统按原版重建（建筑 / 经济 / 电力 / 地形 / 步兵 / 飞机 / 载具）

这一轮不再"调参让它像红警"，而是把参考实现的**系统本体**搬到 `project/assets/scripts/sim/`，
Game 层只做适配器。原则：原版文件里每个函数在 sim 层都有一个同名同序的对应物，
数值全部落到 `sim/rules/GeneralRules.ts`（对应 rules.ini `[General]`），代码里不再有散落的魔数。

### 21.1 目录

```
sim/rules/     GeneralRules（[General] 全部数值）、TerrainRules（LandType/SpeedType/LandRules）、BuildStatus
sim/player/    PowerTrait（电力）、Production（工厂/前置/低电惩罚）、ProductionQueue（队列）
sim/traits/    Powered Turret Dock Rally Factory Harvester Suppression IdleAction Agent Crashable
               AirportBound Helipad UnitReload HoverBob Tilter Rocking Transport Gunner Submergible
sim/task/harvester/  GatherOreTask  ReturnOreTask  HarvestWorld
sim/gameobject/      StanceType  InfDeathType
```

### 21.2 电力（`player/trait/PowerTrait.ts`）

- 产出 = `ceil(power * health / 100) + occupantPowerBonus`（掉血即掉电，`NotifyHealthChange` 已接进 `damage()`）。
- `drain` 存正数；`PowerLevel = power >= drain && !blackoutFrames ? Normal : Low`。
- 消耗只在 add / remove 时变化，**不是**每帧重算。
- 低电建造惩罚：`penalty = (0.3 * modifier * (1 - min(1, power/drain))) / 0.15`，clamp 到 `[0.5, 1]`。
- 断电门控：防御武器与生产都要 `BuildStatus.Ready && poweredTrait.isPoweredOn()`。

### 21.3 经济（`trait/ProductionTrait.ts` + `player/production/*`）

- `buildTime = floorTo((cost / effectiveBuildSpeed) * buildTimeMultiplier, 54)`，下限 54 tick。
- `effectiveBuildSpeed = baseBuildSpeed * buildSpeedModifier * (1/pow(0.8, 工厂数-1)) * 墙体系数`。
- 每 tick 扣 `min(credits, cost/buildTime + creditsSpentLeftover, remaining)`，**15 Hz 累加器**驱动。
- 队列类型与上限照抄：Structures(1,1) / Armory(1,1) / Infantry·Vehicles·Ships(maxQ+1) / Aircrafts(0,maxQ+1)；
  相同项**堆叠成一行 quantity**，`creditsSpent` 只属于队首；`maxSize` setter 截断队尾（停机坪数量限制）。
- 出售退款 `floor(cost * 0.5 * clamp(hp/maxHp, 0.15, 1))`，走 `BuildDown` 动画后到账。
- 卸货 `credits += ore*25 + gems*50`，每台净化器 +25%，AI 按难度补虚拟净化器（hard 4 / normal 2）。

### 21.4 地形（`map/Terrain.ts` + `type/LandType` + `rules/LandRules`）

- `LandType` 11 种、`SpeedType` 8 种，`getSpeedModifier` 三条特殊规则逐条照抄
  （Track=0 → Foot 也 0；缺省 1；非 Track/Wheel 且 >0 一律归 1）。
- `Wall + Track` 时回读底层地形（本项目无桥梁层，`bridgeLevel` 恒 false）。
- `Tiles.Tile` 增 `terrainType`（TMP 原始类型），与派生的 `landType` 分开存。
- 矿脉按 **bail** 计：每次 `collectBail` 扣 25，耗尽后 3×3 回沙地并重建通行图。

### 21.5 采矿（`task/harvester/GatherOreTask` + `ReturnOreTask`）

Game 里原来那套 `seek/toMine/mining/toBase/unload` 手写状态机**整段删除**，
换成原版任务链：`GatherOreTask → ReturnOreTask → GatherOreTask`，
`HarvesterStatus` 9 态、`PRIORITY_MATRIX` 邻居优先、近扫半径 1 再 2..6 / 远扫 12、
`forceMoveTried`、`closeEnough=2`、`harvesterTooFarDistance=5`、预留/占用双表全部一致。

实测状态轨迹：`2 走矿 → 3 采矿 → 5 返回 → 8 卸货`，60 秒 2 台车产出 900 晶体。

一个**原版不存在的状态**必须点出来：原版的 `landType === Tiberium` 等价于"格上有矿"，
因为矿是 overlay 对象；本项目 landType 是静态地形，矿采空后仍留着 Tiberium 标记。
若照抄这一行，`status = Harvesting` 会在空格上被反复弹回 `MovingToOreSite`
（`onTick` 无限自递归 → 爆栈，mesa 图实测）。改为用 `isOreTile()` 判定，并加一道单 tick 递归护栏。

### 21.6 步兵（`gameobject/Infantry.ts` + 5 个 trait）

- `SUB_CELLS = [2,4,3]`：一格 3 人（MoveTask 侧早已就位，本轮接上工厂出厂选格）。
- `StanceType` 与既有的"攻击姿态"分离：`stance` = aggressive/guard/hold（交战半径），
  `pose` = None/Guard/Prone/Deployed/Paradrop/Cheer（身体状态）。原版就是两套。
- `SuppressionTrait`：被打中且**站着不动**（或已压制）→ 压制 30 tick，`poseNow` 自动读成 Prone，
  站着不动的人才会趴下，跑动冲锋不受影响（这正是机枪阵地能被冲下来的原因）。
- `IdleActionTrait`：`fraidycat` 单位空闲时 50% 概率自己散开；`actionDueThisTick` 供待机动作。
- `AgentTrait`：间谍渗透（断电 / 偷钱 / 偷科技 / 老兵）。
- `InfDeathType` 决定死亡动画族。

### 21.7 飞机（`gameobject/Aircraft.ts` + WingedLocomotor 的可见部分）

- 弹匣：`ammo` 每发减 1；打空后必须回停机坪。
- `AirportBoundTrait`：优先 `preferredAirport`，没有或满了才重新挑，挑不到 → `crash()`。
- 落地 → `DockTrait.dockUnitAt` → `UnitReloadTrait` 按 `ReloadRate` **一发一发**装填 → 满弹起飞。
- `CrashableTrait`：击落不等于删除。停止接单、每 tick 滚转 + 掉高度，触地才 `destroyObject` 并溅射。
- 实测一个完整架次：`8 发打空(6.5s) → 返航(7.3s) → 落地装填 1 发/秒(8s) → 起飞`，循环稳定。

### 21.8 载具（`gameobject/Vehicle.ts` + 6 个 trait）

- `RockingTrait`：爆炸命中让车体在悬挂上晃 `ROCKING_TICKS=34`（纯表现）。
- `HoverBobTrait`：气垫单位按 `0.1 * H sin(2πt/(60*bob))` 上下浮动，只加增量，不覆盖地形高度。
- `TilterTrait`：`rampType 0..16 → pitch/yaw` 映射逐行照抄；本项目格上没有 rampType，故暂不生效（映射留着）。
- `TransportTrait` / `GunnerTrait` / `SubmergibleTrait`：容量按 `Size` 累计、IFV 炮塔随乘客切换、
  潜艇"静止开火 → 重置 5 秒下潜计时，移动不重置"。本阵容没有运输/IFV/潜艇，代码已就位未接线。

### 21.9 三处必须偏离原版的地方

| 位置 | 原版 | 本项目 | 原因 |
|---|---|---|---|
| `HarvesterTrait.hasRefinery` | `unit.owner.buildings` | `world.hasRefinery(unit)` | 本项目的 `owner` 是数字 id，不是 player 对象 |
| `FactoryTrait` / `PoweredTrait` | `building.owner.production` | `building.player` / `world.getProduction()` | 同上；不改会**静默失效**（工厂不产兵、防御塔永远断电） |
| `ReturnOreTask` 停靠前转身 | `TurnTask(270°)` | 省略 | 我们的 MoveTask 到位时车头已朝停机位，再转 270° 读起来像卡住 |

配套：`Building.player` 别名、`building.dockTileFor(i)`（`DockingOffset0 = size, size/2`，
**不是** `size-1` —— 停在最后一列会把车停进建筑里，采集车永远进不了坞）。

### 21.10 验证

```
tsc -p tsconfig.check.json   0 error
smoke 0 error（60 fps）      movetest 18/18    crowdtest 7/7     phystest 10/10
occltest 5/5                 dirtest 9/9       speedtest 12/12   menutest 11/11
assettest 20/20              inputtest 20/20   featuretest 14/14 harvesttest 6/6
maptest 21/21                battletest 6 分钟 0 报错
```

---

## 22. v0.24：建筑 trait 族与飞机 trait 族补全

第 21 章把「一栋楼 / 一架飞机」的**主干**搬完了，但原版 `gameobject/trait/` 下还有一整层
"锦上添花但决定手感"的 trait 没接：C4、幸存者、免费单位、超武归属、维修、围墙、子机、导弹、离场。
这一轮把它们逐个搬进 `sim/traits/`，并把能在本阵容里跑起来的全部接线。

### 22.1 本轮新增文件

```
sim/Timer.ts                      Timer（tick 倒计时，C4 引信本体）
sim/bresenham.ts                  bresenham + isNotNullOrUndefined（离场航线用）
sim/wallTypes.ts                  wallTypes（16 种墙体连接表，索引即美术帧号）
sim/gameobject/DeathType.ts       DeathType（Normal / Demolish / Crush / …）
sim/player/SuperWeaponsTrait.ts   玩家超武袋（name → 状态对象，可选镜像到 PlayerState.sw）
sim/traits/C4ChargeTrait.ts       C4 炸药（挂在**目标建筑**上）
sim/traits/CrewedTrait.ts         建筑阵亡 / 被卖时放出幸存者
sim/traits/FreeUnitTrait.ts       建筑建成送一个免费单位
sim/traits/SuperWeaponTrait.ts    超武建筑 ↔ 玩家超武袋
sim/traits/OverpoweredTrait.ts    超载（友军充能单位把防御塔切到副武器）
sim/traits/UnitRepairTrait.ts     维修厂 / 机场维修
sim/traits/WallTrait.ts           围墙自动拼接 + 连锁伤害
sim/traits/SpawnLinkTrait.ts      子机牵引（航母 / 驱逐舰）
sim/traits/MissileSpawnTrait.ts   子机导弹自毁起爆
sim/traits/UnlandableTrait.ts     不可降落单位飞出地图
sim/Tiles.ts 追加                 RadialBackFirstTileFinder、getMapSize / getInRectangle / getAllNeighbourTiles
```

### 22.2 C4：工兵的两条指令终于分开（`task/PlantC4Task.ts` + `trait/C4ChargeTrait.ts`）

原版里「占领」和「爆破」是**两条订单**：`CaptureBuildingOrder` 派工兵进门，
`AttackOrder.isValid` 命中 `sourceObject.c4 && targetObj.isBuilding() && targetObj.c4ChargeTrait` 分支时
置 `isC4 = true`（`OrderFeedbackType.SpecialAttack`），跑 `PlantC4Task`。

本项目的 `engineerOrderFor(u, target, mode)` 就是这条判定：

| 玩家动作 | mode | 结果 |
|---|---|---|
| 占领按钮（`orderCapture`） | `capture` | `{ k: 'capture' }`，原样占领 |
| 攻击指令（`orderAttack`） | `attack` | `{ k: 'demolish' }`，放炸药 |

- 引信 `chargeTime = floor(60 * c4Delay * BASE_TICKS_PER_SECOND)`，`c4Delay = 0.05` → **45 tick = 3 秒**。
- `setCharge` 在炸药已经点着时**直接返回**：四个工兵扑同一栋楼不会叠四个引信，也不会延长第一个。
- 到点写 `DeathType.Demolish` 再销毁 —— 塌楼动画，不是爆炸。
- 布置者不留活口（原版 `EnterBuildingTask` 进楼即消失）。
- `Timer.tick` 数的是 **tick**，所以它必须由 15 Hz 循环驱动，见 22.7。

### 22.3 幸存者：人数 = 退款 / SurvivorDivisor（`trait/CrewedTrait.ts`）

```ts
survivorCount = refundValue / survivorDivisor;
survivorCount = survivorCount > 0 && survivorCount < 1 ? 1 : Math.floor(survivorCount);
survivorCount = target.isVehicle() ? Math.min(1, survivorCount) : Math.min(5, survivorCount);
```

三个容易抄错的细节：

1. **`computeRefundValue` 不看血量** —— 原版就是 `purchaseValue * RefundPercent`，
   而 `kill()` 早就把 `hp` 清零了，读血量只会得到 0.15 的下限（本版最初就栽在这，2600 的楼只跑出 1 个人）。
2. **AI 房全额退款** —— `if (!target.owner.isAi) refundValue *= refundPercent`，这是原版保留的怪癖。
3. **最后一个出楼的是工程师** —— 仅当 `target.rules.constructionYard` 时触发
   （"卖掉基地车还能重建"的那个保险）。

除数按**本项目的造价曲线**标定（`alliedSurvivorDivisor = sovietSurvivorDivisor = 260`）：
420 的营帐 → 1 人，2600 的天基阵列 → 5 人（封顶）。照抄原版除数会让每栋楼都顶到 5 人上限。

触发点两个，都是原版的 Notify：
`NotifyDestroy.onDestroy`（`damage()` → `kill()`，且自杀武器 / 移动中的载具 / 正在坠落的飞机不算）
与 `NotifySell.onSell`（`finishSell()`）。落地时挂 `ScatterTask`，把**自己那栋废墟**加入 `ignoredBlockers`，
否则幸存者会绕着刚塌的楼原地打转。

### 22.4 免费单位（`trait/FreeUnitTrait.ts`）

只在 `BuildStatus.BuildUp → Ready` 这一条边沿触发，所以**升起动画没走完是不会送的**。
落点用 `RadialBackFirstTileFinder`（从左/上"背面"开始扫环），条件是
`passable > 0 && |Δz| < 2 && 无障碍物 && 格上不是 overlay（矿）`；全被占满时退回"第一个仅可通行格"；
真找不到就**退款**而不是静默丢弃（原版这条分支存在是有原因的：开局丢一辆基地车是不可恢复的）。

接线：战车库 → 铁砧装甲车，改装厂 → 蜥蜴突击车（`BuildingDef.freeUnit`）。

### 22.5 超武归属（`trait/SuperWeaponTrait.ts` + `player/SuperWeaponsTrait.ts`）

以前是 `syncSuperWeapons()` 每帧扫全表重建 `p.sw`。现在**归属权在 trait**：

- `onSpawn` → `createSuperWeapon(name, player)` 塞进玩家袋；
- `onUnspawn` → 先查"**还有没有别的楼提供同一个超武**"（`getOwnedBuildings(player).some(b => b !== self && …)`），
  没有才移除 —— 这就是"两座力场锚卖掉一座，护盾充能不丢"；
- `onChange` → 旧主移除、新主加入（工兵缴获超武楼时跟着走）；
- 礼物超武（`isGift`）永不由此路径移除。

`SuperWeaponsTrait` 带一个可选的**镜像数组**（就是 `PlayerState.sw`），`add` / `remove` 同时更新两边，
HUD 拿到的和 trait 管的是**同一个对象实例**（`buildingTests` 里断言了 `===`）。
`syncSuperWeapons` 退化成一次防御性对账。

### 22.6 维修：机场用装填时钟（`trait/UnitRepairTrait.ts`）

```ts
repairRate = gameObject.rules.unitReload ? repairRules.reloadRate : repairRules.uRepairRate;
cooldownTicks += BASE_TICKS_PER_SECOND * repairRate * 60;
```

`RepairPercent = 0.2` 是**修满的总价占造价比例**，所以每点 HP 的成本是
`repairPercent * purchaseValue / maxHitPoints`；一个 tick 修 `RepairStep = 12` 点，
钱不够就这一轮不修（`if (!maxCost) return false`）。

三个"不修"的前置条件逐行照抄：没有 dock、dock 里有**空中单位**、建筑断电。
最后一条正是把本 trait 接到机场上的原因 —— 原版空军指挥部**同时**有 `UnitReloadTrait` 和 `UnitRepairTrait`，
`rules.unitReload` 为真时走装填时钟，落地加油的同时把血补回来。
`hasHelipad()` 为真时不再派发 `UnitRepairStart/Finish` 事件（机场有自己的提示音）。

### 22.7 一个必须修的时钟错误：tick 型 trait 不能按帧驱动

`updateBuildings(dt)` 是**每帧**调的（60 Hz），而 `C4ChargeTrait` / `UnitReloadTrait` / `UnitRepairTrait` /
`OverpoweredTrait` 数的都是 **tick**（原版 15 Hz）。按帧驱动会让引信在 60 fps 机器上只有 0.75 秒。

修法：新增 `Game.tickBuildingTraits()`，放进 `tickMovement` 的 `while (this.simAcc >= TICK)` 定步循环里
（`simWorld.currentTick++` 之后），`updateBuildings` 里只留 `factoryTrait` / `dockTrait` 这些本来就按 dt 走的。
副作用是顺带修正了装填速率：`ReloadRate = 1/60` 分钟 = 15 tick = **1 秒 1 发**，这才和 21 章标定的数值一致。

### 22.8 已移植但本阵容没有对应单位（代码就位、未接线）

| trait | 原版宿主 | 缺什么 |
|---|---|---|
| `OverpoweredTrait` | 磁暴线圈 + 磁暴步兵 | 没有"充能型"步兵，也没有副武器塔 |
| `WallTrait` + `wallTypes` | 围墙 | 阵容里没有墙段建筑（`BuildingDef.wall` 已留，`LandType.Wall` 通行规则早就在） |
| `SpawnLinkTrait` | 航母 / 驱逐舰 | 没有 `spawner` 武器，也没有子机 |
| `MissileSpawnTrait` | V3 / 无畏导弹 | 没有独立的导弹单位（本项目的火箭是 `Projectile`，不是 GameObject） |

这四条不做假接线：`sim` 层代码与参考实现保持一致，`Game` 侧留好 world 适配器，
一旦阵容里出现对应的楼/兵，挂上去就能跑。

### 22.9 验证

新增 `tools/buildingtest.mjs`（13 条断言，全部真跑构建产物）：

```
PASS  战车库建成后送出一辆铁砧装甲车            anvil 0 → 1（建造中仍为 0）
PASS  免费单位在升起动画结束前不生成            duringBuildUp=0 status=1
PASS  工兵对敌建筑下达攻击＝布置炸药            order idle → demolish
PASS  引信按 tick 计时（45 tick = 3 s），布置者阵亡
PASS  引信到点后建筑被爆破（DeathType.Demolish） deathType=2 listed=false
PASS  建筑被摧毁后幸存者跑出（refund/Divisor）  步兵 5 → 10
PASS  拆除建筑同样会放出幸存者                  步兵 4 → 5
PASS  机场维修走 UnitRepairTrait 且按装填时钟
PASS  停靠的飞机会被逐渐修好                    hp 120 → 156，扣费 77，status=1
PASS  维修在真实 update 循环里也会推进           hp 120 → 216 / 240
PASS  超武建筑生成 → 玩家武器袋获得该超武（同一实例）
PASS  超武建筑被摧毁 → 武器袋与镜像同步移除
PASS  UnlandableTrait / SpawnLinkTrait 按 def 挂载
```

全量回归（19 个脚本）：

```
tsc -p tsconfig.check.json   0 error
smoke 0 error（60 fps）      movetest 18/18    crowdtest 7/7     phystest 10/10
occltest 5/5                 dirtest 9/9       speedtest 12/12   menutest 11/11
assettest 20/20              inputtest 20/20   featuretest 14/14 harvesttest 6/6
maptest 21/21                buildingtest 13/13
battletest 6 分钟 ERRORS 0（earned 12650 / kills 16 / lost 6 / 建筑 10 vs 9）
```

---

## 23. v0.25-B1：数学地基（原版 40 文件 / 1,411 行）

从这一批开始，移植不再是"补某个系统"，而是**把原版 `src/` 里所有非豁免文件逐个搬完**。
矩阵见 `docs/PORT-MATRIX.md`：豁免 605 文件 / 74,160 行（UI、3D 渲染、多人、战役、资源解析），
应移植 602 文件 / 51,639 行。

### 23.1 本轮范围

```
sim/math/GameMath.ts        532 行   逐字复制（含 1296 项 SIN_TABLE）
sim/math/Vector2.ts         three.Vector2 + 原版 4 个覆盖
sim/math/linear.ts          Vector3 / Quaternion / Euler / Matrix4（自研，见 23.2）
sim/math/{Box2,polar,curves,geometry}.ts
sim/Coords.ts                         逐字复制
sim/Prng.ts                            MT19937 内联 + 原版种子构造
sim/type/*.ts              11 个枚举，逐字复制
sim/util/*.ts              15 个工具，逐字复制（Base64/logger 见 23.3）
sim/index.ts                          引擎层统一出口
```

### 23.2 关键决策：three.js 的四个类，改"自研同算法"

原版的 `Vector3` / `Quaternion` / `Euler` / `Matrix4` 全部 `extends THREE.*`，
只覆盖了少数必须走 `GameMath` 的方法。我们不发布 three（25MB 源码 + 与本项目 2D 渲染无关），
所以把 three 的**基础实现**逐行搬进 `sim/math/linear.ts`，并保留原版的每个覆盖方法原样：

| 类 | three 提供 | 原版覆盖（必须保留） |
|---|---|---|
| Vector2 | 全部基础运算 | `length` / `distanceTo`（GameMath.sqrt）、`angle`（GameMath.atan2）、`rotateAround`（GameMath.cos/sin） |
| Vector3 | 全部基础运算 | `length` / `distanceTo` / `angleTo`（GameMath.acos）、`applyEuler`、`applyAxisAngle`、`projectOnPlane`、`reflect`、`setFromSpherical/Cylindrical` |
| Quaternion | set/copy/dot/multiply | `setFromEuler`（六 order）、`setFromAxisAngle`、`setFromRotationMatrix`、`length`、`slerp`（全部分支） |
| Matrix4 | set/copy/invert/determinant/compose | `extractRotation`、`makeRotationFromEuler`（六 order）、`lookAt`、`getMaxScaleOnAxis`、`makeRotationX/Y/Z/Axis`、`decompose` |

四个类放在**一个模块**里，因为原版靠 three 的打包避免循环引用；拆开会形成
`Matrix4 → Vector3 → Quaternion → Matrix4` 的 import 环。静态暂存对象全部改成**惰性 getter**
（`Vector3.scratch` / `Matrix4.scratch`），否则 `private static _quaternion = new Quaternion()`
会在模块求值期撞上 TDZ（`Quaternion` 声明在 `Vector3` 之后）。

### 23.3 两处"载体换掉、能力补全"

**Base64**：原版 `encode` 是裸 `btoa`，超过 U+00FF 直接抛；它的兜底
`unescape(encodeURIComponent(s))` 产出的字节串，`atob` 永远还原不回原文 —— 这条分支在
Android WebView 上不可达所以没暴露，但在小程序运行时就是坏的。
现在 `encode`/`decode` 保持原版的**二进制串**语义（`binaryStringToUint8Array(decode(x))` 依赖它），
另加 `encodeUtf8`/`decodeUtf8` 做真正的文本往返。

**logger**：原版 `import Logger from 'js-logger'`。改成同调用面（`Logger.get(name)` + 四级）的
极简实现，不实现 handler / formatter / timer（游戏代码一处都没用到）。

### 23.4 两个"看起来像 bug 但其实要照抄"的地方

1. **`CubicBezierCurve3` 不是贝塞尔**。three 的 `getPoint` 走的是 Catmull-Rom 基函数，
   曲线**经过 v1 和 v2**，v0/v3 是控制手柄。所以 `getPoint(0) === v1`、`getPoint(1) === v2`。
   导弹下降弹道（`MissileLocomotor`）直接建在这个语义上，改成标准贝塞尔会让弹道抬头。
2. **`rotateVec2` 先 `Math.floor` 角度**。`rotateVec2(v, 44.9°)` 实际按 44° 转。
   配合 `angleDegFromVec2` 的 `Math.round`，整条链路都在整数度上工作。

### 23.5 验证：`tools/mathtest.mjs`（40 条断言）

不强求"和 Math 一致"，而是断言**原版特征值**：

```
PASS  GameMath.sin(π/6) = 0.5（π/6 恰好落在采样点上，1296/12）
PASS  GameMath.sin(π/7) 与 Math.sin 不同（离网格角度走查表）
PASS  GameMath.cos(a) 就是 GameMath.sin(a + π/2)（原版定义）
PASS  GameMath.sqrt 误差 < 1e-14（牛顿迭代）
PASS  GameMath.atan2 误差 < 1e-3（三次多项式近似）
PASS  GameMath.pow 整数走精确幂，小数走 6 位定点
PASS  MT19937 标准测试向量（seed 5489 → 3499211612）
PASS  MT19937 第二个输出与标准一致（581869302）
PASS  seed 与 sequence 是字符串拼接而非数值相加
PASS  makeRotationFromEuler 六个 order 全部正交且 det=1
PASS  Quaternion.slerp 在 t=0 / 0.5 / 1 处正确
PASS  Coords 常量与参考一致（30px 瓦片 / 256 leptons）
PASS  CurvePath 按弧长参数化（14 单位折线，半程落点在拐角）
PASS  CubicBezierCurve3 走 Catmull-Rom（getPoint(0)=v1, getPoint(1)=v2）
PASS  Crc32 标准向量 "123456789" → 0xCBF43926
```

全量回归：`smoke 0 error / movetest 18 / crowdtest 7 / phystest 10 / occltest 5 /
dirtest 9 / speedtest 12 / menutest 11 / assettest 20 / inputtest 20 / featuretest 14 /
harvesttest 6 / maptest 21 / buildingtest 13` —— 全部通过。

## 24. v0.25-B2：规则全表（原版 37 文件 / 2,635 行）

B1 搬的是数学地基，B2 搬的是**所有规则**——原版 `src/game/rules/**` 整个目录。
这一层没有"手感"，只有数据、派生和几处刻意的取整，所以验收方式也变了：
不再看画面，而是逐条断言**原版的派生结果**。

### 24.1 本轮范围

```
sim/rules/Rules.ts              610 行   根容器（原版 555 行）
sim/rules/TechnoRules.ts        997 行   ~300 字段全派生（B2 前半完成）
sim/rules/GeneralRules.ts       292 行   主容器 + PrereqCategory（原版 183 行）
sim/rules/general/*.ts         ×12       Crew/DMisl/Hover/LightningStorm/Missile/
                                         Paradrop/Prism/Radar/Repair/Threat/V3Rocket/Veteran
sim/rules/ObjectRules.ts         87 行   基类 + 两个单位换算
sim/rules/WarheadRules.ts       138 行   verses 缺失槽位 = 满伤
sim/rules/WeaponRules.ts        131 行   Range=-2 → Infinity；speed 双存
sim/rules/CombatDamageRules.ts   74 行
sim/rules/{Land,Terrain}Rules.ts 65 + 110  原版两个类，替代旧的单文件混合体
sim/rules/{Overlay,Smudge,Debris,Projectile,Radiation,Tiberium}.ts
sim/rules/{SuperWeapon,Ai,Country,Crate,ElevationModel,Powerups,AudioVisual,MpDialogSettings}.ts
sim/rules/ObjectRulesFactory.ts  58 行   按 ObjectType 分派
sim/rules/rulesContent.ts       308 行   本项目自己的 rules.ini（内容）
sim/type/TheaterType.ts          20 行
sim/util/Color.ts                92 行   [Colors] 的 HSV 读取
```

引擎侧合计 4,432 行（原版同目录 2,351 行），差额是注释、`XxxRulesData` 类型和 308 行内容数据。

### 24.2 数据格式：`readIni(ini)` → `read(data)`

原版每个规则类都是 `readIni(ini: IniReader)`，逐键 `ini.getNumber('Cost')`。
按既定决策（TS 对象 + 字段逐一对齐，不移植 INI 解析器），本轮统一改成：

```ts
export interface XxxRulesData { cost?: number; /* ... 键名 = ini 键的 camelCase */ }
export class XxxRules { cost = 0; read(data: XxxRulesData = {}): this { ... } }
```

只换**取值方式**，不换**字段语义**：默认值仍取原版 `getXxx(key, default)` 的回落值，
派生仍在 `read` 里算一次（不在使用点重算），一个字段两份含义的（`WeaponRules.speed` /
`iniSpeed`、`ProjectileRules.rot` / `iniRot`、`TechnoRules.rot`）保持双存。

`Rules` 构造参数从 `IniFile` 换成 `RulesContent`，但 `init()` 的**装配顺序原样保留**
（AudioVisual → CombatDamage → Radiation → General → AI → Crate → Elevation → MpDialog →
类型表 → Colors → Countries → Warheads → Tiberiums → SuperWeapons → 对象表 → 武器索引）。
这条顺序有意义：`TechnoRules` 在构造时就要读 `general.unitsUnsellable` / `returnStructures`。

### 24.3 `GENERAL` 常量的每一站

旧的自研 `GENERAL` 常量共被 9 个文件、19 个字段读用，本轮全部拆解，**不留兼容对象**：

| 旧读点 | 新归属 | 备注 |
|---|---|---|
| `baseTicksPerSecond` ×14 | `sim/Constants.TICKS_PER_SECOND` | 时钟常量，原版在任何 `[General]` 里都没有这个键 |
| `closeEnough` ×3 | `RULES.general.closeEnough` | |
| `harvesterTooFarDistance` ×3 | `RULES.general.harvesterTooFarDistance` | |
| `refundPercent` ×2 | `RULES.general.refundPercent` | 读取时 clamp 到 [0,1] |
| `multipleFactory` ×2 | `RULES.general.multipleFactory` | |
| `buildupTime` ×2 | `RULES.general.buildupTime` | 分钟 |
| `maximumQueuedObjects` | `RULES.general.maximumQueuedObjects` | 队列容量 = 值 + 1 |
| `wallBuildSpeedCoefficient` | `RULES.general.wallBuildSpeedCoefficient` | |
| `purifierBonus` | `RULES.general.purifierBonus` | |
| `repair` | `RULES.general.repair` | 整个 `RepairRules` 实例 |
| `reloadRate` | `RULES.general.repair.reloadRate` | 原版就在 Repair 块里，不在 `[General]` 顶层 |
| `c4Delay` | `RULES.combatDamage.c4Delay` | 原版在 `[CombatDamage]` |
| `crew.*` ×6 | `RULES.general.crew.*` | `CrewRules` 实例 |
| `harvesterStorage` | `sim/Constants.HARVESTER_STORAGE` | 原版无此键：容量在 `TechnoRules.Storage`，等 B5 迁到单位定义上 |
| `crew.alliedEngineer` / `sovietEngineer` | `Game.ts` 的 `CREW_ENGINEER` | 原版 `CrewRules` 没有工程师字段；这是本项目的阵营内容 |

三个字段直接删除，因为它们从来没有读点：`oreValue` / `gemValue`（矿价已由
`RULES.getTiberium(id).value` 承担）、`buildTimeFloorMs`。

### 24.4 四处"看起来多余、其实必须照抄"

1. **`LandRules.getSpeedModifier` 的三条 early-out**，第三条把 **Foot 也夹成 1**：
   ```ts
   if (speedType !== SpeedType.Track && speedType !== SpeedType.Wheel && modifier > 0) modifier = 1;
   ```
   `[Rock]` 写 `Foot=80`，步兵踩上去并不是 0.8 倍速，而是 1 倍——**只有履带和轮式保留小数**。
   我第一版断言写成"Foot 0.8"就挂了，查回原版才发现这条。同时：
   `Track=0` 会让 Foot 也变 0（墙就是墙）；缺失列按 1 而不是 0。
2. **`ProjectileRules` 的加速度三段推导**，顺序不能动：
   ```ts
   if (rot === 1 && !acceleration) acceleration = Infinity;
   acceleration = acceleration || 3;   // Infinity || 3 仍是 Infinity
   ```
   `ROT=1`（瞬时转向）意味着可以任意急转，所以是无穷大而不是 0；把 `|| 3` 提到前面会让
   瞬时转向的弹道变成每秒加速 3。
3. **`ElevationModelRules.bonusCap` 卡的是步数，不是百分比**：
   `min(bonusCap, floor(高差/步长)) * incrementBonus`。步长 4、加成 5、cap 50 时，
   400 点高差的收益是 `min(50,100)*5 = 250`，不是 50。
4. **`TerrainRules.normalizeOccupationBits`** 把越界掩码折回 `[0,8)`：
   `(bits + 8*|floor(bits/8)|) % 8`。零售树写 `OccupationBits=-1`，不折的话每个位测试都会意外通过。
   配套的 `testOccupationBit` 对子格 0/1 恒返回 true——子格 0 是格心、1 是共用位，永远被占。

另外两个"推导出来的默认值"也保住了：`OverlayRules.radarInvisible` 缺省是
`!isWall && !isARock`（墙和石头默认不上雷达，其它默认上）；
`DebrisRules.elasticity` 读取时 clamp 到 [0,1]（大于 1 会每次弹跳加能量，永不落地）。

### 24.5 两个载体换掉

**INI section → TS 内容对象**。原版 `Rules` 从 `rules.ini` 读；本项目仓库里没有也不该有
规则文本。所有数值搬进 `sim/rules/rulesContent.ts`，形态与 `[General]` / `[Clear]` /
`[Colors]` 等段落一一对应（`landRules` 以**段名**为键，好让 `getLandRules` 的
`Cliff → Rock` 回退仍然成立）。空表（warheads / weapons / projectiles / 单位类型表）
是刻意的——留给 B3 与内容梳理，而不是填占位值让错误延后暴露。

**`private` → `public`**。原版 `AudioVisualRules` / `AiRules` / `CrateRules` / `DebrisRules`
的字段都写了 `private`，但 `engine/renderable/**` 与 `trait/**` 一直在读它们——
TS 的 `private` 只是编译期约定，从没真正拦住。照抄会编译不过，所以改成 `public`，
**只改可见性，不改语义**。

### 24.6 验证：`tools/rulestest.mjs`（62 条断言）

```
PASS  refundPercent 1.5 被夹到 1 / -1 被夹到 0
PASS  revealTriggerRadius 50 被压到 10
PASS  缺 prerequisiteProc 时 readPrereqCategories 抛错
PASS  getMissileRules("V3Rocket") 返回 v3Rocket 实例，未知类型抛错
PASS  Track=0 时 Foot 也被挡住 → 0
PASS  非 Track/Wheel 的正 modifier 被夹成 1（Hover / Foot 都不吃减速）
PASS  Rock: 只有 Track/Wheel 保留小数（0.7 / 0.5），Foot 被夹成 1
PASS  Cliff 走显式 [Cliff] 段而不是回落 [Rock]
PASS  occupationBits -1 → 7 / 8 → 0 / 9 → 1
PASS  Snow 与 Temperate 的占用掩码分开取值
PASS  Overlay: Wall / IsARock 默认不上雷达，显式值可覆盖
PASS  Projectile: ROT=1 且无加速度 → Infinity；无加速度 → 3；显式 5 保留
PASS  Projectile: ROT 128 → 180 度/帧；AG 默认 true / AA 默认 false
PASS  ElevationModel: bonusCap 卡步数（50 步 × 5 = 250）
PASS  Color.fromHsv(0,0,255) → 白，(0,255,255) → 红，h=255 绕回红
PASS  CrateRules: UnitCrateType="NONE" → undefined
PASS  MpDialogSettings: 缺 key 保持 undefined，0 保持 0
PASS  PowerupsRules: IonStorm/Gas/Pod/Squad 在读取时被剔除
```

全量回归：`mathtest 40 / rulestest 62 / movetest 18 / crowdtest / phystest / occltest /
dirtest / speedtest / menutest / assettest / inputtest / featuretest / harvesttest /
maptest / buildingtest / battletest`，`smoke ERRORS 0`。

## 25. v0.25-B3：战斗数学（原版 33 文件 / ≈2,600 行）

B2 把 `WarheadRules.verses` 读进来了，B3 是第一次真的拿它去乘。这一层全是纯函数
加两个状态机，所以验收方式也最硬：不测"看起来对不对"，只测**原版算出来的那个数**。

### 25.1 本轮范围

```
sim/Warhead.ts                     775 行   canDamage / computeDamage / inflictDamage / detonate
sim/Weapon.ts                      546 行   burst / cooldown / distributedFire 三套状态机
sim/WeaponTargeting.ts             350 行   整本"什么能打什么"的规则
sim/Target.ts                      135 行   目标是一个"落点"，不是一个对象
sim/gameobject/unit/RangeHelper.ts 310 行   四种距离与唯一加射程的地方
sim/gameobject/trait/HealthTrait.ts 162 行  百分比 ↔ HP 的双向转换
sim/gameobject/unit/FacingUtil.ts    39 行
sim/gameobject/unit/TargetUtil.ts    42 行   （当前未接调用方，B5 的导弹会用）
sim/gameobject/unit/{ZoneType,CollisionType,HealthLevel}.ts
sim/gameobject/trait/{Invulnerable,WarpedOut,DelayedKill,Tiberium}Trait.ts
sim/gameobject/trait/interface/Notify{Damage,HealthChange,Heal,Tick,WarpChange}.ts
sim/gameobject/common/AnimTerrainEffect.ts  矿石烧毁 + 焦痕
sim/map/tileFinder/RadialTileFinder.ts      同心方环生成器
sim/map/{BridgeOverlayTypes,OreOverlayTypes}.ts   写死的 id 区间
sim/art/FlhCoords.ts
sim/event/{EventType,WarheadDetonate,WeaponFire,ObjectAttacked,InflictDamage,HealthChange}Event.ts
sim/trait/interface/NotifyAttack.ts
sim/type/{OverlayTibType,TiberiumType}.ts
```

引擎侧 3,258 行（原版同范围 ≈2,600 行），差额是注释与 duck-type 接口声明。

### 25.2 一次命中经过的六段

```
canDamage(obj, tile, zone)          能不能碰        → 布尔，16 道 early-out
computeDamage(base, target, world)  该掉多少        → 纯函数，护甲 × verses × 各种除法
detonate() 里按距离 lerp            溅射衰减        → lerp(dmg, percentAtMax*dmg, d/r)
sign() 吸附                         亚 1 伤害       → ±1，有 25% 门槛
inflictDamage()                     HP 真的变       → 事件 + 恐慌 + 崩溃 + 销毁
pickExplodeAnim()                   炸成什么样      → damage/25 索引 animList
```

其中只有 `computeDamage` 是可重入的纯计算，其余四段都带副作用。这条链的**顺序**是
语义的一部分：`HealthChange` 先于 `InflictDamage` 先于 `ObjectAttacked` 先于
`WarheadDetonate`，四条事件在 `combattest` 里被逐字断言。

### 25.3 五处「看着像 bug，必须照抄」

1. **`verses.get(armor) || 1` 把显式的 0% 也变成 100%**。
   写 `Verses=0%` 想表达"完全免疫"，读出来却是满伤。原版就是这样，我第一版断言
   写"显式 0 应该是 0"直接挂了。要真免疫得用 `Immune=yes`，不是 `Verses=0`。

2. **`computeDamage` 最后一行是 `damage > 0 ? floor : ceil`**。
   取整方向**背离零**。于是 0.9 伤害在 `computeDamage` 处就已经变成 0，`detonate`
   里那个 `Math.sign()` 吸附**够不着**它 —— 亚 1 伤害想造成 1 点，必须 `baseDamage`
   本身就 ≥ 1，再靠溅射衰减把它压到亚 1，才会被吸附回 1。这是两个不同的入口，
   很容易以为"0.5 伤害也会扣 1 血"。

3. **`HealthTrait` 的百分比 → HP 不是往返的**。
   `health = v` → `max(1, floor(v * maxHP / 100))`。50 上限的单位设 1% 得到 1 HP，
   再读回来是 2%。那个 `max(1, ...)` 是"设正值永远杀不死"的保证，血条上的 1% 和
   内部的 1 HP 本来就不是同一个数。

4. **建筑副武器的射程被主武器封顶**，`min(primary.range, own.range)`，
   只有 `overpoweredTrait`（磁暴线圈充能）能绕过。所以给防空炮写 `Range=12` 而主炮
   `Range=8`，实际只有 8。

5. **`RadialTileFinder` 的环序是固定的**：底行右→左、右列下→上、顶行左→右、
   左列下→上。看起来只是遍历顺序，但 `detonate` 里"谁算直击"取决于它，
   两个重叠单位谁吃 `isDirectHit` 由这个顺序决定。

### 25.4 两个载体换掉

**`ScatterTask` 还没出生**。`Warhead.suppressOrScatterTarget` 里要
`new ScatterTask(...)`，而 `ScatterTask` 依赖 `MoveTask`（1,037 行，B7）。按
"能力先到、载体后到"的原则，改成 `Warhead.taskFactory` 静态注入点：

```ts
static taskFactory?: WarheadTaskFactory;   // B7 由 ScatterTask 注册
```

条件分支（`fraidycat` / `hasTasks` / `isPanicked` / `isSuppressed`）100% 保留，
只有"实例化"被延后。未注册时那一步是空操作，不会崩。

**`new IniSection("Dummy")` → `new WeaponRules({ name: "Dummy" })`**。
`createDummyWeaponInfo()` 需要一份"什么都没有"的武器规则给无武器弹头用。
原版从空 INI 段构造，我们从空数据对象构造——同义。

### 25.5 一处顺手补齐的上游

`TileDirection` 原本只有四个北向成员（寻路只需要这些）。`AnimTerrainEffect`
的 2×2 焦痕需要 `Bottom` / `BottomLeft` / `BottomRight` 三格都存在，所以把枚举补到
完整八向。原版是数字枚举、我们是字符串枚举，能力等价。

### 25.6 验证：`tools/combattest.mjs`（71 条断言）

```
PASS  verses[Flak]=0.5 生效 → 10 × 0.5 = 5
PASS  verses 缺槽位 → `|| 1` 满伤 10
PASS  verses 显式写 0 → `0 || 1` 仍是满伤 10（原版如此）
PASS  负伤害向上取整 -1.9 → -1
PASS  0.9 伤害在 computeDamage 处归 0（±1 吸附在 detonate 里，够不着）
PASS  老兵护甲是除数：10 / 2 = 5
PASS  卧倒步兵吃 0.5 倍；辐射/时空弹头不吃这个折扣
PASS  WallAbsoluteDestroyer → 正无穷
PASS  Wood=yes 打木墙 → 10（不是 0）；打混凝土墙 → 0
PASS  health = 1% → 1 HP，不是 0
PASS  max 50 / health 1% → 1 HP 且回报 2%
PASS  projectDamage 下限是 -30
PASS  arcing 速度 = 0.75 × min(256, 128) = 96
PASS  !rot / inviso / isLaser / isElectricBolt → 正无穷
PASS  建筑副武器被主武器射程封顶 → min(8,12) = 8；Overpowered 解封 → 12
PASS  驻军 3 人 → rof 60/3 = 20
PASS  老兵 ROF 乘完再 floor：61 × 0.5 = 30.5 → 30
PASS  Secondary 专用对空武器不能打地面（zone 判定拦截）
PASS  空降中（>2 格）步兵需要防空武器；高度 2 不吃豁免
PASS  4x2 建筑 × 平射武器 → ceil(min(4,2)/2) = 1 → 11
PASS  下坡 (4-0)×5 = 20 加成 → 30；上坡无加成
PASS  矿石 overlay：isOre=true 但不设 obj
PASS  桥 overlay 强制 bridgeMode = Bridge(2)
PASS  建筑 target 用 centerTile，不是 tile
PASS  环 1 的环序：4,4 5,5 4,5 3,5 5,4 5,3 3,3 4,3 3,4
PASS  矿 id 127 落在 Riparius/Vinifera 重叠区 → Riparius（先测 Riparius）
PASS  端到端：100 伤害打 100 HP → 死亡且 HP 归零
PASS  端到端：事件链 29 → 28 → 12 → 30
PASS  端到端：0.5 伤害一滴血都不掉
```

全量回归：`mathtest 40 / rulestest 62 / combattest 71 / movetest 18 / crowdtest /
phystest / occltest / dirtest / speedtest / menutest / assettest / inputtest /
featuretest / harvesttest / maptest / buildingtest / battletest`，`smoke ERRORS 0`。
