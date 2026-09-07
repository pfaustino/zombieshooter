"""Generate a ~10x city: city-layout.json (bounds+roads) and world.json (content).

Rules:
- Meaningful road grid + perimeter ring
- Buildings and NPCs never on roads
- Only driveable cars placed on roads
"""
from __future__ import annotations

import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAYOUT_OUT = ROOT / "assets" / "city-layout.json"
WORLD_OUT = ROOT / "assets" / "world.json"

# Current city ≈ 260×285; scale linear 10× around same center.
CENTER_X, CENTER_Z = 40.0, 12.5
HALF_X, HALF_Z = 1300.0, 1425.0
BOUNDS = {
    "minX": CENTER_X - HALF_X,
    "maxX": CENTER_X + HALF_X,
    "minZ": CENTER_Z - HALF_Z,
    "maxZ": CENTER_Z + HALF_Z,
}
GROUND_SIZE = 4000
ROAD_WIDTH = 16.0
RING_INSET = 70.0
BLOCK = 120.0  # centerline spacing
SIDEWALK = 10.0  # keep buildings this far off road edge

BUILDING_MODELS = [
    ("Big Building.glb", 2.0, 2.8),
    ("Building Red.glb", 4.5, 6.0),
    ("Building Green.glb", 3.5, 5.0),
    ("Brown Building.glb", 3.0, 4.2),
    ("Building Red Corner.glb", 5.0, 6.8),
    ("Pizza Corner.glb", 4.5, 6.0),
]

DRIVABLE = [
    ("Car.glb", 1.8, 2.2),
    ("Car-unqqkULtRU.glb", 1.8, 2.2),
    ("SUV.glb", 1.6, 2.0),
    ("Sports Car.glb", 1.5, 1.9),
    ("Sports Car-Gzj704DXdr.glb", 1.5, 1.9),
    ("Police Car.glb", 1.8, 2.2),
    ("Pickup Truck.glb", 1.7, 2.1),
    ("Bus.glb", 1.4, 1.8),
    ("Motorcycle.glb", 1.2, 1.6),
]

NPC_MODELS = [
    "Man.glb",
    "Animated Woman.glb",
    "Animated Woman-nIItLV9nxS.glb",
    "Animated Woman-qJ2gsTUBHL.glb",
    "Adventurer.glb",
]

STATIC_VEHICLE_SCENERY = [
    ("Van.glb", 1.5, 2.0),
    ("Bus Stop.glb", 1.0, 1.3),
]

PROP_SCENERY = [
    ("Tree.glb", 1.0, 1.8),
    ("Traffic Light.glb", 1.0, 1.2),
    ("Bench.glb", 1.0, 1.2),
    ("Fence.glb", 1.0, 1.4),
]

ROTS = [0.0, math.pi / 2, math.pi, 3 * math.pi / 2]


def road_rect(x: float, z: float, w: float, d: float) -> dict:
    return {"x": round(x, 2), "z": round(z, 2), "w": round(w, 2), "d": round(d, 2)}


def build_roads() -> list[dict]:
    b = BOUNDS
    roads: list[dict] = []
    # Usable inner area for road centerlines
    x0 = b["minX"] + RING_INSET
    x1 = b["maxX"] - RING_INSET
    z0 = b["minZ"] + RING_INSET
    z1 = b["maxZ"] - RING_INSET
    span_x = x1 - x0
    span_z = z1 - z0

    # Perimeter ring (four long segments)
    roads.append(road_rect((x0 + x1) * 0.5, z1, span_x + ROAD_WIDTH, ROAD_WIDTH))  # north
    roads.append(road_rect((x0 + x1) * 0.5, z0, span_x + ROAD_WIDTH, ROAD_WIDTH))  # south
    roads.append(road_rect(x1, (z0 + z1) * 0.5, ROAD_WIDTH, span_z + ROAD_WIDTH))  # east
    roads.append(road_rect(x0, (z0 + z1) * 0.5, ROAD_WIDTH, span_z + ROAD_WIDTH))  # west

    # North–south arterials
    x = x0 + BLOCK
    while x < x1 - BLOCK * 0.5:
        roads.append(road_rect(x, (z0 + z1) * 0.5, ROAD_WIDTH, span_z))
        x += BLOCK

    # East–west arterials
    z = z0 + BLOCK
    while z < z1 - BLOCK * 0.5:
        roads.append(road_rect((x0 + x1) * 0.5, z, span_x, ROAD_WIDTH))
        z += BLOCK

    return roads


