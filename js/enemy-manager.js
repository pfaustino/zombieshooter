import { Vec3 } from './math.js';
import { Enemy } from './enemy.js';

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
    this.spawnRadius = 60;
    this.minSpawnDistance = 15;
    this.killsDisplay = document.getElementById('kills');
    this.waveDisplay = document.getElementById('wave');
    this.notificationDisplay = document.getElementById('notification');
  }

  init() { this.startWave(); }

  startWave() {
    this.waveInProgress = true;
    this.waveEnemiesSpawned = 0;
    this.waveKilled = 0;
    const baseEnemies = 5 + (this.currentWave - 1) * 3;
    const multiplier = this.spawnMultiplier || 1.5;
    this.waveTotalEnemies = Math.ceil(baseEnemies * multiplier);
    this.updateWaveDisplay();
    this.updateKillDisplay();
    this.showNotification(`Wave ${this.currentWave}`);
    this.checkSpawns();
  }

  checkSpawns() {
    if (!this.waveInProgress) return;
    const activeCount = this.enemies.filter(e => e.state !== Enemy.STATE.DEAD).length;
    if (this.waveEnemiesSpawned < this.waveTotalEnemies && activeCount < this.maxSimultaneousEnemies) {
      this.spawnEnemy();
    }
  }

  spawnEnemy() {
    let attempts = 0;
    let position = null;
    while (attempts < 20) {
      const angle = Math.random() * Math.PI * 2;
      const distance = this.minSpawnDistance + Math.random() * (this.spawnRadius - this.minSpawnDistance);
      position = new Vec3(
        this.game.player.position.x + Math.cos(angle) * distance, 0,
        this.game.player.position.z + Math.sin(angle) * distance);
      if (this.isValidSpawnPosition(position)) break;
      attempts++;
    }
    if (position) {
      const enemy = new Enemy(this.game, position);
      enemy.init();
      this.enemies.push(enemy);
      this.waveEnemiesSpawned++;
    }
  }

  isValidSpawnPosition(position) {
    for (const enemy of this.enemies) {
      if (enemy.state !== Enemy.STATE.DEAD && enemy.position.distanceTo(position) < 3) return false;
    }
    for (const c of this.game.world.collidables) {
      if (c.name === 'ground') continue;
      if (c.aabb.containsPoint(position)) return false;
      if (c.aabb.intersectsCircleXZ(position.x, position.z, 1.0)) return false;
    }
    return true;
  }

  update(delta) {
    for (const enemy of this.enemies) enemy.update(delta);
    this._resolveEnemyCollisions();
    if (this.waveInProgress) this.checkSpawns();
  }

  _resolveEnemyCollisions() {
    const active = this.enemies.filter(e => e.state !== Enemy.STATE.DEAD && e.state !== Enemy.STATE.RAGDOLL);
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
    this.showNotification('Wave Complete!');
    setTimeout(() => { this.currentWave++; this.startWave(); }, 5000);
  }

  updateKillDisplay() {
    if (this.killsDisplay) this.killsDisplay.textContent = `Total Kills: ${this.killCount}`;
  }

  updateWaveDisplay() {
    if (this.waveDisplay) this.waveDisplay.textContent = `Wave ${this.currentWave}: ${this.waveKilled}/${this.waveTotalEnemies}`;
  }

  showNotification(text) {
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
    this.spawnMultiplier = 0.5 + (level * 0.5);
  }

  raycastEnemies(origin, dir, maxDist = 1000) {
    let closest = null;
    let closestDist = maxDist;
    for (const enemy of this.enemies) {
      if (enemy.state === Enemy.STATE.DEAD) continue;
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
