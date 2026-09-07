import { Vec3, AABB } from './math.js';
import { loadGLBWithNodes } from './gltf-loader.js';

export class Vehicle {
  constructor(game, position, modelFile, scale = 1, yaw = 0) {
    this.game = game;
    this.position = position.clone();
    this.yaw = yaw;
    this.speed = 0;
    this.angularVelocity = 0;
    this.velocity = new Vec3(0, 0, 0);
    this.steerAngle = 0;
    this.steerInput = 0;
    this.throttleInput = 0;
    this.modelFile = modelFile;
    this.modelScale = scale;
    this.occupied = false;
    this.parts = [];
    this.wheelNodes = [];
    this.frontWheels = [];
    this.rearWheels = [];
    this.wheelSpin = 0;
    this.health = 200;
    this.maxHealth = 200;
    this.destroyed = false;
    this.loaded = false;
    this.forwardAxis = 2;
    this.bounds = null;
    this.roadkillStreak = 0;
    this.roadkillTimer = 0;
    this.ROADKILL_WINDOW = 2.8;
    this._smokeTimer = 0;
    this._roadkillBannerTimer = 0;
  }

  static STATS = {
    'Car.glb': { maxSpeed: 60, acceleration: 15, brakeForce: 25, steerSpeed: 3.5, maxSteer: 0.42, friction: 3, lateralGrip: 14, mass: 1200 },
    'Car-unqqkULtRU.glb': { maxSpeed: 60, acceleration: 15, brakeForce: 25, steerSpeed: 3.5, maxSteer: 0.42, friction: 3, lateralGrip: 14, mass: 1200 },
    'SUV.glb': { maxSpeed: 50, acceleration: 12, brakeForce: 22, steerSpeed: 3.0, maxSteer: 0.38, friction: 2.8, lateralGrip: 13, mass: 1800 },
    'Sports Car.glb': { maxSpeed: 84, acceleration: 22, brakeForce: 30, steerSpeed: 4.0, maxSteer: 0.48, friction: 3.5, lateralGrip: 16, mass: 900 },
    'Sports Car-Gzj704DXdr.glb': { maxSpeed: 84, acceleration: 22, brakeForce: 30, steerSpeed: 4.0, maxSteer: 0.48, friction: 3.5, lateralGrip: 16, mass: 900 },
    'Police Car.glb': { maxSpeed: 70, acceleration: 18, brakeForce: 27, steerSpeed: 3.5, maxSteer: 0.42, friction: 3, lateralGrip: 14, mass: 1100 },
    'Pickup Truck.glb': { maxSpeed: 44, acceleration: 10, brakeForce: 18, steerSpeed: 2.5, maxSteer: 0.35, friction: 2.5, lateralGrip: 12, mass: 2500 },
    'Bus.glb': { maxSpeed: 36, acceleration: 8, brakeForce: 15, steerSpeed: 2.0, maxSteer: 0.3, friction: 2.2, lateralGrip: 11, mass: 4000 },
    'Motorcycle.glb': { maxSpeed: 70, acceleration: 20, brakeForce: 28, steerSpeed: 4.5, maxSteer: 0.55, friction: 3, lateralGrip: 10, mass: 200 },
  };

  _stats() {
    return Vehicle.STATS[this.modelFile] || Vehicle.STATS['Car.glb'];
  }

  async init() {
    await this._loadModel();
  }

  async _loadModel() {
    const urls = this._modelUrls();
    let lastError = null;
    for (const url of urls) {
      try {
        const { nodes } = await loadGLBWithNodes(url);
        this._processNodes(nodes, url);
        this.loaded = true;
        return;
      } catch (err) {
        lastError = err;
      }
    }
    console.warn(`Vehicle: Failed to load ${this.modelFile}, using fallback:`, lastError);
    this._createFallbackMesh();
    this.loaded = true;
  }

  _modelUrls() {
    const encoded = this.modelFile.split('/').map(encodeURIComponent).join('/');
    return [`assets/CityPack/${encoded}`, `3dfps-main/assets/CityPack/${encoded}`];
  }

