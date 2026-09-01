import { Vec3 } from './math.js';
import { Vehicle } from './vehicle.js';

const DRIVABLE_MODELS = [
  'Car.glb', 'Car-unqqkULtRU.glb', 'SUV.glb', 'Sports Car.glb', 'Sports Car-Gzj704DXdr.glb',
  'Police Car.glb', 'Pickup Truck.glb', 'Bus.glb', 'Motorcycle.glb',
];

export class VehicleManager {
  constructor(game) {
    this.game = game;
    this.vehicles = [];
  }

  async init() {
    const worldData = this.game.world.loadedWorldData;
    if (worldData && worldData.vehicles) {
      for (const v of worldData.vehicles) {
        if (!DRIVABLE_MODELS.includes(v.model)) continue;
        if (!this._isValidSpawn(v.x, v.z, v.scale || 1)) continue;
        const vehicle = new Vehicle(this.game, new Vec3(v.x, 0, v.z), v.model, v.scale || 1, v.rotY || 0);
        await vehicle.init();
        this.vehicles.push(vehicle);
      }
    }

    if (this.vehicles.length === 0) {
      const fallbackSpawns = [
        { model: 'Car.glb', x: 5, z: 10, scale: 2, yaw: 0 },
        { model: 'SUV.glb', x: -15, z: -5, scale: 1.5, yaw: Math.PI / 2 },
        { model: 'Sports Car.glb', x: 30, z: 20, scale: 1.7, yaw: -Math.PI / 4 },
        { model: 'Police Car.glb', x: -30, z: 25, scale: 2, yaw: Math.PI },
      ];
      for (const s of fallbackSpawns) {
        if (!this._isValidSpawn(s.x, s.z, s.scale)) continue;
        const vehicle = new Vehicle(this.game, new Vec3(s.x, 0, s.z), s.model, s.scale, s.yaw);
        await vehicle.init();
        this.vehicles.push(vehicle);
      }
    }
  }

  _isValidSpawn(x, z, scale) {
    const r = (scale || 1) * 2;
    for (const c of this.game.world.collidables) {
      if (c.name === 'ground') continue;
      if (c.aabb.intersectsCircleXZ(x, z, r)) return false;
    }
    return true;
  }

  update(delta) {
    const input = this.game.player;
    for (const v of this.vehicles) {
      v.update(delta, v.occupied ? input : null);
    }
  }

  tryEnterVehicle(player) {
    for (const v of this.vehicles) {
      if (v.canEnter(player.position)) {
        v.enter(player);
        return v;
      }
    }
    return null;
  }

  getNearestVehicle(pos) {
    let nearest = null;
    let minDist = Infinity;
    for (const v of this.vehicles) {
      if (v.destroyed || v.occupied) continue;
      const d = v.position.distanceTo(pos);
      if (d < minDist) { minDist = d; nearest = v; }
    }
    return nearest;
  }
}
