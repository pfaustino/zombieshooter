import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "3dfps-main" / "assets"

CB = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    data = path.read_bytes()
    offset = 12
    gltf = None
    blob = None
    while offset < len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset:offset + length]
        offset += length
        if chunk_type == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8"))
        elif chunk_type == 0x004E4942:
            blob = chunk
    return gltf, blob


def read_accessor(gltf, blob, index):
    accessor = gltf["accessors"][index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    comp_size = CB[accessor["componentType"]]
    count = TC[accessor["type"]]
    stride = view.get("byteStride", comp_size * count)
    base = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    out = []
    for n in range(accessor["count"]):
        vals = []
        for c in range(count):
            o = base + n * stride + c * comp_size
            if accessor["componentType"] == 5126:
                vals.append(struct.unpack_from("<f", blob, o)[0])
            else:
                vals.append(0.0)
        out.append(vals)
    return out


def quat_to_mat3(q):
    x, y, z, w = q
    x2, y2, z2 = x + x, y + y, z + z
    xx, xy, xz = x * x2, x * y2, x * z2
    yy, yz, zz = y * y2, y * z2, z * z2
    wx, wy, wz = w * x2, w * y2, w * z2
    return [
        [1 - (yy + zz), xy - wz, xz + wy],
        [xy + wz, 1 - (xx + zz), yz - wx],
        [xz - wy, yz + wx, 1 - (xx + yy)],
    ]


def transform_point(p, node):
    s = node.get("scale", [1, 1, 1])
    r = quat_to_mat3(node.get("rotation", [0, 0, 0, 1]))
    t = node.get("translation", [0, 0, 0])
    x, y, z = p[0] * s[0], p[1] * s[1], p[2] * s[2]
    return [
        r[0][0] * x + r[0][1] * y + r[0][2] * z + t[0],
        r[1][0] * x + r[1][1] * y + r[1][2] * z + t[1],
        r[2][0] * x + r[2][1] * y + r[2][2] * z + t[2],
    ]


def world_transform(node_index, gltf):
    node = gltf["nodes"][node_index]
    s = node.get("scale", [1, 1, 1])
    r = quat_to_mat3(node.get("rotation", [0, 0, 0, 1]))
    t = node.get("translation", [0, 0, 0])
    return s, r, t


def apply_parent(child_pts, parent_s, parent_r, parent_t):
    out = []
    for p in child_pts:
        x, y, z = p[0] * parent_s[0], p[1] * parent_s[1], p[2] * parent_s[2]
        out.append([
            parent_r[0][0] * x + parent_r[0][1] * y + parent_r[0][2] * z + parent_t[0],
            parent_r[1][0] * x + parent_r[1][1] * y + parent_r[1][2] * z + parent_t[1],
            parent_r[2][0] * x + parent_r[2][1] * y + parent_r[2][2] * z + parent_t[2],
        ])
    return out


def main():
    for name in ["Pistol.glb", "AssaultRifle.glb"]:
        path = ASSETS / name
        gltf, blob = read_glb(path)
        print(f"\n=== {name} ===")
        for ni, node in enumerate(gltf.get("nodes", [])):
            print(f"  Node {ni}: {node.get('name', '?')}")
            if "rotation" in node:
                print(f"    rotation: {node['rotation']}")
            if "scale" in node:
                print(f"    scale: {node['scale']}")
            if "translation" in node:
                print(f"    translation: {node['translation']}")
            if "mesh" in node:
                mesh = gltf["meshes"][node["mesh"]]
                pts = []
                for prim in mesh.get("primitives", []):
                    pos_acc = prim.get("attributes", {}).get("POSITION")
                    if pos_acc is None:
                        continue
                    for p in read_accessor(gltf, blob, pos_acc):
                        pts.append(transform_point(p, node))
                if pts:
                    mn = [min(p[i] for p in pts) for i in range(3)]
                    mx = [max(p[i] for p in pts) for i in range(3)]
                    ext = [mx[i] - mn[i] for i in range(3)]
                    cen = [(mx[i] + mn[i]) / 2 for i in range(3)]
                    print(f"    bounds: min={mn}, max={mx}")
                    print(f"    extent: {ext}")
                    print(f"    center: {cen}")
                    longest = ext.index(max(ext))
                    axes = ["X", "Y", "Z"]
                    print(f"    longest axis: {axes[longest]} ({ext[longest]:.4f})")
            children = node.get("children", [])
            if children:
                print(f"    children: {children}")


if __name__ == "__main__":
    main()
