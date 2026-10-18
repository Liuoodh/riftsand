"""Review sheets for the unit atlases (runs inside Blender for numpy + PNG IO).

    python tools/blender/bridge.py run tools/blender/inspect_atlas.py

Writes art/blender/_debug/facings_ready.png and walk_cycle.png, both at 6x with
a crosshair marking the sprite anchor (canvas centre).
"""

import os
import sys

import bpy
import numpy as np

ROOT = r"C:/Users/sixin/program/project/AI/仿红色警戒的小程序游戏"
sys.path.insert(0, os.path.join(ROOT, "tools", "blender"))
import blib as B

CELL = 72
ZOOM = 6
BG = (0.145, 0.135, 0.125)
GRID = (0.26, 0.25, 0.23)


def load(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    arr = np.flipud(buf.reshape(h, w, 4))
    bpy.data.images.remove(img)
    return arr


def at(atlas, idx):
    col, row = idx % 8, idx // 8
    return atlas[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL]


def over(dst, src):
    a = src[:, :, 3:4]
    out = dst.copy()
    out[:, :, :3] = src[:, :, :3] * a + dst[:, :, :3] * (1 - a)
    out[:, :, 3:4] = np.maximum(dst[:, :, 3:4], a)
    return out


def composite(hull, turret, facing, anim, start, per_facing):
    h = at(hull, start + per_facing * facing + anim)
    t = at(turret, facing)
    return over(h.copy(), t)


def upscale(tile, k):
    return np.repeat(np.repeat(tile, k, axis=0), k, axis=1)


def sheet(tiles, cols, rows, path, labels_y=None):
    cw = CELL * ZOOM
    img = np.zeros((rows * cw, cols * cw, 4), dtype=np.float32)
    img[:, :, :3] = BG
    img[:, :, 3] = 1.0
    for i, t in enumerate(tiles):
        c, r = i % cols, i // cols
        big = upscale(t, ZOOM)
        x, y = c * cw, r * cw
        img[y:y + big.shape[0], x:x + big.shape[1], :3] = big[:, :, :3]
        # anchor crosshair
        cx, cy = x + (CELL // 2) * ZOOM, y + (CELL // 2) * ZOOM
        img[cy:cy + 1, x:x + cw, :3] = GRID
        img[y:y + cw, cx:cx + 1, :3] = GRID
    B.write_png(img, path)
    return path


def main():
    hull = load(os.path.join(ROOT, "art", "units", "rampart.png"))
    turret = load(os.path.join(ROOT, "art", "units", "rampart_turret.png"))
    dbg = os.path.join(ROOT, "art", "blender", "_debug")

    ready = [composite(hull, turret, f, 0, 8, 4) for f in range(8)]
    p1 = sheet(ready, cols=4, rows=2, path=os.path.join(dbg, "facings_ready.png"))

    walk = [composite(hull, turret, 6, a, 8, 4) for a in range(4)]
    p2 = sheet(walk, cols=4, rows=1, path=os.path.join(dbg, "walk_cycle.png"))
    print("OK", p1, p2)


main()
