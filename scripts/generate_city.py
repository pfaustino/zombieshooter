"""Generate a ~10x city: city-layout.json (bounds+roads) and world.json (content).

Rules:
- Meaningful road grid + perimeter ring
- Buildings and NPCs never on roads
- Only driveable cars placed on roads
- Dense downtown core around spawn; still filled suburbs
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
DOWNTOWN_RADIUS = 420.0  # dense core around spawn
PLAZA_RADIUS = 22.0

BUILDING_MODELS = [
    ("Big Building.glb", 2.0, 2.8),
    ("Building Red.glb", 4.5, 6.0),
    ("Building Green.glb", 3.5, 5.0),
    ("Brown Building.glb", 3.0, 4.2),
    ("Building Red Corner.glb", 5.0, 6.8),
    ("Pizza Corner.glb", 4.5, 6.0),
]

# CityPack models use very different native units — match pre-city-redo world.json.
DRIVABLE = [
    ("Car.glb", 1.8, 2.2),
    ("Car-unqqkULtRU.glb", 1.8, 2.2),
    ("SUV.glb", 1.5, 1.7),
    ("Sports Car.glb", 1.5, 1.8),
    ("Sports Car-Gzj704DXdr.glb", 0.85, 1.0),
    ("Police Car.glb", 1.8, 2.2),
    ("Pickup Truck.glb", 1.0, 1.2),
    ("Bus.glb", 0.08, 0.12),
    ("Motorcycle.glb", 0.018, 0.025),
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
    """Return (x, z, rotY) along road centerlines. rotY aligns car with long axis."""
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

    # Prefer shorter downtown segments by sampling roads near spawn first.
    ordered = sorted(roads, key=lambda r: dist2_spawn(r["x"], r["z"]))
    attempts = 0
    while len(points) < count and attempts < count * 20:
        attempts += 1
        if prefer_downtown and len(points) < count * 0.55:
            road = ordered[rng.randrange(min(12, len(ordered)))]
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

    mi = 0
    for cx, cz in centers:
        downtown = dist2_spawn(cx, cz) < DOWNTOWN_RADIUS**2
        # Dense downtown lots; still fill the suburbs.
        n = rng.randint(5, 8) if downtown else rng.randint(3, 5)
        sep = 11.0 if downtown else 14.0
        jitter = 46.0 if downtown else 40.0
        for _ in range(n * 3):
            if sum(1 for bx, bz in occupied if (bx - cx) ** 2 + (bz - cz) ** 2 < 55**2) >= n:
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

    # Extra downtown fill so spawn feels like a packed city core.
    for _ in range(400):
        ang = rng.uniform(0, math.pi * 2)
        rad = rng.uniform(PLAZA_RADIUS + 8, DOWNTOWN_RADIUS * 0.85)
        x = CENTER_X + math.cos(ang) * rad
        z = CENTER_Z + math.sin(ang) * rad
        if blocked(x, z, sep=10.0):
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
        if sum(1 for bx, bz in occupied if dist2_spawn(bx, bz) < 200**2) >= 160:
            break

    # Driveable cars only on roads — pack downtown streets first, then citywide.
    vehicles: list[dict] = []
    downtown_cars = sample_road_points(
        roads, rng, count=120, prefer_downtown=True, min_sep=9.0, max_spawn_dist=280.0
    )
    city_cars = sample_road_points(roads, rng, count=280, prefer_downtown=False, min_sep=14.0)
    # Dedupe city cars that landed on downtown spots
    car_points = list(downtown_cars)
    for x, z, rot in city_cars:
        if any((x - px) ** 2 + (z - pz) ** 2 < 12**2 for px, pz, _ in car_points):
            continue
        car_points.append((x, z, rot))
        if len(car_points) >= 400:
            break
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

    # Static scenery vehicles off-road (bus stops / vans near sidewalks)
    for i in range(60):
        cx, cz = rng.choice(centers)
        x = cx + rng.uniform(-45, 45)
        z = cz + rng.uniform(-45, 45)
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

    # NPCs on sidewalks / plazas (off road), denser downtown
    props: list[dict] = []
    npc_i = 0
    sidewalk = BLOCK * 0.5 - ROAD_WIDTH * 0.5 - 6.0
    npc_sep: list[tuple[float, float]] = []
    for cx, cz in centers:
        downtown = dist2_spawn(cx, cz) < DOWNTOWN_RADIUS**2
        if not downtown and rng.random() > 0.35:
            continue
        rolls = rng.randint(2, 4) if downtown else rng.randint(1, 2)
        for _ in range(rolls):
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
            if any((x - ox) ** 2 + (z - oz) ** 2 < 8**2 for ox, oz in npc_sep):
                continue
            if any((x - ox) ** 2 + (z - oz) ** 2 < 10**2 for ox, oz in occupied):
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
            if npc_i >= 100:
                break
        if npc_i >= 100:
            break

    # Decorative props off-road
    for i in range(200):
        cx, cz = rng.choice(centers)
        x = cx + rng.uniform(-40, 40)
        z = cz + rng.uniform(-40, 40)
        if on_road(x, z, roads, margin=margin) or blocked(x, z, 8):
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
