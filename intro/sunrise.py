# Заставка Horizon «Восход над горизонтом» (Blender 5.2, без ручной работы).
# Камера летит над тёмной водой, из-за горизонта встаёт солнце и превращается в значок Horizon,
# затем проявляется надпись. 3,5 секунды, 30 кадров/с.
#
# Пробные кадры:  blender -b -P sunrise.py -- preview
# Видео:          blender -b -P sunrise.py -- video
import math
import os
import sys

import bpy

MODE = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'preview'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'render')
os.makedirs(OUT, exist_ok=True)

FPS = 30
END = 120
ACCENT = (1.0, 0.55, 0.2, 1.0)  # оранжевый акцент Horizon
SUN_Y = 220.0
SUN_R = 11.0

# ---------- Пустая сцена ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start = 1
scene.frame_end = END
scene.render.fps = FPS
scene.render.resolution_x = 1920 if MODE == 'video' else 1280
scene.render.resolution_y = 1080 if MODE == 'video' else 720
scene.render.film_transparent = False

for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
eevee = scene.eevee
for attr, value in (('use_raytracing', True), ('taa_render_samples', 32 if MODE == 'video' else 16)):
    try:
        setattr(eevee, attr, value)
    except AttributeError:
        pass
try:
    eevee.ray_tracing_options.resolution_scale = '1'
except Exception:
    pass
try:
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Punchy'
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


