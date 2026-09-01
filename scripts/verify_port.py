from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CHECKS = [
    ("js/gltf-loader.js", "export async function loadGLBGeometry"),
    ("js/gltf-loader.js", "makeVertexColors"),
    ("js/gltf-loader.js", "materialColor"),
    ("js/world.js", "import { loadGLBGeometry } from './gltf-loader.js';"),
    ("js/world.js", "await Promise.all(jobs);"),
    ("js/world.js", "this.game.renderer.registerGeometry(name, geometry);"),
    ("js/world.js", "3dfps-main/assets/CityPack"),
    ("js/player.js", "moveDir = moveDir.add(fwd)"),
    ("js/player.js", "sprintMultiplier"),
    ("js/player.js", "Pistol.glb"),
    ("js/player.js", "AssaultRifle.glb"),
    ("js/player.js", "this.game.world._loadModelGeometry(weapon.model, 'assets')"),
    ("js/player.js", "this.weaponObj.modelMatrix = this._composeCameraWeaponMatrix(pos, right, up, fwd, weapon)"),
    ("js/player.js", "const up = right.cross(fwd).normalize()"),
    ("js/player.js", "name: 'Pistol', model: 'Pistol.glb'"),
    ("js/player.js", "localYaw: -Math.PI / 2"),
    ("js/player.js", "name: 'Assault Rifle', model: 'AssaultRifle.glb'"),
    ("js/player.js", "localYaw: Math.PI"),
    ("js/player.js", "if (this.moveRight) moveDir = moveDir.add(right)"),
    ("js/player.js", "if (this.moveLeft) moveDir = moveDir.sub(right)"),
    ("js/renderer.js", "let model = obj.modelMatrix"),
    ("js/camera.js", "this.yaw - Math.PI / 2"),
    ("js/camera.js", "Math.abs(fwd.dot(up)) > 0.999"),
    ("js/player.js", "clamp(this.pitch, -1.45, 1.45)"),
    ("js/player.js", "clamp(this.pitch + (weapon.cameraRecoil || 0), -1.45, 1.45)"),
    ("js/renderer.js", "rotationX: 0, rotationY, rotationZ: 0"),
    ("js/world.js", "new Vec3(400, 1, 400)"),
    ("js/renderer.js", "const size = 400;"),
    ("js/renderer.js", "@location(2) color : vec3f"),
    ("js/renderer.js", "setVertexBuffer(2, geo.colorBuf)"),
    ("js/renderer.js", "indexFormat: geo.indices instanceof Uint32Array ? 'uint32' : 'uint16'"),
    ("js/renderer.js", "setRenderScale("),
    ("js/renderer.js", "setMSAA("),
    ("js/renderer.js", "setGridVisible("),
    ("js/game.js", "_setupSettingsControlCenter("),
    ("js/game.js", "_showFeedback("),
    ("js/game.js", "_applyAllSettings("),
    ("js/game.js", "_resetAllSettings("),
    ("js/game.js", "_applySettingsToUI("),
    ("js/game.js", "setRenderScale("),
    ("js/game.js", "_updateLoading("),
    ("js/game.js", "showFps"),
    ("js/player.js", "this.mouseSensitivity"),
    ("index.html", "Orbitron"),
    ("index.html", "settings-sidebar"),
    ("index.html", "settings-search-input"),
    ("index.html", "set-aa"),
    ("index.html", "set-fov"),
    ("index.html", "loading-bar-fill"),
    ("index.html", "set-danger-zone"),
    ("index.html", "set-footer-apply"),
    ("index.html", "set-accent-row"),
    ("index.html", "set-feedback"),
    ("js/audio-manager.js", "_createReverb("),
    ("js/audio-manager.js", "_startHeartbeat("),
    ("js/audio-manager.js", "_startEerieStingers("),
    ("js/audio-manager.js", "stopAmbient("),
    ("js/audio-manager.js", "setMusicVolume("),
    ("js/audio-manager.js", "voiceVolume"),
    ("js/audio-manager.js", "playReload() {"),
    ("js/vehicle.js", "class Vehicle"),
    ("js/vehicle.js", "_checkRunover("),
    ("js/vehicle.js", "ragdoll("),
    ("js/vehicle-manager.js", "class VehicleManager"),
    ("js/vehicle-manager.js", "tryEnterVehicle("),
    ("js/enemy.js", "RAGDOLL: 'ragdoll'"),
    ("js/enemy.js", "ragdoll(impactVel)"),
    ("js/enemy.js", "_updateRagdoll("),
    ("js/player.js", "toggleVehicle("),
    ("js/player.js", "exitVehicle("),
    ("js/player.js", "_updateVehicleMode("),
    ("js/player.js", "isInVehicle"),
    ("js/game.js", "VehicleManager"),
    ("js/game.js", "vehicleManager.init("),
    ("index.html", "vehicle-hud"),
    ("js/math.js", "intersectsAABB("),
    ("js/math.js", "intersectsCircleXZ3D("),
    ("js/enemy.js", "_collisionBox("),
    ("js/enemy.js", "getCollisionRadius("),
    ("js/enemy-manager.js", "_resolveEnemyCollisions("),
    ("js/world.js", "checkCollisionAABB("),
    ("js/world.js", "checkCollision3D("),
    ("js/world.js", "generateVoxelColliders("),
    ("js/player.js", "getAABB() {"),
    ("js/player.js", "checkCollision3D("),
    ("js/gltf-loader.js", "loadGLBWithNodes("),
    ("js/gltf-loader.js", "collectNodes("),
    ("js/vehicle.js", "loadGLBWithNodes"),
    ("js/vehicle.js", "_isWheelNode("),
    ("js/vehicle.js", "_processNodes("),
    ("js/vehicle.js", "wheelNodes"),
    ("js/vehicle.js", "wheelSpin"),
    ("js/vehicle.js", "forwardAxis"),
    ("js/vehicle.js", "modelFile"),
    ("js/vehicle-manager.js", "DRIVABLE_MODELS"),
    ("js/vehicle-manager.js", "loadedWorldData"),
    ("server.py", "app.mount(\"/3dfps-main\""),
]


def main():
    failures = []
    for rel, needle in CHECKS:
        path = ROOT / rel
        text = path.read_text(encoding="utf-8")
        if needle not in text:
            failures.append(f"{rel}: missing {needle}")
        else:
            print(f"OK {rel}: {needle}")
    renderer = (ROOT / "js" / "renderer.js").read_text(encoding="utf-8")
    if renderer.count("_makeDefaultColors") != 2:
        failures.append("js/renderer.js: unexpected _makeDefaultColors reference count")
    if renderer.count("registerGeometry(name, geo)") != 1:
        failures.append("js/renderer.js: duplicate or missing registerGeometry method")
    if failures:
        print("\nFailures:")
        for failure in failures:
            print(f"- {failure}")
        raise SystemExit(1)
    print("\nPort integration checks passed")


if __name__ == "__main__":
    main()
