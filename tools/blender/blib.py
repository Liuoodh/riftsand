"""
Shared helpers for the Blender sprite pipeline (runs *inside* Blender).

Everything here is deliberately primitive-free (no bpy.ops modelling) so a build
is repeatable and never depends on the active view layer / selection state.

Conventions
-----------
* +X = the direction a model "faces" in its own local space.
* +Z = up, ground plane at z = 0.
* The camera looks along +Y with a 30 deg downward tilt, so on screen:
    screen right = +X, screen up = +Y.
* Facing index i is rendered by rotating the model about Z by 90 + 45*i deg,
  which yields the game's order: up, up-left, left, down-left, down,
  down-right, right, up-right.
"""

import math
import os

import bpy
import bmesh
import numpy as np
from mathutils import Vector, Euler

# --------------------------------------------------------------------------
# palette (mirrors docs/ART_STYLE.md)
# --------------------------------------------------------------------------
PAL = {
    "sand":        (0.79, 0.63, 0.45),
    "metal_main":  (0.294, 0.329, 0.380),   # #4b5461  hull body (neutral grey)
    "metal_light": (0.365, 0.404, 0.459),   # #5d6775  lit plates
    "metal_dark":  (0.129, 0.145, 0.176),   # #212530  crevices / underside
    "rubber":      (0.062, 0.070, 0.086),
    "neon":        (0.247, 0.851, 0.925),   # #3fd9ec
    "team":        (0.910, 0.639, 0.239),   # #e8a33d
    "danger":      (0.898, 0.322, 0.247),
    "white":       (0.949, 0.961, 0.969),
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(rgb):
    """sRGB tuple -> linear RGBA (Blender wants linear base colours)."""
    return tuple(srgb_to_linear(v) for v in rgb) + (1.0,)


# --------------------------------------------------------------------------
# scene bootstrap
# --------------------------------------------------------------------------
def fresh_scene(name):
    bpy.ops.wm.read_homefile(use_empty=True)
    scene = bpy.context.scene
    scene.name = name
    coll = bpy.data.collections.new(name)
    scene.collection.children.link(coll)
    return scene, coll


def setup_render(res=288, samples=24, transparent=True):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15
    try:
        scene.eevee.taa_render_samples = samples
    except AttributeError:
        pass
    for attr, val in (("use_gtao", True), ("use_bloom", True)):
        if hasattr(scene.eevee, attr):
            setattr(scene.eevee, attr, val)
    vs = scene.view_settings
    vs.view_transform = "Standard"
    try:
        vs.look = "None"
    except TypeError:
        pass
    vs.exposure = 0.0
    vs.gamma = 1.0
    return scene


def setup_world(color=(0.03, 0.035, 0.045), strength=0.6):
    world = bpy.data.worlds.new("W")
    bpy.context.scene.world = world
    world.use_nodes = True
    # node names are localised, so look the node up by type, not by name
    bg = next((n for n in world.node_tree.nodes
               if n.bl_idname == "ShaderNodeBackground"), None)
    if bg is None:
        nt = world.node_tree
        bg = nt.nodes.new("ShaderNodeBackground")
        out = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputWorld"), None)
        if out:
            nt.links.new(bg.outputs[0], out.inputs[0])
    bg.inputs[0].default_value = (*color, 1.0)
    bg.inputs[1].default_value = strength
    return world


def sun(name, rot_deg, energy, color=(1, 1, 1), angle_deg=8.0):
    data = bpy.data.lights.new(name, "SUN")
    data.energy = energy
    data.color = color
    data.angle = math.radians(angle_deg)
    data.use_shadow = False
    obj = bpy.data.objects.new(name, data)
    obj.rotation_euler = Euler([math.radians(a) for a in rot_deg], "XYZ")
    bpy.context.scene.collection.objects.link(obj)
    return obj


def light_rig():
    """Fixed world-space rig: upper-left key + zenith punch + cool fill/rim.

    The zenith light is what keeps the top faces clearly lighter than the flanks
    after the sprite is squashed to 72 px - without it the tank reads as a flat
    grey lump.
    """
    sun("key", (58, 0, -42), 4.6, (1.0, 0.95, 0.87))
    sun("fill", (72, 0, 145), 0.55, (0.55, 0.68, 0.98))
    sun("rim", (80, 0, 95), 1.3, (0.45, 0.85, 1.0))


def camera_iso(ortho_scale, dist=12.0, pitch_deg=30.0):
    """Camera at -Y, tilted `pitch_deg` below horizontal, aimed at world origin.

    Aiming at the origin is what puts the unit's ground-contact point in the
    exact centre of the frame, which is the engine's anchor.
    """
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam = bpy.data.objects.new("cam", cam_data)
    pitch = math.radians(pitch_deg)
    cam.location = (0.0, -dist * math.cos(pitch), dist * math.sin(pitch))
    cam.rotation_euler = Euler((math.radians(90.0) - pitch, 0.0, 0.0), "XYZ")
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------
def _set(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def material(name, color, rough=0.55, metallic=0.15, emit=None, emit_strength=0.0,
             tread=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (420, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (120, 0)
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    _set(bsdf, ["Base Color"], lin(color))
    _set(bsdf, ["Roughness"], rough)
    _set(bsdf, ["Metallic"], metallic)
    _set(bsdf, ["Specular IOR Level", "Specular"], 0.35)
    if emit is not None:
        _set(bsdf, ["Emission Color", "Emission"], lin(emit))
        _set(bsdf, ["Emission Strength"], emit_strength)
    if tread:
        # scrolling stripes along X so the tread reads as moving across frames
        coord = nt.nodes.new("ShaderNodeTexCoord")
        coord.location = (-760, -120)
        mapping = nt.nodes.new("ShaderNodeMapping")
        mapping.location = (-560, -120)
        mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
        wave = nt.nodes.new("ShaderNodeTexWave")
        wave.location = (-360, -120)
        wave.wave_type = "BANDS"
        wave.bands_direction = "X"
        wave.inputs["Scale"].default_value = 3.0
        wave.inputs["Distortion"].default_value = 0.0
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.location = (-160, -120)
        ramp.color_ramp.elements[0].position = 0.42
        ramp.color_ramp.elements[0].color = lin(PAL["rubber"])
        ramp.color_ramp.elements[1].position = 0.52
        ramp.color_ramp.elements[1].color = lin(PAL["metal_light"])
        nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
        nt.links.new(mapping.outputs["Vector"], wave.inputs["Vector"])
        nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
        mat["tread_mapping"] = mapping.name
    return mat


def set_tread_offset(mat, dx):
    tree = mat.node_tree
    node = tree.nodes.get(mat.get("tread_mapping", ""))
    if node is None:
        node = next((n for n in tree.nodes if n.bl_idname == "ShaderNodeMapping"), None)
    if node is not None:
        node.inputs["Location"].default_value = (dx, 0.0, 0.0)


# --------------------------------------------------------------------------
# geometry
# --------------------------------------------------------------------------
def _new_mesh(name, verts, faces, mat, coll, bevel=0.0, segs=2, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if mat:
        ob.data.materials.append(mat)
    if bevel > 0:
        mod = ob.modifiers.new("bev", "BEVEL")
        mod.width = bevel
        mod.segments = segs
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(50)
    ob.visible_shadow = False
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def box(name, center, size, mat, coll, bevel=0.0, segs=2, rot_z=0.0):
    cx, cy, cz = center
    sx, sy, sz = (s / 2.0 for s in size)
    v = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
         (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    if rot_z:
        c, s = math.cos(rot_z), math.sin(rot_z)
        v = [(x * c - y * s, x * s + y * c, z) for (x, y, z) in v]
    v = [(x + cx, y + cy, z + cz) for (x, y, z) in v]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return _new_mesh(name, v, f, mat, coll, bevel, segs)


def hull_profile(name, profile, half_w, mat, coll, taper=0.86, bevel=0.05, segs=2):
    """Extrude a closed XZ profile along ±Y, tapering the top inwards."""
    zs = [p[1] for p in profile]
    z0, z1 = min(zs), max(zs)
    verts, faces = [], []
    n = len(profile)
    for side in (1, -1):
        for (x, z) in profile:
            t = 0.0 if z1 - z0 < 1e-6 else (z - z0) / (z1 - z0)
            w = half_w * (1.0 - (1.0 - taper) * t)
            verts.append((x, side * w, z))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(range(n, 2 * n)))
    ob = _new_mesh(name, verts, faces, mat, coll, bevel, segs)
    return ob


def ngon_prism(name, center, n, r_bot, r_top, z0, z1, mat, coll, rot=0.0, bevel=0.0,
               segs=2):
    cx, cy = center[0], center[1]
    verts, faces = [], []
    for i in range(n):
        a = rot + 2 * math.pi * i / n
        verts.append((cx + r_bot * math.cos(a), cy + r_bot * math.sin(a), z0))
    for i in range(n):
        a = rot + 2 * math.pi * i / n
        verts.append((cx + r_top * math.cos(a), cy + r_top * math.sin(a), z1))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(range(n, 2 * n)))
    return _new_mesh(name, verts, faces, mat, coll, bevel, segs)


def prism_xy(name, pts, z0, z1, mat, coll, taper=0.9, bevel=0.03, segs=2):
    """Extrude a top-view polygon (list of (x, y)) upwards, tapering the top."""
    n = len(pts)
    verts, faces = [], []
    for (x, y) in pts:
        verts.append((x, y, z0))
    for (x, y) in pts:
        verts.append((x * 1.0, y * 1.0, z1))
    # taper the top ring towards the polygon centroid
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    for i in range(n):
        x, y, _ = verts[n + i]
        verts[n + i] = (cx + (x - cx) * taper, cy + (y - cy) * taper, z1)
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(range(n, 2 * n)))
    return _new_mesh(name, verts, faces, mat, coll, bevel, segs)


def cylinder_x(name, start, length, radius, mat, coll, segs=14, radius2=None, cap=True):
    """Cylinder whose axis runs along +X, starting at `start` (x, y, z) centre."""
    x0, y0, z0 = start
    r1 = radius
    r2 = radius if radius2 is None else radius2
    verts, faces = [], []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        verts.append((x0, y0 + r1 * math.cos(a), z0 + r1 * math.sin(a)))
    for i in range(segs):
        a = 2 * math.pi * i / segs
        verts.append((x0 + length, y0 + r2 * math.cos(a), z0 + r2 * math.sin(a)))
    for i in range(segs):
        j = (i + 1) % segs
        faces.append((i, j, segs + j, segs + i))
    if cap:
        faces.append(tuple(range(segs - 1, -1, -1)))
        faces.append(tuple(range(segs, 2 * segs)))
    ob = _new_mesh(name, verts, faces, mat, coll)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def cylinder_z(name, center, radius, height, mat, coll, segs=16, r_top=None, r_bot=None):
    cx, cy, z0 = center
    rt = radius if r_top is None else r_top
    rb = radius if r_bot is None else r_bot
    verts, faces = [], []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        verts.append((cx + rb * math.cos(a), cy + rb * math.sin(a), z0))
    for i in range(segs):
        a = 2 * math.pi * i / segs
        verts.append((cx + rt * math.cos(a), cy + rt * math.sin(a), z0 + height))
    for i in range(segs):
        j = (i + 1) % segs
        faces.append((i, j, segs + j, segs + i))
    faces.append(tuple(range(segs - 1, -1, -1)))
    faces.append(tuple(range(segs, 2 * segs)))
    ob = _new_mesh(name, verts, faces, mat, coll)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def join(objs, name):
    """Merge objects into one mesh, applying modifiers.

    Avoids `bpy.ops.object.join()` because the MCP execute_code namespace hands
    us a restricted context without `selected_objects` / an active object.
    """
    deps = bpy.context.evaluated_depsgraph_get()
    mats = []
    verts = []
    faces = []
    face_mat = []
    face_smooth = []
    for ob in objs:
        eval_ob = ob.evaluated_get(deps)
        me = eval_ob.to_mesh()
        base = len(verts)
        mw = ob.matrix_world.copy()
        for v in me.vertices:
            co = mw @ v.co
            verts.append((co.x, co.y, co.z))
        mat_index = 0
        if ob.data.materials:
            mat = ob.data.materials[0]
            if mat not in mats:
                mats.append(mat)
            mat_index = mats.index(mat)
        for p in me.polygons:
            faces.append(tuple(base + i for i in p.vertices))
            face_mat.append(mat_index)
            face_smooth.append(p.use_smooth)
        eval_ob.to_mesh_clear()

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    for m in mats:
        me.materials.append(m)
    for i, p in enumerate(me.polygons):
        p.material_index = face_mat[i]
        p.use_smooth = face_smooth[i]
    me.update()

    ob = bpy.data.objects.new(name, me)
    # link into the same collection as the first source object
    coll = objs[0].users_collection[0]
    coll.objects.link(ob)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    ob.visible_shadow = False
    return ob


# --------------------------------------------------------------------------
# render / compose
# --------------------------------------------------------------------------
def render_to(path):
    scene = bpy.context.scene
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


FACING_ROT = [90.0 + 45.0 * i for i in range(8)]


def render_facings(root, outdir, frames, frame_cb=None, tag="f", res=288):
    """Render every facing (and animation frame) for `root`.

    `frames` is a list of animation frame indices; `frame_cb(i, anim_frame)` may
    tweak the scene before each render.
    """
    os.makedirs(outdir, exist_ok=True)
    paths = {}
    for ai, af in enumerate(frames):
        if frame_cb:
            frame_cb(ai, af)
        for fi, rot in enumerate(FACING_ROT):
            root.rotation_euler = Euler((0.0, 0.0, math.radians(rot)), "XYZ")
            bpy.context.view_layer.update()
            p = os.path.join(outdir, "%s_%d_%d.png" % (tag, fi, ai))
            render_to(p)
            paths[(fi, ai)] = p
    root.rotation_euler = Euler((0, 0, 0), "XYZ")
    return paths


def _load_rgba(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    arr = buf.reshape(h, w, 4)
    bpy.data.images.remove(img)
    return arr  # bottom-up rows


def _box_down(arr, factor):
    h, w, c = arr.shape
    return arr.reshape(h // factor, factor, w // factor, factor, c).mean(axis=(1, 3))


def _outline(rgba, color=(0.055, 0.065, 0.085), strength=1.0):
    """1px dark contour around the silhouette; keeps small sprites readable."""
    a = rgba[:, :, 3]
    solid = a > 0.45
    pad = np.zeros_like(solid)
    pad[1:, :] |= solid[:-1, :]
    pad[:-1, :] |= solid[1:, :]
    pad[:, 1:] |= solid[:, :-1]
    pad[:, :-1] |= solid[:, 1:]
    edge = pad & ~solid
    rgba[edge, 0] = color[0]
    rgba[edge, 1] = color[1]
    rgba[edge, 2] = color[2]
    rgba[edge, 3] = strength
    return rgba


def _premultiplied_down(paths, factor, cell, outline=True, alpha_cut=0.004):
    """Load renders, box-downscale in premultiplied space, return straight RGBA."""
    tiles = {}
    for key, p in paths.items():
        arr = _load_rgba(p)
        arr = _box_down(arr, factor)
        rgb = arr[:, :, :3] * arr[:, :, 3:4]      # premultiply for clean edges
        small = np.concatenate([rgb, arr[:, :, 3:4]], axis=2)
        a = small[:, :, 3:4]
        out = np.where(a > 1e-6, small[:, :, :3] / np.maximum(a, 1e-6), 0.0)
        tile = np.concatenate([out, a], axis=2)
        tile[tile[:, :, 3] < alpha_cut] = 0.0
        if outline:
            tile = _outline(tile)
        # Blender images are bottom-up; flip to top-down for atlas math
        tiles[key] = np.flipud(tile)
    return tiles


def save_atlas(tiles, cols, rows, cell_w, cell_h, path, bg=None):
    atlas = np.zeros((rows * cell_h, cols * cell_w, 4), dtype=np.float32)
    if bg is not None:
        atlas[:, :, :3] = bg
        atlas[:, :, 3] = 1.0
    for (col, row), tile in tiles.items():
        if row >= rows or col >= cols:
            continue
        h, w = tile.shape[0], tile.shape[1]
        h, w = min(h, cell_h), min(w, cell_w)
        y0, x0 = row * cell_h, col * cell_w
        dst = atlas[y0:y0 + h, x0:x0 + w]
        src = tile[:h, :w]
        a = src[:, :, 3:4]
        dst[:, :, :3] = src[:, :, :3] * a + dst[:, :, :3] * (1 - a)
        dst[:, :, 3:4] = np.maximum(dst[:, :, 3:4], a)
    write_png(atlas, path)
    return path


def write_png(rgba_top_down, path):
    """rgba in top-down row order -> PNG on disk."""
    h, w = rgba_top_down.shape[0], rgba_top_down.shape[1]
    img = bpy.data.images.new("atlas", width=w, height=h, alpha=True)
    flat = np.flipud(rgba_top_down).reshape(-1).astype(np.float32)
    img.pixels.foreach_set(flat)
    img.file_format = "PNG"
    img.filepath_raw = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save()
    bpy.data.images.remove(img)
    return path


def save_blend(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=path)
    return path


def report(**kw):
    return "OK " + " ".join("%s=%s" % (k, v) for k, v in kw.items())
