"""Bake matching far crowns from the authored model and CC0 branch scans."""
import bpy, pathlib, math
root=pathlib.Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(root/'art/models/siege-library.blend'))
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.film_transparent=True
scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
for o in scene.objects:o.hide_render=True
world=bpy.data.worlds.new('Impostor ambient');world.use_nodes=True;world.node_tree.nodes['Background'].inputs['Color'].default_value=(.58,.68,.75,1);world.node_tree.nodes['Background'].inputs['Strength'].default_value=.8;scene.world=world
bpy.ops.object.light_add(type='AREA',location=(-3,-4,6));light=bpy.context.object;light.data.energy=350;light.data.shape='DISK';light.data.size=5
bpy.ops.object.camera_add(location=(0,-4,.5));camera=bpy.context.object;camera.rotation_euler=(math.pi/2,0,0);camera.data.type='ORTHO';camera.data.ortho_scale=2.25;scene.camera=camera
bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=.024,radius2=.012,depth=.62,location=(0,0,.31));trunk=bpy.context.object;trunk.name='matching-impostor-trunk'
trunk_material=bpy.data.materials.new('distant-bark');trunk_material.diffuse_color=(.20,.14,.09,1);trunk.data.materials.append(trunk_material)
out=root/'art/foliage';out.mkdir(parents=True,exist_ok=True)
for species in ['pine','broadleaf','riverside']:
 obj=bpy.data.objects[species+'_lod0'];obj.hide_render=False
 mat=bpy.data.materials.new(species+'-impostor-scan');mat.use_nodes=True;n=mat.node_tree.nodes;l=mat.node_tree.links;n.clear()
 output=n.new('ShaderNodeOutputMaterial');mix=n.new('ShaderNodeMixShader');transparent=n.new('ShaderNodeBsdfTransparent');surface=n.new('ShaderNodeBsdfDiffuse');surface.inputs['Roughness'].default_value=.9;image=n.new('ShaderNodeTexImage');image.image=bpy.data.images.load(str(out/('pine.png' if species=='pine' else 'broadleaf.png')))
 l.new(image.outputs['Color'],surface.inputs['Color']);l.new(image.outputs['Alpha'],mix.inputs[0]);l.new(transparent.outputs[0],mix.inputs[1]);l.new(surface.outputs[0],mix.inputs[2]);l.new(mix.outputs[0],output.inputs['Surface']);obj.data.materials.clear();obj.data.materials.append(mat)
 scene.render.filepath=str(out/(species+'-impostor.png'));bpy.ops.render.render(write_still=True);obj.hide_render=True