  _processNodes(nodes, url) {
    let allMin = [Infinity, Infinity, Infinity];
    let allMax = [-Infinity, -Infinity, -Infinity];

    for (const node of nodes) {
      if (!node.meshes) continue;
      for (const sub of node.meshes) {
        for (let i = 0; i < 3; i++) {
          allMin[i] = Math.min(allMin[i], sub.bounds[['minX', 'minY', 'minZ'][i]]);
          allMax[i] = Math.max(allMax[i], sub.bounds[['maxX', 'maxY', 'maxZ'][i]]);
        }
      }
    }

    const modelCenterX = (allMin[0] + allMax[0]) * 0.5;
    const modelCenterY = allMin[1];
    const modelCenterZ = (allMin[2] + allMax[2]) * 0.5;

    const sizeX = (allMax[0] - allMin[0]) * this.modelScale;
    const sizeY = (allMax[1] - allMin[1]) * this.modelScale;
    const sizeZ = (allMax[2] - allMin[2]) * this.modelScale;

    this.length = Math.max(sizeX, sizeZ);
    this.width = Math.min(sizeX, sizeZ);
    this.height = sizeY;

    if (sizeX > sizeZ) {
      this.forwardAxis = 0;
    } else {
      this.forwardAxis = 2;
    }
    this.modelYawOffset = 0;

    this._modelOffset = new Vec3(
      -modelCenterX * this.modelScale,
      -modelCenterY * this.modelScale,
      -modelCenterZ * this.modelScale,
    );

    for (const node of nodes) {
      if (!node.meshes) continue;
      const isWheel = this._isWheelNode(node.name);
      const nodeIndex = nodes.indexOf(node);

      for (let subIndex = 0; subIndex < node.meshes.length; subIndex++) {
        const sub = node.meshes[subIndex];
        // Unique name per primitive — shared names made rim overwrite tire (or vice versa).
        const geoName = `vehicle:${this.modelFile}:${nodeIndex}:${subIndex}`;
        let recenteredPos;
        let partCenterX, partCenterY, partCenterZ;

        if (isWheel) {
          partCenterX = (sub.bounds.minX + sub.bounds.maxX) * 0.5;
          partCenterY = (sub.bounds.minY + sub.bounds.maxY) * 0.5;
          partCenterZ = (sub.bounds.minZ + sub.bounds.maxZ) * 0.5;
          recenteredPos = new Float32Array(sub.positions.length);
          for (let i = 0; i < sub.positions.length; i += 3) {
            recenteredPos[i] = sub.positions[i] - partCenterX;
            recenteredPos[i + 1] = sub.positions[i + 1] - partCenterY;
            recenteredPos[i + 2] = sub.positions[i + 2] - partCenterZ;
          }
        } else {
          recenteredPos = new Float32Array(sub.positions.length);
          for (let i = 0; i < sub.positions.length; i += 3) {
            recenteredPos[i] = sub.positions[i] - modelCenterX;
            recenteredPos[i + 1] = sub.positions[i + 1] - modelCenterY;
            recenteredPos[i + 2] = sub.positions[i + 2] - modelCenterZ;
          }
        }

        const geo = { positions: recenteredPos, normals: sub.normals, colors: sub.colors, indices: sub.indices };
        this.game.renderer.registerGeometry(geoName, geo);

        const obj = this.game.renderer.addObject(geoName,
          new Vec3(this.position.x, this.position.y, this.position.z),
          new Vec3(this.modelScale, this.modelScale, this.modelScale),
          this.yaw + this.modelYawOffset, [1, 1, 1], [0, 0, 0], 1);

        if (isWheel) {
          const wheelOffsetX = (partCenterX - modelCenterX) * this.modelScale;
          const wheelOffsetZ = (partCenterZ - modelCenterZ) * this.modelScale;
          const isFront = this._isFrontWheel(node.name, wheelOffsetX, wheelOffsetZ);
          const wheel = {
            obj,
            offsetX: wheelOffsetX,
            offsetY: (partCenterY - modelCenterY) * this.modelScale,
            offsetZ: wheelOffsetZ,
            isFront,
          };
          this.wheelNodes.push(wheel);
          if (isFront) this.frontWheels.push(wheel);
          else this.rearWheels.push(wheel);
        } else {
          this.parts.push({ obj });
        }
      }
    }

    this._resolveModelYawOffset();
    this.wheelBase = Math.max(this.length * 0.62, 2.4);
    this._syncParts();
  }

