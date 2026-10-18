"""
RAMPART (城墙主战坦克, BU) — first Blender art batch.

Builds a low-poly heavy tank, renders it from the game's 8 screen facings at a
30 deg camera pitch, and writes two atlases in the layout the engine expects:

    art/units/rampart.png          576x360   row0 ready | rows1-4 walk (4 frames)
    art/units/rampart_turret.png   576x72    8 facings, aligned with the hull

Run through the MCP bridge (see tools/blender/bridge.py):

    python tools/blender/bridge.py run tools/blender/rampart_build.py
"""

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Euler

ROOT = r"C:/Users/sixin/program/project/AI/仿红色警戒的小程序游戏"
sys.path.insert(0, os.path.join(ROOT, "tools", "blender"))
import blib as B
import importlib
importlib.reload(B)

RES = 576          # render size (per facing); 576 = 4x the 144px game frame
FACTOR = 4         # downscale factor -> 144px
CELL = 144
OUT_UNITS = os.path.join(ROOT, "art", "units")
TMP = os.path.join(ROOT, "art", "blender", "_tmp")
DEBUG = os.path.join(ROOT, "art", "blender", "_debug")

UNIT_COLOR = B.PAL["team"]     # BU amber


# ---------------------------------------------------------------- materials
def build_materials():
    m = {}
    m["hull"] = B.material("hull", B.PAL["metal_main"], rough=0.58, metallic=0.25)
    m["plate"] = B.material("plate", B.PAL["metal_light"], rough=0.5, metallic=0.3)
    m["dark"] = B.material("dark", B.PAL["metal_dark"], rough=0.65, metallic=0.2)
    m["rubber"] = B.material("track", B.PAL["rubber"], rough=0.8, metallic=0.05,
                             tread=True)
    m["neon"] = B.material("neon", B.PAL["neon"], rough=0.3, metallic=0.0,
                           emit=B.PAL["neon"], emit_strength=3.0)
    m["team"] = B.material("team", UNIT_COLOR, rough=0.45, metallic=0.1,
                           emit=UNIT_COLOR, emit_strength=0.7)
    m["glass"] = B.material("glass", B.PAL["neon"], rough=0.15, metallic=0.0)
    return m


# ---------------------------------------------------------------- hull
def build_hull(coll, m):
    parts = []

    # track runs
    for side in (1, -1):
        parts.append(B.box("track_%d" % side, (0.0, side * 0.95, 0.40),
                           (3.84, 0.46, 0.58), m["rubber"], coll, bevel=0.04))
        # armoured side skirt: leaves a strip of tread visible at the bottom
        parts.append(B.box("skirt_%d" % side, (0.0, side * 0.94, 0.755),
                           (3.62, 0.05, 0.21), m["plate"], coll, bevel=0.02))
        for gx in (-1.25, 0.05, 1.35):
            parts.append(B.box("skirtgap", (gx, side * 0.965, 0.755),
                               (0.06, 0.04, 0.2), m["dark"], coll, bevel=0.01))

    # main hull: rear block -> flat deck -> sloped glacis -> nose
    profile = [
        (-2.05, 0.50), (-2.00, 1.00), (-1.66, 1.30),
        (0.78, 1.30), (1.56, 1.17), (2.08, 0.84),
        (2.10, 0.58), (1.82, 0.46), (-2.05, 0.46),
    ]
    parts.append(B.hull_profile("hull", profile, 0.82, m["hull"], coll, taper=0.9,
                                bevel=0.04))

    # rear engine deck + inset grilles
    parts.append(B.box("deck", (-1.28, 0.0, 1.28), (1.3, 1.16, 0.06), m["plate"],
                       coll, bevel=0.02))
    parts.append(B.box("engine", (-1.80, 0.0, 1.44), (0.5, 1.0, 0.28), m["hull"],
                       coll, bevel=0.04))
    for yy in (-0.34, 0.0, 0.34):
        parts.append(B.box("grille", (-1.24, yy, 1.315), (1.12, 0.2, 0.02),
                           m["dark"], coll, bevel=0.004))
    for side in (1, -1):
        parts.append(B.cylinder_x("exhaust_%d" % side, (-2.06, side * 0.44, 0.98),
                                  0.08, 0.1, m["dark"], coll, segs=8))

    # stowage bins on the sponsons (flat on the deck, not overhanging)
    for side in (1, -1):
        parts.append(B.box("bin_%d" % side, (-0.98, side * 0.56, 1.33),
                           (0.86, 0.26, 0.1), m["dark"], coll, bevel=0.02))

    # neon rail along both sides (BU: horizontal, right-angled)
    for side in (1, -1):
        parts.append(B.box("neon_%d" % side, (-0.2, side * 0.752, 1.14),
                           (2.28, 0.045, 0.05), m["neon"], coll, bevel=0.01))
    parts.append(B.box("tail", (-2.05, 0.0, 1.04), (0.05, 0.4, 0.055), m["neon"], coll))

    # team colour band across the deck (BU amber) - the sprite has no runtime tint
    parts.append(B.box("hull_team", (0.52, 0.0, 1.315), (0.16, 1.24, 0.05), m["team"],
                       coll, bevel=0.01))

    # headlights + tow shackle
    for side in (1, -1):
        parts.append(B.box("lamp_%d" % side, (2.05, side * 0.5, 0.92),
                           (0.06, 0.17, 0.1), m["neon"], coll, bevel=0.01))
    parts.append(B.box("tow", (2.13, 0.0, 0.54), (0.11, 0.82, 0.1), m["dark"], coll,
                       bevel=0.02))

    return B.join(parts, "rampart_hull")


