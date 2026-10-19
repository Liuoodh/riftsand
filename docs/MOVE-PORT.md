# 移动 / 寻路 / 碰撞：原版逐行对应表

这一版把**寻路、碰撞、让路、停车**整套逻辑换成了原版移植，删掉了此前自己加的一整套启发式
（`moveStep` 逐帧转向、`separateHulls` 互推、`handleBlocked` 状态链、`repathAround`、
`parkNear`、`resolveWorldCollision` 等）。现在的行为由原版的
「格子占用 + MoveTask 状态机」决定，**没有任何逐帧几何修正**。

参考实现：`RedAlert2-Android-main/redalert2/src/**`（下称「原版」）。
移植代码：`project/assets/scripts/sim/**`。

---

## 1. 文件对应

| 原版 | 本工程 | 说明 |
|---|---|---|
| `util/Graph.ts` | `sim/Graph.ts` `Graph` / `GraphNode` | 邻接图，双向连边 |
| `map/pathFinder/NodeHeap.ts` | `sim/Graph.ts` `NodeHeap` | 二叉堆，`updateItem` 语义一致 |
| `map/pathFinder/SearchStatePool.ts` | `sim/Graph.ts` `SearchState` / `SearchStatePool` | 状态复用池 |
| `map/pathFinder/PathFinder.ts` | `sim/Graph.ts` `PathFinder` | A*：`bestEffort`、转向 +0.2 启发式 |
| `map/Terrain.ts` | `sim/Passability.ts` | 通行图、`computePath`、`getPassableSpeed`、`findObstacles` |
| `map/TileCollection.ts` | `sim/Tiles.ts` `Tile` / `TileCollection` | 格子、八邻接方向 |
| `map/MapBounds.ts` | `sim/Tiles.ts` `MapBounds` | |
| `map/tileFinder/RadialTileFinder.ts` | `sim/Tiles.ts` `RadialTileFinder` | 环形扫描，**访问顺序一致** |
| `map/tileFinder/RandomTileFinder.ts` | `sim/Tiles.ts` `RandomTileFinder` | 空军重定位用 |
| `map/TileOccupation.ts` | `sim/TileOccupation.ts` | 占格表：一格一车 / 三步兵 |
| `gameobject/trait/MoveTrait.ts` | `sim/MoveTrait.ts` | 四态机、速度、路径预占 |
| `gameobject/locomotor/DriveLocomotor.ts` | `sim/Locomotor.ts` `DriveLocomotor` | 每段只算一次朝向、曲线转向、末段减速 |
| `gameobject/locomotor/FootLocomotor.ts` | `sim/Locomotor.ts` `FootLocomotor` | 步兵：到点停一帧 |
| `gameobject/task/move/MoveTask.ts` | `sim/MoveTask.ts` | **核心**：计划 / 等待 / 让路 / 重定位 / 放弃 |
| `gameobject/task/move/MoveAsideTask.ts` | `sim/MoveAsideTask.ts` | 被堵时绕开一格（含"连锁推"） |
| `gameobject/task/TurnTask.ts` | `sim/Locomotor.ts` `TurnTask` | 转向任务（不可取消） |
| `gameobject/task/system/WaitTicksTask.ts` | `sim/Task.ts` `WaitTicksTask` | 等待 N tick |
| `gameobject/task/system/Task.ts` | `sim/Task.ts` `Task` / `UnitOrders` | 任务树 + 单位任务队列 |
| `gameobject/unit/FacingUtil.ts` | `sim/Math2.ts` `FacingUtil` | 朝向：0=北、90=西、180=南、270=东 |
| `game/math/{LineCurve,QuadraticBezierCurve,CurvePath}` | `sim/Curves.ts` | 转弯弧线（不依赖 three.js） |
| `game/gameobject/ObjectPosition.ts` | `sim/Position.ts` | 格子 + 格内偏移，越格触发 `handleTileChange` |

## 2. 一份移动订单的完整路径

```
player tap
  └─ Game.orderMove()            // 编队散点
      └─ Game.moveUnitTo()       // 取消旧任务，压入 MoveTask
          └─ MoveTask.onStart()  // 规划路径，moveState = ReachedNextWaypoint
tick（固定 60Hz，Game.tickMovement）
  └─ UnitOrders.tick()
      └─ MoveTask.onTick()
          ├─ ReachedNextWaypoint : 弹出已到达的航点；空路径→到达/重定位
          │                       否则 locomotor.selectNextWaypoint()
          │                       onNewWaypoint() 需要转身时压入 TurnTask
          ├─ PlanMove            : 逐格检查前方
          │     ├─ 地形/建筑挡住  → needsPathUpdate（记住 blockedPathNodes）
          │     ├─ 前方是单位    → 等 40 tick / 喊 MoveAsideTask / 沿路回退
          │     ├─ 正面对向      → 停车等待（collisionState = Waiting）
          │     └─ 通过          → 占用后续路径格，moveState = Moving
          └─ Moving              : locomotor.tick() 每 tick 前进 speed/60
                                   position.moveByLeptons() → 越格 → handleTileChange()
                                   done → 回到 ReachedNextWaypoint（同 tick 递归）
```

## 3. 关键规则（与原版一致，不再有自定义"手感修正"）

1. **一格一车、三步兵**（`MoveTask.canStopAtTile` + `Passability.findObstacles`）。
   步兵子格为 `[2,4,3]`（`Infantry.SUB_CELLS`），互不重复。