  _isFrontWheel(name, offsetX, offsetZ) {
    const lower = (name || '').toLowerCase();
    if (lower.includes('front')) return true;
    if (lower.includes('back') || lower.includes('rear')) return false;
    if (this.forwardAxis === 0) return offsetX > 0;
    return offsetZ > 0;
  }

  _resolveModelYawOffset() {
    if (this.frontWheels.length === 0) {
      this.modelYawOffset = 0;
      return;
    }
    let frontSum = 0;
    let rearSum = 0;
    for (const w of this.frontWheels) frontSum += this.forwardAxis === 0 ? w.offsetX : w.offsetZ;
    for (const w of this.rearWheels) rearSum += this.forwardAxis === 0 ? w.offsetX : w.offsetZ;
    const frontAvg = frontSum / this.frontWheels.length;
    const rearAvg = this.rearWheels.length ? rearSum / this.rearWheels.length : 0;
    // Mesh render uses rotationY(-yaw), which flips the X axis of the model.
    // So the model's nose in world space is the negative of the raw front-wheel offset.
    const noseAlongForward = this.forwardAxis === 0 ? -frontAvg : frontAvg;
    this.modelYawOffset = noseAlongForward >= 0 ? 0 : Math.PI;
  }

  _isWheelNode(name) {
    if (!name) return false;
    const lower = name.toLowerCase();
    return lower.includes('wheel') || lower.includes('tire') || lower.includes('tyre') || lower.includes('rim');
  }

  _createFallbackMesh() {
    const geoName = 'box';
    const obj = this.game.renderer.addObject(geoName,
      new Vec3(this.position.x, this.position.y + 0.5, this.position.z),
      new Vec3(1.8, 1.0, 4.2), this.yaw, [0.15, 0.3, 0.5], [0, 0, 0], 1);
    this.parts.push({ obj, isWheel: false });
    this.length = 4.2;
    this.width = 1.8;
    this.height = 1.0;
    this.forwardAxis = 2;
    this.modelYawOffset = 0;
    this.wheelBase = 2.6;
    this._modelOffset = new Vec3(0, 0, 0);
    this._syncParts();
  }

  _healthFrac() {
    return Math.max(0, this.health / this.maxHealth);
  }

  /** Handling falls off as the car takes damage. */
  _conditionMults() {
    const h = this._healthFrac();
    return {
      speed: 0.45 + h * 0.55,
      accel: 0.4 + h * 0.6,
      steer: 0.55 + h * 0.45,
      grip: 0.5 + h * 0.5,
    };
  }

