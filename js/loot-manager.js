import { Vec3 } from './math.js';

export class LootManager {
  constructor(game) {
    this.game = game;
    this.drops = [];
    this.pickupRadius = 1.5;
    this.rotateSpeed = 2.0;
    this.floatSpeed = 2.0;
  }

  init() {}

  spawnLoot(position, type) {
    let geoName, color, scale, emissive = [0, 0, 0];
    if (type === 'coin') {
      geoName = 'cylinder'; color = [1, 0.84, 0]; scale = new Vec3(0.3, 0.05, 0.3); emissive = [0.3, 0.25, 0];
    } else if (type === 'cowboyhat') {
      geoName = 'cone'; color = [0.55, 0.27, 0.07]; scale = new Vec3(0.3, 0.2, 0.3);
    } else if (type === 'potion') {
      geoName = 'cylinder'; color = [0.2, 0.8, 0.2]; scale = new Vec3(0.15, 0.3, 0.15); emissive = [0, 0.2, 0];
    } else return;

    const pos = new Vec3(position.x, position.y + 0.5, position.z);
    const obj = this.game.renderer.addObject(geoName, pos, scale, 0, color, emissive, 1);
    this.drops.push({ obj, type, startY: pos.y, active: true, pos });
  }

  update(delta) {
    const playerPos = this.game.player.position;
    const time = performance.now() * 0.001;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      if (!drop.active) continue;
      drop.obj.rotationY += this.rotateSpeed * delta;
      drop.obj.position.y = drop.startY + Math.sin(time * this.floatSpeed) * 0.2;
      this.game.renderer.updateObjectTransform(drop.obj);
      const dist = drop.pos.distanceTo(playerPos);
      if (dist < this.pickupRadius) this._collect(drop, i);
    }
  }

  _collect(drop, index) {
    drop.active = false;
    this.game.renderer.removeObject(drop.obj);
    this.drops.splice(index, 1);
    this.game.player.collectLoot(drop.type);
  }
}
