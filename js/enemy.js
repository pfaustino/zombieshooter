import { Vec3, AABB } from './math.js';
import { loadGLBGeometry, loadGLBSkinned } from './gltf-loader.js?v=0.1.4n';
import { AnimPlayer } from './anim-player.js?v=0.1.4n';

const ZOMBIE_GLB_ANIM = 'assets/pixellabs-zombie-3403-a.glb';
const ZOMBIE_GLB_STATIC = 'assets/pixellabs-zombie-3403.glb';
const BIGARM_GLB = 'assets/big-arm.glb';

function skinnedRestBounds(skinned, clipName = 'idle') {
  const player = new AnimPlayer(skinned);
  if (skinned.animations[clipName]) player.play(clipName);
  player.update(0);
  const JM = player.jointMatrices;
  const { positions, joints, weights } = skinned;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.length / 3; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const ji = joints[i * 4 + k];
      const w = weights[i * 4 + k];
      if (!(w > 0) || ji * 16 + 15 >= JM.length) continue;
      const o = ji * 16;
      x += w * (JM[o] * px + JM[o + 4] * py + JM[o + 8] * pz + JM[o + 12]);
      y += w * (JM[o + 1] * px + JM[o + 5] * py + JM[o + 9] * pz + JM[o + 13]);
      z += w * (JM[o + 2] * px + JM[o + 6] * py + JM[o + 10] * pz + JM[o + 14]);
    }
    if (!Number.isFinite(y)) continue;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minY)) return { minY: 0, maxY: 1.7, height: 1.7 };
  return { minY, maxY, height: Math.max(maxY - minY, 0.01) };
}

export class Enemy {
  static STATE = { IDLE: 'idle', PATROL: 'patrol', CHASE: 'chase', ATTACK: 'attack', DEAD: 'dead', RAGDOLL: 'ragdoll', DYING: 'dying' };
  static TYPE = { ROBOT: 'robot', GHOST: 'ghost', ZOMBIE: 'zombie', DEMON: 'demon', BIGARM: 'bigarm' };

  static zombieGeo = null;
  static zombieSkinned = null;
  static zombieScale = 2.6;
  static zombieYOffset = 0.85;
  static zombieYawOffset = 0;

  static bigArmGeo = null;
  static bigArmSkinned = null;
  static bigArmScale = 1.3;
  static bigArmYOffset = 0;
  static bigArmYawOffset = 0;

  static async preloadAssets(game) {
    await Enemy._preloadZombie(game);
    await Enemy._preloadBigArm(game);
  }

