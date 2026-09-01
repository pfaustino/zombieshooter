import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CITYPACK = ROOT / "3dfps-main" / "assets" / "CityPack"
MODELS = [
    "Brown Building.glb",
    "Building Red Corner.glb",
    "Police Car.glb",
    "Pizza Corner.glb",
]


def read_glb_json(path: Path):
    data = path.read_bytes()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path.name}: invalid GLB magic")
    if version != 2:
        raise ValueError(f"{path.name}: unsupported GLB version {version}")
    offset = 12
    while offset < len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset:offset + length]
        offset += length
        if chunk_type == 0x4E4F534A:
            return json.loads(chunk.decode("utf-8"))
    raise ValueError(f"{path.name}: missing JSON chunk")


def inspect_model(name: str):
    path = CITYPACK / name
    gltf = read_glb_json(path)
    primitives = []
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            primitives.append({
                "mode": primitive.get("mode", 4),
                "attributes": sorted((primitive.get("attributes") or {}).keys()),
                "has_indices": "indices" in primitive,
                "extensions": sorted((primitive.get("extensions") or {}).keys()),
            })
    return {
        "file": name,
        "nodes": len(gltf.get("nodes", [])),
        "meshes": len(gltf.get("meshes", [])),
        "materials": len(gltf.get("materials", [])),
        "primitives": primitives,
        "extensions_used": sorted(gltf.get("extensionsUsed", [])),
    }


def main():
    for model in MODELS:
        result = inspect_model(model)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
