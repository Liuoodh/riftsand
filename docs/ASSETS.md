# 素材管线（ASSETS）

> 这份文档回答一个问题：**将来把原版素材放进项目，游戏能不能直接用？**
> 结论：能。地形瓦片、单位帧、调色板三条链路都按零售格式实现，并用 round-trip 测试验证过。

---

## 0. 为什么要有这一层

v0.5 及之前的单位、建筑、地形全部是「运行时用 `cc.Graphics` 画矢量」。这在“没有素材”时能跑，但**它不是红警的渲染模型**：

| | 零售红警 | v0.5 之前 |
|---|---|---|
| 单位 | SHP 位图帧（8 方向 × N 帧）或 VXL 体素 | 每帧重算矢量路径 |
| 建筑 | 主图 SHP + 多个动画 SHP 聚合 | 一次矢量绘制 |
| 地形 | TMP 等距瓦片图集 + 调色板 | 逐格画菱形 |

只要渲染方式还是“每帧画矢量”，素材一到就得**推翻整个渲染层**。所以这一版把渲染改成 **纹理 + Sprite**，矢量绘制降级为「素材生成器」。

```
                 ┌──────────────────┐
   .shp  .pal  → │ assets/Shp.ts    │ ─┐
   .tmp        → │ assets/Tmp.ts    │  │
                 │ assets/Palette.ts│  ├→ Texture2D → SpriteFrame → Sprite
   Art.ts 绘制 → │ assets/Assets.ts │ ─┘   （单位渲染只认 SpriteFrame）
                 │  （烘焙成纹理）   │
                 └──────────────────┘
```

单位渲染层（`Views.ts` / `EntityView`）**不认识 SHP，也不认识 Art.ts**，它只要 `SpriteFrame`。

---

## 1. 目录

| 文件 | 职责 | 行数量级 |
|---|---|---|
| `assets/Reader.ts` | 小端字节游标 | 90 |
| `assets/Shp.ts` | SHP 解析（头 / 24B 帧表 / 压缩 0·1·2·3，含 LCW） | 175 |
| `assets/ShpEncode.ts` | SHP 写入（用于 round-trip 测试与预烘焙） | 70 |
| `assets/Palette.ts` | .pal 解析、6bit→8bit、阵营 remap、索引→RGBA | 110 |
| `assets/Tmp.ts` | TMP 瓦片解析（头 / 块元数据 / 高度 / 地形类型 / 坡道类型） | 165 |
| `assets/Pen.ts` | 绘制后端抽象（`GfxPen` / `CanvasPen`） | 180 |
| `assets/Assets.ts` | 烘焙、帧缓存、`unitBodyFrame()`、`frameFromShp()` | 150 |

全部不依赖零售文件；`Reader/Shp/Tmp/Palette` 是纯逻辑，可以单独移植到工具链。

---

## 2. SHP（单位与建筑图）

### 2.1 布局

```
header      i16 reserved(0) | i16 width | i16 height | i16 numImages
descriptor  numImages × 24B，从 offset 8 开始
            i16 x | i16 y | i16 w | i16 h | u8 comp | u8[3] pad
            i32 0 | i32 0 | i32 dataOffset   ← 绝对文件偏移
frame       位于 dataOffset：i16 x,y,w,h | u8 comp | ... | i32 dataOffset
```

**易错点**：没有独立的“帧偏移表”。第 N 帧的描述符位置是 `8 + 24*N`，真正指向像素的是描述符**最后 4 字节**。

### 2.2 压缩

| 值 | 含义 | 处理 |
|---|---|---|
| 0 / 1 | 原样 | 直接读 `w*h` 字节 |
| 2 | 逐行 RLE | 每行 `u16 lineLen`（含自身），随后 `lineLen-2` 字节 |
| 3 | LCW / Format3 | 每行 `u16 lineLen`，`0` 表示游程，非 0 为字面量 |

像素是 **8 位调色板索引**，行优先、**无 4 字节对齐**，索引 `0` 透明。

### 2.3 朝向

零售把 8 个朝向排在连续帧里，帧号公式：

```ts
facingIndex = Math.round((((deg - 45 + 360) % 360) / 360) * facings) % facings
frameIndex  = startFrame + facingMult * facingIndex + animFrame
```

本项目 `render/Frames.ts` 的 `facingIndex()` 与之一致，`SEQUENCES` 给出帧数与帧率（`Rate 900 → 15fps`）。

### 2.4 影子

零售把影子放在**同一文件的第二半**（`numImages/2 + frameNo`）。`ShpFile.bodyCount` / `hasShadow()` 已经能识别；接入影子时无需额外文件。

---

## 3. PAL（调色板）

- 768 字节 = 256 × RGB，每通道 **6 bit**，展开方式 `min(255, v * 4)`。
- 索引 0 一律 alpha 0（`parsePal` 已处理）。
- **阵营色固定在 16..31**，用 16 档亮度因子重写：

```ts
const REMAP_FACTORS = [63,59,55,52,48,44,41,37,33,30,26,22,19,15,11,8];
slot[16+i] = floor(base / 255 * factor[i] * 4)
```

