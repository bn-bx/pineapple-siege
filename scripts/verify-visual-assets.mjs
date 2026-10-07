import * as THREE from 'three';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {createHash} from 'node:crypto';
const source=await readFile('public/assets/models/siege-library.glb');
const modelRecord=JSON.parse(await readFile('art/models/provenance.json','utf8'));
if(createHash('sha256').update(source).digest('hex')!==modelRecord.sha256)throw Error('Model library provenance mismatch');
const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength),'');
const meshes=new Map();gltf.scene.traverse(o=>{if(o.isMesh)meshes.set(o.name,o);});
for(const family of ['module','coping','human-hand','human-boot','door','window','arch-trim','grass-clump','pine','broadleaf','riverside','rock','fruit','human-head','human-torso','human-limb','leaf','roof'])for(let lod=0;lod<3;lod++){
 const mesh=meshes.get(`${family}_lod${lod}`);if(!mesh)throw Error(`Missing mesh ${family}/${lod}`);
 for(const attr of ['position','normal','uv'])if(!mesh.geometry.getAttribute(attr))throw Error(`Missing ${attr}: ${mesh.name}`);
 const position=mesh.geometry.getAttribute('position');for(let i=0;i<position.count;i++)if(!Number.isFinite(position.getX(i)+position.getY(i)+position.getZ(i)))throw Error(`Invalid position ${mesh.name}`);
}
for(let lod=0;lod<3;lod++)if(!meshes.get(`grass-clump_lod${lod}`).geometry.getAttribute('color'))throw Error(`Missing grass color gradient at LOD ${lod}`);
gltf.scene.updateMatrixWorld(true);
for(const family of ['module','coping','human-hand','human-boot','door','window','arch-trim','rock','fruit','human-head','human-torso','human-limb','roof'])for(let lod=0;lod<3;lod++){
 const mesh=meshes.get(`${family}_lod${lod}`),position=mesh.geometry.getAttribute('position'),index=mesh.geometry.index;
 let volume=0;const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
 for(let i=0;i<(index?.count??position.count);i+=3){
  a.fromBufferAttribute(position,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
  b.fromBufferAttribute(position,index?index.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
  c.fromBufferAttribute(position,index?index.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
  volume+=a.dot(b.cross(c))/6;
 }
 if(volume<=0)throw Error(`Inward or degenerate closed model: ${mesh.name}`);
}
const records=JSON.parse(await readFile('art/materials/provenance.json','utf8'));
for(const record of records){const path=`public/assets/materials/${record.family}-${record.channel}.ktx2`,bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error(`Changed asset without provenance ${path}`);if(bytes.toString('hex',0,12)!=='ab4b5458203230bb0d0a1a0a')throw Error(`Invalid KTX2 ${path}`);}
for(const family of ['pine','broadleaf','grass','pine-impostor','broadleaf-impostor','riverside-impostor'])await stat(`public/assets/foliage/${family}.ktx2`);
for(const file of ['basis_transcoder.js','basis_transcoder.wasm'])await stat(`public/assets/decoders/${file}`);
const particles=JSON.parse(await readFile('art/particles/provenance.json','utf8'));
const particleBytes=await readFile(particles.runtime);
if(createHash('sha256').update(particleBytes).digest('hex')!==particles.sha256)throw Error('Particle atlas provenance mismatch');
if(particleBytes.toString('hex',0,12)!=='ab4b5458203230bb0d0a1a0a')throw Error('Invalid particle KTX2');
console.log(`Verified ${meshes.size} mesh nodes, all three LODs, preserved UVs, ${records.length} scanned maps, foliage, particle atlas and local decoders.`);

const fruitRecord = JSON.parse(await readFile('art/materials/pineapple-skin-v1.provenance.json','utf8'));
for (const [path, hash] of [['art/materials/pineapple-skin-v1.png', fruitRecord.sourceSha256], ['public/assets/materials/pineapple-skin-v1.ktx2',fruitRecord.runtimeSha256]]) {
 const bytes = await readFile(path);
 if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error(`Fruit texture provenance mismatch: ${path}`);
}
console.log('Verified generated fruit source and locally compressed runtime texture.');

const runtimeManifest = JSON.parse(await readFile('src/runtime-assets.json', 'utf8'));
if (runtimeManifest.version !== 1 || runtimeManifest.cachePolicy !== 'sha256-filename') {
 throw Error('Runtime asset manifest has an unsupported cache identity policy');
}
const runtimeAssets = [
 runtimeManifest.modelLibrary,
 runtimeManifest.fruitSkin,
 runtimeManifest.puffAtlas,
 ...Object.values(runtimeManifest.surfaces).flatMap((channels) => Object.values(channels)),
 ...Object.values(runtimeManifest.foliage),
 ...Object.values(runtimeManifest.audio),
];
let hashedAssetCount = 0;
for (const asset of runtimeAssets) {
 const bytes = await readFile(`public${asset.path}`);
 const actualHash = createHash('sha256').update(bytes).digest('hex');
 if (actualHash !== asset.sha256) throw Error(`Hashed runtime asset changed: ${asset.path}`);
 if (!path.basename(asset.path).includes(`.${actualHash}.`)) throw Error(`Runtime filename does not carry its content hash: ${asset.path}`);
 await stat(`public${asset.source}`); // Keep legacy immutable URLs available to already released clients.
 hashedAssetCount++;
}
const decoderSetHash = runtimeManifest.decoders.sha256;
if (!runtimeManifest.decoders.path.endsWith(`/${decoderSetHash}/`)) throw Error('Decoder directory is not content-addressed');
for (const [name, record] of Object.entries(runtimeManifest.decoders.files)) {
 const bytes = await readFile(`public${runtimeManifest.decoders.path}${name}`);
 if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw Error(`Decoder hash mismatch: ${name}`);
 await stat(`public${record.source}`);
 hashedAssetCount++;
}
console.log(`Verified ${hashedAssetCount} content-hashed runtime files; legacy immutable URLs remain available.`);
