"""Blender 4.5 source for the shared game mesh library.
Run: blender --background --python scripts/author-visual-assets.py
Coordinates are authored in game meters, exported with glTF's Y-up convention.
"""
import bpy, math, random, pathlib
from mathutils import Vector
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'art/models'; OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
random.seed(41729)
def xyz(p): return (p[0], -p[2], p[1])
def material(name, color, metal=0, rough=.8):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,1); bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    return m
metal=material('aircraft-aluminum',(.42,.47,.49),.82,.32)
dark=material('engine-metal',(.055,.065,.068),.8,.4)
glass=material('canopy-glass',(.045,.13,.16),.35,.08)
leaf=material('leaf',(.085,.17,.06),0,.9)
grass_material=material('grass-blades',(.2,.28,.1),0,1)
grass_color=grass_material.node_tree.nodes.new('ShaderNodeVertexColor');grass_color.layer_name='Color'
grass_material.node_tree.links.new(grass_color.outputs['Color'],grass_material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
skin=material('fruit-skin',(.51,.32,.09),0,.72)
head_material=material('resident-face',(1,1,1),0,.9)
head_color=head_material.node_tree.nodes.new('ShaderNodeVertexColor');head_color.layer_name='Color'
head_material.node_tree.links.new(head_color.outputs['Color'],head_material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
stone=material('stone',(.62,.57,.46))
def mesh(name,verts,faces,mat=None):
    data=bpy.data.meshes.new(name); data.from_pydata([xyz(p) for p in verts],[],faces); data.update()
    obj=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(obj)
    if mat: data.materials.append(mat)
    bpy.context.view_layer.objects.active=obj; obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.uv.smart_project(angle_limit=1.15); bpy.ops.object.mode_set(mode='OBJECT'); obj.select_set(False)
    return obj
def ellipsoid(name,radii=(1,1,1),pos=(0,0,0),segments=20,rings=12,mat=None,fruit=False):
    verts=[]; faces=[]
    for j in range(rings+1):
        t=math.pi*j/rings
        for i in range(segments+1):
            a=2*math.pi*i/segments
            bump=1+.025*math.cos(a*12+t*8)*math.cos(a*12-t*8) if fruit else 1
            verts.append((pos[0]+math.sin(t)*math.cos(a)*radii[0]*bump,pos[1]+math.cos(t)*radii[1],pos[2]+math.sin(t)*math.sin(a)*radii[2]*bump))
    for j in range(rings):
        for i in range(segments):
            a=j*(segments+1)+i; faces.append((a,a+1,a+segments+2,a+segments+1))
    obj=mesh(name,verts,faces,mat)
    if fruit:
        for loop in obj.data.loops:
            j,i=divmod(loop.vertex_index,segments+1)
            obj.data.uv_layers.active.data[loop.index].uv=(i/segments,1-j/rings)
    for p in obj.data.polygons:p.use_smooth=True
    return obj
def bevelbox(name,size=(2,2,2),pos=(0,0,0),bevel=.02,mat=None):
    bpy.ops.mesh.primitive_cube_add(size=2,location=xyz(pos)); o=bpy.context.object; o.name=name
    o.scale=(size[0]/2,size[2]/2,size[1]/2); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if mat:o.data.materials.append(mat)
    if bevel:
        mod=o.modifiers.new('weathered-edge','BEVEL'); mod.width=bevel; mod.segments=1; bpy.ops.object.modifier_apply(modifier=mod.name)
        norm=o.modifiers.new('corner-normals','WEIGHTED_NORMAL'); bpy.ops.object.modifier_apply(modifier=norm.name)
    o.select_set(False);return o
def join(name,parts):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:p.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]; bpy.ops.object.join();o=bpy.context.object;o.name=name
    bpy.context.scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');o.select_set(False);return o
def solid_panel(name, outline, thickness, mat):
    points=[Vector(p) for p in outline]
    normal=(points[1]-points[0]).cross(points[2]-points[0]).normalized()*thickness*.5
    verts=[tuple(p-normal) for p in points]+[tuple(p+normal) for p in points]
    return mesh(name,verts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)
def canopy(species,lod):
    verts=[];faces=[]
    count=([384,128,32] if species=='pine' else [550,170,32])[lod]
    for i in range(count):
        a=i*2.399963;t=(i+.5)/count
        if species=='pine':
            # Discrete, irregular branch whorls with open gaps between them.
            # Scanned shoots run along radial branches instead of filling a cone.
            tiers=12 if lod==0 else 9 if lod==1 else 6
            tier=i%tiers;h=(tier+.5)/tiers
            a=(i//tiers)*2.399963+tier*.71
            length=(1-h)**.74*.82*(.8+.2*random.random())
            along=.24+.74*random.random()
            radial=Vector((math.cos(a),0,math.sin(a)))
            side=Vector((-math.sin(a),0,math.cos(a)))
            rise=.04+.10*h
            direction=Vector((radial.x,-.12+.22*h,radial.z)).normalized()
            # Alternate side and top cards so overhead flight sees a full branch.
            # Crown instances are much taller than they are wide. Compensate
            # upright card width so twig scans do not become hanging curtains.
            across=Vector((0,.23,0)) if i%3 else side
            center=radial*(length*along)+Vector((.025*math.sin(h*9),.25+.68*h-rise*along,0))
            shoot=(.32*(1-h)+.11)*(1+lod*.35)
            halfwidth=shoot*.32
            tip=center+direction*shoot*.65
            basepoint=center-direction*shoot*.65
            corners=[basepoint-across*halfwidth,basepoint+across*halfwidth,
                     tip+across*halfwidth,tip-across*halfwidth]
            base=len(verts);verts.extend([tuple(v) for v in corners])
        else:
            # Irregular branch-end clusters leave gaps and a divided silhouette.
            # Cards alternate their tilt so both ground and aerial views see leaves.
            lobe=i%7;heading=lobe*2.399963
            spread=.34 if species=='broadleaf' else .19
            center=Vector((math.cos(heading)*spread,.52+.055*(lobe%4),math.sin(heading)*spread))
            if lobe==6:center=Vector((.035,.79,-.02))
            azimuth=a;vertical=2*((i*37%count)+.5)/count-1
            radial=math.sqrt(max(0,1-vertical*vertical))
            radius=(.25 if species=='broadleaf' else .21)*(.64+.36*random.random())
            point=center+Vector((math.cos(azimuth)*radial*radius,vertical*radius*.63,math.sin(azimuth)*radial*radius))
            width=(.14 if species=='broadleaf' else .115)*(1+lod*.42)
            side=Vector((math.cos(a+.7),0,math.sin(a+.7)))*width
            tilt=.3+.65*((i*13)%17)/16
            up=Vector((-math.sin(a+.7)*math.cos(tilt),math.sin(tilt),math.cos(a+.7)*math.cos(tilt)))*width*.68
            base=len(verts)
            verts.extend([tuple(point-side-up),tuple(point+side-up),tuple(point+side+up),tuple(point-side+up)])
        faces.append((base,base+1,base+2,base+3))
    obj=mesh(species+'_lod'+str(lod),verts,faces,leaf)
    # Each branch card uses the complete scanned branch, not a random atlas crop.
    uv=obj.data.uv_layers.active
    for poly in obj.data.polygons:
        for loop,coord in zip(poly.loop_indices,[(0,0),(1,0),(1,1),(0,1)]):uv.data[loop].uv=coord
    return obj
def grass_clump(lod):
    verts=[];faces=[]
    blades=[11,6,3][lod];segments=[4,3,2][lod]
    for blade in range(blades):
        angle=blade*2.399963
        height=.35+.31*((blade*7)%11)/10
        root=Vector((math.cos(angle)*.14,0,math.sin(angle)*.14))
        across=Vector((math.cos(angle+.8),0,math.sin(angle+.8)))
        bend=Vector((math.cos(angle)*.22,0,math.sin(angle)*.22))
        start=len(verts)
        for segment in range(segments+1):
            t=segment/segments
            center=root+Vector((0,height*t,0))+bend*t*t
            width=(.028+.012*(blade%3))*(1-t)*.5+.001
            verts.extend([tuple(center-across*width),tuple(center+across*width)])
        for segment in range(segments):
            a=start+segment*2;faces.append((a,a+1,a+3,a+2))
    obj=mesh('grass-clump_lod'+str(lod),verts,faces,grass_material)
    colors=obj.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
    for i,v in enumerate(verts):
        light=.62+.35*min(1,v[1]/.66)
        colors.data[i].color=(light,light,light*.87,1)
    return obj
for lod in range(3):
    grass_clump(lod)
    bevelbox('module_lod'+str(lod),bevel=.018 if lod==0 else .008 if lod==1 else 0,mat=stone)
    bevelbox('coping_lod'+str(lod),bevel=.12 if lod==0 else .06 if lod==1 else 0,mat=stone)
    # Boots retain a sole, forward toe and ankle even in the far silhouette.
    boot_parts=[bevelbox('boot-sole',(.86,.14,1.4),(0,-.35,.2),.035 if lod<2 else 0,stone),
                bevelbox('boot-toe',(.82,.4,1.1),(0,-.09,.32),.1 if lod<2 else 0,stone),
                bevelbox('boot-ankle',(.62,.65,.6),(0,.16,-.1),.07 if lod<2 else 0,stone)]
    join('human-boot_lod'+str(lod),boot_parts)
    hand_parts=[ellipsoid('hand-palm',(.36,.34,.18),segments=12 if lod==0 else 8,rings=8 if lod==0 else 5,mat=head_material)]
    if lod<2:
        for finger in range(4):
            hand_parts.append(ellipsoid('hand-finger',(.065,.23-(finger%3)*.025,.075),(-.22+finger*.145,-.3,0),segments=8 if lod==0 else 6,rings=6 if lod==0 else 4,mat=head_material))
        hand_parts.append(ellipsoid('hand-thumb',(.13,.2,.1),(.34,-.02,0),segments=8,rings=5,mat=head_material))
    join('human-hand_lod'+str(lod),hand_parts)
    # Normalized working door: separately cut planks, two battens and a brace.
    # Runtime fits this leaf to the existing opening and places it open.
    boards=[6,4,1][lod];door_parts=[]
    for board in range(boards):
        door_parts.append(bevelbox('door-plank',(2/boards-.012,2,.1),(-1+(board+.5)*2/boards,0,0),.008 if lod<2 else 0,stone))
    if lod<2:
        for y in [-.65,.65]:door_parts.append(bevelbox('door-batten',(1.9,.14,.12),(0,y,.09),.012,stone))
        brace=bevelbox('door-brace',(.13,2.15,.11),(0,0,.09),.01,stone)
        brace.rotation_euler[1]=-.72;door_parts.append(brace)
    join('door_lod'+str(lod),door_parts)
    for species in ['pine','broadleaf','riverside']:canopy(species,lod)
    ellipsoid('rock_lod'+str(lod),segments=16 if lod==0 else 8,rings=10 if lod==0 else 5,mat=stone,fruit=True)
    ellipsoid('fruit_lod'+str(lod),segments=40 if lod==0 else 20 if lod==1 else 10,rings=24 if lod==0 else 12 if lod==1 else 6,mat=skin,fruit=True)
    face_segments=16 if lod==0 else 8;face_rings=10 if lod==0 else 6
    head=ellipsoid('resident-head',radii=(.5,.55,.46),segments=face_segments,rings=face_rings,mat=head_material)
    for v in head.data.vertices:
        # A narrower jaw and a hairline give the shared head a human profile.
        height=v.co.z
        if height<0:v.co.x*=.82+.18*max(0,1+height/.55)
    colors=head.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
    for i,v in enumerate(head.data.vertices):
        front=-v.co.y
        hair=v.co.z>.25 and (front<.30 or v.co.z>.47)
        colors.data[i].color=(.16,.12,.085,1) if hair else (1,1,1,1)
    face_parts=[head]
    for position,radii in [((0,-.025,.46),(.065,.115,.115)),((-.48,-.025,0),(.075,.14,.065)),((.48,-.025,0),(.075,.14,.065))]:
        part=ellipsoid('face-detail',radii=radii,pos=position,segments=8 if lod==0 else 6,rings=6 if lod==0 else 4,mat=head_material)
        colors=part.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
        for color in colors.data:color.color=(1,1,1,1)
        face_parts.append(part)
    join('human-head_lod'+str(lod),face_parts)
    # Clothing has rounded shoulders and a taper instead of a cuboid torso.
    verts=[];faces=[]
    for y,rx,rz in [(-.5,.42,.25),(-.25,.46,.25),(.28,.48,.25),(.44,.36,.22),(.5,.2,.16)]:
        for i in range(12):
            a=i*math.pi/6;verts.append((math.cos(a)*rx,y,math.sin(a)*rz))
    for row in range(4):
        for i in range(12):
            a=row*12+i;b=row*12+(i+1)%12;faces.append((a,b,b+12,a+12))
    faces.extend([tuple(reversed(range(12))),tuple(range(48,60))]);mesh('human-torso_lod'+str(lod),verts,faces,stone)
    ellipsoid('human-limb_lod'+str(lod),radii=(.48,.5,.48),segments=12 if lod==0 else 6,rings=8 if lod==0 else 4,mat=stone)
    # A fibrous curved blade, with a central ridge and a tapered tip.
    verts=[];faces=[]
    for i in range(7):
        t=i/6;w=(1-t)*.8+.01;y=(t-.5)*2;z=t*t*.38
        verts.extend([(-w,y,z),(0,y,z+.06),(w,y,z)])
    for i in range(6):
        a=i*3;faces.extend([(a,a+3,a+4,a+1),(a+1,a+4,a+5,a+2)])
    mesh('leaf_lod'+str(lod),verts,faces,leaf)
    # Roof silhouette stays inside the original pyramid collision envelope.
    mesh('roof_lod'+str(lod),[(-1,-1,-1),(1,-1,-1),(1,-1,1),(-1,-1,1),(0,1,0)],[(4,1,0),(4,2,1),(4,3,2),(4,0,3),(0,1,2,3)],stone)

# Arched glazing and individual voussoirs stay within the existing window
# owner's presentation transform. They introduce no collision or save entities.
for lod in range(3):
    rows=[10,7,4][lod]
    verts=[]; faces=[]
    for j in range(rows+1):
        t=j/rows; y=.62+t*.38; w=math.sqrt(max(.000001,1-t*t))
        verts.extend([(-w,y,-w),(w,y,-w),(w,y,w),(-w,y,w)])
    verts.extend([(-1,-1,-1),(1,-1,-1),(1,-1,1),(-1,-1,1)])
    bottom=(rows+1)*4
    for k in range(4): faces.append((bottom+k,bottom+(k+1)%4,(k+1)%4,k))
    for j in range(rows):
        for k in range(4):
            a=j*4+k;b=j*4+(k+1)%4;faces.append((a,b,b+4,a+4))
    faces.extend([(bottom+3,bottom+2,bottom+1,bottom),tuple(range(rows*4,rows*4+4))])
    mesh('window_lod'+str(lod),verts,[tuple(reversed(face)) for face in faces],glass)
    verts=[];faces=[];segments=[12,8,5][lod]
    for i in range(segments):
        start=i*math.pi/segments+.008;end=(i+1)*math.pi/segments-.008
        offset=len(verts)
        for z in [-.12,.12]:
            for radius,a in [(1,start),(1,end),(1.18,end),(1.18,start)]:
                verts.append((math.cos(a)*radius,math.sin(a)*radius,z))
        faces.extend([tuple(offset+k for k in f) for f in [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]])
    mesh('arch-trim_lod'+str(lod),verts,[tuple(reversed(face)) for face in faces],stone)

# Aircraft: lofted fuselage, swept airfoils, inlets, twin nozzles and canopy.
parts=[];verts=[];faces=[];profile=[(-5,.65,.62),(-3,1.1,.85),(0,1.15,.9),(2,.9,.75),(4,.62,.55),(6,.3,.26),(7.5,.025,.025)]
for z,rx,ry in profile:
    for i in range(24):
        a=i*math.pi/12;verts.append((math.cos(a)*rx,math.sin(a)*ry,z))
for row in range(len(profile)-1):
    for i in range(24):
        a=row*24+i;b=row*24+(i+1)%24;faces.append((a,b,b+24,a+24))
faces.extend([tuple(reversed(range(24))),tuple(range((len(profile)-1)*24,len(profile)*24))]);fuselage=mesh('fuselage',verts,faces,metal)
for face in fuselage.data.polygons:face.use_smooth=True
parts.append(fuselage)
for sign in [-1,1]:
    for z,span in [(0,7),(-4.7,3.1)]:
        outline=[(0,.05,z+2.2),(sign*span,.15,z-2),(sign*(span-.5),.15,z-3),(0,.05,z-2.6)]
        lower=[(x,y-.15,z) for x,y,z in outline];v=outline+lower
        parts.append(mesh('wing',v,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],metal))
    parts.append(bevelbox('intake',(1.2,.85,2.4),(sign*1.15,-.3,-.2),.08,dark))
    verts=[];faces=[]
    for z,r in [(-4.1,.6),(-5.5,.52),(-5.65,.44),(-5.2,.38)]:
        for i in range(24):a=i*math.pi/12;verts.append((sign*.78+math.cos(a)*r,-.2+math.sin(a)*r,z))
    for j in range(3):
        for i in range(24):a=j*24+i;b=j*24+(i+1)%24;faces.append((a,b,b+24,a+24))
    nozzle=mesh('nozzle',verts,faces,dark)
    for face in nozzle.data.polygons:face.use_smooth=True
    parts.append(nozzle)
    parts.append(solid_panel('tail-fin',[(sign*.6,.4,-5),(sign*1.2,2.8,-4.3),(sign*1.2,2.4,-2.6),(sign*.6,.4,-3)],.09,metal))
    # Visible panel seams share one merged draw, with no runtime line objects.
    for z in [-3,-1.3,.4,2.2]:parts.append(bevelbox('panel-seam',(.018,.018,1.1),(sign*.94,.15,z),0,dark))
for sign in [-1,1]:
    pivot=(sign*3.5,.05,-2.55)
    control=solid_panel('aileron-left' if sign<0 else 'aileron-right',[(0,0,0),(sign*2.8,0,-.45),(sign*2.8,0,-.9),(0,0,-.7)],.065,metal)
    control.location=xyz(pivot);control['pivot']=list(pivot);parts.append(control)
parts.append(ellipsoid('canopy' ,(.66,.62,1.8),(0,.78,2),32,16,glass))
# Framed transparent canopy and a fitted cockpit instead of a dark solid bulb.
for z in [1.05,2.9]:
    radius=math.sqrt(1-((z-2)/1.8)**2);verts=[];faces=[]
    for i in range(17):
        a=i*math.pi/16
        for r,dz in [(1,-.025),(1,.025),(1.055,.025),(1.055,-.025)]:
            verts.append((math.cos(a)*.66*radius*r,.78+math.sin(a)*.62*radius*r,z+dz))
    for i in range(16):
        for k in range(4):
            a=i*4+k;b=i*4+(k+1)%4;faces.append((a,b,b+4,a+4))
    faces.extend([(3,2,1,0),tuple(range(64,68))]);parts.append(mesh('canopy-frame',verts,faces,dark))
parts.append(bevelbox('cockpit-seat',(.58,.7,.48),(0,.55,1.2),.08,dark))
parts.append(ellipsoid('pilot-helmet',(.21,.22,.23),(0,1,1.55),16,10,dark))
# Static surfaces share two draws; control-surface pivots stay independent.
controls=[p for p in parts if p.name in ['aileron-left','aileron-right','canopy']]
for mat,name in [(metal,'airframe'),(dark,'engine-and-panel-detail')]:
    static=[p for p in parts if p not in controls and p.data.materials[0]==mat]
    parts=[p for p in parts if p not in static]
    controls.append(join(name,static))
parts=controls
jet=bpy.data.objects.new('jet',None);bpy.context.collection.objects.link(jet)
for p in parts:p.parent=jet

bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'siege-library.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'siege-library.glb'),export_format='GLB',export_yup=True,export_animations=False,export_cameras=False,export_lights=False,export_extras=True)
print('Authored',len(bpy.data.objects),'mesh-library objects')
