"""固定验收场景（Blender 版）：山体、男女双剑对打、相机环绕并始终看向两人中点。

ABI: build(ctx) / pose(t, mode) / dispose()
"""

import math

import bpy
from mathutils import Vector

_state = {}


def _look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def _material(name, color, roughness=0.7, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return mat


def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _sword(blade_mat, hilt_mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.62))
    blade = bpy.context.active_object
    blade.scale = (0.035, 0.07, 0.6)
    blade.data.materials.append(blade_mat)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.05))
    guard = bpy.context.active_object
    guard.scale = (0.07, 0.14, 0.03)
    guard.data.materials.append(hilt_mat)

    bpy.ops.mesh.primitive_cylinder_add(radius=0.045, depth=0.24, vertices=8, location=(0, 0, -0.1))
    grip = bpy.context.active_object
    grip.data.materials.append(hilt_mat)
    return [blade, guard, grip]


def build(ctx):
    # 地面
    bpy.ops.mesh.primitive_cylinder_add(radius=30, depth=0.5, vertices=64, location=(0, 0, -0.25))
    ground = bpy.context.active_object
    ground.data.materials.append(_material("Ground", (0.26, 0.34, 0.29), 0.95))

    # 环形远山：任意环绕角度都有山体背景
    mountain_mat = _material("Mountain", (0.20, 0.27, 0.24), 1.0)
    for x, y, radius, height in (
        (0, 22, 10, 13),
        (16, 15, 8, 10),
        (-16, 15, 8, 9.5),
        (21, -4, 9, 11),
        (-21, -4, 9, 11),
        (0, -22, 10, 12),
    ):
        bpy.ops.mesh.primitive_cone_add(
            vertices=9, radius1=radius, radius2=0, depth=height, location=(x, y, height / 2 - 0.5)
        )
        bpy.context.active_object.data.materials.append(mountain_mat)

    man_mat = _material("Man", (0.18, 0.36, 0.54), 0.7)
    woman_mat = _material("Woman", (0.72, 0.36, 0.48), 0.7)
    skin = _material("Skin", (0.84, 0.69, 0.55), 0.8)
    steel = _material("Steel", (0.85, 0.89, 0.92), 0.25, 0.85)
    wood = _material("Hilt", (0.35, 0.23, 0.13), 0.9)

    _state["man"] = []
    _state["woman"] = []
    for name, x, mat, body_h, head_r in (
        ("man", -0.72, man_mat, 1.05, 0.2),
        ("woman", 0.72, woman_mat, 0.98, 0.19),
    ):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.24, depth=body_h, vertices=12, location=(x, 0, 0.82))
        body = bpy.context.active_object
        body.data.materials.append(mat)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=head_r, segments=16, ring_count=12, location=(x, 0, 0.82 + 0.82))
        head = bpy.context.active_object
        head.data.materials.append(skin)
        sword = _sword(steel, wood)
        for part in sword:
            part.location.x += x + (-0.16 if name == "man" else 0.16)
            part.location.y += 0.18
            part.location.z += 0.82 + 0.42
            part.rotation_euler[1] = -1.05 if name == "man" else 1.05
        _state[name] = [body, head] + sword
        _state[f"{name}Base"] = [part.location.x for part in _state[name]]

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.11, segments=12, ring_count=8, location=(0, 0.2, 1.12))
    clash = bpy.context.active_object
    clash.data.materials.append(_material("Clash", (1.0, 0.82, 0.4), 0.4))
    _state["clash"] = clash
    _state["clashBase"] = (clash.location.x, clash.location.z)

    # 灯光
    sun_data = bpy.data.lights.new("Key", type="SUN")
    sun_data.energy = 4.0
    sun = _link(bpy.data.objects.new("Key", sun_data))
    sun.location = (5, -6, 9)
    _look_at(sun, (0, 0, 1))

    fill_data = bpy.data.lights.new("Fill", type="AREA")
    fill_data.energy = 300
    fill_data.size = 8
    fill = _link(bpy.data.objects.new("Fill", fill_data))
    fill.location = (-6, 4, 5)
    _look_at(fill, (0, 0, 1))

    # 世界色
    bg = ctx.scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.36, 0.42, 0.45, 1.0)
        bg.inputs["Strength"].default_value = 0.8

    ctx.camera.location = (8, -8, 3.2)
    _look_at(ctx.camera, (0, 0, 0.85))
    ctx.camera_data.lens = 40


def pose(t, mode):
    duration = 4.0
    p = min(1.0, max(0.0, t / duration))
    angle = -0.7 + p * 2.1
    cam = bpy.context.scene.camera
    if cam:
        cam.location = (math.cos(angle) * 8, math.sin(angle) * 8, 3.2)
        _look_at(cam, (0, 0, 0.85))

    swing = math.sin(t * 5.2)
    man = _state.get("man") or []
    woman = _state.get("woman") or []
    if man and woman:
        man_base = _state.get("manBase") or []
        woman_base = _state.get("womanBase") or []
        for i, part in enumerate(man):
            part.location.x = man_base[i] + swing * 0.08
        for i, part in enumerate(woman):
            part.location.x = woman_base[i] - swing * 0.08
        # 剑随挥砍略转（man[-3] / woman[-3] 是剑身）
        man[-3].rotation_euler[1] = -1.05 + swing * 0.12
        woman[-3].rotation_euler[1] = 1.05 - swing * 0.12

    clash = _state.get("clash")
    base = _state.get("clashBase") or (0, 1.12)
    if clash:
        clash.location.x = base[0] + swing * 0.04
        clash.location.z = base[1] + swing * 0.04


def dispose():
    pass
