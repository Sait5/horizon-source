# Заставка Horizon «Сборка логотипа» (Blender 5.2).
# Стеклянные осколки слетаются со всех сторон, вспыхивают при касании и складываются в значок Horizon.
# По значку пробегает блик, он мягко поднимается, снизу проявляется надпись. 3,5 секунды, 30 кадров/с.
#
# Пробные кадры:  blender -b -P assemble.py -- preview
# Видео:          blender -b -P assemble.py -- video
import math
import os
import random
import sys

import bpy
from mathutils import Vector

MODE = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'preview'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'render')
os.makedirs(OUT, exist_ok=True)
random.seed(11)

FPS = 30
END = 105
R = 8.0  # радиус дуги значка
THICK = 0.9

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
for attr, value in (('use_raytracing', True), ('taa_render_samples', 32 if MODE == 'video' else 16)):
    try:
        setattr(scene.eevee, attr, value)
    except AttributeError:
        pass
scene.render.use_motion_blur = True
scene.view_settings.view_transform = 'Standard'


def key(socket, frame, value):
    socket.default_value = value
    socket.keyframe_insert('default_value', frame=frame)


# ---------- Фон: тёмный, с мягким светом в центре ----------
world = bpy.data.worlds.new('Dark')
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
bg = wn['Background']
bg.inputs['Color'].default_value = (0.008, 0.009, 0.016, 1)

# ---------- Стеклянный материал осколков ----------
def shard_material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (1.0, 0.55, 0.22, 1)
    b.inputs['Roughness'].default_value = 0.12
    b.inputs['Metallic'].default_value = 0.35
    try:
        b.inputs['Coat Weight'].default_value = 1.0
        b.inputs['Coat Roughness'].default_value = 0.03
    except KeyError:
        pass
    b.inputs['Emission Color'].default_value = (1.0, 0.5, 0.18, 1)
    return mat, b.inputs['Emission Strength']


shards = []