  update(delta, input) {
    if (this.destroyed || !this.loaded) return;

    const stats = this._stats();
    const cond = this._conditionMults();
    const wheelBase = this.wheelBase || Math.max((this.length || 4.2) * 0.62, 2.4);

    if (this.roadkillTimer > 0) {
      this.roadkillTimer -= delta;
      if (this.roadkillTimer <= 0) this.roadkillStreak = 0;
    }
    if (this._roadkillBannerTimer > 0) {
      this._roadkillBannerTimer -= delta;
      if (this._roadkillBannerTimer <= 0) {
        document.getElementById('roadkill-banner')?.classList.remove('show');
      }
    }

    if (this.occupied && input) {
      this.throttleInput = 0;
      if (input.moveForward) this.throttleInput = 1;
      if (input.moveBackward) this.throttleInput = -1;

      this.steerInput = 0;
      if (input.moveLeft) this.steerInput = -1;
      if (input.moveRight) this.steerInput = 1;
    } else {
      this.throttleInput = 0;
      this.steerInput = 0;
    }

    const steerTarget = this.steerInput * stats.maxSteer * cond.steer;
    const steerLerp = 1 - Math.exp(-(stats.steerSpeed * cond.steer) * delta);
    this.steerAngle += (steerTarget - this.steerAngle) * steerLerp;

    const fwd = this._getForward();
    const right = new Vec3(fwd.z, 0, -fwd.x);
    let vForward = this.velocity.x * fwd.x + this.velocity.z * fwd.z;
    let vLateral = this.velocity.x * right.x + this.velocity.z * right.z;

    const maxSpeed = stats.maxSpeed * cond.speed;
    let accel = 0;
    if (this.throttleInput > 0) {
      accel = this.throttleInput * stats.acceleration * cond.accel;
    } else if (this.throttleInput < 0) {
      if (vForward > 0.5) accel = this.throttleInput * stats.brakeForce * (0.7 + cond.accel * 0.3);
      else accel = this.throttleInput * stats.acceleration * cond.accel * 0.55;
    }
    accel -= vForward * stats.friction * 0.35;
    vForward += accel * delta;
    vForward = Math.max(-maxSpeed * 0.35, Math.min(maxSpeed, vForward));
    this.speed = vForward;

    const grip = 1 - Math.exp(-((stats.lateralGrip || 14) * cond.grip) * delta);
    vLateral *= 1 - grip;

    const speedAbs = Math.abs(vForward);
    if (speedAbs > 0.35) {
      const speedSteerScale = 1 / (1 + speedAbs * 0.045);
      const steer = this.steerAngle * speedSteerScale;
      // Render uses rotationY(-yaw), so a positive physics yaw turns the car the other way on screen.
      const yawRate = -(Math.sign(vForward) * speedAbs * Math.tan(steer)) / wheelBase;
      this.yaw += yawRate * delta;
    } else if (this.throttleInput !== 0 && Math.abs(this.steerAngle) > 0.05) {
      this.yaw -= this.steerAngle * 1.4 * this.throttleInput * delta;
    }

    const newFwd = this._getForward();
    const newRight = new Vec3(newFwd.z, 0, -newFwd.x);
    this.velocity.x = newFwd.x * vForward + newRight.x * vLateral;
    this.velocity.z = newFwd.z * vForward + newRight.z * vLateral;

    const oldX = this.position.x, oldZ = this.position.z;
    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.z * delta;

    if (this.game.world.checkCollision(this.position.x, this.position.z, this.width * 0.5)) {
      this.position.x = oldX;
      this.position.z = oldZ;
      const preImpact = Math.hypot(this.velocity.x, this.velocity.z);
      this.velocity.x *= 0.25;
      this.velocity.z *= 0.25;
      if (preImpact > 8) this._takeDamage(preImpact * 0.55);
    }

    this._resolveVehicleCollisions(oldX, oldZ);

    this.wheelSpin += vForward * delta * 2.5;

    this._checkRunover();
    this._updateDamageFx(delta);
    this._syncParts();

    if (this.occupied) {
      this._updateVehicleCamera(delta);
      this._updateVehicleHud();
      const am = this.game.audioManager;
      if (am?.updateEngine) {
        const speed = Math.hypot(this.velocity.x, this.velocity.z);
        am.updateEngine(speed, maxSpeed);
      }
    }
  }

  _collisionRadius() {
    const w = this.width || 1.8;
    const l = this.length || 4.2;
    return Math.max(w * 0.55, l * 0.3);
  }

  _mass() {
    return this._stats().mass || 1200;
  }

