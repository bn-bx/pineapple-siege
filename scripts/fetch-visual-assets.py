"""Reproducible CC0 acquisition. Run explicitly, never during game startup/build.
Usage: python scripts/fetch-visual-assets.py --toktx /path/to/toktx
"""
import argparse, concurrent.futures, hashlib, json, pathlib, subprocess, tempfile, urllib.request
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = {"stone": "large_sandstone_blocks", "wood": "medieval_wood", "grass": "leafy_grass", "rock": "dark_rock", "soil": "forest_ground_04", "roof": "grey_roof_tiles", "bark":"pine_bark", "cloth":"rough_linen", "sand":"coast_sand_01"}
def request(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "PineappleSiege-AssetBuild/1.0"}), timeout=90) as response: return response.read()
def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--toktx", required=True); args = parser.parse_args()
    directory = ROOT / "public/assets/materials"; directory.mkdir(parents=True, exist_ok=True)
    sources = ROOT / "art/materials"; sources.mkdir(parents=True, exist_ok=True)
    records = []
    previous = json.loads((sources/"provenance.json").read_text()) if (sources/"provenance.json").exists() else []
    for family, asset in ASSETS.items():
        prior=[r for r in previous if r["family"]==family]
        if len(prior)==3 and all(r["asset"]=="https://polyhaven.com/a/"+asset for r in prior) and all((directory/(family+"-"+r["channel"]+".ktx2")).exists() for r in prior): records.extend(prior);continue
        data = json.loads(request("https://api.polyhaven.com/files/" + asset))
        (sources / (family + ".json")).write_text(json.dumps(data, indent=2))
        for channel, key in [("color", "Diffuse"), ("normal", "nor_gl"), ("orm", "arm")]:
            meta = data[key]["1k"]["jpg"]
            source = sources / (family + "-" + channel + ".jpg")
            raw = request(meta["url"])
            if hashlib.md5(raw).hexdigest() != meta["md5"]: raise RuntimeError("Asset checksum mismatch: " + asset)
            source.write_bytes(raw)
            with tempfile.TemporaryDirectory(prefix="siege-material-") as tmp:
                png = pathlib.Path(tmp) / "source.png"; Image.open(source).convert("RGB").save(png)
                output = directory / (family + "-" + channel + ".ktx2")
                subprocess.run([args.toktx, "--t2", "--encode", "uastc", "--uastc_quality", "1", "--zcmp", "18", "--genmipmap", "--assign_oetf", "srgb" if channel == "color" else "linear", str(output), str(png)], check=True)
            records.append({"family": family, "channel": channel, "source": meta["url"], "sourceMD5": meta["md5"], "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "bytes": output.stat().st_size, "license": "CC0-1.0", "asset": "https://polyhaven.com/a/" + asset})
    (ROOT / "art/materials/provenance.json").write_text(json.dumps(records, indent=2) + "\n")
if __name__ == "__main__": main()
