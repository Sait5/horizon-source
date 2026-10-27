# Заставка Horizon «Портал» (Blender 5.2).
# Из темноты навстречу летят светящиеся кольца, камера проносится сквозь них среди звёзд
# и выходит к значку Horizon. 3,5 секунды, 30 кадров/с.
#
# Пробные кадры:  blender -b -P portal.py -- preview
# Видео:          blender -b -P portal.py -- video
import math
import os
import random
import sys

import bpy

MODE = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'preview'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'render')
os.makedirs(OUT, exist_ok=True)
random.seed(7)

FPS = 30
END = 105
RINGS = 12
RING_GAP = 16.0
LOGO_Y = RINGS * RING_GAP + 100

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = END
scene.render.fps = FPS
scene.render.resolution_x = 1920 if MODE == 'video' else 1280
scene.render.resolution_y = 1080 if MODE == 'video' else 720
for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
try:
    scene.eevee.taa_render_samples = 32 if MODE == 'video' else 16
except AttributeError:
    pass
scene.render.use_motion_blur = True
try:
    scene.view_settings.view_transform = 'Standard'
except TypeError:
    pass


def emission_material(name, color, strength):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    em = nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = color
    em.inputs['Strength'].default_value = strength
    mat.node_tree.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mat, em


def key(socket, frame, value):
    socket.default_value = value
    socket.keyframe_insert('default_value', frame=frame)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3)) + (1.0,)


def show_from(obj, frame):
    obj.hide_render = True
    obj.keyframe_insert('hide_render', frame=1)
    obj.hide_render = False
    obj.keyframe_insert('hide_render', frame=frame)


# ---------- Космос ----------
world = bpy.data.worlds.new('Space')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.004, 0.004, 0.012, 1)
bg.inputs['Strength'].default_value = 1.0

# ---------- Кольца портала: от фиолетового к оранжевому ----------
VIOLET = (0.45, 0.25, 1.0)
ORANGE = (1.0, 0.5, 0.15)
for i in range(RINGS):
    t = i / (RINGS - 1)
    y = 20 + i * RING_GAP
    # Тоннель плавно изгибается, чтобы полёт выглядел живым
    x = math.sin(i * 0.55) * 2.2
    z = math.cos(i * 0.45) * 1.4
    bpy.ops.mesh.primitive_torus_add(major_radius=6.0, minor_radius=0.28, major_segments=128, minor_segments=12,
                                     location=(x, y, z), rotation=(math.radians(90), 0, math.radians(i * 7)))
    ring = bpy.context.object
    ring.name = f'Ring{i}'
    mat, em = emission_material(f'Ring{i}', mix(VIOLET, ORANGE, t), 0.0)
    ring.data.materials.append(mat)
    # Кольцо загорается, когда камера к нему подлетает
    appear = 1 + i * 2
    key(em.inputs['Strength'], 1, 0.0)
    key(em.inputs['Strength'], appear, 0.0)
    key(em.inputs['Strength'], appear + 12, 1.5)
    # и медленно вращается
    ring.keyframe_insert('rotation_euler', frame=1)
    ring.rotation_euler.y = math.radians(40 if i % 2 else -40)
    ring.keyframe_insert('rotation_euler', frame=END)

# ---------- Звёзды-искры вокруг тоннеля ----------
star_mat, _ = emission_material('Star', (0.85, 0.85, 1.0, 1), 6.0)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.06)
star_src = bpy.context.object
star_src.data.materials.append(star_mat)
for _ in range(320):
    angle = random.uniform(0, math.tau)
    dist = random.uniform(8, 40)
    star = star_src.copy()
    star.location = (math.cos(angle) * dist, random.uniform(-10, LOGO_Y + 60), math.sin(angle) * dist)
    s = random.uniform(0.6, 2.2)
    star.scale = (s, s, s)
    scene.collection.objects.link(star)
star_src.location = (0, -500, 0)

# ---------- Значок Horizon в конце пути ----------
ACCENT = (1.0, 0.55, 0.2, 1.0)
logo_mat, logo_em = emission_material('Logo', ACCENT, 0.0)
key(logo_em.inputs['Strength'], 68, 0.0)
key(logo_em.inputs['Strength'], 88, 1.15)
R = 7.0
# Дуга — половина кольца над линией горизонта
bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=0.4, major_segments=128, minor_segments=16,
                                 location=(0, LOGO_Y, 0), rotation=(math.radians(90), 0, 0))