  _resolveVehicleCollisions(oldX, oldZ) {
    const others = this.game.vehicleManager?.vehicles;
    if (!others || others.length === 0) return;

    const restitution = 0.55;
    const frictionMix = 0.15;

    for (const other of others) {
      if (other === this || other.destroyed || !other.loaded) continue;
      // Resolve each pair once.
      if (others.indexOf(other) <= others.indexOf(this)) continue;

      let dx = this.position.x - other.position.x;
      let dz = this.position.z - other.position.z;
      let distSq = dx * dx + dz * dz;
      const minDist = this._collisionRadius() + other._collisionRadius();
      if (distSq >= minDist * minDist) continue;

      if (distSq < 1e-6) {
        dx = (Math.random() - 0.5) || 0.01;
        dz = (Math.random() - 0.5) || 0.01;
        distSq = dx * dx + dz * dz;
      }

      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = minDist - dist;

      const m1 = this._mass();
      const m2 = other._mass();
      const inv1 = 1 / m1;
      const inv2 = 1 / m2;
      const invSum = inv1 + inv2;

      // Positional correction (mass-weighted).
      const corr = (overlap / invSum) * 0.85;
      this.position.x += nx * corr * inv1;
      this.position.z += nz * corr * inv1;
      other.position.x -= nx * corr * inv2;
      other.position.z -= nz * corr * inv2;

      // Relative velocity along contact normal.
      const rvx = this.velocity.x - other.velocity.x;
      const rvz = this.velocity.z - other.velocity.z;
      const velAlongNormal = rvx * nx + rvz * nz;
      if (velAlongNormal > 0) {
        other._syncParts();
        continue; // already separating
      }

      // Bounce impulse.
      const j = -(1 + restitution) * velAlongNormal / invSum;
      const ix = j * nx;
      const iz = j * nz;
      this.velocity.x += ix * inv1;
      this.velocity.z += iz * inv1;
      other.velocity.x -= ix * inv2;
      other.velocity.z -= iz * inv2;

      // Light tangential friction so they don't stick sliding forever.
      const tx = rvx - velAlongNormal * nx;
      const tz = rvz - velAlongNormal * nz;
      const tLen = Math.hypot(tx, tz);
      if (tLen > 1e-4) {
        const jt = Math.min(j * frictionMix, tLen / invSum);
        const tnx = tx / tLen;
        const tnz = tz / tLen;
        this.velocity.x -= tnx * jt * inv1;
        this.velocity.z -= tnz * jt * inv1;
        other.velocity.x += tnx * jt * inv2;
        other.velocity.z += tnz * jt * inv2;
      }

      const impact = Math.abs(velAlongNormal);
      if (impact > 5) {
        this._takeDamage(impact * 0.25);
        other._takeDamage(impact * 0.25);
        this.game.audioManager?.playCarThud?.(impact / 12);
      }
      other._syncParts();
    }

    this._resolvePlayerCollision();

    if (this.game.world.checkCollision(this.position.x, this.position.z, this.width * 0.5)) {
      this.position.x = oldX;
      this.position.z = oldZ;
      this.velocity.x *= 0.35;
      this.velocity.z *= 0.35;
    }
  }

  _resolvePlayerCollision() {
    const player = this.game.player;
    if (!player || player.isInVehicle || player.isDead || player.isDying || player.ghostMode) return;

    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const distSq = dx * dx + dz * dz;
    const minDist = this._collisionRadius() + (player.playerRadius || 0.4) + 0.15;
    if (distSq >= minDist * minDist) return;

    if (distSq < 1e-6) {
      player.position.x += minDist;
      return;
    }

    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const nz = dz / dist;
    const overlap = minDist - dist;

    player.position.x += nx * overlap;
    player.position.z += nz * overlap;

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const mCar = this._mass();
    const mPlayer = 80;
    const invSum = 1 / mCar + 1 / mPlayer;
    const rvn = this.velocity.x * nx + this.velocity.z * nz;
    if (rvn > 0.5) {
      const j = -1.15 * rvn / invSum;
      this.velocity.x += (j * nx) / mCar;
      this.velocity.z += (j * nz) / mCar;
      player.position.x += nx * Math.min(0.6, speed * 0.04);
      player.position.z += nz * Math.min(0.6, speed * 0.04);
      if (speed > 10) player.takeDamage(Math.min(35, speed * 1.2));
    }
  }

  _getChaseForward() {
    return this._getForward();
  }

  _updateVehicleCamera(_delta) {
    const cam = this.game.camera;
    const len = this.length || 4.2;
    const h = this.height || 1.2;
    const forward = this._getForward();
    const followDist = Math.max(len * 1.45, 8);
    const followHeight = Math.max(h * 1.35, 3.2) + 1.2;
    const lookAhead = Math.max(len * 0.85, 4);

    const eye = new Vec3(
      this.position.x - forward.x * followDist,
      this.position.y + followHeight,
      this.position.z - forward.z * followDist
    );
    const lookTarget = new Vec3(
      this.position.x + forward.x * lookAhead,
      this.position.y + Math.max(h * 0.55, 1.0),
      this.position.z + forward.z * lookAhead
    );

    this._chaseEye = eye;
    cam.setLookAt(eye, lookTarget);

    this.game.player.position.set(this.position.x, this.position.y + 1.0, this.position.z);
    this.game.player.yaw = this.yaw;
    this.game.player.pitch = cam.pitch;
  }

