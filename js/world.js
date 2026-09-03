import { Vec3, AABB } from './math.js';
import { loadGLBGeometry } from './gltf-loader.js';
import { DRIVABLE_MODELS } from './vehicle-manager.js?v=0.1.4';
import { NPC_PROP_MODELS } from './npc-manager.js?v=0.1.4k';

export class World {
  constructor(game) {
    this.game = game;
    this.collidables = [];
    this.objects = [];
    this.geometryCache = new Map();
  }

  init() {
    this.createGround();
    this.createRoads();
    this.createCityWalls();
  }

  createGround() {
    const ground = this.game.renderer.addObject('plane',
      new Vec3(0, 0, 0), new Vec3(800, 1, 800), 0,
      [0.165, 0.165, 0.23], [0, 0, 0], 1);
    ground.visible = true;
    this.collidables.push({ name: 'ground', aabb: new AABB(new Vec3(-400, -1, -400), new Vec3(400, 0, 400)) });
  }

  createRoads() {
    const roads = [
      { x: 0, z: 0, w: 8, d: 700 },
      { x: 0, z: 0, w: 700, d: 8 },
      { x: -40, z: 0, w: 6, d: 480 },
      { x: 40, z: 0, w: 6, d: 480 },
      { x: 120, z: 0, w: 8, d: 640 },
      { x: -120, z: 0, w: 8, d: 640 },
      { x: 0, z: -40, w: 480, d: 6 },
      { x: 0, z: 40, w: 480, d: 6 },
      { x: 0, z: -160, w: 560, d: 8 },
      { x: 0, z: 160, w: 560, d: 8 },
      { x: 100, z: 140, w: 120, d: 8 },
      { x: -100, z: -140, w: 120, d: 8 },
    ];
    for (const r of roads) {
      this.game.renderer.addObject('plane',
        new Vec3(r.x, 0.02, r.z), new Vec3(r.w, 1, r.d), 0,
        [0.2, 0.2, 0.27], [0, 0, 0], 1);
    }
  }

  createCityWalls() {
    const minX = -90;
    const maxX = 170;
    const minZ = -130;
    const maxZ = 155;
    const height = 14;
    const thickness = 4;
    const wallColor = [0.26, 0.26, 0.3];
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;

    this.cityBounds = { minX, maxX, minZ, maxZ };

    const segments = [
      { x: (minX + maxX) * 0.5, z: maxZ + thickness * 0.5, w: spanX + thickness * 2, d: thickness },
      { x: (minX + maxX) * 0.5, z: minZ - thickness * 0.5, w: spanX + thickness * 2, d: thickness },
      { x: maxX + thickness * 0.5, z: (minZ + maxZ) * 0.5, w: thickness, d: spanZ + thickness * 2 },
      { x: minX - thickness * 0.5, z: (minZ + maxZ) * 0.5, w: thickness, d: spanZ + thickness * 2 },
    ];

    for (const s of segments) {
      this.game.renderer.addObject('box',
        new Vec3(s.x, height * 0.5, s.z),
        new Vec3(s.w, height, s.d),
        0, wallColor, [0, 0, 0], 1);
      this.collidables.push({
        name: 'city_wall',
        aabb: new AABB(
          new Vec3(s.x - s.w * 0.5, 0, s.z - s.d * 0.5),
          new Vec3(s.x + s.w * 0.5, height, s.z + s.d * 0.5)
        ),
      });
    }
  }

  async loadCityAssets() {
    try {
      const r = await fetch('assets/world.json', { cache: 'no-store' });
      const data = await r.json();
      const jobs = [];
      if (data.buildings) jobs.push(...data.buildings.map(b => this.loadModel(b, true)));
      if (data.vehicles) {
        const staticVehicles = data.vehicles.filter(v => !DRIVABLE_MODELS.includes(v.model));
        jobs.push(...staticVehicles.map(v => this.loadModel(v, true)));
      }
      if (data.props) {
        const staticProps = data.props.filter(p => !NPC_PROP_MODELS.has(p.model));
        jobs.push(...staticProps.map(p => this.loadModel(p, false)));
      }
      this.loadedWorldData = data;
      await Promise.all(jobs);
    } catch (e) {
      console.error('Error loading world.json:', e);
      this.createDefaultBuildings();
    }
  }

