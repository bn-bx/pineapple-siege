"""Pack the locally archived Kenney CC0 puff variants into a shared GPU atlas."""
from pathlib import Path
from PIL import Image
import argparse, hashlib, json, subprocess
root = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--toktx', required=True)
args = p.parse_args()
source = root / 'art/particles/source'
files = sorted((source / 'PNG/White puff').glob('*.png'))
assert len(files) == 25
atlas = Image.new('RGBA', (1280, 1280))
for i, path in enumerate(files):
    image = Image.open(path).convert('RGBA').resize((248, 248), Image.Resampling.LANCZOS)
    # Transparent padding prevents neighbouring sprites bleeding into each other.
    atlas.paste(image, (i % 5 * 256 + 4, i // 5 * 256 + 4))
output = root / 'art/particles/puff-atlas.png'
atlas.save(output)
runtime = root / 'public/assets/particles/puff-atlas.ktx2'
# No whole-atlas mip chain: small mip levels mix unrelated cells. Each card
# fades before it becomes a subpixel feature; hardware filtering stays local.
subprocess.run([args.toktx, '--t2', '--encode', 'uastc', '--uastc_quality', '1', '--zcmp', '18', '--assign_oetf', 'srgb', str(runtime), str(output)], check=True)
record = dict(creator='Kenney', license='CC0-1.0', source_url='https://kenney.nl/assets/smoke-particles', frames=25, grid=[5,5], tile=256, padding=4,
              source_files=[dict(path=str(path.relative_to(root)), sha256=hashlib.sha256(path.read_bytes()).hexdigest()) for path in files],
              runtime=str(runtime.relative_to(root)), sha256=hashlib.sha256(runtime.read_bytes()).hexdigest(),
              animation='Cross-fade puff variants with expansion, rotation, advection and lifetime opacity; source images are variations, not a captured simulation.')
(root / 'art/particles/provenance.json').write_text(json.dumps(record, indent=2) + '\n')
