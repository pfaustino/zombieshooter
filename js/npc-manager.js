import { Vec3 } from './math.js';
import { loadGLBSkinned } from './gltf-loader.js?v=0.1.4n';
import { AnimPlayer } from './anim-player.js?v=0.1.4n';
import { Npc } from './npc.js?v=0.1.33';

/** City people prop models replaced by animated NPCs. */
export const NPC_PROP_MODELS = new Set([
  'Man.glb',
  'Animated Woman.glb',
  'Animated Woman-nIItLV9nxS.glb',
  'Animated Woman-qJ2gsTUBHL.glb',
  'Adventurer.glb',
]);

const NPC_ASSET_FILES = {
  man: 'Man.glb',
  woman: 'Animated Woman.glb',
};

function pickClip(animations, kind) {
  const names = Object.keys(animations);
  if (kind === 'idle') {
    return names.find((n) => /(^|\|)(Man_Idle|Idle)$/i.test(n))
      || names.find((n) => /Idle_Neutral/i.test(n))
      || names.find((n) => /idle/i.test(n) && !/sit|gun|sword/i.test(n))
      || names.find((n) => /idle/i.test(n));
  }
  return names.find((n) => /(^|\|)(Man_Walk|Walking|Walk)$/i.test(n))
    || names.find((n) => /walk/i.test(n) && !/run/i.test(n))
    || names.find((n) => /walk/i.test(n));
}

