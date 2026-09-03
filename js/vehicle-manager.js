import { Vec3 } from './math.js';
import { Vehicle } from './vehicle.js';

export const DRIVABLE_MODELS = [
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
        await this._spawnDrivable(v);
      }
    }

    if (this.vehicles.length === 0) {
      const fallbackSpawns = [
        { model: 'Car.glb', x: 5, z: 10, scale: 2, rotY: 0 },
        { model: 'SUV.glb', x: -15, z: -5, scale: 1.5, rotY: Math.PI / 2 },
        { model: 'Sports Car.glb', x: 30, z: 20, scale: 1.7, rotY: -Math.PI / 4 },
        { model: 'Police Car.glb', x: -30, z: 25, scale: 2, rotY: Math.PI },
      ];
      for (const s of fallbackSpawns) await this._spawnDrivable(s);
    }
  }

  async _spawnDrivable(config) {
    const scale = config.scale || 1;
    const spawn = this._findSafeSpawn(config.x, config.z, scale);
    if (!spawn) return;
    const vehicle = new Vehicle(
      this.game, new Vec3(spawn.x, 0, spawn.z), config.model, scale, config.rotY || 0);
    await vehicle.init();
    this.vehicles.push(vehicle);
  }

  _findSafeSpawn(x, z, scale) {
    const r = (scale || 1) * 2.5 + 1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const angle = attempt === 0 ? 0 : Math.random() * Math.PI * 2;
      const dist = attempt === 0 ? 0 : 3 + attempt * 2;
      const tx = x + Math.cos(angle) * dist;
      const tz = z + Math.sin(angle) * dist;
      if (this._isValidSpawnAt(tx, tz, r)) return { x: tx, z: tz };
    }
    return null;
  }

  _isValidSpawnAt(x, z, radius) {
    const world = this.game.world;
    if (world.cityBounds) {
      const b = world.cityBounds;
      if (x - radius < b.minX || x + radius > b.maxX || z - radius < b.minZ || z + radius > b.maxZ) return false;
    }
    return !world.checkCollision(x, z, radius);
  }

  update(delta) {
    const input = this.game.player;
    for (const v of this.vehicles) {
      v.update(delta, v.occupied ? input : null);
    }
  }

  getEnterableVehicle(pos) {
    for (const v of this.vehicles) {
      if (v.canEnter(pos)) return v;
    }
    return null;
  }

  tryEnterVehicle(player) {
    const vehicle = this.getEnterableVehicle(player.position);
    if (!vehicle) return null;
    vehicle.enter(player);
    return vehicle;
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