  _getForward() {
    // Matches player/camera yaw: +Z at yaw 0, +X at yaw π/2.
    // Mesh render uses rotationY(-yaw) so the body faces this same vector.
    return new Vec3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  _checkRunover() {
    const speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2);
    if (speed < 5) return;
    const enemies = this.game.enemyManager.enemies;
    const fwd = this._getForward();
    for (const enemy of enemies) {
      if (enemy.state === 'dead' || enemy.state === 'ragdoll') continue;
      const dist = enemy.position.distanceTo(this.position);
      if (dist < this.length * 0.7) {
        const toEnemy = Vec3.sub(enemy.position, this.position);
        toEnemy.y = 0;
        toEnemy.normalize();
        const dot = fwd.dot(toEnemy);
        if (dot > 0.3 || dist < this.width * 0.6) {
          const impactVel = new Vec3(this.velocity.x * 0.8, 8 + speed * 0.3, this.velocity.z * 0.8);
          enemy.ragdoll(impactVel);
          this.velocity.x *= 0.92;
          this.velocity.z *= 0.92;
          this.game.audioManager?.playZombieThud?.(speed / 14);

          const bloodPos = enemy.position.clone();
          bloodPos.y = Math.max(0.4, bloodPos.y);
          this.game.particleSystem?.emitBlood?.(bloodPos, fwd, 14 + Math.floor(speed * 0.4));
          this.game.particleSystem?.emit?.(bloodPos, 6, [0.45, 0.02, 0.02]);

          this.roadkillStreak++;
          this.roadkillTimer = this.ROADKILL_WINDOW;
          this._showRoadkill(this.roadkillStreak);
          this._takeDamage(1.2 + speed * 0.06);

          if (this.roadkillStreak >= 3 && Math.random() < 0.4) {
            this.game.lootManager?.spawnLoot?.(enemy.position.clone(), 'coin');
          }
          if (this.roadkillStreak >= 5 && Math.random() < 0.28) {
            this.game.lootManager?.spawnLoot?.(enemy.position.clone(), 'potion');
          }
        }
      }
    }
  }

  _showRoadkill(n) {
    const banner = document.getElementById('roadkill-banner');
    const textEl = document.getElementById('roadkill-text');
    const multEl = document.getElementById('roadkill-mult');
    if (!banner || !textEl) return;

    let label = 'ROADKILL';
    if (n === 2) label = 'DOUBLE ROADKILL';
    else if (n === 3) label = 'TRIPLE ROADKILL';
    else if (n === 4) label = 'QUAD ROADKILL';
    else if (n >= 5) label = 'ROADKILL RAMPAGE';

    textEl.textContent = label;
    if (multEl) multEl.textContent = n >= 2 ? `x${n} STREAK` : '';
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    this._roadkillBannerTimer = 1.35;
  }

  _updateDamageFx(delta) {
    const h = this._healthFrac();
    if (h >= 0.55) return;

    this._smokeTimer -= delta;
    if (this._smokeTimer > 0) return;
    this._smokeTimer = h < 0.3 ? 0.12 : 0.22;

    const hood = this.position.clone();
    hood.y += (this.height || 1.4) * 0.55;
    const fwd = this._getForward();
    hood.x += fwd.x * (this.length || 4) * 0.15;
    hood.z += fwd.z * (this.length || 4) * 0.15;

    if (h < 0.3) {
      this.game.particleSystem?.emit?.(hood, 4, [0.55, 0.22, 0.05]);
      this.game.particleSystem?.emit?.(hood, 3, [0.25, 0.25, 0.25]);
    } else {
      this.game.particleSystem?.emit?.(hood, 3, [0.35, 0.35, 0.38]);
    }
  }

  _updateVehicleHud() {
    const fill = document.getElementById('vehicle-health-fill');
    const integrity = document.getElementById('vehicle-integrity');
    const hud = document.getElementById('vehicle-hud');
    const frac = this._healthFrac();
    const pct = Math.round(frac * 100);
    if (fill) {
      fill.style.transform = `scaleX(${frac})`;
      if (frac < 0.3) fill.style.background = 'linear-gradient(90deg, #f30, #f80)';
      else if (frac < 0.55) fill.style.background = 'linear-gradient(90deg, #fa0, #fc4)';
      else fill.style.background = 'linear-gradient(90deg, #0f8, #0cf)';
    }
    if (integrity) {
      integrity.textContent = frac < 0.3 ? `CRITICAL ${pct}%` : `Integrity ${pct}%`;
      integrity.style.color = frac < 0.3 ? '#f66' : frac < 0.55 ? '#fc4' : '#8cf';
    }
    if (hud) {
      hud.classList.toggle('critical', frac < 0.3);
      hud.classList.toggle('damaged', frac >= 0.3 && frac < 0.55);
    }
  }

