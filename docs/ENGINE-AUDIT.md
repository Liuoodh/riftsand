# 引擎对照审计（v0.10）

把「物理、寻路、战斗结算」逐项和参考实现（`RedAlert2-Android-main/redalert2/src`，TypeScript 版红警 2 引擎）对齐。

标记：✅ 已对齐 · 🟡 行为等价但实现不同 · ⬜ 未做（已排期）

---

## 1. 时间与坐标

| 项 | 原版 | 我们 | 状态 |
|---|---|---|---|
| 时间基准 | 固定 tick，15 tick/s = 1.0x（`game/GameSpeed.ts`） | 同（`Core.gameSpeedTicks`） | ✅ |
| 速度档位 | 0.67 / 0.8 / 1 / 1.33 / 2 / 3 / 4（`60/(6-s)`，5、6 档特例 45/60） | 同 | ✅ |
| 逻辑坐标 | lepton 直角坐标，256/格，渲染时投影（`game/Coords.ts`） | 32 px/格，渲染时投影（`world/Iso.ts`） | 🟡 单位不同，分工一致 |
| 高度 | `tile.z` 整数层 + `rampType 1..20` 格内插值 | `Terrain.level` 整数层 + 顶点高度场插值 | 🟡 等价 |
| 视野尺寸 | 等距瓦片 60×30 | 56×28 | 🟡 2:1 一致，比例略小 |

---

## 2. 移动

| 项 | 原版 | 我们 | 状态 |
|---|---|---|---|
| 移动器抽象 | `Locomotor` 子类（Drive/Walk/Hover/Jumpjet/Tunnel/Teleport） | `Unit.moveStep` 内按 `kind` 分支（infantry/air/vehicle） | 🟡 未拆类，行为分支已有 |
| 转向前置 | 朝向不符则 `velocity = 0` + `TurnTask`（`DriveLocomotor`） | 残差 > 49° 时本帧只转不走（`Entities.moveStep`） | ✅ |
| 转向速率 | 每类单位 `ROT` | `unitTurn()` 表 | ✅ |
| 加速 | 有加速度模型 | `unitAccel()` 线性逼近 | 🟡 |
| 地形速度 | `SpeedType` 查表（Clear/Road/Rough/Water…） | `Terrain.speedAt()`（沙 1 / 丘 0.84 / 矿 0.66，步兵与悬浮有修正） | ✅ |
| 路径消费 | 瓦片序列，逐格推进 | 瓦片序列 + 视线平滑 | 🟡 平滑是我们加的（观感更好） |
| 到达判定 | 到格中心 | `d < 3` 切下一个点 | 🟡 |
| 卡住处理 | `MoveResult.Fail` / 等待 / 重算 | 等待 0.55s → 螺旋找替代点 → 5 次后放弃 | ✅ |
| 单位互斥 | `TileOccupation: Set<obj>` + `CollisionState.Waiting` + `MoveAsideTask` | `TileOccupation`（新建）+ `push()` 让路 + 圆盘占位检测 | ✅ v0.10 |
| 碾压 | 进入新格时判定 `crusher`（`MoveTrait.ts:240`） | 同（`Game.syncCell`），不看速度 | ✅ v0.10 |
| 步兵 subCell | 每格 3 个 sub-position | 权重 1/3 + 圆盘软分离 | 🟡 未做真实 sub-position |

---

## 3. 寻路

| 项 | 原版 | 我们 | 状态 |
|---|---|---|---|
| 算法 | A*（`game/map/pathFinder/PathFinder.ts`）+ 八向图 | A*（`world/Path.ts`） | ✅ |
| 距离 | `dx+dy+(√2-2)·min(dx,dy)`（octile，`Terrain.ts:72`） | 同 | ✅ |
| 转向惩罚 | 启发值 +0.2（`Terrain.ts:93-96`） | g 值 +0.2（v0.10 补上） | ✅ |
| 切角 | 由 passability graph 保证（对角需两侧可通） | `if (blocked(cx+dx,cy) \|\| blocked(cx,cy+dy)) continue` | ✅ |
| 通行图 | 按 `SpeedType` 分别缓存图 | 单一图 + 地形代价 | 🟡 未分速度类型 |
| 单位体积 | footprint 查占位表 | 半径圆盘 `discFree` | 🟡 等价 |
| 目标不可达 | `bestEffort`：返回最近可达点；否则 `[]` | `bestEffort` + `findFreeNear` | ✅ |
| 节点预算 | `maxExpandedNodes`（默认无限，调用方可限） | 5200 | ✅ |
| 路径平滑 | 无（逐格） | 视线平滑（`smooth/lineClear`） | 🟡 |

---

## 4. 碰撞与占据

| 项 | 原版 | 我们 | 状态 |
|---|---|---|---|
| 占格表 | `Set<GameObject>[]`，随移动增删 | `world/TileOccupation.ts`，随 `syncCell` 增删 | ✅ v0.10 |
| 阻挡反应 | 等待 / 请求让路（45° 扇区）/ 重算 | 等待 → 侧移让路 → 螺旋替代点 → 放弃 | ✅ |
| 位置修正 | **从不修改坐标** | 只在「已在墙内」时以 110px/s 推出，不瞬移 | ✅ v0.9 |
| 建筑放置 | 查占位表，不允许压在单位上 | `canPlace` 几何判定（v0.9 补） | ✅ |
| 分离位移预算 | 无（不推） | 每帧每单位 40·dt，防瞬移 | 🟡 我们保留软推 |

