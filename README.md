# 裂沙战线 / RIFTSAND

移动端即时战略（RTS）游戏，保留《红色警戒》式核心玩法（实时建设、资源采集、兵种生产、手动指挥、战争迷雾、科技树、摧毁基地取胜），世界设定、阵营、建筑、兵种、美术、UI 全部原创。

- 目标平台：微信小游戏、抖音小游戏（横屏 1280×720）
- 引擎：Cocos Creator 3.8.8
- 语言：TypeScript
- 仓库：https://github.com/Liuoodh/riftsand
- 当前版本：**v0.1.0 — 首个可玩迭代（Vertical Slice）**

![主菜单](docs/shots/menu.png)

![战场](docs/shots/combat.png)

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

| 操作 | 说明 |
| --- | --- |
| 单指拖动 | 平移视角 |
| 双指捏合 / 滚轮 | 缩放 |
| 点击单位 | 选中；再次点击同类型单位 = 选中全部同类 |
| 点击地面 | 已选部队移动 / 攻击移动 |
| 点击敌方单位或建筑 | 下达攻击指令 |
| 点击自己的建筑 | 选中并打开生产卡片 |
| 「全选部队」 | 选中所有作战单位 |
| 小地图 | 点击/拖动快速定位 |
| 底部卡片 | 建造建筑 / 生产单位 |
| 「拆除」 | 半价回收选中的建筑 |

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
```

需要本机 Chrome 与 `puppeteer-core`（脚本内已指向本地安装路径）。

## 版权

玩法机制致敬经典 RTS，但所有阵营、单位、建筑、地图、美术、UI 文案均为本项目原创。
