# 裂沙战线 / RIFTSAND

移动端即时战略（RTS）游戏，保留《红色警戒》式核心玩法（实时建设、资源采集、兵种生产、手动指挥、战争迷雾、科技树、摧毁基地取胜），世界设定、阵营、建筑、兵种、美术、UI 全部原创。

- 目标平台：微信小游戏、抖音小游戏（横屏 1280×720）
- 引擎：Cocos Creator 3.8.8
- 语言：TypeScript
- 仓库：https://github.com/Liuoodh/riftsand
- 当前版本：**v0.2.0-dev — 触屏操作层（框选 / 编队 / 指令盘 / 吸附 / 辅助开关）**

![主菜单](docs/shots/menu.png)

![战场](docs/shots/combat.png)

触屏操作层实拍——框选、长按指令盘、编队条与批量生产队列：

| 框选 | 长按指令盘 | 编队 / 队列 |
| --- | --- | --- |
| ![框选](docs/shots/box-select.png) | ![指令盘](docs/shots/command-wheel.png) | ![队列](docs/shots/queue.png) |

---

## 目录结构

```
.
├─ project/                  # Cocos Creator 工程（全部代码与资源）
│  ├─ assets/
│  │  ├─ scenes/main.scene   # 唯一场景：Canvas + Camera
│  │  └─ scripts/
│  │     ├─ Boot.ts          # 入口：分辨率、输入、生命周期、主循环
│  │     ├─ core/Core.ts     # 常量、色板、阵营 / 兵种 / 建筑数据表、公式
│  │     ├─ world/           # 程序化地图生成、A* 寻路
│  │     ├─ game/            # 实体、模拟核心、AI
│  │     ├─ render/          # 程序化矢量美术、实体视图、战争迷雾、相机
│  │     └─ ui/              # HUD、建造/生产卡片、小地图、菜单与结算
│  ├─ settings/  tsconfig.json  package.json
├─ docs/
│  ├─ GDD.md                 # 玩法与数值设计
│  ├─ ART_STYLE.md           # 视觉规范（对齐参考图）
│  ├─ TECH.md                # 技术架构与小程序适配
│  ├─ ROADMAP.md             # 迭代路线
│  └─ shots/                 # 实机截图（headless Chrome 采集）
└─ README.md
```

> 约定：`project/` 只放工程本体；设计文档、说明等一律放在外层。

## 运行

1. 用 Cocos Dashboard 打开 `project/`（Creator 3.8.8）。
2. 打开 `assets/scenes/main.scene`，点击预览。
3. 或在项目目录执行命令行构建：

```bash
"C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe" \
  --project "<绝对路径>/project" \
  --build "platform=web-mobile;debug=true;buildPath=build"
```

开发期可直接打开 `build/web-mobile/index.html?auto=1` 跳过主菜单进入对局。

## 发布到微信 / 抖音小游戏

1. Cocos 编辑器 → 构建发布 → 平台选 `微信小游戏`（或 `抖音小游戏`），首场景选 `main`，构建。
2. 微信：用「微信开发者工具」导入 `build/wechatgame`，填入自己的 AppID 后预览/上传。
3. 抖音：用「抖音开发者工具」导入 `build/bytedance-mini-game`。
4. 项目已按小游戏约束设计：无外部图片/音频资源，全部图形运行时用 `Graphics` 绘制，首包极小（构建后约数百 KB 的脚本 + 引擎）。

## 操作

| 手势 | 说明 |
| --- | --- |
| 单击单位 | 选中 |
| 单击自己的建筑 | 选中并打开生产卡片 |
| 单击地面 | 已选部队移动；选中建筑时为设置集结点 |
| 单击敌方目标 | 下达攻击指令 |
| 双击己方单位 | 选中屏幕内所有同类型单位 |
| 单指拖拽 | 框选（框内无作战单位时改选采集车，框空取消选择） |
| 双指拖动 | 平移视角 |
| 双指捏合 | 缩放 |
| 长按空白处 | 呼出指令盘（停止 / 攻移 / 采集，建筑为集结点 / 拆除），滑动选中抬手执行 |
| 长按编队格 | 把当前选中编入该编队 |
| 点击编队格 | 选中该编队；双击跳到编队位置 |
| 长按生产卡片 | 一次排满 5 格生产队列 |
| 「全选部队」 | 选中所有作战单位 |
| 小地图 | 点击快速定位 |
| 底部卡片 | 建造建筑 / 生产单位（建造为连续放置） |
| 「拆除」 | 半价回收选中的建筑 |

**辅助开关**（暂停面板中可关闭）：自动索敌——待命单位对射程内敌人开火；保持阵型——编队行军按最慢单位速度同步。辅助只消除手速惩罚，不代替玩家做战略决策。

**键盘**（桌面调试）：`WASD`/方向键平移，`滚轮`缩放，`空格`全选，`1`–`5` 选编队，`Shift/Ctrl + 1`–`5` 编队，`H` 停止，`Q` 攻击移动，`Esc` 暂停。

## 分支

- `main`：稳定可玩版本（打 tag 的版本都从这里出）
- `dev-liu`：日常开发提交，当前开发线（新东西先进这里，稳定后合回 `main`）

```bash
git clone git@github.com:Liuoodh/riftsand.git
git checkout dev-liu
```

## 自动化验证

```bash
node tools/smoke.mjs       # 启动、开局、帧率、控制台错误、界面截图
node tools/battletest.mjs  # 快进对局，输出经济/兵力/胜负曲线
node tools/inputtest.mjs   # 真实触摸事件回归 14 项手势（框选/双击/双指/长按/编队/批量生产/吸附）
```

需要本机 Chrome 与 `puppeteer-core`（脚本内已指向本地安装路径）。

## 版权

玩法机制致敬经典 RTS，但所有阵营、单位、建筑、地图、美术、UI 文案均为本项目原创。
