import { Vec3 } from './math.js';
import { AnimPlayer } from './anim-player.js?v=0.1.4n';

/**
 * Non-hostile city NPC using the people pack models' own idle/walk clips.
 */
export class Npc {
  static STATE = { IDLE: 'idle', PATROL: 'patrol', FLEE: 'flee' };
  static ROLE = { CIVILIAN: 'civilian', TRADER: 'trader' };

  constructor(game, position, yaw = 0, asset = null, options = {}) {
    this.game = game;
    this.position = position.clone();
    this.facingYaw = yaw;
    this.role = options.role || Npc.ROLE.CIVILIAN;
    this.offer = options.offer || null;
    this.state = this.role === Npc.ROLE.TRADER ? Npc.STATE.IDLE : Npc.STATE.PATROL;
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
    this.dead = false;
    this.fleeTimer = 0;
    this.threatPos = null;
    this.markerObj = null;
    this._markerPhase = Math.random() * Math.PI * 2;
  }

  isTrader() { return this.role === Npc.ROLE.TRADER && !!this.offer; }

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
    if (this.isTrader()) this._createMarker();
    else this._pickPatrolTarget();
    return true;
  }

  /** Floating icon so stalls stay findable across the city. */
  _createMarker() {
    this.markerObj = this.game.renderer.addObject(
      'sphere',
      new Vec3(this.position.x, this.position.y + 2.5, this.position.z),
      new Vec3(0.22, 0.22, 0.22),
      0,
      this.offer.color,
      this.offer.emissive,
      1
    );
  }

  _updateMarker(delta) {
    if (!this.markerObj) return;
    this._markerPhase += delta * 2.4;
    this.markerObj.position.set(
      this.position.x,
      this.position.y + 2.5 + Math.sin(this._markerPhase) * 0.14,
      this.position.z
    );
    this.markerObj.rotationY += delta * 1.6;
    this.game.renderer.updateObjectTransform(this.markerObj);
  }

  /**
   * Sells this stall's single item. Returns why it failed so the HUD can say so.
   */
  purchase(player) {
    if (!this.isTrader() || this.dead) return { ok: false, reason: 'none' };
    const offer = this.offer;
    if (player.money < offer.price) return { ok: false, reason: 'money', offer };
    if (!offer.apply(player)) return { ok: false, reason: 'full', offer };
    player.money -= offer.price;
    player.updateHUD();
    return { ok: true, offer };
  }

  update(delta) {
    if (this.dead || !this.anim || this.parts.length === 0) return;

    if (this.isTrader()) {
      this.anim.speed = 1;
      this.position.y = 0;
      this._updateAnim(delta);
      this._syncParts();
      this._updateMarker(delta);
      return;
    }

    if (this.state === Npc.STATE.FLEE) {
      this.fleeTimer -= delta;
      if (this.fleeTimer <= 0) {
        this.threatPos = null;
        this.state = Npc.STATE.PATROL;
        this._pickPatrolTarget();
      } else {
        this._updateFlee(delta);
      }
    } else if (this.state === Npc.STATE.IDLE) {
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
    this.anim.speed = this.state === Npc.STATE.FLEE ? 1.9 : 1;
    this._updateAnim(delta);
    this._syncParts();
  }

  /**
   * Scares a civilian into a sprint away from a threat. Traders hold their post.
   */
  panic(threatPos, duration = 3.5) {
    if (this.dead || this.isTrader() || !threatPos) return;
    this.threatPos = threatPos.clone ? threatPos.clone() : new Vec3(threatPos.x, 0, threatPos.z);
    this.state = Npc.STATE.FLEE;
    this.fleeTimer = Math.max(this.fleeTimer, duration);
    this.targetPosition = null;
  }

  _updateFlee(delta) {
    const away = new Vec3(
      this.position.x - (this.threatPos?.x ?? this.position.x - 1),
      0,
      this.position.z - (this.threatPos?.z ?? this.position.z)
    );
    let len = Math.hypot(away.x, away.z);
    if (len < 1e-4) {
      away.x = Math.sin(this.facingYaw);
      away.z = Math.cos(this.facingYaw);
      len = 1;
    }
    const target = new Vec3(
      this.position.x + (away.x / len) * 6,
      0,
      this.position.z + (away.z / len) * 6
    );
    // Roads are fair game while panicking — that's how they end up under your bumper.
    this._moveToward(target, this.speed * 2.6, delta, true);
  }

  _updateAnim(delta) {
    const moving = this.state === Npc.STATE.PATROL || this.state === Npc.STATE.FLEE;
    const clip = moving ? this.walkClip : this.idleClip;
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
      if (!this.game.world.checkCollision(x, z, bodyR) && !this.game.world.isOnRoad?.(x, z, 1)) {
        this.targetPosition = new Vec3(x, 0, z);
        return;
      }
    }
    const fx = this.position.x + Math.sin(this.facingYaw) * 2;
    const fz = this.position.z + Math.cos(this.facingYaw) * 2;
    this.targetPosition = (!this.game.world.checkCollision(fx, fz, bodyR) && !this.game.world.isOnRoad?.(fx, fz, 1))
      ? new Vec3(fx, 0, fz)
      : this.position.clone();
  }

  _moveToward(target, speed, delta, allowRoad = false) {
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
    const blocked = (x, z) =>
      this.game.world.checkCollision(x, z, r) ||
      (!allowRoad && this.game.world.isOnRoad?.(x, z, 0.5));

    if (!blocked(newX, newZ)) {
      this.position.x = newX;
      this.position.z = newZ;
      return;
    }

    // Axis slide only if it still roughly matches facing; then face the slide direction.
    if (!blocked(newX, oldZ) && Math.abs(mx) >= 0.25) {
      this.position.x = newX;
      this.facingYaw = Math.atan2(Math.sign(mx), 0);
      return;
    }
    if (!blocked(oldX, newZ) && Math.abs(mz) >= 0.25) {
      this.position.z = newZ;
      this.facingYaw = Math.atan2(0, Math.sign(mz) || 1);
      return;
    }

    // Cornered while fleeing: veer instead of freezing up against the wall.
    if (this.state === Npc.STATE.FLEE) {
      this.facingYaw += (Math.random() < 0.5 ? -1 : 1) * (Math.PI * 0.4);
      return;
    }

    this.state = Npc.STATE.IDLE;
    this.stateTimer = 1 + Math.random() * 2;
    this._pickPatrolTarget();
  }

  hitByVehicle(impactDir, speed = 10) {
    // Stalls survive traffic; losing a shop to a stray bumper would gut the economy.
    if (this.dead || this.isTrader()) return;
    this.dead = true;
    const bloodPos = this.position.clone();
    bloodPos.y = 0.5;
    const dir = impactDir?.clone?.() || new Vec3(0, 0, 1);
    this.game.particleSystem?.emitBlood?.(bloodPos, dir, 42 + Math.floor(speed * 1.2));
    this.game.particleSystem?.emit?.(bloodPos, 18, [0.45, 0.02, 0.02]);
    this.dispose();
  }

  dispose() {
    for (const p of this.parts) this.game.renderer.removeObject(p.obj);
    this.parts = [];
    if (this.markerObj) {
      this.game.renderer.removeObject(this.markerObj);
      this.markerObj = null;
    }
    this.anim = null;
  }
}