  createDefaultBuildings() {
    const buildings = [
      { x: -20, z: -20, w: 10, h: 15, d: 10 },
      { x: 20, z: -20, w: 12, h: 20, d: 12 },
      { x: -20, z: 20, w: 8, h: 10, d: 8 },
      { x: 20, z: 20, w: 15, h: 25, d: 15 },
      { x: -60, z: -30, w: 10, h: 12, d: 10 },
      { x: 60, z: 30, w: 14, h: 18, d: 14 },
      { x: -50, z: 40, w: 10, h: 8, d: 10 },
      { x: 50, z: -40, w: 12, h: 15, d: 12 },
    ];
    for (const b of buildings) {
      this.loadModel({ model: 'Building', x: b.x, y: 0, z: b.z, scale: 1, rotY: 0, collidable: true, _box: b }, true);
    }
  }

  async loadModel(config, isCollidable = false) {
    const shouldCollide = config.collidable !== undefined ? config.collidable : isCollidable;
    const scale = config.scale || 1;
    let objectColor = this._getModelColor(config.model);
    let geoName = 'box';
    let bounds = this._estimateBounds(config, Math.min(scale, 3));

    if (config.model && config.model.toLowerCase().endsWith('.glb')) {
      try {
        const loaded = await this._loadModelGeometry(config.model, config.path);
        geoName = loaded.name;
        objectColor = [1, 1, 1];
        bounds = this._boundsFromGeometry(loaded.geometry.positions, scale, config.rotY || 0, config.x, config.y || 0, config.z);
        if (shouldCollide && loaded.geometry.positions) {
          this.generateVoxelColliders(loaded.geometry.positions, loaded.geometry.indices, scale, config.rotY || 0, config.x, config.y || 0, config.z, config.model);
        }
      } catch (error) {
        console.warn(`Using primitive fallback for ${config.model}:`, error);
      }
    }

    const obj = this.game.renderer.addObject(geoName,
      new Vec3(config.x, config.y || 0, config.z),
      new Vec3(scale, scale, scale),
      config.rotY || 0,
      objectColor, [0, 0, 0], 1);

    if (geoName === 'box') {
      obj.position.y = config.y || bounds.center.y;
      obj.scale = bounds.size;
      this.game.renderer.updateObjectTransform(obj);
    }

    this.objects.push({ obj, config, modelName: config.model, bounds });

    if (shouldCollide) {
      this.collidables.push({
        name: 'obstacle_' + (config.model || 'obj'),
        aabb: bounds.aabb,
        modelName: config.model,
      });
    }
  }

