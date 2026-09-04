import { Vec3 } from './math.js';
import { loadGLBSkinned } from './gltf-loader.js?v=0.1.4n';
import { AnimPlayer } from './anim-player.js?v=0.1.4n';
import { Npc } from './npc.js?v=0.1.4p';

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

export class NpcManager {
  constructor(game) {
    this.game = game;
    this.npcs = [];
    this.assets = {};
  }

  async init() {
    await this._preloadAssets();
    const props = this.game.world?.loadedWorldData?.props || [];
    // World props are mostly Animated Woman variants in one area; alternate those
    // onto the man mesh so streets aren't all female.
    let womanSlot = 0;
    for (const p of props) {
      if (!p?.model || !NPC_PROP_MODELS.has(p.model)) continue;
      let key = resolveAssetKey(p.model);
      if (key === 'woman' && this.assets.man) {
        if (womanSlot % 2 === 0) key = 'man';
        womanSlot += 1;
      }
      const asset = this.assets[key] || this.assets.man || this.assets.woman;
      if (!asset) continue;
      const npc = new Npc(this.game, new Vec3(p.x, 0, p.z), p.rotY || 0, asset);
      if (npc.init()) this.npcs.push(npc);
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
    for (const npc of this.npcs) npc.update(delta);
  }
}
