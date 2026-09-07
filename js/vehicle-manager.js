import { Vec3 } from './math.js';
import { Vehicle } from './vehicle.js?v=0.1.13';

export const DRIVABLE_MODELS = [
  'Car.glb', 'Car-unqqkULtRU.glb', 'SUV.glb', 'Sports Car.glb', 'Police Car.glb',
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
        // Driveable cars belong on roads only.
        if (this.game.world.isOnRoad && !this.game.world.isOnRoad(v.x, v.z, 2)) continue;
        await this._spawnDrivable(v);
      }
    }

    if (this.vehicles.length === 0) {
      for (const s of this._fallbackRoadSpawns()) await this._spawnDrivable(s);
    }
  }

  _fallbackRoadSpawns() {
    const spawn = this.game.world.cityLayout?.spawn || { x: 40, z: 12.5 };
    const roads = this.game.world.roads || [];
    const picks = [];
    for (const r of roads) {
      const d = Math.hypot(r.x - spawn.x, r.z - spawn.z);
      if (d > 180) continue;
      picks.push(r);
      if (picks.length >= 8) break;
    }
    const models = ['Car.glb', 'SUV.glb', 'Sports Car.glb', 'Police Car.glb'];
    if (picks.length === 0) {
      return models.map((model, i) => ({
        model, x: spawn.x + 8 + i * 6, z: spawn.z, scale: 1.8, rotY: 0,
      }));
    }
    return picks.slice(0, 4).map((r, i) => ({
      model: models[i % models.length],
      x: r.x,
      z: r.z,
      scale: 1.8,
      rotY: r.w >= r.d ? 0 : Math.PI / 2,
    }));
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
    // Keep clearance modest so cars fit on 16-wide roads; tiny GLB scales still need ~2m footprint.
    const r = Math.min(Math.max((scale || 1) * 1.2, 1.6), 3.5);
    for (let attempt = 0; attempt < 40; attempt++) {
      const angle = attempt === 0 ? 0 : Math.random() * Math.PI * 2;
      // Stay close to the authored road point — wandering off asphalt fails isOnRoad.
      const dist = attempt === 0 ? 0 : 1 + attempt * 0.75;
      const tx = x + Math.cos(angle) * dist;
      const tz = z + Math.sin(angle) * dist;
      if (this._isValidSpawnAt(tx, tz, r)) return { x: tx, z: tz };
    }
    // Last resort: trust the road point if it's on asphalt (buildings may over-clear).
    if (this.game.world.isOnRoad?.(x, z, 0)) return { x, z };
    return null;
  }

  _isValidSpawnAt(x, z, radius) {
    const world = this.game.world;
    if (world.cityBounds) {
      const b = world.cityBounds;
      if (x - radius < b.minX || x + radius > b.maxX || z - radius < b.minZ || z + radius > b.maxZ) return false;
    }
    if (world.isOnRoad && !world.isOnRoad(x, z, 0.5)) return false;
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