  _syncParts() {
    // Mat4.rotationY(θ) maps local +Z → (-sin θ, 0, cos θ).
    // Drive/camera forward is (sin yaw, 0, cos yaw), so the mesh must use θ = -yaw.
    const renderYaw = -(this.yaw + (this.modelYawOffset || 0));
    const steerVis = this.steerAngle;

    for (const p of this.parts) {
      p.obj.position.set(this.position.x, this.position.y, this.position.z);
      p.obj.rotationY = renderYaw;
      this.game.renderer.updateObjectTransform(p.obj);
    }

    const cosT = Math.cos(renderYaw), sinT = Math.sin(renderYaw);
    for (const w of this.wheelNodes) {
      const rx = w.offsetX * cosT - w.offsetZ * sinT;
      const rz = w.offsetX * sinT + w.offsetZ * cosT;
      w.obj.position.set(
        this.position.x + rx,
        this.position.y + w.offsetY,
        this.position.z + rz);
      // Front wheels steer opposite the body yaw because of the render X-flip.
      w.obj.rotationY = renderYaw - (w.isFront ? steerVis : 0);
      w.obj.rotationX = this.wheelSpin;
      this.game.renderer.updateObjectTransform(w.obj);
    }
  }

  _takeDamage(amount) {
    if (this.destroyed || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    if (this.occupied) this._updateVehicleHud();
    if (this.health <= 0 && !this.destroyed) this._destroy();
  }

  _destroy() {
    this.destroyed = true;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.roadkillStreak = 0;

    const blast = this.position.clone();
    blast.y += (this.height || 1.4) * 0.4;
    this.game.particleSystem?.emit?.(blast, 28, [1.0, 0.35, 0.05]);
    this.game.particleSystem?.emit?.(blast, 18, [0.25, 0.25, 0.28]);
    this.game.particleSystem?.emit?.(blast, 12, [0.9, 0.15, 0.02]);
    this.game.audioManager?.playCarThud?.(1.4);
    this.game.audioManager?.playZombieThud?.(1.2);

    for (const p of this.parts) {
      p.obj.color = [0.1, 0.05, 0.03];
      p.obj.emissive = [0.3, 0.1, 0.02];
      this.game.renderer.updateObjectTransform(p.obj);
    }
    for (const w of this.wheelNodes) {
      w.obj.color = [0.1, 0.05, 0.03];
      this.game.renderer.updateObjectTransform(w.obj);
    }
    if (this.occupied) this.game.player.exitVehicle();
    this.game.audioManager?.stopEngine?.();
    document.getElementById('roadkill-banner')?.classList.remove('show');
  }

  getAABB() {
    const halfW = this.width * 0.5, halfL = this.length * 0.5;
    return new AABB(
      new Vec3(this.position.x - halfW, 0, this.position.z - halfL),
      new Vec3(this.position.x + halfW, this.height, this.position.z + halfL));
  }

  canEnter(playerPos) {
    if (this.destroyed || this.occupied || !this.loaded) return false;
    return this.position.distanceTo(playerPos) < 3.5;
  }

  enter(player) {
    this.occupied = true;
    player.isInVehicle = true;
    player.vehicle = this;
    player.yaw = this.yaw;
    player.pitch = -0.2;
    if (player.weaponObj) player.weaponObj.visible = false;
    this._chaseEye = null;
    this._updateVehicleCamera(0);
    this.game.audioManager?.startEngine?.();
  }

  exit(player) {
    this.occupied = false;
    this._chaseEye = null;
    player.isInVehicle = false;
    player.vehicle = null;
    this.game.audioManager?.stopEngine?.();
    const fwd = this._getForward();
    const right = new Vec3(fwd.z, 0, -fwd.x);
    player.position.set(
      this.position.x + right.x * (this.width * 0.5 + 1),
      this.position.y + 1.0,
      this.position.z + right.z * (this.width * 0.5 + 1));
    if (player.weaponObj) player.weaponObj.visible = true;
  }

  dispose() {
    for (const p of this.parts) this.game.renderer.removeObject(p.obj);
    for (const w of this.wheelNodes) this.game.renderer.removeObject(w.obj);
  }
}