---

## 5. 战斗

| 项 | 原版 | 我们 | 状态 |
|---|---|---|---|
| 弹道类型 | `Bullet`（瞬发/inviso）、`ArcingProjectile`（抛物线）等 | bullet 直线 / shell 抛物线 / rocket 制导 / bomb 抛物线 | ✅ 结构对应 |
| 命中判定 | 逐帧位置 + 目标半径 | 线段扫掠 `segmentCircleT` | 🟡 更严格 |
| 提前量 | 无（弹速极快或制导） | 3 次迭代预瞄 | 🟡 我们加的 |
| 伤害矩阵 | `Warhead.Verses[ArmorType]`，10 种装甲 | `DMG_TABLE[dmgType][armor]`，3×4 | 🟡 维度更少 |
| 溅射 | `CellSpread` + 线性衰减 | `lerp(1, fallout, d/r)` | ✅ |
| 误伤友军 | 默认会 | 部分实现（溅射会伤友军） | 🟡 |
| 开火前摇 | `PreAttackDelay` + 炮塔对齐 | 炮塔对齐（v0.10 补），无前摇帧 | 🟡 |
| 炮塔独立 | `TurretTrait.desiredFacing` | `turretFace/turretAim/turretHold` | ✅ |
| 老兵加成 | 伤害/射速/装甲分级 | `damageMul/rofMul/armorMul` | ✅ |
| 建筑建造 | `BuildStatus.BuildUp` + `BuildupTime` | `status='buildup'` + 进度驱动外观 | ✅ v0.10 |
| 建筑贩卖 | `SellObjectAction` → `BuildDown` → 退款 `RefundPercent` | `sellSelectedBuilding` → `builddown` → 完成时退款 50% | ✅ v0.10 |
| 建筑废墟 | 摧毁后留残骸（不阻挡） | `Game.ruins` + 渲染层，不阻挡 | ✅ v0.10 |

---

## 6. 视野

| 项 | 原版 | 我们 | 状态 |
|---|---|---|---|
| 迷雾状态 | `Unexplored / TemporaryReveal / Explored`（`MapShroud.ts:4-8`） | unexplored / explored（v0.10 去掉了「已探索半透明」这一档） | ✅ v0.10 |
| 已探索是否永久可见 | 是（`isShrouded` 只判 Unexplored） | 是（`isVisibleTo` 用 `explored`） | ✅ v0.10 |
| 迷雾绘制 | 4×4 子块拼 `SHROUD.SHP`，边缘抖动 | 按行合并菱形 + 边界噪声抖动 | 🟡 无纹理版 |
| 高度对迷雾的影响 | `tileElevation` 参与投影 | 未做（单层迷雾） | ⬜ v0.11 |
| 临时揭示（间谍/超武） | `TemporaryReveal` | 无 | ⬜ |

---

## 7. 其它

| 项 | 原版 | 我们 | 状态 |
|---|---|---|---|
| 绘制排序 | 3D 深度缓冲 | 画家序（投影 y） | 🟡 |
| 单位表现 | SHP 8 方向帧 / VXL 体素 | 烘焙帧 + 8 方向（可换 SHP） | ✅ 结构一致 |
| 建筑表现 | SHP 主图 + `ActiveAnim` | 等距体块 + 建造/拆除动画 | 🟡 无 ActiveAnim |
| 地图瓦片 | TMP（60×30，4bpp 扫描线） | 程序化菱形；TMP 解析 + 展开已实现（v0.10） | ✅ 解析层 |
| 地形高度 | `rampType` 20 种 | 顶点高度场（等价） | 🟡 |

---

## 8. 这一版补的差异

1. **`TileOccupation`**（`world/TileOccupation.ts`）—— 步兵 1/3 权重，其他整格。
2. **碾压改为换格判定** —— 去掉速度阈值（原版没有）。
3. **建筑建造/拆除动画 + 状态机** —— `buildup / ready / builddown`。
4. **废墟** —— 摧毁与拆除都留痕，不阻挡。
5. **迷雾语义** —— 已探索即永久完全可见，敌人在已探索区始终可见。
6. **A* 转向惩罚 +0.2** —— 列队不再锯齿走位。
7. **炮塔对齐才开火** —— 不再出现炮管还在转就出弹。

## 9. 仍未对齐（按影响排序）

| 项 | 影响 | 计划 |
|---|---|---|
| `Warhead.Verses` 10 种装甲 | 兵种克制不够细 | v0.11 |
| 真实步兵 sub-position | 步兵拥挤时偶尔重叠 | v0.11 |
| 按 `SpeedType` 分层通行图 | 悬浮/履带绕路差异不明显 | v0.11 |
| 迷雾按高度投影 | 高台边缘会露 | v0.12（要桥梁/多层） |
| `ActiveAnim` 建筑动画 | 建筑「不动」 | 等素材 |
| 桥梁 / 高低差 / 运输载具 | 玩法缺失 | 见 ROADMAP |
