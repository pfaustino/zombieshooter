"""Rebuild assets/world.json buildings: keep originals + dense neighborhood fill (~5x)."""
from __future__ import annotations

import copy
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORLD = ROOT / "assets" / "world.json"

SPAWN_X, SPAWN_Z = 62.0, 30.0
SPAWN_CLEAR = 14.0

MODELS = [
    ("Big Building.glb", 2.2, 2.8),
    ("Building Red.glb", 5.0, 6.2),
    ("Building Green.glb", 3.8, 5.0),
    ("Brown Building.glb", 3.2, 4.2),
    ("Building Red Corner.glb", 5.5, 7.2),
    ("Pizza Corner.glb", 5.0, 6.2),
]

ROT = [0.0, math.pi / 2, math.pi, 3 * math.pi / 2]


def main() -> None:
    rng = random.Random(42)
    data = json.loads(WORLD.read_text(encoding="utf-8"))

    # Prefer original 14 if present; otherwise use current list's unique "core" by proximity
    all_b = data.get("buildings") or []
    # Recover originals: those in the classic city bbox
    core = [
        b
        for b in all_b
        if 0 <= b["x"] <= 80 and -70 <= b["z"] <= 60
    ]
    # If we already expanded, core may still include fills — keep first 14 unique-ish
    if len(all_b) >= 14:
        # Re-read from git? We don't have originals. Use the first 14 that look like hand-authored
        # from the known original set if file was expanded from our script: originals were first 14.
        originals = [copy.deepcopy(b) for b in all_b[:14]]
    else:
        originals = [copy.deepcopy(b) for b in all_b]

    # If first 14 are already far-flung from a previous bad expand, filter to near-spawn cluster
    near_orig = [
        b for b in originals if math.hypot(b["x"] - SPAWN_X, b["z"] - SPAWN_Z) < 120
    ]
    if len(near_orig) >= 8:
        originals = near_orig

    target = max(70, len(originals) * 5)
    buildings = [copy.deepcopy(b) for b in originals]
    occupied = [(b["x"], b["z"]) for b in buildings]

    def blocked(x: float, z: float, sep: float = 16.0) -> bool:
        if (x - SPAWN_X) ** 2 + (z - SPAWN_Z) ** 2 < SPAWN_CLEAR**2:
            return True
        for ox, oz in occupied:
            if (x - ox) ** 2 + (z - oz) ** 2 < sep**2:
                return True
        return False

    # Dense grid around the existing city (not far away tiles)
    # Cover roughly x [-40..140], z [-100..120]
    spacing = 18.0
    candidates: list[tuple[float, float]] = []
    x = -40.0
    while x <= 140.0:
        z = -100.0
        while z <= 120.0:
            # Leave road corridors near axes / spawn roads
            on_road = (
                abs(x) < 6
                or abs(z) < 6
                or abs(x - 40) < 5
                or abs(x + 40) < 5
                or abs(x - 120) < 6
                or abs(z - 40) < 5
                or abs(z + 40) < 5
            )
            if not on_road:
                # jitter so it doesn't look like a perfect grid
                jx = x + rng.uniform(-3.5, 3.5)
                jz = z + rng.uniform(-3.5, 3.5)
                candidates.append((jx, jz))
            z += spacing
        x += spacing

    rng.shuffle(candidates)
    mi = 0
    for x, z in candidates:
        if len(buildings) >= target:
            break
        if blocked(x, z, sep=15.0):
            continue
        model, smin, smax = MODELS[mi % len(MODELS)]
        mi += 1
        buildings.append(
            {
                "model": model,
                "x": round(x, 2),
                "y": 0.0,
                "z": round(z, 2),
                "scale": round(rng.uniform(smin, smax), 2),
                "rotY": round(ROT[mi % 4], 4),
                "collidable": True,
            }
        )
        occupied.append((x, z))

    data["buildings"] = buildings
    WORLD.write_text(json.dumps(data, indent=4) + "\n", encoding="utf-8")

    near = sum(
        1
        for b in buildings
        if math.hypot(b["x"] - SPAWN_X, b["z"] - SPAWN_Z) < 100
    )
    print(f"buildings: {len(buildings)} (target {target})")
    print(f"within 100 of spawn: {near}")
    xs = [b["x"] for b in buildings]
    zs = [b["z"] for b in buildings]
    print(f"x [{min(xs):.1f}, {max(xs):.1f}]  z [{min(zs):.1f}, {max(zs):.1f}]")


if __name__ == "__main__":
    main()