arc = bpy.context.object
arc.data.materials.append(logo_mat)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
bpy.ops.object.mode_set(mode='OBJECT')
for v in arc.data.vertices:
    v.select = (arc.matrix_world @ v.co).z < -0.05
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.delete(type='VERT')
bpy.ops.object.mode_set(mode='OBJECT')
# Две линии: горизонт и короткая под ним
bpy.ops.mesh.primitive_cylinder_add(radius=0.4, depth=R * 3.0, location=(0, LOGO_Y, -0.2), rotation=(0, math.radians(90), 0))
line1 = bpy.context.object
line1.data.materials.append(logo_mat)
bpy.ops.mesh.primitive_cylinder_add(radius=0.4, depth=R * 1.7, location=(0, LOGO_Y, -3.0), rotation=(0, math.radians(90), 0))
line2 = bpy.context.object
line2.data.materials.append(logo_mat)
for obj, start in ((arc, 66), (line1, 66), (line2, 70)):
    show_from(obj, start)
for line, f0, f1 in ((line1, 68, 84), (line2, 72, 88)):
    line.scale = (1, 1, 0.01)
    line.keyframe_insert('scale', frame=f0)
    line.scale = (1, 1, 1)
    line.keyframe_insert('scale', frame=f1)

bpy.ops.object.text_add(location=(0, LOGO_Y, R + 4.5), rotation=(math.radians(90), 0, 0))
text = bpy.context.object
text.data.body = 'HORIZON'
text.data.align_x = 'CENTER'
text.data.size = 3.6
text.data.space_character = 1.35
for font in ('C:/Windows/Fonts/segoeuil.ttf', 'C:/Windows/Fonts/segoeui.ttf'):
    if os.path.exists(font):
        text.data.font = bpy.data.fonts.load(font)
        break
title_mat, title_em = emission_material('Title', (1.0, 0.95, 0.9, 1), 0.0)
text.data.materials.append(title_mat)
key(title_em.inputs['Strength'], 82, 0.0)
key(title_em.inputs['Strength'], 100, 0.95)
show_from(text, 80)

# ---------- Камера: разгон сквозь кольца и мягкая остановка перед значком ----------
cam_data = bpy.data.cameras.new('Camera')
cam_data.lens = 24
cam = bpy.data.objects.new('Camera', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
path = [(1, 0, 0, 0), (25, 0.8, 70, 0.5), (55, -0.6, 200, -0.3), (72, 0, LOGO_Y - 60, 1.5), (END, 0, LOGO_Y - 48, 1.5)]
for frame, x, y, z in path:
    cam.location = (x, y, z)
    cam.keyframe_insert('location', frame=frame)
for frame, roll in ((1, 0), (40, 18), (72, 0), (END, 0)):
    cam.rotation_euler = (math.radians(90), math.radians(roll), 0)
    cam.keyframe_insert('rotation_euler', frame=frame)

# ---------- Вывод ----------
if MODE == 'preview':
    scene.render.image_settings.file_format = 'PNG'
    for frame in (15, 35, 55, 80, 105):
        scene.frame_set(frame)
        scene.render.filepath = os.path.join(OUT, f'portal_{frame:03d}.png')
        bpy.ops.render.render(write_still=True)
        print('КАДР', frame, scene.render.filepath)
else:
    settings = scene.render.image_settings
    try:
        settings.media_type = 'VIDEO'
    except (AttributeError, TypeError):
        pass
    settings.file_format = 'FFMPEG'
    scene.render.ffmpeg.format = 'MPEG4'
    scene.render.ffmpeg.codec = 'H264'
    scene.render.ffmpeg.constant_rate_factor = 'HIGH'
    scene.render.ffmpeg.audio_codec = 'NONE'
    scene.render.filepath = os.path.join(OUT, 'intro_portal.mp4')
    bpy.ops.render.render(animation=True)
    print('ВИДЕО', scene.render.filepath)
