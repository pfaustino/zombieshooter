import { Vec3 } from './math.js';

export class ParticleSystem {
  constructor(game) {
    this.game = game;
    this.particles = [];
  }

  init() {}

  emit(position, count = 10, color = [0.8, 0, 0]) {
    for (let i = 0; i < count; i++) {
      const vel = new Vec3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 4);
      const pos = position.clone();
      const obj = this.game.renderer.addObject('sphere', pos, new Vec3(0.08, 0.08, 0.08), 0, color, [0, 0, 0], 1);
      this.particles.push({ obj, vel, pos, life: 1.0, gravity: 10, bounce: 0.3 });
    }
  }

  update(delta) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta * 2;
      if (p.life <= 0) {
        this.game.renderer.removeObject(p.obj);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * delta;
      p.pos.x += p.vel.x * delta;
      p.pos.y += p.vel.y * delta;
      p.pos.z += p.vel.z * delta;
      if (p.pos.y < 0) {
        p.pos.y = 0;
        p.vel.y = -p.vel.y * p.bounce;
        p.vel.x *= 0.8;
        p.vel.z *= 0.8;
      }
      p.obj.position = p.pos;
      p.obj.opacity = p.life;
      this.game.renderer.updateObjectTransform(p.obj);
    }
  }
}
