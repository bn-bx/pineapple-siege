import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const document = await io.read('art/models/siege-library.glb');
await document.transform(dedup(), prune({keepAttributes:true}), meshopt({encoder:MeshoptEncoder,level:'medium'}));
await mkdir('public/assets/models',{recursive:true});
await io.write('public/assets/models/siege-library.glb',document);

const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
await writeFile('art/models/provenance.json',JSON.stringify({
  origin:'Authored for Pineapple Siege; source geometry has no external model dependency.',
  source:'art/models/siege-library.blend',sourceSha256:await hash('art/models/siege-library.blend'),
  export:'art/models/siege-library.glb',exportSha256:await hash('art/models/siege-library.glb'),
  runtime:'public/assets/models/siege-library.glb',sha256:await hash('public/assets/models/siege-library.glb'),
  authorScript:'scripts/author-visual-assets.py',authorScriptSha256:await hash('scripts/author-visual-assets.py'),
  compression:'Meshopt, deduplication and quantization; retained UV attributes; three named detail levels.',
  sourceTool:'Blender 4.5 LTS',geometryTool:'@gltf-transform 4.5.1'
},null,2)+'\n');
