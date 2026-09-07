"""Generate a playable city: city-layout.json (bounds+roads) and world.json (content).

Sized for WebGPU FPS (~3× the original map, not 10×).

Rules:
- Road grid + perimeter ring
- Buildings and NPCs never on roads
- Only driveable cars placed on roads
- Dense-enough downtown without melting the GPU
"""
from __future__ import annotations

import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAYOUT_OUT = ROOT / "assets" / "city-layout.json"
WORLD_OUT = ROOT / "assets" / "world.json"

# Original city ≈ 260×285. Keep ~1.75× for FPS headroom.
CENTER_X, CENTER_Z = 40.0, 12.5
HALF_X, HALF_Z = 230.0, 250.0
BOUNDS = {
    "minX": CENTER_X - HALF_X,
    "maxX": CENTER_X + HALF_X,
    "minZ": CENTER_Z - HALF_Z,
    "maxZ": CENTER_Z + HALF_Z,
}
GROUND_SIZE = 800
ROAD_WIDTH = 16.0
RING_INSET = 30.0
BLOCK = 90.0
SIDEWALK = 10.0
DOWNTOWN_RADIUS = 140.0
PLAZA_RADIUS = 16.0

# Soft caps — keep draw calls / GLB loads in a sane range.
MAX_BUILDINGS = 45
MAX_DRIVEABLE = 22
MAX_NPCS = 12
MAX_STATIC_SCENERY = 8
MAX_PROPS = 20

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
    ("SUV.glb", 1.5, 1.7),
    ("Sports Car.glb", 1.5, 1.8),
    ("Police Car.glb", 1.8, 2.2),
]

NPC_MODELS = [
    "Man.glb",
    "Animated Woman.glb",
    "Animated Woman-nIItLV9nxS.glb",
    "Animated Woman-qJ2gsTUBHL.glb",
    "Adventurer.glb",
]

