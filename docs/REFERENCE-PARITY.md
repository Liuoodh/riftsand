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