def on_road(x: float, z: float, roads: list[dict], margin: float = 0.0) -> bool:
    for r in roads:
        hw = r["w"] * 0.5 + margin
        hd = r["d"] * 0.5 + margin
        if abs(x - r["x"]) <= hw and abs(z - r["z"]) <= hd:
            return True
    return False


def sample_road_points(roads: list[dict], rng: random.Random, count: int) -> list[tuple[float, float, float]]:
    """Return (x, z, rotY) along road centerlines. rotY aligns car with long axis."""
    points: list[tuple[float, float, float]] = []
    # Weight by length
    weighted = []
    for r in roads:
        length = max(r["w"], r["d"])
        weighted.append((r, length))
    total = sum(w for _, w in weighted)
    for _ in range(count * 3):
        if len(points) >= count:
            break
        pick = rng.uniform(0, total)
        acc = 0.0
        road = weighted[0][0]
        for r, w in weighted:
            acc += w
            if pick <= acc:
                road = r
                break
        if road["w"] >= road["d"]:
            # east-west road
            half = road["w"] * 0.5 - 8
            if half < 4:
                continue
            x = road["x"] + rng.uniform(-half, half)
            z = road["z"] + rng.uniform(-1.5, 1.5)
            rot = 0.0 if rng.random() < 0.5 else math.pi
        else:
            half = road["d"] * 0.5 - 8
            if half < 4:
                continue
            x = road["x"] + rng.uniform(-1.5, 1.5)
            z = road["z"] + rng.uniform(-half, half)
            rot = math.pi / 2 if rng.random() < 0.5 else -math.pi / 2
        # Avoid packing too tight
        if any((x - px) ** 2 + (z - pz) ** 2 < 22**2 for px, pz, _ in points):
            continue
        points.append((x, z, rot))
    return points


def block_centers(roads: list[dict]) -> list[tuple[float, float]]:
    b = BOUNDS
    x0 = b["minX"] + RING_INSET + BLOCK * 0.5
    x1 = b["maxX"] - RING_INSET - BLOCK * 0.5
    z0 = b["minZ"] + RING_INSET + BLOCK * 0.5
    z1 = b["maxZ"] - RING_INSET - BLOCK * 0.5
    centers = []
    x = x0
    while x <= x1:
        z = z0
        while z <= z1:
            if not on_road(x, z, roads, margin=ROAD_WIDTH * 0.5 + SIDEWALK):
                centers.append((x, z))
            z += BLOCK
        x += BLOCK
    return centers