STATIC_VEHICLE_SCENERY = [
    ("Van.glb", 0.07, 0.1),
    ("Bus Stop.glb", 0.18, 0.25),
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
    x0 = b["minX"] + RING_INSET
    x1 = b["maxX"] - RING_INSET
    z0 = b["minZ"] + RING_INSET
    z1 = b["maxZ"] - RING_INSET
    span_x = x1 - x0
    span_z = z1 - z0

    roads.append(road_rect((x0 + x1) * 0.5, z1, span_x + ROAD_WIDTH, ROAD_WIDTH))
    roads.append(road_rect((x0 + x1) * 0.5, z0, span_x + ROAD_WIDTH, ROAD_WIDTH))
    roads.append(road_rect(x1, (z0 + z1) * 0.5, ROAD_WIDTH, span_z + ROAD_WIDTH))
    roads.append(road_rect(x0, (z0 + z1) * 0.5, ROAD_WIDTH, span_z + ROAD_WIDTH))

    x = x0 + BLOCK
    while x < x1 - BLOCK * 0.5:
        roads.append(road_rect(x, (z0 + z1) * 0.5, ROAD_WIDTH, span_z))
        x += BLOCK

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


def dist2_spawn(x: float, z: float) -> float:
    return (x - CENTER_X) ** 2 + (z - CENTER_Z) ** 2


def sample_road_points(
    roads: list[dict],
    rng: random.Random,
    count: int,
    *,
    prefer_downtown: bool = True,
    min_sep: float = 14.0,
    max_spawn_dist: float | None = None,
) -> list[tuple[float, float, float]]:
    points: list[tuple[float, float, float]] = []

    def try_sample(road: dict) -> tuple[float, float, float] | None:
        if road["w"] >= road["d"]:
            half = road["w"] * 0.5 - 8
            if half < 4:
                return None
            x = road["x"] + rng.uniform(-half, half)
            z = road["z"] + rng.uniform(-2.0, 2.0)
            rot = 0.0 if rng.random() < 0.5 else math.pi
        else:
            half = road["d"] * 0.5 - 8
            if half < 4:
                return None
            x = road["x"] + rng.uniform(-2.0, 2.0)
            z = road["z"] + rng.uniform(-half, half)
            rot = math.pi / 2 if rng.random() < 0.5 else -math.pi / 2
        if max_spawn_dist is not None and dist2_spawn(x, z) > max_spawn_dist**2:
            return None
        if any((x - px) ** 2 + (z - pz) ** 2 < min_sep**2 for px, pz, _ in points):
            return None
        return (x, z, rot)

    ordered = sorted(roads, key=lambda r: dist2_spawn(r["x"], r["z"]))
    attempts = 0
    while len(points) < count and attempts < count * 20:
        attempts += 1
        if prefer_downtown and len(points) < count * 0.6:
            road = ordered[rng.randrange(min(10, len(ordered)))]
        else:
            road = roads[rng.randrange(len(roads))]
        pt = try_sample(road)
        if pt:
            points.append(pt)
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
    centers = block_centers(roads)

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
        if dist2_spawn(x, z) < PLAZA_RADIUS**2:
            return True
        for ox, oz in occupied:
            if (x - ox) ** 2 + (z - oz) ** 2 < sep**2:
                return True
        return False

    # Prefer downtown blocks first so the budget fills the playable core.
    centers_sorted = sorted(centers, key=lambda c: dist2_spawn(c[0], c[1]))
    mi = 0
    for cx, cz in centers_sorted:
        if len(buildings) >= MAX_BUILDINGS:
            break
        downtown = dist2_spawn(cx, cz) < DOWNTOWN_RADIUS**2
        n = rng.randint(2, 3) if downtown else rng.randint(1, 2)
        sep = 14.0 if downtown else 18.0
        jitter = 38.0 if downtown else 34.0
        for _ in range(n * 4):
            if len(buildings) >= MAX_BUILDINGS:
                break
            if sum(1 for bx, bz in occupied if (bx - cx) ** 2 + (bz - cz) ** 2 < 50**2) >= n:
                break
            x = cx + rng.uniform(-jitter, jitter)
            z = cz + rng.uniform(-jitter, jitter)
            if blocked(x, z, sep=sep):
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

    vehicles: list[dict] = []
    car_points = sample_road_points(
        roads,
        rng,
        count=MAX_DRIVEABLE,
        prefer_downtown=True,
        min_sep=16.0,
        max_spawn_dist=None,
    )
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

    for i in range(MAX_STATIC_SCENERY * 3):
        if sum(1 for v in vehicles if v["model"] in ("Van.glb", "Bus Stop.glb")) >= MAX_STATIC_SCENERY:
            break
        cx, cz = rng.choice(centers)
        x = cx + rng.uniform(-40, 40)
        z = cz + rng.uniform(-40, 40)
        if on_road(x, z, roads, margin=margin) or blocked(x, z, 12):
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

    props: list[dict] = []
    npc_i = 0
    sidewalk = BLOCK * 0.5 - ROAD_WIDTH * 0.5 - 6.0
    npc_sep: list[tuple[float, float]] = []
    for cx, cz in centers_sorted:
        if npc_i >= MAX_NPCS:
            break
        downtown = dist2_spawn(cx, cz) < DOWNTOWN_RADIUS**2
        if not downtown and rng.random() > 0.4:
            continue
        for _ in range(rng.randint(1, 2) if downtown else 1):
            if npc_i >= MAX_NPCS:
                break
            edge = rng.choice(["n", "s", "e", "w"])
            if edge == "n":
                x, z = cx + rng.uniform(-20, 20), cz + sidewalk
            elif edge == "s":
                x, z = cx + rng.uniform(-20, 20), cz - sidewalk
            elif edge == "e":
                x, z = cx + sidewalk, cz + rng.uniform(-20, 20)
            else:
                x, z = cx - sidewalk, cz + rng.uniform(-20, 20)
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

    prop_count = 0
    for i in range(MAX_PROPS * 4):
        if prop_count >= MAX_PROPS:
            break
        cx, cz = rng.choice(centers)
        x = cx + rng.uniform(-36, 36)
        z = cz + rng.uniform(-36, 36)
        if on_road(x, z, roads, margin=margin) or blocked(x, z, 10):
            continue
        model, smin, smax = PROP_SCENERY[i % len(PROP_SCENERY)]
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
        prop_count += 1

    world = {"buildings": buildings, "vehicles": vehicles, "props": props}
    WORLD_OUT.write_text(json.dumps(world, indent=4) + "\n", encoding="utf-8")

    near_b = sum(1 for b in buildings if dist2_spawn(b["x"], b["z"]) < 200**2)
    near_c = sum(1 for x, z, _ in car_points if dist2_spawn(x, z) < 200**2)
    print(f"Wrote {LAYOUT_OUT.relative_to(ROOT)}")
    print(f"  bounds {BOUNDS}  roads={len(roads)}")
    print(f"Wrote {WORLD_OUT.relative_to(ROOT)}")
    print(
        f"  buildings={len(buildings)} vehicles={len(vehicles)} "
        f"(driveable~{len(car_points)}) props={len(props)} npcs~{npc_i}"
    )
    print(f"  within 200 of spawn: buildings={near_b} cars={near_c}")


if __name__ == "__main__":
    main()