  static async _preloadZombie(game) {
    if (Enemy.zombieGeo || Enemy.zombieSkinned) return;
    const animUrls = [ZOMBIE_GLB_ANIM, `3dfps-main/${ZOMBIE_GLB_ANIM}`];
    for (const url of animUrls) {
      try {
        const skinned = await loadGLBSkinned(url);
        const bounds = skinnedRestBounds(skinned, 'idle');
        Enemy.zombieScale = 1.75 / bounds.height;
        Enemy.zombieYOffset = -bounds.minY * Enemy.zombieScale;
        Enemy.zombieYawOffset = 0;
        const name = 'enemy:zombie-skinned';
        game.renderer.registerSkinnedGeometry(name, skinned);
        Enemy.zombieGeo = name;
        Enemy.zombieSkinned = skinned;
        return;
      } catch (error) {
        console.warn(`Failed to load animated zombie from ${url}:`, error);
      }
    }

    const staticUrls = [ZOMBIE_GLB_STATIC, `3dfps-main/${ZOMBIE_GLB_STATIC}`];
    for (const url of staticUrls) {
      try {
        const geometry = await loadGLBGeometry(url);
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 1; i < geometry.positions.length; i += 3) {
          minY = Math.min(minY, geometry.positions[i]);
          maxY = Math.max(maxY, geometry.positions[i]);
        }
        const height = Math.max(maxY - minY, 0.01);
        Enemy.zombieScale = 1.75 / height;
        Enemy.zombieYOffset = -minY * Enemy.zombieScale;
        Enemy.zombieYawOffset = 0;
        const name = 'enemy:zombie';
        game.renderer.registerGeometry(name, geometry);
        Enemy.zombieGeo = name;
        return;
      } catch (error) {
        console.warn(`Failed to load zombie model from ${url}:`, error);
      }
    }
    console.warn('Zombie GLB unavailable — using primitive fallback');
  }

  static async _preloadBigArm(game) {
    if (Enemy.bigArmGeo || Enemy.bigArmSkinned) return;
    const urls = [BIGARM_GLB, `3dfps-main/${BIGARM_GLB}`];
    for (const url of urls) {
      try {
        const skinned = await loadGLBSkinned(url);
        const bounds = skinnedRestBounds(skinned, 'idle');
        Enemy.bigArmScale = 1.95 / bounds.height;
        Enemy.bigArmYOffset = -bounds.minY * Enemy.bigArmScale;
        Enemy.bigArmYawOffset = 0;
        const name = 'enemy:bigarm-skinned';
        game.renderer.registerSkinnedGeometry(name, skinned);
        Enemy.bigArmGeo = name;
        Enemy.bigArmSkinned = skinned;
        return;
      } catch (error) {
        console.warn(`Failed to load big-arm from ${url}:`, error);
      }
    }
  }

  constructor(game, position, type = null) {
    this.game = game;
    this.position = position.clone();
    const types = Object.values(Enemy.TYPE);
    this.type = type || types[Math.floor(Math.random() * types.length)];
    this.state = Enemy.STATE.PATROL;
    this.targetPosition = null;
    this.patrolRadius = 15;
    this.detectionRange = 20;
    this.attackRange = 2;
    this.loseInterestRange = 30;
    this.health = 100;
    this.maxHealth = 100;
    this.damage = 10;
    this.attackCooldown = 0;
    this.attackRate = 1;
    this.speed = 2;
    this.chaseSpeed = 10.5; // overwritten in applyTypeStats from player walk * 0.75
    this.chaseSpeedRatio = 0.75;
    this.stateTimer = 0;
    this.patrolWaitTime = 2;
    this.floatOffset = 0;
    this.facingYaw = 0;
    this.anim = null;
    this.forcedAggro = false;
    this.parts = [];
    this.healthBar = null;
    this.healthBarBg = null;
    this.applyTypeStats();
  }

  applyTypeStats() {
    const walk = this.game.player?.moveSpeed ?? 14;
    const chase = walk * 0.75;
    switch (this.type) {
      case Enemy.TYPE.ROBOT:
        this.health = 150; this.maxHealth = 150; this.damage = 15; this.speed = walk * 0.35; this.chaseSpeed = chase; break;
      case Enemy.TYPE.GHOST:
        this.health = 60; this.maxHealth = 60; this.damage = 8; this.speed = walk * 0.4; this.chaseSpeed = chase; this.detectionRange = 25; break;
      case Enemy.TYPE.ZOMBIE:
        this.health = 120; this.maxHealth = 120; this.damage = 12; this.speed = walk * 0.3; this.chaseSpeed = chase; this.attackRate = 1.5;
        this.detectionRange = 45; this.loseInterestRange = 65; break;
      case Enemy.TYPE.BIGARM:
        this.health = 200; this.maxHealth = 200; this.damage = 18; this.speed = walk * 0.28; this.chaseSpeed = chase * 0.9;
        this.attackRate = 1.2; this.attackRange = 2.4;
        this.detectionRange = 45; this.loseInterestRange = 65; break;
      case Enemy.TYPE.DEMON:
        this.health = 100; this.maxHealth = 100; this.damage = 20; this.speed = walk * 0.4; this.chaseSpeed = chase; this.attackRate = 0.8; break;
    }
  }

  init() {
    this.createMesh();
    this.createHealthBar();
    this.pickNewPatrolTarget();
    const player = this.getPlayerPosition();
    this._faceToward(player.x, player.z);
  }

  _addPart(geoName, pos, scale, color, emissive = [0, 0, 0]) {
    const obj = this.game.renderer.addObject(geoName,
      new Vec3(this.position.x + pos.x, this.position.y + pos.y, this.position.z + pos.z),
      new Vec3(scale.x || scale, scale.y || scale, scale.z || scale),
      0, color, emissive, 1);
    this.parts.push({ obj, offsetX: pos.x, offsetY: pos.y, offsetZ: pos.z, baseColor: [...color] });
    return obj;
  }

  createMesh() {
    switch (this.type) {
      case Enemy.TYPE.ROBOT: this._createRobot(); break;
      case Enemy.TYPE.GHOST: this._createGhost(); break;
      case Enemy.TYPE.ZOMBIE: this._createZombie(); break;
      case Enemy.TYPE.BIGARM: this._createBigArm(); break;
      case Enemy.TYPE.DEMON: this._createDemon(); break;
    }
  }

  _createRobot() {
    this._addPart('box', { x: 0, y: 1.0, z: 0 }, { x: 0.8, y: 1.0, z: 0.5 }, [0.29, 0.33, 0.41]);
    this._addPart('box', { x: 0, y: 1.7, z: 0 }, { x: 0.5, y: 0.4, z: 0.4 }, [0.18, 0.22, 0.28]);
    this._addPart('box', { x: 0, y: 1.72, z: 0.2 }, { x: 0.4, y: 0.1, z: 0.05 }, [0, 1, 1], [0, 0.5, 0.5]);
    this._addPart('box', { x: -0.55, y: 1.0, z: 0 }, { x: 0.15, y: 0.5, z: 0.15 }, [0.44, 0.5, 0.58]);
    this._addPart('box', { x: 0.55, y: 1.0, z: 0 }, { x: 0.15, y: 0.5, z: 0.15 }, [0.44, 0.5, 0.58]);
    this._addPart('box', { x: -0.2, y: 0.25, z: 0 }, { x: 0.2, y: 0.5, z: 0.2 }, [0.44, 0.5, 0.58]);
    this._addPart('box', { x: 0.2, y: 0.25, z: 0 }, { x: 0.2, y: 0.5, z: 0.2 }, [0.44, 0.5, 0.58]);
  }

  _createGhost() {
    this._addPart('sphere', { x: 0, y: 1.5, z: 0 }, { x: 0.5, y: 0.75, z: 0.4 }, [0.67, 0.87, 1.0], [0, 0, 0.2]);
    for (let i = 0; i < 3; i++) {
      this._addPart('cone', { x: (i - 1) * 0.25, y: 0.8, z: 0 }, { x: 0.15, y: 0.6, z: 0.15 }, [0.53, 0.8, 1.0]);
    }
    this._addPart('sphere', { x: -0.15, y: 1.6, z: 0.35 }, 0.08, [1, 1, 1], [0.5, 0.5, 0.5]);
    this._addPart('sphere', { x: 0.15, y: 1.6, z: 0.35 }, 0.08, [1, 1, 1], [0.5, 0.5, 0.5]);
    this.floatOffset = Math.random() * Math.PI * 2;
  }

  _createZombie() {
    if (Enemy.zombieGeo && Enemy.zombieSkinned) {
      const s = Enemy.zombieScale;
      const y = Enemy.zombieYOffset;
      const obj = this.game.renderer.addSkinnedObject(Enemy.zombieGeo,
        new Vec3(this.position.x, this.position.y + y, this.position.z),
        new Vec3(s, s, s), 0, [1, 1, 1], [0, 0, 0], 1);
      this.anim = new AnimPlayer(Enemy.zombieSkinned);
      this.anim.time = Math.random() * 0.5;
      this.game.renderer.updateSkinnedJoints(obj, this.anim.jointMatrices);
      this.parts.push({
        obj, offsetX: 0, offsetY: y, offsetZ: 0, baseColor: [1, 1, 1],
        meshPart: true, yawOffset: Enemy.zombieYawOffset, skinned: true,
      });
      return;
    }
    if (Enemy.zombieGeo) {
      const s = Enemy.zombieScale;
      const y = Enemy.zombieYOffset;
      const obj = this.game.renderer.addObject(Enemy.zombieGeo,
        new Vec3(this.position.x, this.position.y + y, this.position.z),
        new Vec3(s, s, s), 0, [1, 1, 1], [0, 0, 0], 1);
      this.parts.push({
        obj, offsetX: 0, offsetY: y, offsetZ: 0, baseColor: [1, 1, 1],
        meshPart: true, yawOffset: Enemy.zombieYawOffset,
      });
      return;
    }
    this._createZombiePrimitive();
  }

  _createZombiePrimitive() {
    this._addPart('cylinder', { x: 0, y: 0.85, z: 0 }, { x: 0.35, y: 1.1, z: 0.4 }, [0.33, 0.42, 0.18]);
    this._addPart('sphere', { x: 0.05, y: 1.55, z: 0 }, { x: 0.28, y: 0.25, z: 0.28 }, [0.55, 0.6, 0.42]);
    this._addPart('sphere', { x: -0.08, y: 1.58, z: 0.22 }, 0.05, [0.8, 1.0, 0], [0.4, 0.5, 0]);
    this._addPart('sphere', { x: 0.12, y: 1.55, z: 0.22 }, 0.05, [0.8, 1.0, 0], [0.4, 0.5, 0]);
    this._addPart('cylinder', { x: -0.45, y: 0.95, z: 0.2 }, { x: 0.08, y: 0.7, z: 0.1 }, [0.29, 0.35, 0.24]);
    this._addPart('cylinder', { x: 0.45, y: 1.0, z: 0.1 }, { x: 0.1, y: 0.6, z: 0.08 }, [0.29, 0.35, 0.24]);
    this._addPart('cylinder', { x: -0.15, y: 0.3, z: 0 }, { x: 0.1, y: 0.6, z: 0.12 }, [0.29, 0.35, 0.24]);
    this._addPart('cylinder', { x: 0.18, y: 0.3, z: 0 }, { x: 0.1, y: 0.6, z: 0.12 }, [0.29, 0.35, 0.24]);
  }

  _createBigArm() {
    if (Enemy.bigArmGeo && Enemy.bigArmSkinned) {
      const s = Enemy.bigArmScale;
      const y = Enemy.bigArmYOffset;
      const obj = this.game.renderer.addSkinnedObject(Enemy.bigArmGeo,
        new Vec3(this.position.x, this.position.y + y, this.position.z),
        new Vec3(s, s, s), 0, [1, 1, 1], [0, 0, 0], 1);
      this.anim = new AnimPlayer(Enemy.bigArmSkinned);
      this.anim.time = Math.random() * 0.5;
      this.game.renderer.updateSkinnedJoints(obj, this.anim.jointMatrices);
      this.parts.push({
        obj, offsetX: 0, offsetY: y, offsetZ: 0, baseColor: [1, 1, 1],
        meshPart: true, yawOffset: Enemy.bigArmYawOffset, skinned: true,
      });
      return;
    }
    this._createZombiePrimitive();
  }

  _createDemon() {
    this._addPart('cylinder', { x: 0, y: 0.95, z: 0 }, { x: 0.3, y: 1.3, z: 0.45 }, [0.55, 0, 0], [0.1, 0, 0]);
    this._addPart('sphere', { x: 0, y: 1.75, z: 0 }, 0.3, [0.67, 0.13, 0.13], [0.1, 0, 0]);
    this._addPart('cone', { x: -0.2, y: 2.0, z: 0 }, { x: 0.06, y: 0.3, z: 0.06 }, [0.1, 0.1, 0.1]);
    this._addPart('cone', { x: 0.2, y: 2.0, z: 0 }, { x: 0.06, y: 0.3, z: 0.06 }, [0.1, 0.1, 0.1]);
    this._addPart('sphere', { x: -0.12, y: 1.78, z: 0.25 }, 0.07, [1, 0.4, 0], [0.5, 0.2, 0]);
    this._addPart('sphere', { x: 0.12, y: 1.78, z: 0.25 }, 0.07, [1, 0.4, 0], [0.5, 0.2, 0]);
    this._addPart('cylinder', { x: -0.5, y: 1.1, z: 0 }, { x: 0.08, y: 0.7, z: 0.12 }, [0.4, 0, 0], [0.1, 0, 0]);
    this._addPart('cylinder', { x: 0.5, y: 1.1, z: 0 }, { x: 0.08, y: 0.7, z: 0.12 }, [0.4, 0, 0], [0.1, 0, 0]);
    this._addPart('cylinder', { x: -0.18, y: 0.3, z: 0 }, { x: 0.1, y: 0.6, z: 0.14 }, [0.4, 0, 0], [0.1, 0, 0]);
    this._addPart('cylinder', { x: 0.18, y: 0.3, z: 0 }, { x: 0.1, y: 0.6, z: 0.14 }, [0.4, 0, 0], [0.1, 0, 0]);
  }

  createHealthBar() {
    let barY = 2.2;
    if (this.type === Enemy.TYPE.ZOMBIE && Enemy.zombieGeo) barY = 2.05;
    if (this.type === Enemy.TYPE.BIGARM && Enemy.bigArmGeo) barY = 2.35;
    this.healthBarBg = this.game.renderer.addBillboard(
      new Vec3(this.position.x, this.position.y + barY, this.position.z),
      new Vec3(1, 0.1), [0.2, 0.2, 0.2], 0);
    this.healthBar = this.game.renderer.addBillboard(
      new Vec3(this.position.x, this.position.y + barY, this.position.z),
      new Vec3(0.96, 0.06), [0.27, 1, 0.27], 0.001);
    this.healthBarOffset = barY;
  }

  pickNewPatrolTarget() {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * this.patrolRadius;
    this.targetPosition = new Vec3(
      this.position.x + Math.cos(angle) * distance, 0,
      this.position.z + Math.sin(angle) * distance);
  }

  getPlayerPosition() { return this.game.player.position; }
  distanceToPlayer() { return this.position.distanceTo(this.getPlayerPosition()); }

  canSeePlayer() {
    const dist = this.distanceToPlayer();
    if (dist > this.detectionRange) return false;
    const from = new Vec3(this.position.x, 1, this.position.z);
    const to = new Vec3(this.getPlayerPosition().x, 1, this.getPlayerPosition().z);
    return this.game.world.checkLineOfSight(from, to);
  }

  update(delta) {
    if (this.state === Enemy.STATE.DEAD) return;
    if (this.state === Enemy.STATE.RAGDOLL) { this._updateRagdoll(delta); return; }
    if (this.state === Enemy.STATE.DYING) {
      if (this.anim) {
        this._updateAnim(delta);
        this._syncParts();
        if (this.anim.finished) {
          this.dispose();
          this.state = Enemy.STATE.DEAD;
        }
      } else {
        this._updateDying(delta);
      }
      return;
    }
    if (this.attackCooldown > 0) this.attackCooldown -= delta;

    switch (this.state) {
      case Enemy.STATE.IDLE: this._updateIdle(delta); break;
      case Enemy.STATE.PATROL: this._updatePatrol(delta); break;
      case Enemy.STATE.CHASE: this._updateChase(delta); break;
      case Enemy.STATE.ATTACK: this._updateAttack(delta); break;
    }

    if (this.state === Enemy.STATE.CHASE || this.state === Enemy.STATE.ATTACK || this.forcedAggro || this.canSeePlayer()) {
      const player = this.getPlayerPosition();
      this._faceToward(player.x, player.z);
    }

    if (this.state !== Enemy.STATE.DEAD && this.state !== Enemy.STATE.ATTACK) {
      if (this.forcedAggro || this.canSeePlayer()) {
        if ((this.state === Enemy.STATE.IDLE || this.state === Enemy.STATE.PATROL) && this.canSeePlayer()) {
          if (this.game.audioManager) this.game.audioManager.playEnemyAttack(this.type);
        }
        if (this.distanceToPlayer() <= this.attackRange) {
          this.state = Enemy.STATE.ATTACK;
        } else {
          this.state = Enemy.STATE.CHASE;
        }
      } else if (this.state === Enemy.STATE.CHASE && this.distanceToPlayer() > this.loseInterestRange) {
        this.state = Enemy.STATE.PATROL;
        this.pickNewPatrolTarget();
      }
    }

    if (this.type === Enemy.TYPE.GHOST) {
      const time = performance.now() * 0.001;
      this.position.y = 0.3 + Math.sin(time * 2 + this.floatOffset) * 0.3;
    } else {
      this.position.y = 0;
    }

    if (this.anim) this._updateAnim(delta);
    this._syncParts();

    this._updateHealthBar();
  }

  _updateAnim(delta) {
    let clip = 'idle';
    let loop = true;
    let speed = 1;
    if (this.state === Enemy.STATE.PATROL) clip = 'walk';
    else if (this.state === Enemy.STATE.CHASE) clip = 'chase';
    else if (this.state === Enemy.STATE.ATTACK) clip = 'attack';
    else if (this.state === Enemy.STATE.DYING) {
      clip = 'death';
      loop = false;
      speed = 1 / 6;
    }
    this.anim.speed = speed;
    this.anim.play(clip, { loop, reset: this.anim.clipName !== clip });
    this.anim.update(delta);
    for (const p of this.parts) {
      if (p.skinned) this.game.renderer.updateSkinnedJoints(p.obj, this.anim.jointMatrices);
    }
  }

  _faceToward(x, z) {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    if (dx * dx + dz * dz > 1e-6) this.facingYaw = Math.atan2(dx, dz);
  }

  _syncParts() {
    for (const p of this.parts) {
      p.obj.position.set(this.position.x + p.offsetX, this.position.y + p.offsetY, this.position.z + p.offsetZ);
      if (p.meshPart) {
        p.obj.rotationY = this.facingYaw + (p.yawOffset || 0);
        if (!p.skinned) {
          p.obj.rotationX = 0;
          p.obj.rotationZ = 0;
        }
      }
      this.game.renderer.updateObjectTransform(p.obj);
    }
  }

  _updateIdle(delta) {
    this.stateTimer -= delta;
    if (this.stateTimer <= 0) { this.state = Enemy.STATE.PATROL; this.pickNewPatrolTarget(); }
  }

  _updatePatrol(delta) {
    if (!this.targetPosition) { this.pickNewPatrolTarget(); return; }
    const dist = this.position.distanceTo(this.targetPosition);
    if (dist < 0.5) { this.state = Enemy.STATE.IDLE; this.stateTimer = this.patrolWaitTime; return; }
    this._faceToward(this.targetPosition.x, this.targetPosition.z);
    this._moveToward(this.targetPosition, this.speed, delta);
  }

  _updateChase(delta) {
    const dist = this.distanceToPlayer();
    if (dist <= this.attackRange) { this.state = Enemy.STATE.ATTACK; return; }
    // Keep chase locked to 75% of current player walk speed
    const walk = this.game.player?.moveSpeed ?? 14;
    this.chaseSpeed = walk * (this.chaseSpeedRatio ?? 0.75);
    const player = this.getPlayerPosition();
    this._faceToward(player.x, player.z);
    this._moveToward(player, this.chaseSpeed, delta);
  }

  _updateAttack(delta) {
    const player = this.getPlayerPosition();
    this._faceToward(player.x, player.z);
    const dist = this.distanceToPlayer();
    if (dist > this.attackRange * 1.5) { this.state = Enemy.STATE.CHASE; return; }
    if (this.attackCooldown <= 0) { this._attack(); this.attackCooldown = this.attackRate; }
  }

  _moveToward(target, speed, delta) {
    const dir = Vec3.sub(target, this.position);
    dir.y = 0;
    const len = dir.length();
    if (len < 1e-6) return;
    const nx = dir.x / len;
    const nz = dir.z / len;
    this.facingYaw = Math.atan2(nx, nz);
    const r = this.getCollisionRadius();
    const step = speed * delta;
    const newX = this.position.x + nx * step;
    const newZ = this.position.z + nz * step;
    if (!this.game.world.checkCollision(newX, newZ, r)) {
      this.position.x = newX; this.position.z = newZ;
    } else {
      if (!this.game.world.checkCollision(newX, this.position.z, r)) this.position.x = newX;
      else if (!this.game.world.checkCollision(this.position.x, newZ, r)) this.position.z = newZ;
    }
  }

  _attack() {
    this.game.player.takeDamage(this.damage);
  }

  takeDamage(amount) {
    if (this.state === Enemy.STATE.DEAD || this.state === Enemy.STATE.RAGDOLL || this.state === Enemy.STATE.DYING) return;
    this.health -= amount;
    this._flashDamage();
    if (this.health <= 0) {
      this.die();
      return;
    }
    this._aggroFromHit();
  }

  _aggroFromHit() {
    const wasPassive = this.state === Enemy.STATE.IDLE || this.state === Enemy.STATE.PATROL;
    this.forcedAggro = true;
    const player = this.getPlayerPosition();
    this._faceToward(player.x, player.z);
    if (this.distanceToPlayer() <= this.attackRange) this.state = Enemy.STATE.ATTACK;
    else this.state = Enemy.STATE.CHASE;
    if (wasPassive && this.game.audioManager) this.game.audioManager.playEnemyAttack(this.type);
  }

  ragdoll(impactVel) {
    if (this.state === Enemy.STATE.DEAD || this.state === Enemy.STATE.RAGDOLL || this.state === Enemy.STATE.DYING) return;
    this.state = Enemy.STATE.RAGDOLL;
    if (this.game.audioManager) this.game.audioManager.playEnemyDeath();
    if (this.healthBar) this.game.renderer.removeBillboard(this.healthBar);
    if (this.healthBarBg) this.game.renderer.removeBillboard(this.healthBarBg);
    this.healthBar = null;
    this.healthBarBg = null;

    this.ragdollParts = [];
    for (const p of this.parts) {
      const spread = 0.5;
      this.ragdollParts.push({
        obj: p.obj,
        vel: new Vec3(
          impactVel.x + (Math.random() - 0.5) * spread * 5,
          impactVel.y + Math.random() * 3,
          impactVel.z + (Math.random() - 0.5) * spread * 5
        ),
        angVel: new Vec3(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 8
        ),
        rotX: 0, rotY: 0, rotZ: 0,
        pos: new Vec3(p.obj.position.x, p.obj.position.y, p.obj.position.z),
        scale: new Vec3(p.obj.scale.x, p.obj.scale.y, p.obj.scale.z),
        baseColor: [...p.baseColor],
        grounded: false,
        life: 4.0,
      });
    }

    if (this.game.enemyManager) this.game.enemyManager.onEnemyKilled(this);
    if (this.game.lootManager) {
      const rand = Math.random();
      if (rand < 0.1) this.game.lootManager.spawnLoot(this.position, 'potion');
      else if (rand < 0.2) this.game.lootManager.spawnLoot(this.position, 'cowboyhat');
      else if (rand < 0.8) this.game.lootManager.spawnLoot(this.position, 'coin');
    }
  }

  _updateRagdoll(delta) {
    if (!this.ragdollParts) { this.state = Enemy.STATE.DEAD; return; }
    const gravity = 25;
    let allGrounded = true;
    let anyAlive = false;

    for (const rp of this.ragdollParts) {
      if (rp.grounded) {
        rp.life -= delta;
        if (rp.life > 0) anyAlive = true;
        rp.obj.opacity = Math.max(0, rp.life / 4.0);
        rp.obj.position.set(rp.pos.x, rp.pos.y, rp.pos.z);
        this.game.renderer.updateObjectTransform(rp.obj);
        continue;
      }
      allGrounded = false;
      anyAlive = true;

      rp.vel.y -= gravity * delta;
      rp.pos.x += rp.vel.x * delta;
      rp.pos.y += rp.vel.y * delta;
      rp.pos.z += rp.vel.z * delta;

      rp.rotX += rp.angVel.x * delta;
      rp.rotY += rp.angVel.y * delta;
      rp.rotZ += rp.angVel.z * delta;

      if (rp.pos.y <= 0.1) {
        rp.pos.y = 0.1;
        if (Math.abs(rp.vel.y) > 1.5) {
          rp.vel.y = -rp.vel.y * 0.4;
          rp.vel.x *= 0.6;
          rp.vel.z *= 0.6;
          rp.angVel.x *= 0.5;
          rp.angVel.y *= 0.5;
          rp.angVel.z *= 0.5;
        } else {
          rp.vel.set(0, 0, 0);
          rp.angVel.set(0, 0, 0);
          rp.grounded = true;
        }
      }

      rp.obj.position.set(rp.pos.x, rp.pos.y, rp.pos.z);
      rp.obj.rotationX = rp.rotX;
      rp.obj.rotationY = rp.rotY;
      rp.obj.rotationZ = rp.rotZ;
      this.game.renderer.updateObjectTransform(rp.obj);
    }

    if (!anyAlive) {
      this.dispose();
      this.state = Enemy.STATE.DEAD;
      this.ragdollParts = null;
    }
  }

  _flashDamage() {
    for (const p of this.parts) {
      p.obj.color = [1, 1, 1];
      this.game.renderer.updateObjectTransform(p.obj);
    }
    setTimeout(() => {
      for (const p of this.parts) {
        p.obj.color = p.baseColor;
        this.game.renderer.updateObjectTransform(p.obj);
      }
    }, 100);
  }

  _updateHealthBar() {
    const pct = Math.max(0, this.health / this.maxHealth);
    const color = pct > 0.5 ? [0.27, 1, 0.27] : pct > 0.25 ? [1, 1, 0.27] : [1, 0.27, 0.27];
    const barY = this.healthBarOffset || 2.2;
    this.game.renderer.updateBillboard(this.healthBar,
      new Vec3(this.position.x, this.position.y + barY, this.position.z),
      new Vec3(0.96 * pct, 0.06), color, 0.001);
    this.game.renderer.updateBillboard(this.healthBarBg,
      new Vec3(this.position.x, this.position.y + barY, this.position.z),
      new Vec3(1, 0.1), [0.2, 0.2, 0.2], 0);
  }

  die() {
    if (this.state === Enemy.STATE.DEAD || this.state === Enemy.STATE.RAGDOLL || this.state === Enemy.STATE.DYING) return;

    if (this.healthBar) this.game.renderer.removeBillboard(this.healthBar);
    if (this.healthBarBg) this.game.renderer.removeBillboard(this.healthBarBg);
    this.healthBar = null;
    this.healthBarBg = null;

    if (this.game.audioManager) this.game.audioManager.playEnemyDeath();
    if (this.game.particleSystem) {
      this.game.particleSystem.emit(
        new Vec3(this.position.x, this.position.y + 1.0, this.position.z),
        14,
        [0.45, 0.05, 0.05]
      );
    }
    if (this.game.enemyManager) this.game.enemyManager.onEnemyKilled(this);
    if (this.game.lootManager) {
      const rand = Math.random();
      if (rand < 0.1) this.game.lootManager.spawnLoot(this.position, 'potion');
      else if (rand < 0.2) this.game.lootManager.spawnLoot(this.position, 'cowboyhat');
      else if (rand < 0.8) this.game.lootManager.spawnLoot(this.position, 'coin');
    }

    // Skinned monsters play death clip; static zombies topple; others shrink/fade
    if (this.anim) {
      this.state = Enemy.STATE.DYING;
      this.anim.play('death', { loop: false, reset: true });
      return;
    }
    if (this.type === Enemy.TYPE.ZOMBIE) {
      this.state = Enemy.STATE.DYING;
      this.deathTime = 0;
      this.deathDuration = 0.95 * 6;
      this.deathFallSign = Math.random() < 0.5 ? 1 : -1;
      const toPlayer = Vec3.sub(this.getPlayerPosition(), this.position);
      toPlayer.y = 0;
      const len = toPlayer.length() || 1;
      this.deathKnock = new Vec3(-(toPlayer.x / len) * 1.2, 0, -(toPlayer.z / len) * 1.2);
      return;
    }

    this.state = Enemy.STATE.DEAD;
    const startTime = performance.now();
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / 500, 1);
      for (const p of this.parts) {
        p.obj.scale.x *= 0.99;
        p.obj.scale.y *= 0.99;
        p.obj.scale.z *= 0.99;
        p.obj.position.y -= 0.01;
        p.obj.opacity = 1 - progress;
        this.game.renderer.updateObjectTransform(p.obj);
      }
      if (progress < 1) requestAnimationFrame(animate);
      else this.dispose();
    };
    animate();
  }

  _updateDying(delta) {
    this.deathTime += delta;
    const t = Math.min(this.deathTime / this.deathDuration, 1);
    const ease = t * t * (3 - 2 * t);
    const angle = ease * (Math.PI / 2) * this.deathFallSign;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const sink = ease * 0.45;
    const knock = ease;
    const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;

    for (const p of this.parts) {
      const ox = p.offsetX;
      const oy = p.offsetY;
      const oz = p.offsetZ;
      // Tip over around Z (fall left/right), pivot near the feet
      const rx = ox * cos - oy * sin;
      const ry = ox * sin + oy * cos;
      p.obj.position.set(
        this.position.x + rx + this.deathKnock.x * knock,
        Math.max(0.05, this.position.y + ry - sink),
        this.position.z + oz + this.deathKnock.z * knock
      );
      if (p.meshPart) p.obj.rotationY = this.facingYaw + (p.yawOffset || 0);
      p.obj.rotationZ = angle;
      p.obj.opacity = Math.max(0, fade);
      this.game.renderer.updateObjectTransform(p.obj);
    }

    if (t >= 1) {
      this.dispose();
      this.state = Enemy.STATE.DEAD;
    }
  }

  dispose() {
    for (const p of this.parts) this.game.renderer.removeObject(p.obj);
    this.parts = [];
    if (this.healthBar) this.game.renderer.removeBillboard(this.healthBar);
    if (this.healthBarBg) this.game.renderer.removeBillboard(this.healthBarBg);
    this.healthBar = null;
    this.healthBarBg = null;
  }

  getAABB() {
    const cb = this._collisionBox();
    return new AABB(
      new Vec3(this.position.x - cb.w * 0.5, this.position.y, this.position.z - cb.d * 0.5),
      new Vec3(this.position.x + cb.w * 0.5, this.position.y + cb.h, this.position.z + cb.d * 0.5));
  }

  _collisionBox() {
    switch (this.type) {
      case Enemy.TYPE.ROBOT: return { w: 0.9, h: 2.0, d: 0.6 };
      case Enemy.TYPE.GHOST: return { w: 0.6, h: 1.8, d: 0.5 };
      case Enemy.TYPE.ZOMBIE: return { w: 0.65, h: 1.75, d: 0.55 };
      case Enemy.TYPE.BIGARM: return { w: 0.85, h: 2.0, d: 0.7 };
      case Enemy.TYPE.DEMON: return { w: 0.7, h: 2.1, d: 0.6 };
      default: return { w: 0.7, h: 1.8, d: 0.5 };
    }
  }

  getCollisionRadius() {
    const cb = this._collisionBox();
    return Math.max(cb.w, cb.d) * 0.5;
  }
}
