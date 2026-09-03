import { Vec3 } from './math.js';
import { Enemy } from './enemy.js?v=0.1.4';

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.enemies = [];
    this.killCount = 0;
    this.currentWave = 1;
    this.waveTotalEnemies = 5;
    this.waveEnemiesSpawned = 0;
    this.waveKilled = 0;
    this.waveInProgress = false;
    this.maxSimultaneousEnemies = 8;
    this.targetActiveEnemies = 8;
    this.waveTimeLimit = 120;
    this.waveTimer = this.waveTimeLimit;
    this.pressureMode = false;
    this.reinforceInterval = 10;
    this.reinforceCooldown = 0;
    this.spawnRadius = 60;
    this.minSpawnDistance = 15;
    this.killsDisplay = null;
    this.waveDisplay = null;
    this.waveTimerDisplay = null;
    this.notificationDisplay = null;
    this.spawnClearance = 1.5;
  }

  _ensureHUDRefs() {
    if (!this.killsDisplay) this.killsDisplay = document.getElementById('kills');
    if (!this.waveDisplay) this.waveDisplay = document.getElementById('wave');
    if (!this.waveTimerDisplay) this.waveTimerDisplay = document.getElementById('wave-timer');
    if (!this.notificationDisplay) this.notificationDisplay = document.getElementById('notification');
  }

  init() { return this._init(); }

  async _init() {
    await Enemy.preloadAssets(this.game);
    this.startWave();
  }

  startWave() {
    this.waveInProgress = true;
    this.waveEnemiesSpawned = 0;
    this.waveKilled = 0;
    this.waveTimer = this.waveTimeLimit;
    this.pressureMode = false;
    this.reinforceCooldown = 0;
    const baseEnemies = 5 + (this.currentWave - 1) * 3;
    const multiplier = this.spawnMultiplier || 1.5;
    this.waveTotalEnemies = Math.ceil(baseEnemies * multiplier);
    this.updateWaveDisplay();
    this.updateWaveTimerDisplay();
    this.updateKillDisplay();
    this.showNotification(`Wave ${this.currentWave}`);
    this.checkSpawns();
  }

  _activeCount() {
    return this.enemies.filter(e =>
      e.state !== Enemy.STATE.DEAD && e.state !== Enemy.STATE.RAGDOLL && e.state !== Enemy.STATE.DYING
    ).length;
  }

  checkSpawns() {
    if (!this.waveInProgress) return;
    const activeCount = this._activeCount();
    if (this.waveEnemiesSpawned < this.waveTotalEnemies && activeCount < this.maxSimultaneousEnemies) {
      this.spawnEnemy();
    }
  }

  spawnEnemy(reinforcement = false) {
    const activeCount = this._activeCount();
    if (activeCount >= this.maxSimultaneousEnemies) return;
    if (!reinforcement && this.waveEnemiesSpawned >= this.waveTotalEnemies) return;

    let attempts = 0;
    let position = null;
    while (attempts < 40) {
      const angle = Math.random() * Math.PI * 2;
      const distance = this.minSpawnDistance + Math.random() * (this.spawnRadius - this.minSpawnDistance);
      const candidate = new Vec3(
        this.game.player.position.x + Math.cos(angle) * distance, 0,
        this.game.player.position.z + Math.sin(angle) * distance);
      if (this.isValidSpawnPosition(candidate)) {
        position = candidate;
        break;
      }
      attempts++;
    }
    if (!position) return;

    position.y = this.game.world.getGroundHeight(position.x, position.z);
    const enemy = new Enemy(this.game, position, Enemy.TYPE.ZOMBIE);
    enemy.init();
    this.enemies.push(enemy);
    if (!reinforcement) this.waveEnemiesSpawned++;
  }

  isValidSpawnPosition(position) {
    for (const enemy of this.enemies) {
      if (enemy.state !== Enemy.STATE.DEAD && enemy.position.distanceTo(position) < 3) return false;
    }
    const world = this.game.world;
    if (world.cityBounds) {
      const b = world.cityBounds;
      const r = this.spawnClearance;
      if (position.x - r < b.minX || position.x + r > b.maxX ||
          position.z - r < b.minZ || position.z + r > b.maxZ) return false;
    }
    if (world.checkCollision(position.x, position.z, this.spawnClearance)) return false;
    if (world.checkCollision3D(position.x, position.y, position.z, this.spawnClearance, 2)) return false;
    return true;
  }

  _updateWaveTimer(delta) {
    if (this.pressureMode) {
      this.reinforceCooldown -= delta;
      const activeCount = this._activeCount();
      if (activeCount >= this.targetActiveEnemies) {
        this.pressureMode = false;
        this.waveTimer = this.waveTimeLimit;
        this.reinforceCooldown = 0;
        this.updateWaveTimerDisplay();
        this.showNotification('Horde at full strength — timer reset');
        return;
      }
      if (this.reinforceCooldown <= 0) {
        this.spawnEnemy(true);
        this.reinforceCooldown = this.reinforceInterval;
      }
      this.updateWaveTimerDisplay();
      return;
    }

    this.waveTimer -= delta;
    if (this.waveTimer <= 0) {
      this.waveTimer = 0;
      this.pressureMode = true;
      this.reinforceCooldown = 0;
      this.showNotification('Time\'s up! Reinforcements incoming...');
    }
    this.updateWaveTimerDisplay();
  }

  update(delta) {
    for (const enemy of this.enemies) enemy.update(delta);
    this._resolveEnemyCollisions();
    if (this.waveInProgress) {
      this._updateWaveTimer(delta);
      this.checkSpawns();
    }
  }

  _resolveEnemyCollisions() {
    const active = this.enemies.filter(e =>
      e.state !== Enemy.STATE.DEAD && e.state !== Enemy.STATE.RAGDOLL && e.state !== Enemy.STATE.DYING
    );
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const distSq = dx * dx + dz * dz;
        const minDist = a.getCollisionRadius() + b.getCollisionRadius();
        if (distSq < minDist * minDist && distSq > 0.0001) {
          const dist = Math.sqrt(distSq);
          const overlap = (minDist - dist) * 0.5;
          const nx = dx / dist, nz = dz / dist;
          a.position.x -= nx * overlap;
          a.position.z -= nz * overlap;
          b.position.x += nx * overlap;
          b.position.z += nz * overlap;
          a._syncParts();
          b._syncParts();
        }
      }
    }
  }

  onEnemyKilled(enemy) {
    this.killCount++;
    this.waveKilled++;
    this.updateKillDisplay();
    this.updateWaveDisplay();
    if (this.waveKilled >= this.waveTotalEnemies) this.completeWave();
  }

  completeWave() {
    this.waveInProgress = false;
    this.pressureMode = false;
    this.showNotification('Wave Complete!');
    setTimeout(() => { this.currentWave++; this.startWave(); }, 5000);
  }

  updateKillDisplay() {
    this._ensureHUDRefs();
    if (this.killsDisplay) this.killsDisplay.textContent = `Total Kills: ${this.killCount}`;
  }

  updateWaveDisplay() {
    this._ensureHUDRefs();
    if (this.waveDisplay) {
      this.waveDisplay.textContent = `Wave ${this.currentWave}: ${this.waveKilled}/${this.waveTotalEnemies}`;
    }
  }

  updateWaveTimerDisplay() {
    this._ensureHUDRefs();
    if (!this.waveTimerDisplay) return;
    if (this.pressureMode) {
      const nextIn = Math.max(0, Math.ceil(this.reinforceCooldown));
      const active = this._activeCount();
      this.waveTimerDisplay.textContent = `Reinforce: ${active}/${this.targetActiveEnemies} (next ${nextIn}s)`;
      this.waveTimerDisplay.className = 'danger';
      return;
    }
    const seconds = Math.max(0, Math.ceil(this.waveTimer));
    const mins = Math.floor(seconds / 60);
    const secs = String(seconds % 60).padStart(2, '0');
    this.waveTimerDisplay.textContent = `Time: ${mins}:${secs}`;
    this.waveTimerDisplay.className = seconds <= 20 ? 'danger' : seconds <= 45 ? 'warning' : '';
  }

  showNotification(text) {
    this._ensureHUDRefs();
    if (!this.notificationDisplay) return;
    this.notificationDisplay.textContent = text;
    this.notificationDisplay.style.opacity = '1';
    if (this.notificationTimeout) clearTimeout(this.notificationTimeout);
    this.notificationTimeout = setTimeout(() => {
      this.notificationDisplay.style.opacity = '0';
    }, 3000);
  }

  setDifficulty(level) {
    this.difficulty = level;
    const caps = [5, 6, 8, 10, 12, 15];
    this.maxSimultaneousEnemies = caps[level - 1] || 8;
    this.targetActiveEnemies = this.maxSimultaneousEnemies;
    this.spawnMultiplier = 0.5 + (level * 0.5);
  }

  raycastEnemies(origin, dir, maxDist = 1000) {
    let closest = null;
    let closestDist = maxDist;
    for (const enemy of this.enemies) {
      if (enemy.state === Enemy.STATE.DEAD || enemy.state === Enemy.STATE.DYING || enemy.state === Enemy.STATE.RAGDOLL) continue;
      const aabb = enemy.getAABB();
      const hit = this._rayAABB(origin, dir, aabb);
      if (hit !== null && hit < closestDist) {
        closestDist = hit;
        closest = { distance: hit, enemy };
      }
    }
    return closest;
  }

  _rayAABB(origin, dir, aabb) {
    let tmin = 0, tmax = 1000;
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