  async _loadModelGeometry(modelName, basePath) {
    const cacheKey = `${basePath || 'CityPack'}:${modelName}`;
    if (this.geometryCache.has(cacheKey)) return this.geometryCache.get(cacheKey);
    const urls = this._modelUrls(modelName, basePath);
    let lastError = null;
    for (const url of urls) {
      try {
        const geometry = await loadGLBGeometry(url);
        const name = `model:${cacheKey}`;
        this.game.renderer.registerGeometry(name, geometry);
        const loaded = { name, geometry };
        this.geometryCache.set(cacheKey, loaded);
        return loaded;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`No path resolved for ${modelName}`);
  }

  _modelUrls(modelName, basePath) {
    const encoded = modelName.split('/').map(encodeURIComponent).join('/');
    if (basePath) return [`${basePath}/${encoded}`, `3dfps-main/${basePath}/${encoded}`];
    return [`assets/CityPack/${encoded}`, `3dfps-main/assets/CityPack/${encoded}`];
  }

  _estimateBounds(config, scale) {
    let w = 4, h = 8, d = 4;
    if (config._box) { w = config._box.w; h = config._box.h; d = config._box.d; }
    else if (config.model) {
      const m = config.model.toLowerCase();
      if (m.includes('short')) { w = 5; h = 4; d = 5; }
      else if (m.includes('tall') || m.includes('tower')) { w = 5; h = 15; d = 5; }
      else if (m.includes('big')) { w = 8; h = 14; d = 8; }
      else if (m.includes('building') || m.includes('corner')) { w = 6; h = 10; d = 6; }
      else if (m.includes('pizza') || m.includes('shop') || m.includes('store')) { w = 5; h = 6; d = 5; }
      else if (m.includes('car') || m.includes('suv')) { w = 4; h = 1.5; d = 2; }
      else if (m.includes('bus') || m.includes('truck')) { w = 8; h = 3; d = 2.5; }
      else if (m.includes('van')) { w = 5; h = 2.5; d = 2.2; }
      else if (m.includes('motorcycle')) { w = 2; h = 1.2; d = 0.8; }
      else if (m.includes('police')) { w = 4.5; h = 1.6; d = 2.2; }
      else if (m.includes('lamp') || m.includes('light')) { w = 0.3; h = 5; d = 0.3; }
      else if (m.includes('tree')) { w = 2; h = 5; d = 2; }
      else if (m.includes('fence')) { w = 4; h = 1.5; d = 0.2; }
    }
    const size = new Vec3(w * scale, h * scale, d * scale);
    const center = new Vec3(config.x, config.y || h * scale / 2, config.z);
    return { size, center, aabb: new AABB(new Vec3(center.x - size.x / 2, center.y - size.y / 2, center.z - size.z / 2), new Vec3(center.x + size.x / 2, center.y + size.y / 2, center.z + size.z / 2)) };
  }

  _boundsFromGeometry(positions, scale, rotY, tx, ty, tz) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const min = new Vec3(Infinity, Infinity, Infinity);
    const max = new Vec3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < positions.length; i += 3) {
      const lx = positions[i] * scale;
      const ly = positions[i + 1] * scale;
      const lz = positions[i + 2] * scale;
      const x = lx * c - lz * s + tx;
      const y = ly + ty;
      const z = lx * s + lz * c + tz;
      min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
    }
    const size = new Vec3(max.x - min.x, max.y - min.y, max.z - min.z);
    const center = new Vec3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    return { size, center, aabb: new AABB(min, max) };
  }

  _getModelColor(modelName) {
    if (!modelName) return [0.4, 0.4, 0.5];
    const m = modelName.toLowerCase();
    if (m.includes('car') || m.includes('suv') || m.includes('police')) return [0.3, 0.3, 0.6];
    if (m.includes('bus')) return [0.8, 0.7, 0.2];
    if (m.includes('truck') || m.includes('van')) return [0.5, 0.5, 0.5];
    if (m.includes('building') || m.includes('corner')) return [0.35, 0.35, 0.45];
    if (m.includes('tree')) return [0.2, 0.4, 0.15];
    if (m.includes('lamp')) return [0.2, 0.2, 0.2];
    if (m.includes('fence')) return [0.3, 0.3, 0.3];
    return [0.4, 0.4, 0.5];
  }

  update(delta) {}

  findSafeSpawn(preferredX = 0, preferredZ = 0, radius = 80) {
    const playerRadius = 0.5;
    for (let attempt = 0; attempt < 100; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius;
      const x = preferredX + Math.cos(angle) * dist;
      const z = preferredZ + Math.sin(angle) * dist;
      if (!this.checkCollision(x, z, playerRadius + 1)) return new Vec3(x, this.playerHeightSafe(), z);
    }
    for (let r = 5; r <= radius; r += 5) {
      for (let a = 0; a < Math.PI * 2; a += 0.3) {
        const x = preferredX + Math.cos(a) * r;
        const z = preferredZ + Math.sin(a) * r;
        if (!this.checkCollision(x, z, playerRadius + 1)) return new Vec3(x, this.playerHeightSafe(), z);
      }
    }
    return new Vec3(0, 1.7, 0);
  }

  playerHeightSafe() { return 1.7; }

  pushOutOfWalls(x, z, radius) {
    let px = x, pz = z;
    for (let iter = 0; iter < 4; iter++) {
      let stuck = false;
      for (const c of this.collidables) {
        if (c.name === 'ground') continue;
        const aabb = c.aabb;
        const closestX = Math.max(aabb.min.x, Math.min(px, aabb.max.x));
        const closestZ = Math.max(aabb.min.z, Math.min(pz, aabb.max.z));
        const dx = px - closestX;
        const dz = pz - closestZ;
        const distSq = dx * dx + dz * dz;
        if (distSq < radius * radius) {
          const dist = Math.sqrt(distSq);
          if (dist > 0.001) {
            const push = (radius - dist) / dist;
            px += dx * push;
            pz += dz * push;
          } else {
            const cx = (aabb.min.x + aabb.max.x) * 0.5;
            const cz = (aabb.min.z + aabb.max.z) * 0.5;
            const dirX = px - cx;
            const dirZ = pz - cz;
            const dl = Math.hypot(dirX, dirZ);
            if (dl > 0.001) {
              px += dirX / dl * radius;
              pz += dirZ / dl * radius;
            } else {
              px += radius;
            }
          }
          stuck = true;
        }
      }
      if (!stuck) break;
    }
    return { x: px, z: pz };
  }

  getGroundHeight(x, z) {
    for (const c of this.collidables) {
      if (c.name === 'ground') continue;
      if (c.name.startsWith('obstacle_')) {
        if (x >= c.aabb.min.x && x <= c.aabb.max.x && z >= c.aabb.min.z && z <= c.aabb.max.z) {
          return c.aabb.max.y;
        }
      }
    }
    return 0;
  }

  checkCollision(x, z, radius) {
    for (const c of this.collidables) {
      if (c.name === 'ground') continue;
      if (c.aabb.intersectsCircleXZ(x, z, radius)) return true;
    }
    return false;
  }

  checkCollisionAABB(aabb) {
    for (const c of this.collidables) {
      if (c.name === 'ground') continue;
      if (c.aabb.intersectsAABB(aabb)) return true;
    }
    return false;
  }

  checkCollision3D(x, y, z, radius, height) {
    const entityAABB = new AABB(
      new Vec3(x - radius, y, z - radius),
      new Vec3(x + radius, y + height, z + radius));
    for (const c of this.collidables) {
      if (c.name === 'ground') continue;
      if (c.aabb.intersectsAABB(entityAABB)) return true;
    }
    return false;
  }

  generateVoxelColliders(positions, indices, scale, rotY, tx, ty, tz, modelName) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const cellSize = 1.5;
    const cells = new Map();

    for (let i = 0; i < positions.length; i += 3) {
      const lx = positions[i] * scale;
      const ly = positions[i + 1] * scale;
      const lz = positions[i + 2] * scale;
      const wx = lx * c - lz * s + tx;
      const wy = ly + ty;
      const wz = lx * s + lz * c + tz;
      const cx = Math.floor(wx / cellSize);
      const cy = Math.floor(wy / cellSize);
      const cz = Math.floor(wz / cellSize);
      const key = `${cx},${cy},${cz}`;
      if (!cells.has(key)) {
        cells.set(key, { min: new Vec3(wx, wy, wz), max: new Vec3(wx, wy, wz) });
      }
      const cell = cells.get(key);
      cell.min.x = Math.min(cell.min.x, wx);
      cell.min.y = Math.min(cell.min.y, wy);
      cell.min.z = Math.min(cell.min.z, wz);
      cell.max.x = Math.max(cell.max.x, wx);
      cell.max.y = Math.max(cell.max.y, wy);
      cell.max.z = Math.max(cell.max.z, wz);
    }

    const colliders = [];
    for (const [key, cell] of cells) {
      const padding = 0.05;
      const aabb = new AABB(
        new Vec3(cell.min.x - padding, cell.min.y - padding, cell.min.z - padding),
        new Vec3(cell.max.x + padding, cell.max.y + padding, cell.max.z + padding));
      this.collidables.push({ name: `voxel_${modelName}_${key}`, aabb, modelName });
      colliders.push(aabb);
    }
    return colliders;
  }

  checkLineOfSight(from, to) {
    const dir = Vec3.sub(to, from);
    const dist = dir.length();
    dir.normalize();
    for (const c of this.collidables) {
      if (c.name === 'ground') continue;
      if (this._rayAABB(from, dir, c.aabb, dist)) return false;
    }
    return true;
  }

  _rayAABB(origin, dir, aabb, maxDist) {
    let tmin = 0, tmax = maxDist;
    for (const axis of ['x', 'y', 'z']) {
      if (Math.abs(dir[axis]) < 1e-8) {
        if (origin[axis] < aabb.min[axis] || origin[axis] > aabb.max[axis]) return false;
      } else {
        let t1 = (aabb.min[axis] - origin[axis]) / dir[axis];
        let t2 = (aabb.max[axis] - origin[axis]) / dir[axis];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return false;
      }
    }
    return true;
  }

  raycast(origin, dir, maxDist = 1000) {
    let closest = null;
    let closestDist = maxDist;

    for (const c of this.collidables) {
      if (c.name === 'ground') continue;
      const hit = this._rayAABBHit(origin, dir, c.aabb, closestDist);
      if (hit && hit < closestDist) {
        closestDist = hit;
        closest = { distance: hit, type: 'world', obstacle: c };
      }
    }
    return closest;
  }

  _rayAABBHit(origin, dir, aabb, maxDist) {
    let tmin = 0, tmax = maxDist;
    for (const axis of ['x', 'y', 'z']) {
      if (Math.abs(dir[axis]) < 1e-8) {
        if (origin[axis] < aabb.min[axis] || origin[axis] > aabb.max[axis]) return null;
      } else {
        let t1 = (aabb.min[axis] - origin[axis]) / dir[axis];
        let t2 = (aabb.max[axis] - origin[axis]) / dir[axis];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }
}
