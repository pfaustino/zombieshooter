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
  }

  static STATS = {
    'Car.glb': { maxSpeed: 30, acceleration: 15, brakeForce: 25, steerSpeed: 3.5, maxSteer: 0.42, friction: 3, lateralGrip: 14, mass: 1200 },
    'Car-unqqkULtRU.glb': { maxSpeed: 30, acceleration: 15, brakeForce: 25, steerSpeed: 3.5, maxSteer: 0.42, friction: 3, lateralGrip: 14, mass: 1200 },
    'SUV.glb': { maxSpeed: 25, acceleration: 12, brakeForce: 22, steerSpeed: 3.0, maxSteer: 0.38, friction: 2.8, lateralGrip: 13, mass: 1800 },
    'Sports Car.glb': { maxSpeed: 42, acceleration: 22, brakeForce: 30, steerSpeed: 4.0, maxSteer: 0.48, friction: 3.5, lateralGrip: 16, mass: 900 },
    'Sports Car-Gzj704DXdr.glb': { maxSpeed: 42, acceleration: 22, brakeForce: 30, steerSpeed: 4.0, maxSteer: 0.48, friction: 3.5, lateralGrip: 16, mass: 900 },
    'Police Car.glb': { maxSpeed: 35, acceleration: 18, brakeForce: 27, steerSpeed: 3.5, maxSteer: 0.42, friction: 3, lateralGrip: 14, mass: 1100 },
    'Pickup Truck.glb': { maxSpeed: 22, acceleration: 10, brakeForce: 18, steerSpeed: 2.5, maxSteer: 0.35, friction: 2.5, lateralGrip: 12, mass: 2500 },
    'Bus.glb': { maxSpeed: 18, acceleration: 8, brakeForce: 15, steerSpeed: 2.0, maxSteer: 0.3, friction: 2.2, lateralGrip: 11, mass: 4000 },
    'Motorcycle.glb': { maxSpeed: 35, acceleration: 20, brakeForce: 28, steerSpeed: 4.5, maxSteer: 0.55, friction: 3, lateralGrip: 10, mass: 200 },
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
      const geoName = `vehicle:${this.modelFile}:${nodes.indexOf(node)}`;

      for (const sub of node.meshes) {
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
          const isFront = wheelOffsetZ > 0 || wheelOffsetX > 0 && this.forwardAxis === 0;
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
    this.modelYawOffset = frontAvg >= rearAvg ? 0 : Math.PI;
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

  update(delta, input) {
    if (this.destroyed || !this.loaded) return;

    const stats = this._stats();
    const wheelBase = this.wheelBase || Math.max((this.length || 4.2) * 0.62, 2.4);

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

    const steerTarget = this.steerInput * stats.maxSteer;
    const steerLerp = 1 - Math.exp(-stats.steerSpeed * delta);
    this.steerAngle += (steerTarget - this.steerAngle) * steerLerp;

    const fwd = this._getForward();
    const right = new Vec3(fwd.z, 0, -fwd.x);
    let vForward = this.velocity.x * fwd.x + this.velocity.z * fwd.z;
    let vLateral = this.velocity.x * right.x + this.velocity.z * right.z;

    let accel = 0;
    if (this.throttleInput > 0) {
      accel = this.throttleInput * stats.acceleration;
    } else if (this.throttleInput < 0) {
      if (vForward > 0.5) accel = this.throttleInput * stats.brakeForce;
      else accel = this.throttleInput * stats.acceleration * 0.55;
    }
    accel -= vForward * stats.friction * 0.35;
    vForward += accel * delta;
    vForward = Math.max(-stats.maxSpeed * 0.35, Math.min(stats.maxSpeed, vForward));
    this.speed = vForward;

    const grip = 1 - Math.exp(-(stats.lateralGrip || 14) * delta);
    vLateral *= 1 - grip;

    const speedAbs = Math.abs(vForward);
    if (speedAbs > 0.35) {
      const speedSteerScale = 1 / (1 + speedAbs * 0.045);
      const steer = this.steerAngle * speedSteerScale;
      const yawRate = (Math.sign(vForward) * speedAbs * Math.tan(steer)) / wheelBase;
      this.yaw += yawRate * delta;
    } else if (this.throttleInput !== 0 && Math.abs(this.steerAngle) > 0.05) {
      this.yaw += this.steerAngle * 1.4 * this.throttleInput * delta;
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
      this.velocity.x *= 0.25;
      this.velocity.z *= 0.25;
      const impactSpeed = Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2);
      if (impactSpeed > 15) this._takeDamage(impactSpeed * 0.5);
    }

    this.wheelSpin += vForward * delta * 2.5;

    this._checkRunover();
    this._syncParts();

    if (this.occupied) this._updateVehicleCamera(delta);
  }

  _getChaseForward() {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > 1.0) {
      return new Vec3(this.velocity.x / speed, 0, this.velocity.z / speed);
    }
    return this._getForward();
  }

  _updateVehicleCamera(delta) {
    const cam = this.game.camera;
    const len = this.length || 4.2;
    const h = this.height || 1.2;
    const forward = this._getChaseForward();
    const followDist = Math.max(len * 1.6, 9);
    const followHeight = Math.max(h * 2.8, 4.5);
    const lookAhead = Math.max(len * 0.55, 3);

    const focus = new Vec3(
      this.position.x + forward.x * lookAhead * 0.35,
      this.position.y + h * 0.5,
      this.position.z + forward.z * lookAhead * 0.35
    );
    const desiredEye = new Vec3(
      this.position.x - forward.x * followDist,
      this.position.y + followHeight,
      this.position.z - forward.z * followDist
    );
    const lookTarget = new Vec3(
      focus.x + forward.x * lookAhead,
      focus.y + h * 0.15,
      focus.z + forward.z * lookAhead
    );

    if (!this._chaseEye) this._chaseEye = desiredEye.clone();
    const blend = 1 - Math.exp(-10 * delta);
    this._chaseEye.x += (desiredEye.x - this._chaseEye.x) * blend;
    this._chaseEye.y += (desiredEye.y - this._chaseEye.y) * blend;
    this._chaseEye.z += (desiredEye.z - this._chaseEye.z) * blend;

    cam.setLookAt(this._chaseEye, lookTarget);

    this.game.player.position.set(this.position.x, this.position.y + 1.0, this.position.z);
    this.game.player.yaw = this.yaw;
    this.game.player.pitch = cam.pitch;
  }

  _getForward() {
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
        }
      }
    }
  }

  _syncParts() {
    const totalYaw = this.yaw + (this.modelYawOffset || 0);
    const steerVis = this.steerAngle;

    for (const p of this.parts) {
      p.obj.position.set(this.position.x, this.position.y, this.position.z);
      p.obj.rotationY = totalYaw;
      this.game.renderer.updateObjectTransform(p.obj);
    }

    const cosT = Math.cos(totalYaw), sinT = Math.sin(totalYaw);
    for (const w of this.wheelNodes) {
      const rx = w.offsetX * cosT - w.offsetZ * sinT;
      const rz = w.offsetX * sinT + w.offsetZ * cosT;
      w.obj.position.set(
        this.position.x + rx,
        this.position.y + w.offsetY,
        this.position.z + rz);
      w.obj.rotationY = totalYaw + (w.isFront ? steerVis : 0);
      w.obj.rotationX = this.wheelSpin;
      this.game.renderer.updateObjectTransform(w.obj);
    }
  }

  _takeDamage(amount) {
    this.health -= amount;
    if (this.health <= 0 && !this.destroyed) this._destroy();
  }

  _destroy() {
    this.destroyed = true;
    this.speed = 0;
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
  }

  exit(player) {
    this.occupied = false;
    this._chaseEye = null;
    player.isInVehicle = false;
    player.vehicle = null;
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
