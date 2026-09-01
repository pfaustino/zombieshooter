# Zombie Shooter — Particle Realms Port

A 3D first-person zombie shooter ported from [3dfps](https://github.com/pfaustino/3dfps) (Three.js) to the [Particle Realms](https://github.com/BTSpaniel/particlerealms.engine) WebGPU engine.

## Play

- **GitHub Pages:** https://pfaustino.github.io/zombieshooter/
- **itch.io:** https://pfaustino.itch.io/zombie-shooter
- Requires a WebGPU browser (Chrome 113+, Edge 113+).

## Running locally

1. Start a local web server:
   ```
   start-fastapi.bat
   ```
   Or use the static fallback:
   ```
   start-server.bat
   ```
   Manual fallback: `python -m http.server 8080` (or `npm start`)

2. Open `http://localhost:8080` in a WebGPU-compatible browser.

3. Click **Play** to start. The game uses pointer lock for mouse control.

## Ship

```
npm run prepare-dist
# GitHub Pages: push to main (deploy-pages workflow)
# itch.io: butler push dist pfaustino/zombie-shooter:html5 --userversion 0.1.0
```

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrows | Move |
| Mouse | Look around |
| Left Click | Shoot |
| R | Reload |
| Space | Jump (double jump!) |
| 1 / 2 | Switch weapons (Pistol / Assault Rifle) |
| G | Toggle ghost mode (noclip) |

## Architecture

```
J:\zombieshooter\
├── index.html              # Entry point with UI
├── start-fastapi.bat       # FastAPI server launcher
├── start-server.bat        # Static server fallback
├── assets/
│   ├── particle-platform.min.js.gz   # Particle Realms platform
│   ├── particle-engine.min.js.gz     # Particle Realms engine
│   ├── physx-js-webidl.wasm          # PhysX WASM
│   └── world.json                    # World layout data
├── js/
│   ├── main.js             # Entry point
│   ├── game.js             # Game orchestrator
│   ├── renderer.js         # WebGPU renderer with WGSL shaders
│   ├── camera.js           # First-person camera
│   ├── math.js             # Vec3, Mat4, AABB math utilities
│   ├── engine-loader.js    # Particle Realms engine loader
│   ├── gltf-loader.js      # Minimal GLB mesh loader for CityPack models
│   ├── player.js           # FPS controller, weapons, shooting
│   ├── world.js            # World generation, collision, raycasting
│   ├── enemy.js            # Enemy AI (4 types: Robot, Ghost, Zombie, Demon)
│   ├── enemy-manager.js    # Wave spawning system
│   ├── input-manager.js    # Keyboard/mouse input
│   ├── audio-manager.js    # Procedural Web Audio
│   ├── loot-manager.js     # Loot drops (coins, hats, potions)
│   └── particle-system.js  # Blood particle effects
├── scripts/
│   ├── inspect_glb.py      # GLB structure inspection helper
│   ├── verify_models.py    # Validates all world.json GLB references
│   └── verify_port.py      # Static integration checks
└── 3dfps-main/             # Original source and source GLB assets
```

## Porting Notes

- **Rendering**: Three.js WebGLRenderer replaced with raw WebGPU using WGSL shaders
- **Geometry**: CityPack `.glb` models are parsed locally and uploaded to WebGPU, with primitive fallback if a model fails to load
- **Math**: Three.js Vector3/Matrix4 replaced with custom `Vec3`/`Mat4` classes
- **Physics**: Three.js Raycaster replaced with custom ray-AABB intersection
- **Audio**: Web Audio API kept as-is (already engine-independent)
- **Engine**: Particle Realms engine loaded via `engine-loader.js`, provides `window.PE`