# ---------------------------------------------------------------- turret
TURRET_PTS = [
    (0.98, 0.30), (0.98, -0.30),      # narrow nose, flat front for the mantlet
    (-0.26, -0.74), (-0.80, -0.62),   # rear left, bustle left
    (-0.80, 0.62), (-0.26, 0.74),     # bustle right, rear right
]


def build_turret(coll, m):
    """Wedge-shaped turret: narrow flat nose, wide bustle. Reads as a turret, not a dome."""
    parts = []
    parts.append(B.prism_xy("turret", TURRET_PTS, 1.30, 1.94, m["plate"], coll,
                            taper=0.94, bevel=0.03))
    top = [(x * 0.97, y * 0.97) for (x, y) in TURRET_PTS]
    parts.append(B.prism_xy("turret_top", top, 1.94, 2.02, m["plate"], coll,
                            taper=0.95, bevel=0.02))
    seam = [(x * 0.985, y * 0.985) for (x, y) in TURRET_PTS]
    parts.append(B.prism_xy("lid_seam", seam, 1.925, 1.945, m["dark"], coll,
                            taper=1.0, bevel=0.0))

    # gun shield + barrel
    parts.append(B.box("mantlet", (1.06, 0.0, 1.68), (0.46, 0.56, 0.6), m["hull"],
                       coll, bevel=0.05))
    parts.append(B.cylinder_x("sleeve", (1.1, 0.0, 1.66), 0.5, 0.2, m["dark"],
                              coll, segs=14))
    parts.append(B.cylinder_x("barrel", (1.56, 0.0, 1.66), 0.92, 0.155, m["dark"],
                              coll, segs=14))
    parts.append(B.cylinder_x("muzzle", (2.34, 0.0, 1.66), 0.32, 0.235, m["dark"],
                              coll, segs=10))
    parts.append(B.cylinder_x("bore", (2.38, 0.0, 1.66), 0.26, 0.185, m["rubber"],
                              coll, segs=10, cap=False))

    # commander hatch, periscope, sensor mast
    parts.append(B.cylinder_z("hatch", (-0.26, 0.26, 2.02), 0.2, 0.09, m["hull"],
                              coll, segs=14, r_top=0.17))
    parts.append(B.box("peri", (-0.13, 0.42, 2.05), (0.17, 0.12, 0.09), m["glass"],
                       coll, bevel=0.01))
    parts.append(B.cylinder_z("mast", (-0.52, -0.3, 2.02), 0.03, 0.48, m["dark"],
                              coll, segs=6))
    parts.append(B.box("tip", (-0.52, -0.3, 2.48), (0.08, 0.08, 0.08), m["neon"],
                       coll, bevel=0.01))

    # team colour band: front + both flanks (BU amber)
    parts.append(B.box("team_f", (0.98, 0.0, 1.74), (0.06, 0.46, 0.15), m["team"],
                       coll, bevel=0.02))
    for side in (1, -1):
        parts.append(B.box("team_%d" % side, (-0.12, side * 0.66, 1.72),
                           (0.5, 0.06, 0.13), m["team"], coll, bevel=0.02))
    for side in (1, -1):
        parts.append(B.box("tneon_%d" % side, (0.3, side * 0.63, 1.5),
                           (0.5, 0.05, 0.05), m["neon"], coll, bevel=0.01))

    return B.join(parts, "rampart_turret")