`remapTeam()` 与零售逐位一致：纯红在 16 号槽得 `252`，31 号槽得 `32`（测试断言）。

---

## 4. TMP（等距瓦片）

### 4.1 布局

```
header  i32 width | i32 height | i32 blockW | i32 blockH
        i32[width*height] block offsets
block   52B: x, y, unused, unused, dataSize, extraX, extraY, extraW, extraH,
             u32 flags(1=extra, 2=z, 4=damaged),
             u8 zHeight | u8 terrainType | u8 rampType | rgb[3] | rgb[3] | pad[3]
data    (blockW*blockH)/2 索引字节 [+ z 同长] [+ extraW*extraH]
```

### 4.2 对我们真正重要的字段

| 字段 | 用途 |
|---|---|
| `zHeight` | 直接写进 `Terrain.level` |
| `terrainType` | 经 `TERRAIN_TYPE_LAND` 映射到 `clear/road/rock/rough/water/cliff/wall` |
| `rampType` | 0 = 平地，1..20 = 该格用哪种角点混合；可换成顶点高度 |

也就是说：**真瓦片一进来，`Terrain.level` / `.kind` / `.vh` 就能直接被填满**，不需要改玩法代码。

像素展开（菱形扫描线）暂未实现——它只影响渲染，等有真素材再补。当前 `TmpTile.px` 保留原始 900 字节。

---

## 5. 帧的两种来源

```ts
// 单位车体
unitBodyFrame(def, faction, dir8, frame): SpriteFrame | null
```

内部两条路：

1. **程序化烘焙（当前默认）**
   用 `CanvasPen` 把 `Art.ts` 的画法画到离屏 2D canvas，`getImageData` → 行翻转 → `Texture2D.uploadData` → `SpriteFrame`。
   参数：72×72，单位居中，缓存上限 900 帧（LRU 淘汰）。

2. **SHP 直读（素材到位后）**
   `ShpFile.parse(buf)` → `frameFromShp(shp, index, pal)` → 同一个 `SpriteFrame` 类型。
   调用方（`EntityView`）不需要任何改动。

### 5.1 为什么车体与炮塔是分开的

车体烘焙成帧（8 方向 × 4 帧 = 32 张/单位/阵营），**炮塔每帧现画**（只有椭圆 + 炮管两笔）。
如果把炮塔也烘进去，缓存会变成 `8 方向 × 4 帧 × 8 炮塔方向 = 256 张/单位`，显存和首帧卡顿都不可接受。

---

## 6. 接入真实素材的步骤

1. 把 `.shp` / `.pal` / `.tmp` 放进 `project/assets/`（或运行时从 VFS/MIX 读）。
2. 实现 `asset 名 → ArrayBuffer` 的取数函数（Web 用 `fetch`，微信小游戏用 `wx.getFileSystemManager()`）。
3. 单位：
   ```ts
   const shp = ShpFile.parse(await load('girampart.shp'));
   const pal = remapTeam(parsePal(await load('unittem.pal')), r, g, b);
   // 在 unitBodyFrame 的分支里改成 frameFromShp(shp, startFrame + perFacing*dir8 + frame, pal)
   ```
4. 地形：
   ```ts
   const tmp = TmpFile.parse(await load('temperat/tem01.tem'));
   for (const t of tmp.tiles) { terrain.level[i] = t.zHeight; terrain.kind[i] = map(t.terrainType); }
   terrain.rebuildHeight();
   ```
5. 删除 `Art.ts` 的调用即可——渲染层完全不必改动。

---

## 7. 验证

```bash
node tools/assettest.mjs      # 16 项断言，SHP/PAL/TMP round-trip + 烘焙
```

当前结果：

| 断言 | 结果 |
|---|---|
| SHP 帧数 / 宽高 | 32 帧，24×24 |
| SHP 像素逐字节一致 | **mismatch = 0** |
| SHP 影子后半帧识别 | 16 body + shadow |
| PAL 6bit→8bit | `63*4 = 252` |
| PAL 索引 0 透明 | alpha 0 |
| 阵营 remap 16 号槽 | r = 252 |
| 阵营 remap 31 号槽 | r = 32 |
| TMP terrainType / rampType / zHeight | 14 / 7 / 2 |
| TMP 主数据长度 | 900 = 60×30/2 |
| 烘焙帧不透明像素 | 1039 |

> 为什么是 round-trip 而不是“读一个真文件”：本仓库不包含、也永远不会包含零售素材。
> 编码器写出的字节布局与零售一致（24B 描述符、绝对偏移、无对齐索引图），
> 读回来逐字节相等，才能证明读取端是对的。

---

## 8. 还没做的

| 项 | 原因 | 计划 |
|---|---|---|
| TMP 像素展开（菱形扫描线） | 只影响渲染，需要真素材校准 | 有素材后 |
| VXL 体素 | 需要 3D 渲染路径 | 属于独立一块，优先级低于 SHP |
| MIX 解包 | 需要 CRC32 文件名表 | 接素材时一起做（~60 行） |
| SHP 图集打包 | 当前每帧一张纹理，够用 | 帧数上去后再合批 |