def main() -> None:
    rng = random.Random(20260906)
    roads = build_roads()

    layout = {
        "bounds": BOUNDS,
        "groundSize": GROUND_SIZE,
        "roadWidth": ROAD_WIDTH,
        "spawn": {"x": CENTER_X, "z": CENTER_Z},
        "roads": roads,
    }
    LAYOUT_OUT.write_text(json.dumps(layout, indent=2) + "\n", encoding="utf-8")

    buildings: list[dict] = []
    occupied: list[tuple[float, float]] = []
    margin = ROAD_WIDTH * 0.5 + SIDEWALK

    def blocked(x: float, z: float, sep: float) -> bool:
        if on_road(x, z, roads, margin=margin):
            return True
        # Keep plaza clear at spawn
        if (x - CENTER_X) ** 2 + (z - CENTER_Z) ** 2 < 40**2:
            return True
        for ox, oz in occupied:
            if (x - ox) ** 2 + (z - oz) ** 2 < sep**2:
                return True
        return False

    # Fill each city block with a few buildings
    mi = 0
    for cx, cz in block_centers(roads):
        # 2–4 buildings per block with jitter
        n = rng.randint(1, 2)
        for _ in range(n):
            x = cx + rng.uniform(-38, 38)
            z = cz + rng.uniform(-38, 38)
            if blocked(x, z, sep=18.0):
                continue
            model, smin, smax = BUILDING_MODELS[mi % len(BUILDING_MODELS)]
            mi += 1
            buildings.append(
                {
                    "model": model,
                    "x": round(x, 2),
                    "y": 0.0,
                    "z": round(z, 2),
                    "scale": round(rng.uniform(smin, smax), 2),
                    "rotY": round(ROTS[mi % 4], 4),
                    "collidable": True,
                }
            )
            occupied.append((x, z))

    # Driveable cars only on roads
    vehicles: list[dict] = []
    car_points = sample_road_points(roads, rng, count=80)
    for i, (x, z, rot) in enumerate(car_points):
        model, smin, smax = DRIVABLE[i % len(DRIVABLE)]
        vehicles.append(
            {
                "model": model,
                "x": round(x, 2),
                "y": 0.0,
                "z": round(z, 2),
                "scale": round(rng.uniform(smin, smax), 2),
                "rotY": round(rot, 4),
                "collidable": True,
            }
        )

    # A few static scenery vehicles off-road (bus stops / vans near sidewalks)
    for i in range(25):
        cx, cz = rng.choice(block_centers(roads))
        x = cx + rng.uniform(-45, 45)
        z = cz + rng.uniform(-45, 45)
        if on_road(x, z, roads, margin=margin) or blocked(x, z, 14):
            continue
        model, smin, smax = STATIC_VEHICLE_SCENERY[i % len(STATIC_VEHICLE_SCENERY)]
        vehicles.append(
            {
                "model": model,
                "x": round(x, 2),
                "y": 0.0,
                "z": round(z, 2),
                "scale": round(rng.uniform(smin, smax), 2),
                "rotY": round(ROTS[i % 4], 4),
                "collidable": True,
            }
        )
        occupied.append((x, z))

    # NPCs on sidewalks / plazas (off road)
    props: list[dict] = []
    npc_i = 0
    sidewalk = BLOCK * 0.5 - ROAD_WIDTH * 0.5 - 6.0  # inside the block, clear of asphalt
    npc_sep: list[tuple[float, float]] = []
    for cx, cz in block_centers(roads):
        if rng.random() > 0.5:
            continue
        for _ in range(rng.randint(1, 3)):
            edge = rng.choice(["n", "s", "e", "w"])
            if edge == "n":
                x, z = cx + rng.uniform(-25, 25), cz + sidewalk
            elif edge == "s":
                x, z = cx + rng.uniform(-25, 25), cz - sidewalk
            elif edge == "e":
                x, z = cx + sidewalk, cz + rng.uniform(-25, 25)
            else:
                x, z = cx - sidewalk, cz + rng.uniform(-25, 25)
            if on_road(x, z, roads, margin=1.0):
                continue
            if any((x - ox) ** 2 + (z - oz) ** 2 < 10**2 for ox, oz in npc_sep):
                continue
            if any((x - ox) ** 2 + (z - oz) ** 2 < 12**2 for ox, oz in occupied):
                continue
            props.append(
                {
                    "model": NPC_MODELS[npc_i % len(NPC_MODELS)],
                    "x": round(x, 2),
                    "y": 0.0,
                    "z": round(z, 2),
                    "scale": 1.0,
                    "rotY": round(ROTS[npc_i % 4], 4),
                    "collidable": False,
                }
            )
            npc_sep.append((x, z))
            occupied.append((x, z))
            npc_i += 1
            if npc_i >= 60:
                break
        if npc_i >= 60:
            break

    # Decorative props off-road
    for i in range(120):
        cx, cz = rng.choice(block_centers(roads))
        x = cx + rng.uniform(-40, 40)
        z = cz + rng.uniform(-40, 40)
        if on_road(x, z, roads, margin=margin) or blocked(x, z, 10):
            continue
        model, smin, smax = PROP_SCENERY[i % len(PROP_SCENERY)]
        # Skip missing models gracefully — verify against disk
        if not (ROOT / "assets" / "CityPack" / model).exists():
            continue
        props.append(
            {
                "model": model,
                "x": round(x, 2),
                "y": 0.0,
                "z": round(z, 2),
                "scale": round(rng.uniform(smin, smax), 2),
                "rotY": round(ROTS[i % 4], 4),
                "collidable": False,
            }
        )
        occupied.append((x, z))

    world = {"buildings": buildings, "vehicles": vehicles, "props": props}
    WORLD_OUT.write_text(json.dumps(world, indent=4) + "\n", encoding="utf-8")

    print(f"Wrote {LAYOUT_OUT.relative_to(ROOT)}")
    print(f"  bounds {BOUNDS}  roads={len(roads)}")
    print(f"Wrote {WORLD_OUT.relative_to(ROOT)}")
    print(
        f"  buildings={len(buildings)} vehicles={len(vehicles)} "
        f"(driveable~{len(car_points)}) props={len(props)} npcs~{npc_i}"
    )


if __name__ == "__main__":
    main()
