import { Vec3, AABB, clamp } from './math.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.position = new Vec3(62, 1.7, 30);
    this.velocity = new Vec3();
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.isFiring = false;
    this.jumpCount = 0;
    this.maxJumps = 2;
    this.health = 100;
    this.armor = 0;
    this.money = 0;
    this.ammo = 12;
    this.maxAmmo = 12;
    this.moveSpeed = 14;
    this.sprintMultiplier = 1.6;
    this.jumpForce = 8;
    this.gravity = 25;
    this.playerHeight = 1.7;
    this.playerRadius = 0.4;
    this.ghostMode = false;
    this.shootCooldown = 0;
    this.shootRate = 0.3;
    this.isLocked = false;
    this.mouseSensitivity = 0.002;
    this._pointerLockJustAcquired = false;
    this.yaw = 0;
    this.pitch = 0;
    this.weaponRecoil = 0;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
    this.footstepTimer = 0;
    this.isInVehicle = false;
    this.vehicle = null;
    this.invertMouse = false;
    this.weapons = [
      { name: 'Pistol', model: 'Pistol.glb', damage: 20, fireRate: 0.3, ammo: 12, maxAmmo: 12, recoil: 0.1, cameraRecoil: 0, reloadTime: 1.5, automatic: false, modelScale: 0.35, localYaw: -Math.PI / 2, localPitch: -0.08, localRoll: -0.08, viewOffset: { x: 0.24, y: -0.22, z: 0.72 } },
      { name: 'Assault Rifle', model: 'AssaultRifle.glb', damage: 25, fireRate: 0.12, ammo: 30, maxAmmo: 30, recoil: 0.25, cameraRecoil: 0.005, reloadTime: 2.5, automatic: true, modelScale: 0.45, localYaw: Math.PI, localPitch: -0.06, localRoll: -0.06, viewOffset: { x: 0.24, y: -0.24, z: 0.78 } },
    ];
    this.currentWeapon = 0;
    this.weaponObj = null;
    this.weaponLoadToken = 0;
    this.weaponBobTime = 0;
    this.isSprinting = false;
    this.muzzleFlashObj = null;
    this.muzzleFlashTimer = 0;
    this.healthDisplay = document.getElementById('health');
    this.ammoDisplay = document.getElementById('ammo');
    this.reloadPrompt = document.getElementById('reload-prompt');
  }

  init() {
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
    document.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('mouseup', (e) => this.onMouseUp(e));
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    const pushed = this.game.world.pushOutOfWalls(this.position.x, this.position.z, this.playerRadius + 0.1);
    this.position.x = pushed.x;
    this.position.z = pushed.z;

    this.game.camera.position.copy(this.position);
    this.game.camera.yaw = this.yaw;
    this.game.camera.pitch = this.pitch;
    this.game.camera.updateView();

    this._createWeaponModel();
    this.ammo = this.weapons[0].ammo;
    this.maxAmmo = this.weapons[0].maxAmmo;
    this.shootRate = this.weapons[0].fireRate;
    this.updateHUD();
  }

  async _createWeaponModel() {
    const token = ++this.weaponLoadToken;
    if (this.weaponObj) this.game.renderer.removeObject(this.weaponObj);
    const weapon = this.getCurrentWeapon();
    const cam = this.game.camera;
    const fallbackPos = new Vec3(cam.position.x, cam.position.y - 0.25, cam.position.z);
    this.weaponObj = this.game.renderer.addObject('box',
      fallbackPos, new Vec3(0.08, 0.15, weapon.name === 'Pistol' ? 0.35 : 0.65), 0,
      [0.18, 0.18, 0.22], [0, 0, 0], 1);
    try {
      const loaded = await this.game.world._loadModelGeometry(weapon.model, 'assets');
      if (token !== this.weaponLoadToken) return;
      this.game.renderer.removeObject(this.weaponObj);
      this.weaponObj = this.game.renderer.addObject(loaded.name,
        fallbackPos, new Vec3(weapon.modelScale, weapon.modelScale, weapon.modelScale), 0,
        [1, 1, 1], [0, 0, 0], 1);
      this._updateWeaponModel();
    } catch (error) {
      console.warn(`Using fallback weapon model for ${weapon.name}:`, error);
    }
  }

  _updateWeaponModel() {
    if (!this.weaponObj) return;
    const cam = this.game.camera;
    const right = cam.getRight().normalize();
    const fwd = cam.getForward().normalize();
    const up = right.cross(fwd).normalize();
    const recoil = this.weaponRecoil;
    const weapon = this.getCurrentWeapon();
    const offset = weapon.viewOffset;
    const reloadAnim = this._getReloadAnim(weapon);
    const localX = offset.x + reloadAnim.offsetX;
    const localY = offset.y + recoil * 0.08 + reloadAnim.offsetY;
    const localZ = offset.z - recoil * 0.2 + reloadAnim.offsetZ;
    const pos = new Vec3(
      cam.position.x + right.x * localX + up.x * localY + fwd.x * localZ,
      cam.position.y + right.y * localX + up.y * localY + fwd.y * localZ,
      cam.position.z + right.z * localX + up.z * localY + fwd.z * localZ
    );
    this.weaponObj.position.copy(pos);
    this.weaponObj.modelMatrix = this._composeCameraWeaponMatrix(pos, right, up, fwd, weapon, reloadAnim);
    this.game.renderer.updateObjectTransform(this.weaponObj);

    if (this.muzzleFlashObj && this.muzzleFlashTimer > 0) {
      this.muzzleFlashObj.position.set(
        this.weaponObj.position.x + fwd.x * 0.45 + up.x * 0.04,
        this.weaponObj.position.y + fwd.y * 0.45 + up.y * 0.04,
        this.weaponObj.position.z + fwd.z * 0.45 + up.z * 0.04
      );
      this.game.renderer.updateObjectTransform(this.muzzleFlashObj);
      this.muzzleFlashObj.visible = this.muzzleFlashTimer > 0;
    }
  }

  _getReloadAnim(weapon) {
    if (!this.isReloading || this.reloadDuration <= 0) {
      return { pitch: 0, yaw: 0, roll: 0, offsetX: 0, offsetY: 0, offsetZ: 0 };
    }
    const progress = 1 - this.reloadTimer / this.reloadDuration;
    const peak = Math.sin(progress * Math.PI);
    if (weapon.name === 'Pistol') {
      return {
        pitch: peak * 0.65,
        yaw: peak * 0.08,
        roll: -peak * 0.18,
        offsetX: peak * 0.04,
        offsetY: -peak * 0.16,
        offsetZ: -peak * 0.12,
      };
    }
    return {
      pitch: peak * 0.42,
      yaw: -peak * 0.06,
      roll: peak * 0.22,
      offsetX: peak * 0.06,
      offsetY: -peak * 0.12,
      offsetZ: -peak * 0.08,
    };
  }

  _composeCameraWeaponMatrix(pos, right, up, fwd, weapon, anim = {}) {
    const s = weapon.modelScale;
    const pitch = (weapon.localPitch || 0) + (anim.pitch || 0);
    const yaw = (weapon.localYaw || 0) + (anim.yaw || 0);
    const roll = (weapon.localRoll || 0) + (anim.roll || 0);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const lx = new Vec3(cy * cr + sy * sp * sr, cp * sr, -sy * cr + cy * sp * sr);
    const ly = new Vec3(-cy * sr + sy * sp * cr, cp * cr, sy * sr + cy * sp * cr);
    const lz = new Vec3(sy * cp, -sp, cy * cp);
    const wx = new Vec3(
      right.x * lx.x + up.x * lx.y + fwd.x * lx.z,
      right.y * lx.x + up.y * lx.y + fwd.y * lx.z,
      right.z * lx.x + up.z * lx.y + fwd.z * lx.z
    ).normalize();
    const wy = new Vec3(
      right.x * ly.x + up.x * ly.y + fwd.x * ly.z,
      right.y * ly.x + up.y * ly.y + fwd.y * ly.z,
      right.z * ly.x + up.z * ly.y + fwd.z * ly.z
    ).normalize();
    const wz = new Vec3(
      right.x * lz.x + up.x * lz.y + fwd.x * lz.z,
      right.y * lz.x + up.y * lz.y + fwd.y * lz.z,
      right.z * lz.x + up.z * lz.y + fwd.z * lz.z
    ).normalize();
    const m = new Float32Array(16);
    m[0] = wx.x * s; m[1] = wx.y * s; m[2] = wx.z * s; m[3] = 0;
    m[4] = wy.x * s; m[5] = wy.y * s; m[6] = wy.z * s; m[7] = 0;
    m[8] = wz.x * s; m[9] = wz.y * s; m[10] = wz.z * s; m[11] = 0;
    m[12] = pos.x; m[13] = pos.y; m[14] = pos.z; m[15] = 1;
    return m;
  }

  lock() {
    this.isLocked = true;
    this._pointerLockJustAcquired = true;
    this.game.start();
  }

  unlock() {
    this.isLocked = false;
    this.isFiring = false;
    this.game.pause();
  }

  toggleVehicle() {
    if (this.isInVehicle) {
      this.exitVehicle();
    } else {
      if (this.game.vehicleManager) {
        const vehicle = this.game.vehicleManager.tryEnterVehicle(this);
        if (vehicle) {
          const hud = document.getElementById('vehicle-hud');
          if (hud) hud.classList.add('visible');
        }
      }
    }
  }

  exitVehicle() {
    if (!this.vehicle) return;
    this.vehicle.exit(this);
    const hud = document.getElementById('vehicle-hud');
    if (hud) hud.classList.remove('visible');
    const cam = this.game.camera;
    cam.position.copy(this.position);
    cam.yaw = this.yaw;
    cam.updateView();
  }

  _updateVehicleMode(delta) {
    if (!this.vehicle) return;
    this.vehicle.update(delta, this);
  }

  getAABB() {
    const feetY = this.position.y - this.playerHeight;
    return new AABB(
      new Vec3(this.position.x - this.playerRadius, feetY, this.position.z - this.playerRadius),
      new Vec3(this.position.x + this.playerRadius, this.position.y, this.position.z + this.playerRadius));
  }

  onKeyDown(event) {
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = true; break;
      case 'KeyS': case 'ArrowDown': this.moveBackward = true; break;
      case 'KeyA': case 'ArrowLeft': this.moveLeft = true; break;
      case 'KeyD': case 'ArrowRight': this.moveRight = true; break;
      case 'Space':
        if (this.jumpCount < this.maxJumps) {
          this.velocity.y = this.jumpForce * (this.jumpCount === 0 ? 1.0 : 0.8);
          this.jumpCount++;
          if (this.game.audioManager) this.game.audioManager.playJump();
        }
        break;
      case 'Digit1': this.switchWeapon(0); break;
      case 'Digit2': this.switchWeapon(1); break;
      case 'KeyG': this.ghostMode = !this.ghostMode; break;
      case 'KeyR':
        if (this.isInVehicle) this.exitVehicle();
        else this.reloadWeapon();
        break;
      case 'KeyF': this.toggleVehicle(); break;
    }
  }

  onKeyUp(event) {
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = false; break;
      case 'KeyS': case 'ArrowDown': this.moveBackward = false; break;
      case 'KeyA': case 'ArrowLeft': this.moveLeft = false; break;
      case 'KeyD': case 'ArrowRight': this.moveRight = false; break;
    }
  }

  onMouseDown(event) {
    if (!this.game.isRunning) return;
    if (this.isInVehicle) return;
    if (event.button === 0) { this.isFiring = true; this.shoot(); }
  }

  onMouseUp(event) {
    if (event.button === 0) this.isFiring = false;
  }

  onMouseMove(event) {
    if (!this.isLocked) return;
    if (this.isInVehicle) return;
    if (this._pointerLockJustAcquired) {
      this._pointerLockJustAcquired = false;
      return;
    }
    const sensitivity = this.mouseSensitivity || 0.002;
    const maxDelta = 100;
    const mx = Math.max(-maxDelta, Math.min(maxDelta, event.movementX));
    const my = Math.max(-maxDelta, Math.min(maxDelta, event.movementY));
    this.yaw -= mx * sensitivity;
    const pitchSign = this.invertMouse ? 1 : -1;
    this.pitch += pitchSign * my * sensitivity;
    this.pitch = clamp(this.pitch, -1.45, 1.45);
  }

  switchWeapon(index) {
    if (index < 0 || index >= this.weapons.length || index === this.currentWeapon) return;
    this.weapons[this.currentWeapon].ammo = this.ammo;
    this.currentWeapon = index;
    const w = this.weapons[index];
    this.ammo = w.ammo;
    this.maxAmmo = w.maxAmmo;
    this.shootRate = w.fireRate;
    this._createWeaponModel();
    this.updateHUD();
  }

  getCurrentWeapon() { return this.weapons[this.currentWeapon]; }

  reloadWeapon() {
    if (this.isReloading || this.ammo === this.maxAmmo) return;
    this.isReloading = true;
    this.reloadDuration = this.getCurrentWeapon().reloadTime || 1.5;
    this.reloadTimer = this.reloadDuration;
    if (this.game.audioManager) this.game.audioManager.playReload();
    this.updateHUD();
  }

  shoot() {
    if (this.shootCooldown > 0 || this.isReloading) return;
    if (this.ammo <= 0) {
      if (this.game.audioManager) this.game.audioManager.playEmptyGun();
      this.shootCooldown = 0.25;
      this.updateHUD();
      return;
    }
    this.shootCooldown = this.shootRate;
    this.ammo--;
    this.updateHUD();
    const weapon = this.getCurrentWeapon();
    if (this.game.audioManager) this.game.audioManager.playWeaponAction(weapon.name, 'shot');
    this.weaponRecoil = weapon.recoil || 0.15;
    this.pitch = clamp(this.pitch + (weapon.cameraRecoil || 0), -1.45, 1.45);

    const cam = this.game.camera;
    const origin = cam.position.clone();
    const dir = cam.getForward();

    const enemyHit = this.game.enemyManager.raycastEnemies(origin, dir, 1000);
    const worldHit = this.game.world.raycast(origin, dir, 1000);

    let hitEnemy = null;
    if (enemyHit && (!worldHit || enemyHit.distance < worldHit.distance)) hitEnemy = enemyHit.enemy;

    if (hitEnemy) {
      hitEnemy.takeDamage(weapon.damage);
      if (this.game.audioManager) this.game.audioManager.playEnemyHit();
      if (this.game.particleSystem) {
        const hitPos = origin.add(dir.mul(enemyHit.distance));
        this.game.particleSystem.emit(hitPos, 8, [0.8, 0, 0]);
      }
    } else if (worldHit) {
      if (this.game.audioManager) this.game.audioManager.playHit();
    }

    this._createMuzzleFlash();
  }

  _createMuzzleFlash() {
    if (!this.muzzleFlashObj) {
      this.muzzleFlashObj = this.game.renderer.addObject('sphere',
        new Vec3(0, -100, 0), new Vec3(0.15, 0.15, 0.15), 0,
        [1, 1, 0.6], [1, 0.8, 0.2], 1);
    }
    this.muzzleFlashTimer = 0.05;
    this.muzzleFlashObj.visible = true;
  }

  takeDamage(amount) {
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.5);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.health -= amount;
    if (this.game.audioManager) this.game.audioManager.playPlayerDamage();
    this.updateHUD();
    if (this.health <= 0) this.die();
  }

  die() {
    this.health = 0;
    this.updateHUD();
    this.game.gameOver();
  }

  collectLoot(type) {
    if (type === 'coin') { this.money += 10; }
    else if (type === 'cowboyhat') { this.armor = Math.min(100, this.armor + 25); }
    else if (type === 'potion') { this.health = Math.min(100, this.health + 30); }
    this.updateHUD();
  }

  updateHUD() {
    if (this.healthDisplay) this.healthDisplay.textContent = `Health: ${Math.max(0, Math.floor(this.health))}`;
    if (this.ammoDisplay) this.ammoDisplay.textContent = `Ammo: ${this.ammo}/${this.maxAmmo}`;
    if (this.reloadPrompt) {
      const show = this.ammo <= 0 && !this.isReloading && !this.isInVehicle;
      this.reloadPrompt.classList.toggle('visible', show);
    }
    const moneyDisp = document.getElementById('money');
    if (moneyDisp) moneyDisp.textContent = `Money: $${this.money}`;
    const armorDisp = document.getElementById('armor');
    if (armorDisp) armorDisp.textContent = `Armor: ${this.armor}`;
  }

  update(delta) {
    if (!this.isLocked) return;
    if (this.isInVehicle) { this._updateVehicleMode(delta); return; }
    const cam = this.game.camera;

    if (this.shootCooldown > 0) this.shootCooldown -= delta;
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= delta;
      if (this.muzzleFlashTimer <= 0 && this.muzzleFlashObj) this.muzzleFlashObj.visible = false;
    }

    if (this.isFiring && this.getCurrentWeapon().automatic) this.shoot();

    if (this.isReloading) {
      this.reloadTimer -= delta;
      if (this.reloadTimer <= 0) {
        this.isReloading = false;
        this.reloadTimer = 0;
        this.reloadDuration = 0;
        this.ammo = this.maxAmmo;
        this.updateHUD();
      }
    }

    if (this.weaponRecoil > 0) {
      this.weaponRecoil -= delta * 2;
      if (this.weaponRecoil < 0) this.weaponRecoil = 0;
    }

    this.velocity.y -= this.gravity * delta;

    const fwd = cam.getForwardHorizontal();
    const right = cam.getRight();
    let moveDir = new Vec3();
    if (this.moveForward) moveDir = moveDir.add(fwd);
    if (this.moveBackward) moveDir = moveDir.sub(fwd);
    if (this.moveRight) moveDir = moveDir.add(right);
    if (this.moveLeft) moveDir = moveDir.sub(right);
    const moving = moveDir.lengthSq() > 0;
    if (moving) moveDir = moveDir.normalize();
    this.isSprinting = moving && (this.game.inputManager?.isAnyDown('ShiftLeft', 'ShiftRight') || false);
    const currentSpeed = this.moveSpeed * (this.isSprinting ? this.sprintMultiplier : 1);

    const oldX = this.position.x, oldZ = this.position.z;
    this.position.x += moveDir.x * currentSpeed * delta;
    this.position.z += moveDir.z * currentSpeed * delta;

    if (!this.ghostMode) {
      const feetY = this.position.y - this.playerHeight;
      if (this.game.world.checkCollision3D(this.position.x, feetY, this.position.z, this.playerRadius, this.playerHeight)) {
        const pushed = this.game.world.pushOutOfWalls(this.position.x, this.position.z, this.playerRadius + 0.05);
        this.position.x = pushed.x;
        this.position.z = pushed.z;
        if (this.game.world.checkCollision3D(this.position.x, feetY, this.position.z, this.playerRadius, this.playerHeight)) {
          this.position.x = oldX;
          this.position.z = oldZ;
        }
      }
    }

    this.position.y += this.velocity.y * delta;
    const groundHeight = this.game.world.getGroundHeight(this.position.x, this.position.z);
    const feetY = this.position.y - this.playerHeight;
    if (feetY <= groundHeight) {
      this.velocity.y = 0;
      this.position.y = groundHeight + this.playerHeight;
      this.jumpCount = 0;
    }

    if ((this.moveForward || this.moveBackward || this.moveLeft || this.moveRight) && feetY <= groundHeight) {
      this.footstepTimer += delta;
      if (this.footstepTimer > 0.35) {
        this.footstepTimer = 0;
        if (this.game.audioManager) this.game.audioManager.playFootstep();
      }
    }

    cam.position.copy(this.position);
    cam.yaw = this.yaw;
    cam.pitch = this.pitch;
    cam.updateView();

    this._updateWeaponModel();

    const posDisplay = document.getElementById('position');
    if (posDisplay) posDisplay.textContent = `Pos: ${this.position.x.toFixed(1)}, ${this.position.y.toFixed(1)}, ${this.position.z.toFixed(1)}`;
  }
}
