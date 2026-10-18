"""Full-resolution composite review (288 px per facing), hull + turret overlaid.

    python tools/blender/bridge.py run tools/blender/inspect_hires.py
"""

import os
import sys

import bpy
import numpy as np

ROOT = r"C:/Users/sixin/program/project/AI/仿红色警戒的小程序游戏"
sys.path.insert(0, os.path.join(ROOT, "tools", "blender"))
import blib as B

TMP = os.path.join(ROOT, "art", "blender", "_tmp")


def load(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    arr = np.flipud(buf.reshape(h, w, 4))
    bpy.data.images.remove(img)
    return arr


def main():
    tiles = []
    for f in range(8):
        h = load(os.path.join(TMP, "hull", "h_%d_0.png" % f))
        t = load(os.path.join(TMP, "turret", "t_%d_0.png" % f))
        a = t[:, :, 3:4]
        h[:, :, :3] = t[:, :, :3] * a + h[:, :, :3] * (1 - a)
        h[:, :, 3:4] = np.maximum(h[:, :, 3:4], a)
        tiles.append(h)

    n = len(tiles)
    w, h_ = tiles[0].shape[1], tiles[0].shape[0]
    cols, rows = 4, 2
    sheet = np.zeros((rows * h_, cols * w, 4), dtype=np.float32)
    sheet[:, :, :3] = (0.72, 0.58, 0.42)
    sheet[:, :, 3] = 1.0
    for i, t in enumerate(tiles):
        c, r = i % cols, i // cols
        dst = sheet[r * h_:(r + 1) * h_, c * w:(c + 1) * w]
        a = t[:, :, 3:4]
        dst[:, :, :3] = t[:, :, :3] * a + dst[:, :, :3] * (1 - a)
    out = os.path.join(ROOT, "art", "blender", "_debug", "composite_hires.png")
    B.write_png(sheet, out)
    print("OK", out)


main()