# ---------------------------------------------------------------- contact sheet
def contact_sheet(paths, out_path, cell=144, bg=B.PAL["sand"]):
    tiles = B._premultiplied_down(paths, max(1, 288 // cell), CELL, outline=True)
    rows = max(k[1] for k in tiles) + 1
    cols = max(k[0] for k in tiles) + 1
    sheet = np.zeros((rows * cell, cols * cell, 4), dtype=np.float32)
    sheet[:, :, :3] = bg
    sheet[:, :, 3] = 1.0
    for (c, r), t in tiles.items():
        h, w = min(t.shape[0], cell), min(t.shape[1], cell)
        src = t[:h, :w]
        dst = sheet[r * cell:r * cell + h, c * cell:c * cell + w]
        a = src[:, :, 3:4]
        dst[:, :, :3] = src[:, :, :3] * a + dst[:, :, :3] * (1 - a)
    B.write_png(sheet, out_path)
    return out_path


# ---------------------------------------------------------------- main
def main():
    scene, coll = B.fresh_scene("RAMPART")
    B.setup_render(res=RES, samples=16)
    B.setup_world(strength=0.9)
    B.light_rig()
    B.camera_iso(ortho_scale=7.4)
    m = build_materials()

    hull = build_hull(coll, m)
    turret = build_turret(coll, m)

    # ---------------- hull: ready (1) + walk (4)
    walk_frames = [0, 1, 2, 3]
    bob = [0.0, 0.016, 0.0, -0.016]

    def frame_cb(ai, af):
        # tread scroll: 1/4 of a tread pitch per frame
        B.set_tread_offset(m["rubber"], ai * 0.0833)   # quarter of a 0.33u tread pitch
        hull.location.z = bob[ai] * 2.5

    turret.hide_render = True          # hull atlas must not contain the turret

    def ready_cb(ai, af):
        B.set_tread_offset(m["rubber"], 0.0)
        hull.location.z = 0.0

    ready_paths = B.render_facings(hull, os.path.join(TMP, "ready"), [0],
                                   frame_cb=ready_cb, tag="r")
    hull_paths = B.render_facings(hull, os.path.join(TMP, "hull"), walk_frames,
                                  frame_cb=frame_cb, tag="h")

    # ---------------- turret: 8 facings, single frame
    hull.hide_render = True
    turret.hide_render = False
    turret_paths = B.render_facings(turret, os.path.join(TMP, "turret"), [0],
                                    tag="t")

    # ---------------- compose atlases
    hull_tiles = B._premultiplied_down(hull_paths, FACTOR, CELL, outline=True)
    turret_tiles = B._premultiplied_down(turret_paths, FACTOR, CELL, outline=True)

    # The engine addresses frames as start + facingMult * facing + animFrame
    # (render/Frames.ts), i.e. four consecutive cells per facing, so the walk
    # block is one linear run of 32 cells, not 4 rows of 8.
    def to_linear(tiles, start, per_facing):
        out = {}
        for (facing, anim), tile in tiles.items():
            idx = start + per_facing * facing + anim
            out[(idx % 8, idx // 8)] = tile
        return out

    hull_tiles = to_linear(hull_tiles, start=8, per_facing=len(walk_frames))
    ready_tiles = B._premultiplied_down(ready_paths, FACTOR, CELL, outline=True)
    hull_tiles.update(to_linear(ready_tiles, start=0, per_facing=1))
    turret_tiles = to_linear(turret_tiles, start=0, per_facing=1)

    hull_atlas = os.path.join(OUT_UNITS, "rampart.png")
    turret_atlas = os.path.join(OUT_UNITS, "rampart_turret.png")
    B.save_atlas(hull_tiles, cols=8, rows=5, cell_w=CELL, cell_h=CELL, path=hull_atlas)
    B.save_atlas(turret_tiles, cols=8, rows=1, cell_w=CELL, cell_h=CELL, path=turret_atlas)

    # ---------------- debug contact sheets for review
    os.makedirs(DEBUG, exist_ok=True)
    contact_sheet(hull_paths, os.path.join(DEBUG, "hull_contact.png"))
    contact_sheet(ready_paths, os.path.join(DEBUG, "ready_contact.png"))
    contact_sheet(turret_paths, os.path.join(DEBUG, "turret_contact.png"))

    B.save_blend(os.path.join(ROOT, "art", "blender", "rampart.blend"))
    print(B.report(hull=hull_atlas, turret=turret_atlas,
                   frames=len(hull_paths) + len(turret_paths) + len(ready_paths)))


main()
