import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORLD_JSON = ROOT / "assets" / "world.json"
CITYPACK = ROOT / "3dfps-main" / "assets" / "CityPack"
LOCAL_CITYPACK = ROOT / "assets" / "CityPack"
SOURCE_ASSETS = ROOT / "3dfps-main" / "assets"
LOCAL_ASSETS = ROOT / "assets"
EXTRA_MODELS = [
    "Pistol.glb",
    "AssaultRifle.glb",
    "CoinDollarSign.glb",
    "SheriffHat.glb",
    "ComplexHealthPotion.glb",
]


def read_glb_json(path: Path):
    data = path.read_bytes()
    magic, version, total_length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError("invalid GLB magic")
    if version != 2:
        raise ValueError(f"unsupported GLB version {version}")
    if total_length > len(data):
        raise ValueError("declared GLB length exceeds file size")
    offset = 12
    gltf = None
    has_bin = False
    while offset < len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset:offset + length]
        offset += length
        if chunk_type == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8"))
        elif chunk_type == 0x004E4942:
            has_bin = True
    if gltf is None:
        raise ValueError("missing JSON chunk")
    if not has_bin:
        raise ValueError("missing BIN chunk")
    return gltf


def model_path(name: str):
    for base in (LOCAL_CITYPACK, CITYPACK, LOCAL_ASSETS, SOURCE_ASSETS):
        path = base / name
        if path.exists():
            return path
    return None


def validate_gltf_meshes(gltf):
    meshes = gltf.get("meshes", [])
    accessors = gltf.get("accessors", [])
    valid_primitives = 0
    for mesh in meshes:
        for primitive in mesh.get("primitives", []):
            if primitive.get("mode", 4) != 4:
                continue
            attrs = primitive.get("attributes") or {}
            position_accessor = attrs.get("POSITION")
            normal_accessor = attrs.get("NORMAL")
            indices_accessor = primitive.get("indices")
            if position_accessor is None:
                continue
            if position_accessor >= len(accessors):
                raise ValueError("POSITION accessor index out of range")
            if normal_accessor is not None and normal_accessor >= len(accessors):
                raise ValueError("NORMAL accessor index out of range")
            if indices_accessor is not None and indices_accessor >= len(accessors):
                raise ValueError("indices accessor index out of range")
            pos = accessors[position_accessor]
            if pos.get("type") != "VEC3" or pos.get("componentType") != 5126:
                raise ValueError("POSITION accessor must be FLOAT VEC3")
            valid_primitives += 1
    if valid_primitives == 0:
        raise ValueError("no triangle mesh primitives with POSITION")
    return valid_primitives


def referenced_models():
    data = json.loads(WORLD_JSON.read_text(encoding="utf-8"))
    names = set()
    for section in ("buildings", "vehicles", "props"):
        for item in data.get(section, []):
            name = item.get("model")
            if name and name.lower().endswith(".glb"):
                names.add(name)
    return sorted(names)


def main():
    failures = []
    total_primitives = 0
    models = sorted(set(referenced_models() + EXTRA_MODELS))
    for name in models:
        path = model_path(name)
        if path is None:
            failures.append(f"missing: {name}")
            continue
        try:
            gltf = read_glb_json(path)
            primitive_count = validate_gltf_meshes(gltf)
            total_primitives += primitive_count
            print(f"OK {name}: {primitive_count} primitives")
        except Exception as exc:
            failures.append(f"invalid {name}: {exc}")
    print(f"\nChecked {len(models)} referenced GLB models, {total_primitives} primitives")
    if failures:
        print("\nFailures:")
        for failure in failures:
            print(f"- {failure}")
        raise SystemExit(1)
    print("All referenced GLB models are present and parseable")


if __name__ == "__main__":
    main()