2. **不推人**。没有任何"把重叠单位分开"的代码。挡路只有四种结果：等、喊对方让、
   绕路、就近停车（`CloseEnough`）。测试 `movetest` 断言"站着的兵位移 0px"。
3. **迎面相遇**：`|direction 差| === 180` → 双方停车；等待超时后把冲突格标记为
   不可通行重新规划（`allObstaclesAreBlockers`），因此会自己找路绕开。
4. **目的地被占**：`findRelocationTile` 在 5 格环形范围内按
   `距离 + 岛连通 + canStopAtTile` 选一格停车，不是"原地打转"。
5. **朝向只在换段时确定**：`DriveLocomotor.onNewWaypoint` 算出一次航向并返回
   `TurnTask`，`tick` 期间绝不改 `direction`。直线行驶的航向变化为 0。
6. **加速度与末段减速**：`applyAcceleration`（`accelerationFactor` 0.03 / 0.022），
   最后一段 `lerp(1, base, 1-progress)`，所以起步、停车是渐变的。
7. **转弯弧线**：带惯性且转角 < 90° 时走
   `Line → QuadraticBezier → Line`，不是原地硬拐。
8. **占领/采矿/攻击** 都只是"给单位一个 MoveTask + 到达判定"，没有单独的寻路器。

## 4. 为了接入本工程所做的适配（非逻辑改动）

| 位置 | 适配 | 原因 |
|---|---|---|
| `sim/World.ts` `rulesFor()` | `def` → 原版 `rules` 字段（`speedType` / `movementZone` / `rot` / `accelerates`…） | 本工程单位数据在 `core/Core.ts` |
| `sim/World.ts` | `rot = rad/s × TICK × RAD` | 本工程转速用 rad/s，原版用 度/tick |
| `sim/Locomotor.ts` | 速度用 px/s，移动量 `speed × (1/60)`；去掉 `Math.floor(speed)` | 本工程速度是浮点 px/s，原版是整数 lepton/tick |
| 桥梁 | 全部传 `false` / `undefined` | 本工程暂无桥（两层地面） |
| `Target.usesGroundLayerUnderBridge` | 恒 `false` | 同上 |
| `MoveTask.selectWeaponVsObstacle` | 返回 `undefined` | 本工程没有"移动中开火"的攻击任务 |
| `MoveTask` 板条箱 / 地雷 / 伪装 / 传送 / 老兵散开 | 略 | 对应玩法尚未实现，分支已标注 `// no … in this game` |
| `TileOccupation` | `isBuilding` 是本工程的布尔字段，原版是方法 → `isBuildingObject()` | 见 `sim/Constants.ts` |
| `MoveTask` 的 `ignoredBlockers` 过滤 | `!this.isIgnored(o)` | 原版 `?.includes` 在 `undefined` 时为假；直接写 `indexOf(...) === -1` 会把**所有**障碍滤掉（本次调试踩到的坑） |
| `MoveTask.onEnd` | `targetOffset` 取值前判空 | 本工程可能在任务首次 tick 前就取消它 |
| `Unit.face` | `wrapRad(facingToRad(direction))` | 渲染层按 (-π, π] 取图，越界会算出负索引 |

## 5. 固定步长

原版按 tick 运行。`Game.tickMovement(dt)` 用累加器把任意帧长切成 60Hz 的固定步
（单帧最多 6 步），任务逻辑与帧率无关，探针脚本也因此可复现。

## 6. 回归入口

```
node tools/movetest.mjs    # 对向/推挤/抵达/放弃/让路/共格/子格  18 项
node tools/crowdtest.mjs   # 10 车同点，共格与间距              7 项
node tools/pathsim.mjs     # 随机订单停滞普查（stuckRate 应为 0）
node tools/steertest.mjs   # 直线航向 / 炮塔 / 列队
node tools/harvesttest.mjs # 采矿闭环、无瞬移
node tools/phystest.mjs    # 地形、碾压、直射、曲射、防空       10 项
```

改动本目录后请先 `npx tsc -p tsconfig.check.json`（工程自带）再构建。

## 7. 同一套方法搬到建筑 / 飞机 trait（v0.24）

「读原版 → 逐函数落到 `sim/` → Game 层只加 world 适配器」这条路线不止用于移动，
v0.24 用它补齐了建筑与飞机侧的 trait 族（C4 / 幸存者 / 免费单位 / 超武归属 / 维修 / 围墙 /
子机 / 导弹 / 离场），对应表见 `REFERENCE-PARITY.md` 第 22 章。

这里只记一条**通用铁律**，它同时适用于移动和本轮所有 trait：

> 原版 trait 数的是 **tick（15 Hz）**，不是秒。任何 `Timer` / `cooldownTicks` / `blackoutFrames`
> 都必须由 `tickMovement` 里的定步循环驱动，绝不能挂在每帧调用的函数上。

本轮就是踩了这个坑：`C4ChargeTrait` 一开始挂在 `updateBuildings(dt)`（每帧 60 Hz）上，
45 tick 的引信在 60 fps 机器上只有 0.75 秒。现在统一收进 `Game.tickBuildingTraits()`。

另一个反复出现的坑（v0.23 的采集 / 工厂，v0.24 的维修扣费）:

> 本工程 `Entity.owner` 是**数字 id**。原版写 `unit.owner.credits` 的地方，
> 要么走 `Building.player` / `Unit.player` 别名，要么走适配器的 `playerOf(x)`。

v0.24 的维修就是因为它静默失效的：`getCredits(unit.owner)` 拿到 `0`（id），
于是 `maxCost === 0` → `tickRepair` 直接 return false，飞机停在机坪上永远不修。