def fading_emission(name, color):
    """Свечение, которое растворяется полностью (без тёмного следа), когда доля = 0."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    mix = nodes.new('ShaderNodeMixShader')
    tr = nodes.new('ShaderNodeBsdfTransparent')
    em = nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = color
    mat.node_tree.links.new(tr.outputs['BSDF'], mix.inputs[1])
    mat.node_tree.links.new(em.outputs['Emission'], mix.inputs[2])
    mat.node_tree.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    try:
        mat.surface_render_method = 'BLENDED'
    except AttributeError:
        pass
    return mat, em, mix.inputs['Fac']


def key(socket, frame, value, interp='BEZIER'):
    socket.default_value = value
    socket.keyframe_insert('default_value', frame=frame)


def ease_all(obj_or_tree):
    anim = getattr(obj_or_tree, 'animation_data', None)
    if not anim or not anim.action:
        return
    try:
        for fc in anim.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'BEZIER'
                kp.easing = 'EASE_IN_OUT'
    except AttributeError:
        pass  # новый формат действий в Blender 5 — оставляем сглаживание по умолчанию


# ---------- Небо ----------
world = bpy.data.worlds.new('Sky')
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wn.clear()
w_out = wn.new('ShaderNodeOutputWorld')
w_bg = wn.new('ShaderNodeBackground')
w_coord = wn.new('ShaderNodeTexCoord')
w_sep = wn.new('ShaderNodeSeparateXYZ')
w_ramp = wn.new('ShaderNodeValToRGB')
# Небо по направлению взгляда: ниже горизонта темно, у горизонта закат, выше ночь.
w_norm = wn.new('ShaderNodeVectorMath')
w_norm.operation = 'NORMALIZE'
w_map = wn.new('ShaderNodeMapRange')
w_map.inputs['From Min'].default_value = -0.08
w_map.inputs['From Max'].default_value = 0.5
world.node_tree.links.new(w_coord.outputs['Generated'], w_norm.inputs[0])
world.node_tree.links.new(w_norm.outputs['Vector'], w_sep.inputs['Vector'])
world.node_tree.links.new(w_sep.outputs['Z'], w_map.inputs['Value'])
world.node_tree.links.new(w_map.outputs['Result'], w_ramp.inputs['Fac'])
world.node_tree.links.new(w_ramp.outputs['Color'], w_bg.inputs['Color'])
world.node_tree.links.new(w_bg.outputs['Background'], w_out.inputs['Surface'])
ramp = w_ramp.color_ramp
ramp.elements[0].position = 0.0
ramp.elements[0].color = (0.004, 0.006, 0.014, 1)
ramp.elements[1].position = 1.0
ramp.elements[1].color = (0.004, 0.007, 0.022, 1)
for pos, col in ((0.12, (0.006, 0.006, 0.012, 1)), (0.15, (0.6, 0.22, 0.06, 1)), (0.24, (0.24, 0.07, 0.11, 1)), (0.45, (0.04, 0.03, 0.09, 1))):
    e = ramp.elements.new(pos)
    e.color = col
key(w_bg.inputs['Strength'], 1, 0.08)
key(w_bg.inputs['Strength'], 60, 0.9)
key(w_bg.inputs['Strength'], END, 1.0)

# ---------- Вода ----------
bpy.ops.mesh.primitive_plane_add(size=900, location=(0, 300, 0))
water = bpy.context.object
water.name = 'Water'
wm = bpy.data.materials.new('Water')
wm.use_nodes = True
n = wm.node_tree.nodes
bsdf = n['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (0.004, 0.006, 0.012, 1)
bsdf.inputs['Roughness'].default_value = 0.03
bsdf.inputs['Metallic'].default_value = 0.0
try:
    bsdf.inputs['Specular IOR Level'].default_value = 0.8
except KeyError:
    pass
coord = n.new('ShaderNodeTexCoord')
mapping = n.new('ShaderNodeMapping')
mapping.inputs['Scale'].default_value = (0.35, 1.4, 1.0)
noise = n.new('ShaderNodeTexNoise')
noise.noise_dimensions = '4D'
noise.inputs['Scale'].default_value = 3.0
noise.inputs['Detail'].default_value = 6.0
bump = n.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.3
links = wm.node_tree.links
links.new(coord.outputs['Object'], mapping.inputs['Vector'])
links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
links.new(noise.outputs['Fac'], bump.inputs['Height'])
links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
key(noise.inputs['W'], 1, 0.0)
key(noise.inputs['W'], END, 1.6)
water.data.materials.append(wm)

# Настоящие волны вблизи (генератор океана), дальше — гладь до горизонта
water.location.z = -0.1
bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 95, 0))
ocean = bpy.context.object
ocean.name = 'Ocean'
ocean_mod = ocean.modifiers.new('Ocean', 'OCEAN')
ocean_mod.geometry_mode = 'GENERATE'
ocean_mod.resolution = 12
ocean_mod.spatial_size = 50
ocean_mod.repeat_x = 6
ocean_mod.repeat_y = 6
ocean_mod.wave_scale = 0.3
ocean_mod.choppiness = 0.9
ocean_mod.wind_velocity = 6
ocean_mod.time = 1.0
ocean_mod.keyframe_insert('time', frame=1)
ocean_mod.time = 4.5
ocean_mod.keyframe_insert('time', frame=END)
ocean.data.materials.append(wm)
bpy.ops.object.shade_smooth()
# Ставим океан так, чтобы он начинался у камеры и шёл до горизонта
bpy.context.view_layer.update()
from mathutils import Vector as _V
_ev = ocean.evaluated_get(bpy.context.evaluated_depsgraph_get())
_pts = [ocean.matrix_world @ _V(p) for p in _ev.bound_box]
_minx = min(p.x for p in _pts); _maxx = max(p.x for p in _pts); _miny = min(p.y for p in _pts)
ocean.location.x -= (_minx + _maxx) / 2
ocean.location.y += -45 - _miny
print('ОКЕАН', round(_maxx - _minx), 'м в ширину')

# Звёзды ночного неба гаснут с рассветом
star_mat, star_em, star_fac = fading_emission('Stars', (0.85, 0.88, 1.0, 1))
star_em.inputs['Strength'].default_value = 3.0
key(star_fac, 1, 1.0)
key(star_fac, 30, 0.8)
key(star_fac, 62, 0.0)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.35)
star_src = bpy.context.object
star_src.data.materials.append(star_mat)
import random as _random
_random.seed(3)
for _ in range(260):
    star = star_src.copy()
    angle = _random.uniform(-1.2, 1.2)
    dist = _random.uniform(380, 620)
    star.location = (math.sin(angle) * dist, math.cos(angle) * dist, _random.uniform(25, 330))
    s = _random.uniform(0.5, 1.6)
    star.scale = (s, s, s)
    scene.collection.objects.link(star)
star_src.location = (0, -900, 0)

# ---------- Солнце ----------
bpy.ops.mesh.primitive_circle_add(vertices=96, radius=SUN_R, fill_type='NGON', location=(0, SUN_Y, -SUN_R * 1.1), rotation=(math.radians(90), 0, 0))
sun = bpy.context.object
sun.name = 'Sun'
sun_mat, sun_em = emission_material('Sun', (1.0, 0.62, 0.28, 1), 0.0)
sun.data.materials.append(sun_mat)
sun.location.z = -SUN_R * 1.1
sun.keyframe_insert('location', frame=12)
sun.location.z = 0.0
sun.keyframe_insert('location', frame=58)
key(sun_em.inputs['Strength'], 12, 2.0)
key(sun_em.inputs['Strength'], 52, 24.0)
key(sun_em.inputs['Strength'], 66, 22.0)
key(sun_em.inputs['Strength'], 80, 0.0)

# Ореол вокруг солнца (мягкое свечение без постобработки)
bpy.ops.mesh.primitive_plane_add(size=SUN_R * 9, location=(0, SUN_Y + 2, 0), rotation=(math.radians(90), 0, 0))
halo = bpy.context.object
halo.name = 'Halo'
hm = bpy.data.materials.new('Halo')
hm.use_nodes = True
hn = hm.node_tree.nodes
hn.clear()
h_out = hn.new('ShaderNodeOutputMaterial')
h_mix = hn.new('ShaderNodeMixShader')
h_tr = hn.new('ShaderNodeBsdfTransparent')
h_em = hn.new('ShaderNodeEmission')
h_em.inputs['Color'].default_value = (1.0, 0.45, 0.15, 1)
h_grad = hn.new('ShaderNodeTexGradient')
h_grad.gradient_type = 'SPHERICAL'
h_tc = hn.new('ShaderNodeTexCoord')
h_map = hn.new('ShaderNodeMapping')
h_map.inputs['Scale'].default_value = (2.0 / (SUN_R * 4.5), 2.0 / (SUN_R * 4.5), 1)
h_pow = hn.new('ShaderNodeMath')
h_pow.operation = 'POWER'
h_pow.inputs[1].default_value = 2.2
hl = hm.node_tree.links
hl.new(h_tc.outputs['Object'], h_map.inputs['Vector'])
hl.new(h_map.outputs['Vector'], h_grad.inputs['Vector'])
hl.new(h_grad.outputs['Fac'], h_pow.inputs[0])
hl.new(h_pow.outputs['Value'], h_mix.inputs['Fac'])
hl.new(h_tr.outputs['BSDF'], h_mix.inputs[1])
hl.new(h_em.outputs['Emission'], h_mix.inputs[2])
hl.new(h_mix.outputs['Shader'], h_out.inputs['Surface'])
try:
    hm.surface_render_method = 'BLENDED'
except AttributeError:
    hm.blend_method = 'BLEND'
key(h_em.inputs['Strength'], 12, 0.0)
key(h_em.inputs['Strength'], 56, 3.5)
key(h_em.inputs['Strength'], END, 2.2)
halo.data.materials.append(hm)

# ---------- Значок Horizon: дуга и линия горизонта ----------
logo_mat, logo_em = emission_material('Logo', ACCENT, 0.0)
key(logo_em.inputs['Strength'], 58, 0.0)
key(logo_em.inputs['Strength'], 70, 70.0)
key(logo_em.inputs['Strength'], 86, 26.0)
key(logo_em.inputs['Strength'], END, 26.0)

bpy.ops.mesh.primitive_torus_add(major_radius=SUN_R, minor_radius=0.5, major_segments=128, minor_segments=16, location=(0, SUN_Y - 1, 0.6), rotation=(math.radians(90), 0, 0))
arc = bpy.context.object
arc.name = 'LogoArc'
arc.data.materials.append(logo_mat)

bpy.ops.mesh.primitive_cylinder_add(radius=0.45, depth=SUN_R * 3.4, location=(0, SUN_Y - 1, 0.7), rotation=(0, math.radians(90), 0))
bar = bpy.context.object
bar.name = 'LogoBar'
bar.data.materials.append(logo_mat)
# Линия проявляется от центра в стороны
bar.scale = (1, 1, 0.01)
bar.keyframe_insert('scale', frame=60)
bar.scale = (1, 1, 1)
bar.keyframe_insert('scale', frame=82)

# ---------- Надпись ----------
bpy.ops.object.text_add(location=(0, SUN_Y - 4, SUN_R + 7), rotation=(math.radians(90), 0, 0))
text = bpy.context.object
text.name = 'Title'
text.data.body = 'HORIZON'
text.data.align_x = 'CENTER'
text.data.size = 6.5
text.data.space_character = 2.6
text.data.keyframe_insert('space_character', frame=76)
text.data.space_character = 1.35
text.data.keyframe_insert('space_character', frame=104)
text.data.extrude = 0.05
for font in ('C:/Windows/Fonts/segoeuil.ttf', 'C:/Windows/Fonts/segoeui.ttf'):
    if os.path.exists(font):
        text.data.font = bpy.data.fonts.load(font)
        break
# Надпись проявляется, а в конце растворяется: последний кадр заставки = обои главной страницы.
title_mat, title_em, title_fac = fading_emission('Title', (1.0, 0.93, 0.86, 1))
title_em.inputs['Strength'].default_value = 4.0
text.data.materials.append(title_mat)
key(title_fac, 1, 0.0)
key(title_fac, 74, 0.0)
key(title_fac, 96, 1.0)
key(title_fac, 106, 1.0)
key(title_fac, 119, 0.0)

# ---------- Волна по воде в момент появления значка ----------
ripple_mat, ripple_em, ripple_fac = fading_emission('Ripple', ACCENT)
ripple_em.inputs['Strength'].default_value = 14.0
key(ripple_fac, 1, 0.0)
key(ripple_fac, 62, 0.0)
key(ripple_fac, 68, 1.0)
key(ripple_fac, 110, 0.0)
bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.04, major_segments=160, minor_segments=8, location=(0, SUN_Y - 1, 0.12))
ripple = bpy.context.object
ripple.name = 'Ripple'
ripple.data.materials.append(ripple_mat)
ripple.scale = (SUN_R, SUN_R, 1)
ripple.keyframe_insert('scale', frame=62)
ripple.scale = (SUN_R * 9, SUN_R * 9, 1)
ripple.keyframe_insert('scale', frame=112)

# ---------- Камера ----------
cam_data = bpy.data.cameras.new('Camera')
cam_data.lens = 32
cam = bpy.data.objects.new('Camera', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.rotation_euler = (math.radians(88.2), 0, 0)
cam.location = (0, -30, 2.0)
cam.keyframe_insert('location', frame=1)
cam.location = (0, 30, 3.4)
cam.keyframe_insert('location', frame=END)
cam.rotation_euler = (math.radians(87.6), 0, 0)
cam.keyframe_insert('rotation_euler', frame=1)
cam.rotation_euler = (math.radians(89.4), 0, 0)
cam.keyframe_insert('rotation_euler', frame=END)

# Значок и надпись невидимы до своего появления, солнце исчезает, когда превратилось в значок.
def show_between(obj, start, end=None):
    obj.hide_render = True
    obj.keyframe_insert('hide_render', frame=1)
    obj.hide_render = False
    obj.keyframe_insert('hide_render', frame=start)
    if end:
        obj.hide_render = True
        obj.keyframe_insert('hide_render', frame=end)


show_between(arc, 59)
show_between(bar, 59)
show_between(text, 75)
sun.hide_render = False
sun.keyframe_insert('hide_render', frame=1)
sun.hide_render = True
sun.keyframe_insert('hide_render', frame=80)

for thing in (sun, bar, cam):
    ease_all(thing)

# ---------- Свечение и блик линзы (компоновщик) ----------
try:
    scene.render.use_compositing = True
    tree = bpy.data.node_groups.new('Glow', 'CompositorNodeTree')
    tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    rl = tree.nodes.new('CompositorNodeRLayers')
    bloom = tree.nodes.new('CompositorNodeGlare')
    # Fog Glow — ровное круглое свечение; у Bloom вокруг кольца выходил прямоугольный ореол.
    bloom.inputs['Type'].default_value = 'Fog Glow'
    bloom.inputs['Threshold'].default_value = 0.9
    bloom.inputs['Strength'].default_value = 0.6
    bloom.inputs['Size'].default_value = 0.8
    try:
        bloom.inputs['Quality'].default_value = 'High'
    except (KeyError, TypeError):
        pass
    streak = tree.nodes.new('CompositorNodeGlare')
    streak.inputs['Type'].default_value = 'Streaks'
    streak.inputs['Streaks'].default_value = 2
    streak.inputs['Streaks Angle'].default_value = 0.0
    streak.inputs['Threshold'].default_value = 6.0
    streak.inputs['Strength'].default_value = 0.12
    streak.inputs['Fade'].default_value = 0.9
    try:
        streak.inputs['Quality'].default_value = 'High'
    except (KeyError, TypeError):
        pass
    lens = tree.nodes.new('CompositorNodeLensdist')
    lens.inputs['Dispersion'].default_value = 0.012
    out_node = tree.nodes.new('NodeGroupOutput')
    tree.links.new(rl.outputs['Image'], bloom.inputs['Image'])
    tree.links.new(bloom.outputs['Image'], streak.inputs['Image'])
    tree.links.new(streak.outputs['Image'], lens.inputs['Image'])
    tree.links.new(lens.outputs['Image'], out_node.inputs[0])
    scene.compositing_node_group = tree
    print('СВЕЧЕНИЕ включено')
except Exception as error:
    print('СВЕЧЕНИЕ не получилось:', error)

# ---------- Вывод ----------
LOOP = 240  # живые обои: 8 секунд волн после заставки
if MODE == 'loop':
    # Волны продолжают двигаться с той же скоростью, камера и значок стоят как в последнем кадре заставки.
    speed = (4.5 - 1.0) / (END - 1)
    ocean_mod.time = 4.5 + speed * LOOP
    ocean_mod.keyframe_insert('time', frame=END + LOOP)
    key(noise.inputs['W'], END + LOOP, 1.6 + 1.6 / (END - 1) * LOOP)
    scene.frame_start = END
    scene.frame_end = END + LOOP - 1
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
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
    scene.render.filepath = os.path.join(OUT, 'waves_loop.mp4')
    bpy.ops.render.render(animation=True)
    print('ВОЛНЫ', scene.render.filepath)
elif MODE == 'wallpaper':
    # Обои главной страницы: последний кадр без надписи, в высоком разрешении
    scene.render.resolution_x = 2560
    scene.render.resolution_y = 1440
    try:
        scene.eevee.taa_render_samples = 64
    except AttributeError:
        pass
    settings = scene.render.image_settings
    settings.file_format = 'JPEG'
    settings.quality = 92
    scene.frame_set(END)
    scene.render.filepath = os.path.join(OUT, 'wallpaper.jpg')
    bpy.ops.render.render(write_still=True)
    print('ОБОИ', scene.render.filepath)
elif MODE == 'still':
    # Проверочный кадр: последний кадр заставки, как на обоях
    scene.render.image_settings.file_format = 'PNG'
    scene.frame_set(END)
    scene.render.filepath = os.path.join(OUT, 'still_check.png')
    bpy.ops.render.render(write_still=True)
    print('КАДР', scene.render.filepath)
elif MODE == 'preview':
    scene.render.image_settings.file_format = 'PNG'
    for frame in (12, 45, 70, 92, 120):
        scene.frame_set(frame)
        scene.render.filepath = os.path.join(OUT, f'preview_{frame:03d}.png')
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
    scene.render.filepath = os.path.join(OUT, 'intro.mp4')
    bpy.ops.render.render(animation=True)
    print('ВИДЕО', scene.render.filepath)
