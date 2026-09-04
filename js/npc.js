import { Vec3 } from './math.js';
import { AnimPlayer } from './anim-player.js?v=0.1.4n';

/**
 * Non-hostile city NPC using the people pack models' own idle/walk clips.
 */
export class Npc {
  static STATE = { IDLE: 'idle', PATROL: 'patrol' };

  constructor(game, position, yaw = 0, asset = null) {
    this.game = game;
    this.position = position.clone();
    this.facingYaw = yaw;
    this.state = Npc.STATE.PATROL;
    this.stateTimer = 1 + Math.random() * 2;
    this.patrolRadius = 8 + Math.random() * 10;
    this.speed = 1.4 + Math.random() * 0.8;
    this.targetPosition = null;
    this.parts = [];
    this.anim = null;
    this.asset = asset;
    this.home = position.clone();
    this.idleClip = null;
    this.walkClip = null;
  }

  init() {
    if (!this.asset) return false;
    const { geoName, skinned, scale, yOffset, yawOffset, idleClip, walkClip } = this.asset;
    const obj = this.game.renderer.addSkinnedObject(
      geoName,
      new Vec3(this.position.x, this.position.y + yOffset, this.position.z),
      new Vec3(scale, scale, scale),
      0,
      [1, 1, 1],
      [0, 0, 0],
      1
    );
    this.anim = new AnimPlayer(skinned);
    this.anim.time = Math.random() * 1.5;
    this.idleClip = idleClip;
    this.walkClip = walkClip;
    this.anim.play(this.idleClip);
    this.game.renderer.updateSkinnedJoints(obj, this.anim.jointMatrices);
    this.parts.push({
      obj,
      offsetX: 0,
      offsetY: yOffset,
      offsetZ: 0,
      yawOffset: yawOffset || 0,
    });
    this._pickPatrolTarget();
    return true;
  }

  update(delta) {
    if (!this.anim || this.parts.length === 0) return;

    if (this.state === Npc.STATE.IDLE) {
      this.stateTimer -= delta;
      if (this.stateTimer <= 0) {
        this.state = Npc.STATE.PATROL;
        this._pickPatrolTarget();
      }
    } else if (this.state === Npc.STATE.PATROL) {
      if (!this.targetPosition) this._pickPatrolTarget();
      const dist = this.position.distanceTo(this.targetPosition);
      if (dist < 0.6) {
        this.state = Npc.STATE.IDLE;
        this.stateTimer = 1.5 + Math.random() * 3.5;
      } else {
        this._moveToward(this.targetPosition, this.speed, delta);
      }
    }

    this.position.y = 0;
    this._updateAnim(delta);
    this._syncParts();
  }

  _updateAnim(delta) {
    const clip = this.state === Npc.STATE.PATROL ? this.walkClip : this.idleClip;
    if (clip) this.anim.play(clip, { loop: true, reset: this.anim.clipName !== clip });
    this.anim.update(delta);
    for (const p of this.parts) {
      this.game.renderer.updateSkinnedJoints(p.obj, this.anim.jointMatrices);
    }
  }

  _syncParts() {
    for (const p of this.parts) {
      p.obj.position.set(
        this.position.x + p.offsetX,
        this.position.y + p.offsetY,
        this.position.z + p.offsetZ
      );
      p.obj.rotationY = this.facingYaw + (p.yawOffset || 0);
      this.game.renderer.updateObjectTransform(p.obj);
    }
  }

  _pickPatrolTarget() {
    const bodyR = 0.45;
    // Prefer continuing roughly forward so they don't u-turn every few seconds.
    for (let attempt = 0; attempt < 16; attempt++) {
      const forwardBias = attempt < 10;
      const yaw = forwardBias
        ? this.facingYaw + (Math.random() - 0.5) * Math.PI * 0.9
        : Math.random() * Math.PI * 2;
      const dist = 2 + Math.random() * this.patrolRadius;
      let x = this.position.x + Math.sin(yaw) * dist;
      let z = this.position.z + Math.cos(yaw) * dist;
      const hx = x - this.home.x;
      const hz = z - this.home.z;
      const hd = Math.hypot(hx, hz);
      if (hd > this.patrolRadius) {
        x = this.home.x + (hx / hd) * this.patrolRadius;
        z = this.home.z + (hz / hd) * this.patrolRadius;
      }
      if (!this.game.world.checkCollision(x, z, bodyR)) {
        this.targetPosition = new Vec3(x, 0, z);
        return;
      }
    }
    const fx = this.position.x + Math.sin(this.facingYaw) * 2;
    const fz = this.position.z + Math.cos(this.facingYaw) * 2;
    this.targetPosition = !this.game.world.checkCollision(fx, fz, bodyR)
      ? new Vec3(fx, 0, fz)
      : this.position.clone();
  }

  _moveToward(target, speed, delta) {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;

    // Face the destination, then step along that facing so the walk clip matches travel.
    this.facingYaw = Math.atan2(dx, dz);
    const mx = Math.sin(this.facingYaw);
    const mz = Math.cos(this.facingYaw);
    const step = speed * delta;
    const oldX = this.position.x;
    const oldZ = this.position.z;
    const newX = oldX + mx * step;
    const newZ = oldZ + mz * step;
    const r = 0.45;

    if (!this.game.world.checkCollision(newX, newZ, r)) {
      this.position.x = newX;
      this.position.z = newZ;
      return;
    }

    // Axis slide only if it still roughly matches facing; then face the slide direction.
    if (!this.game.world.checkCollision(newX, oldZ, r) && Math.abs(mx) >= 0.25) {
      this.position.x = newX;
      this.facingYaw = Math.atan2(Math.sign(mx), 0);
      return;
    }
    if (!this.game.world.checkCollision(oldX, newZ, r) && Math.abs(mz) >= 0.25) {
      this.position.z = newZ;
      this.facingYaw = Math.atan2(0, Math.sign(mz) || 1);
      return;
    }

    this.state = Npc.STATE.IDLE;
    this.stateTimer = 1 + Math.random() * 2;
    this._pickPatrolTarget();
  }

  dispose() {
    for (const p of this.parts) this.game.renderer.removeObject(p.obj);
    this.parts = [];
    this.anim = null;
  }
}