function skinnedRestBounds(skinned, clipName) {
  const player = new AnimPlayer(skinned);
  if (clipName) player.play(clipName);
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

function resolveAssetKey(modelName) {
  const lower = (modelName || '').toLowerCase();
  if (lower.includes('woman')) return 'woman';
  return 'man';
}

/**
 * Street vendors give coins a purpose. One fixed item each so buying stays a
 * single keypress, and each stall reads as a landmark you learn to drive back to.
 */
export const TRADER_OFFERS = [
  {
    id: 'ammo',
    label: 'AMMO REFILL',
    price: 30,
    color: [1, 0.72, 0.15],
    emissive: [0.7, 0.45, 0.05],
    apply(player) {
      let filled = false;
      for (const w of player.weapons) {
        if (w.ammo < w.maxAmmo) { w.ammo = w.maxAmmo; filled = true; }
      }
      if (player.ammo < player.maxAmmo) { player.ammo = player.maxAmmo; filled = true; }
      if (!filled) return false;
      player.isReloading = false;
      player.reloadTimer = 0;
      player.reloadDuration = 0;
      return true;
    },
  },
  {
    id: 'medkit',
    label: 'MEDKIT +40 HP',
    price: 50,
    color: [0.25, 0.9, 0.35],
    emissive: [0.05, 0.6, 0.12],
    apply(player) {
      if (player.health >= 100) return false;
      player.health = Math.min(100, player.health + 40);
      return true;
    },
  },
  {
    id: 'armor',
    label: 'BODY ARMOR +50',
    price: 70,
    color: [0.35, 0.66, 1],
    emissive: [0.06, 0.3, 0.7],
    apply(player) {
      if (player.armor >= 100) return false;
      player.armor = Math.min(100, player.armor + 50);
      return true;
    },
  },
];

const TRADER_EVERY = 3;
const PANIC_SCAN_INTERVAL = 0.3;
const ZOMBIE_PANIC_RANGE = 13;

export class NpcManager {
  constructor(game) {
    this.game = game;
    this.npcs = [];
    this.assets = {};
    this._panicScanTimer = 0;
  }

  async init() {
    await this._preloadAssets();
    this._spawnFromProps();
  }

  _spawnFromProps() {
    const props = this.game.world?.loadedWorldData?.props || [];
    // World props are mostly Animated Woman variants in one area; alternate those
    // onto the man mesh so streets aren't all female.
    let womanSlot = 0;
    let placed = 0;
    let traderSlot = 0;
    for (const p of props) {
      if (!p?.model || !NPC_PROP_MODELS.has(p.model)) continue;
      if (this.game.world.isOnRoad?.(p.x, p.z, 1)) continue;
      let key = resolveAssetKey(p.model);
      if (key === 'woman' && this.assets.man) {
        if (womanSlot % 2 === 0) key = 'man';
        womanSlot += 1;
      }
      const asset = this.assets[key] || this.assets.man || this.assets.woman;
      if (!asset) continue;

      const isTrader = placed % TRADER_EVERY === 0;
      const options = isTrader
        ? { role: Npc.ROLE.TRADER, offer: TRADER_OFFERS[traderSlot % TRADER_OFFERS.length] }
        : {};
      if (isTrader) traderSlot += 1;

      const npc = new Npc(this.game, new Vec3(p.x, 0, p.z), p.rotY || 0, asset, options);
      if (npc.init()) {
        this.npcs.push(npc);
        placed += 1;
      }
    }
  }

  async _preloadAssets() {
    for (const [key, file] of Object.entries(NPC_ASSET_FILES)) {
      const urls = [
        `assets/CityPack/${file}`,
        `assets/CityPack/${encodeURIComponent(file)}`,
      ];
      let loaded = null;
      for (const url of urls) {
        try {
          loaded = await loadGLBSkinned(url);
          break;
        } catch (err) {
          console.warn(`NPC asset failed ${url}:`, err);
        }
      }
      if (!loaded) continue;
      const idleClip = pickClip(loaded.animations, 'idle');
      const walkClip = pickClip(loaded.animations, 'walk');
      const bounds = skinnedRestBounds(loaded, idleClip);
      const targetH = 1.7;
      const scale = targetH / bounds.height;
      const yOffset = -bounds.minY * scale;
      const yawOffset = 0; // CityPack people face +Z; game yaw 0 is also +Z.
      const geoName = `npc:${key}`;
      this.game.renderer.registerSkinnedGeometry(geoName, loaded);
      this.assets[key] = {
        geoName,
        skinned: loaded,
        scale,
        yOffset,
        yawOffset,
        idleClip,
        walkClip,
      };
    }
  }

  update(delta) {
    this._panicScanTimer -= delta;
    if (this._panicScanTimer <= 0) {
      this._panicScanTimer = PANIC_SCAN_INTERVAL;
      this._scanForThreats();
    }
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const npc = this.npcs[i];
      if (npc.dead) {
        this.npcs.splice(i, 1);
        continue;
      }
      npc.update(delta);
    }
  }

  /** Civilians bolt when the undead — or a speeding car — get close. */
  _scanForThreats() {
    const enemies = this.game.enemyManager?.enemies;
    const vehicles = this.game.vehicleManager?.vehicles;
    const zr2 = ZOMBIE_PANIC_RANGE * ZOMBIE_PANIC_RANGE;

    for (const npc of this.npcs) {
      if (npc.dead || npc.isTrader()) continue;

      if (enemies) {
        for (const e of enemies) {
          if (!e || e.state === 'dead' || e.state === 'dying' || e.state === 'ragdoll') continue;
          const dx = e.position.x - npc.position.x;
          const dz = e.position.z - npc.position.z;
          if (dx * dx + dz * dz > zr2) continue;
          npc.panic(e.position, 3);
          break;
        }
      }

      if (vehicles && npc.state !== Npc.STATE.FLEE) {
        for (const v of vehicles) {
          if (!v?.loaded || v.destroyed) continue;
          const speed = Math.hypot(v.velocity?.x || 0, v.velocity?.z || 0);
          if (speed < 6) continue;
          const dx = v.position.x - npc.position.x;
          const dz = v.position.z - npc.position.z;
          if (dx * dx + dz * dz > 289) continue; // 17m
          npc.panic(v.position, 2.5);
          break;
        }
      }
    }
  }

  /** Gunfire scatters bystanders the same way it draws the horde. */
  panicNear(origin, radius = 30) {
    if (!origin) return;
    const r2 = radius * radius;
    for (const npc of this.npcs) {
      if (npc.dead || npc.isTrader()) continue;
      const dx = npc.position.x - origin.x;
      const dz = npc.position.z - origin.z;
      if (dx * dx + dz * dz > r2) continue;
      npc.panic(origin, 3);
    }
  }

  getTraderNear(position, range = 3.4) {
    if (!position) return null;
    let best = null;
    let bestDist = range * range;
    for (const npc of this.npcs) {
      if (npc.dead || !npc.isTrader()) continue;
      const dx = npc.position.x - position.x;
      const dz = npc.position.z - position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDist) {
        bestDist = d2;
        best = npc;
      }
    }
    return best;
  }

  resetForNewRun() {
    for (const npc of this.npcs) {
      try { npc.dispose(); } catch (_) {}
    }
    this.npcs = [];
    this._panicScanTimer = 0;
    this._spawnFromProps();
  }
}