def add_shard(center, length, angle, index):
    """Брусок-осколок: финальное место center, длина вдоль направления angle (в плоскости XZ)."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.scale = (length, THICK, THICK)
    obj.rotation_euler = (0, -angle, 0)
    bev = obj.modifiers.new('Bevel', 'BEVEL')
    bev.width = 0.12
    bev.segments = 2
    mat, emission = shard_material(f'Shard{index}')
    obj.data.materials.append(mat)
    shards.append((obj, Vector(center), emission))


# Дуга: осколки по полуокружности
ARC_PIECES = 22
for k in range(ARC_PIECES):
    a0 = math.pi * k / ARC_PIECES
    a1 = math.pi * (k + 1) / ARC_PIECES
    mid = (a0 + a1) / 2
    seg = 2 * R * math.sin((a1 - a0) / 2) * 0.9
    add_shard((R * math.cos(mid), 0, R * math.sin(mid)), seg, mid + math.pi / 2, len(shards))

# Линия горизонта и короткая линия под ней
for (length, z, pieces) in ((R * 3.0, -0.6, 12), (R * 1.7, -3.6, 7)):
    piece = length / pieces
    for k in range(pieces):
        x = -length / 2 + piece * (k + 0.5)
        add_shard((x, 0, z), piece * 0.9, 0, len(shards))

# Полёт осколков на место: каждый со своей стороны, со своим вращением и временем
for i, (obj, target, emission) in enumerate(shards):
    start = 4 + random.randint(0, 22)
    land = start + 28 + random.randint(0, 8)
    direction = Vector((random.uniform(-1, 1), random.uniform(-1.2, 0.3), random.uniform(-1, 1))).normalized()
    origin = target + direction * random.uniform(30, 55)
    final_rot = obj.rotation_euler.copy()
    obj.location = origin
    obj.rotation_euler = (random.uniform(-6, 6), random.uniform(-6, 6), random.uniform(-6, 6))
    obj.keyframe_insert('location', frame=start)
    obj.keyframe_insert('rotation_euler', frame=start)
    obj.location = target
    obj.rotation_euler = final_rot
    obj.keyframe_insert('location', frame=land)
    obj.keyframe_insert('rotation_euler', frame=land)
    # Вспышка в момент касания
    key(emission, land - 3, 0.25)
    key(emission, land, 4.0)
    key(emission, land + 8, 0.45)

# Весь значок в конце мягко поднимается
root = bpy.data.objects.new('Logo', None)
scene.collection.objects.link(root)
for obj, _t, _e in shards:
    obj.parent = root
root.location = (0, 0, 0)
root.keyframe_insert('location', frame=78)
root.location = (0, 0, 2.2)
root.keyframe_insert('location', frame=END)

# ---------- Свет и блик ----------
key_light = bpy.data.lights.new('Key', 'AREA')
key_light.energy = 2500
key_light.size = 12
kl = bpy.data.objects.new('Key', key_light)
kl.location = (-12, -30, 22)
kl.rotation_euler = (math.radians(55), 0, math.radians(-20))
scene.collection.objects.link(kl)

sweep = bpy.data.lights.new('Sweep', 'AREA')
sweep.energy = 0
sweep.shape = 'RECTANGLE'
sweep.size = 2
sweep.size_y = 40
sw = bpy.data.objects.new('Sweep', sweep)
sw.rotation_euler = (math.radians(90), 0, 0)
scene.collection.objects.link(sw)
# Блик пробегает слева направо по уже собранному значку
sweep.energy = 0
sweep.keyframe_insert('energy', frame=60)
sweep.energy = 9000
sweep.keyframe_insert('energy', frame=66)
sweep.keyframe_insert('energy', frame=80)
sweep.energy = 0
sweep.keyframe_insert('energy', frame=86)
sw.location = (-30, -14, 4)
sw.keyframe_insert('location', frame=60)
sw.location = (30, -14, 4)
sw.keyframe_insert('location', frame=86)

# ---------- Надпись ----------
bpy.ops.object.text_add(location=(0, 0, -9.5), rotation=(math.radians(90), 0, 0))
text = bpy.context.object
text.data.body = 'HORIZON'
text.data.align_x = 'CENTER'
text.data.size = 3.0
text.data.space_character = 1.4
for font in ('C:/Windows/Fonts/segoeuil.ttf', 'C:/Windows/Fonts/segoeui.ttf'):
    if os.path.exists(font):
        text.data.font = bpy.data.fonts.load(font)
        break
tmat = bpy.data.materials.new('Title')
tmat.use_nodes = True
tn = tmat.node_tree.nodes
tn.clear()
t_out = tn.new('ShaderNodeOutputMaterial')
t_em = tn.new('ShaderNodeEmission')
t_em.inputs['Color'].default_value = (1.0, 0.95, 0.9, 1)
tmat.node_tree.links.new(t_em.outputs['Emission'], t_out.inputs['Surface'])
text.data.materials.append(tmat)
key(t_em.inputs['Strength'], 80, 0.0)
key(t_em.inputs['Strength'], 100, 0.9)
text.hide_render = True
text.keyframe_insert('hide_render', frame=1)
text.hide_render = False
text.keyframe_insert('hide_render', frame=80)
text.location.z = -11
text.keyframe_insert('location', frame=80)
text.location.z = -9.5
text.keyframe_insert('location', frame=100)

# ---------- Камера ----------
cam_data = bpy.data.cameras.new('Camera')
cam_data.lens = 50
cam = bpy.data.objects.new('Camera', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.rotation_euler = (math.radians(90), 0, 0)
cam.location = (0, -78, 1.5)
cam.keyframe_insert('location', frame=1)
cam.location = (0, -64, 1.0)
cam.keyframe_insert('location', frame=END)

# ---------- Вывод ----------
if MODE == 'preview':
    scene.render.image_settings.file_format = 'PNG'
    for frame in (18, 34, 50, 70, 105):
        scene.frame_set(frame)
        scene.render.filepath = os.path.join(OUT, f'assemble_{frame:03d}.png')
        bpy.ops.render.render(write_still=True)
        print('КАДР', frame)
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
    scene.render.filepath = os.path.join(OUT, 'intro_assemble.mp4')
    bpy.ops.render.render(animation=True)
    print('ВИДЕО', scene.render.filepath)
