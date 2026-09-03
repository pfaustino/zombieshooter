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
      const size = 0.06 + Math.random() * 0.06;
      const obj = this.game.renderer.addObject('sphere', pos, new Vec3(size, size, size), 0, color, [0, 0, 0], 1);
      this.particles.push({ obj, vel, pos, life: 1.0, gravity: 10, bounce: 0.3 });
    }
  }

  /** Blood spray in a cone along `direction` (shot / impact outward). */
  emitBlood(position, direction, count = 18) {
    const dir = direction.clone();
    const len = dir.length() || 1;
    dir.x /= len; dir.y /= len; dir.z /= len;
    // Prefer spraying outward from the wound (away from shooter).
    const outX = dir.x;
    const outY = Math.max(0.15, dir.y * 0.35 + 0.25);
    const outZ = dir.z;
    for (let i = 0; i < count; i++) {
      const speed = 4 + Math.random() * 7;
      const spread = 0.55;
      const vel = new Vec3(
        (outX + (Math.random() - 0.5) * spread) * speed,
        (outY + Math.random() * 0.7) * speed * 0.85,
        (outZ + (Math.random() - 0.5) * spread) * speed);
      const pos = new Vec3(
        position.x + (Math.random() - 0.5) * 0.12,
        position.y + (Math.random() - 0.5) * 0.12,
        position.z + (Math.random() - 0.5) * 0.12);
      const shade = 0.35 + Math.random() * 0.45;
      const color = [shade, 0.02, 0.02];
      const size = 0.045 + Math.random() * 0.07;
      const obj = this.game.renderer.addObject(
        'sphere', pos, new Vec3(size, size, size), 0, color, [shade * 0.25, 0, 0], 1);
      this.particles.push({
        obj, vel, pos,
        life: 0.7 + Math.random() * 0.55,
        gravity: 14 + Math.random() * 6,
        bounce: 0.15,
      });
    }
  }

  update(delta) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta * 1.6;
      if (p.life <= 0) {
        this.game.renderer.removeObject(p.obj);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * delta;
      p.pos.x += p.vel.x * delta;
      p.pos.y += p.vel.y * delta;
      p.pos.z += p.vel.z * delta;
      if (p.pos.y < 0.02) {
        p.pos.y = 0.02;
        p.vel.y = -p.vel.y * p.bounce;
        p.vel.x *= 0.65;
        p.vel.z *= 0.65;
      }
      p.obj.position.set(p.pos.x, p.pos.y, p.pos.z);
      p.obj.opacity = Math.max(0, Math.min(1, p.life));
      this.game.renderer.updateObjectTransform(p.obj);
    }
  }
}
