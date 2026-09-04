import { Renderer } from './renderer.js?v=0.1.4e';
import { Camera } from './camera.js';
import { Player } from './player.js?v=0.1.4s';
import { World } from './world.js?v=0.1.4g';
import { InputManager } from './input-manager.js';
import { EnemyManager } from './enemy-manager.js?v=0.1.4r';
import { AudioManager } from './audio-manager.js?v=0.1.4s';
import { LootManager } from './loot-manager.js';
import { ParticleSystem } from './particle-system.js?v=0.1.4c';
import { VehicleManager } from './vehicle-manager.js?v=0.1.4';
import { NpcManager } from './npc-manager.js?v=0.1.4p';
import { loadEngine } from './engine-loader.js';

export class Game {
  constructor() {
    this.canvas = null;
    this.renderer = null;
    this.camera = null;
    this.player = null;
    this.world = null;
    this.inputManager = null;
    this.enemyManager = null;
    this.audioManager = null;
    this.lootManager = null;
    this.particleSystem = null;
    this.isRunning = false;
    this.lastTime = 0;
    this.engine = null;
    this.blocker = document.getElementById('blocker');
    this.crosshair = document.getElementById('crosshair');
    this.hud = document.getElementById('hud');
  }

  async init() {
    if (!navigator.gpu) {
      const loading = document.getElementById('loading');
      if (loading) loading.innerHTML = '<div style="text-align:center;color:#ff4444;"><h1>WebGPU Not Supported</h1><p style="margin:20px;color:#aaa;">This game requires WebGPU. Please use Chrome 113+ or Edge 113+.</p></div>';
      return;
    }

    this._updateLoading(10, 'Loading engine...');
    this.engine = await loadEngine();
    if (this.engine) console.log('Particle Realms engine loaded:', Object.keys(this.engine).slice(0, 10));

    this._updateLoading(25, 'Initializing renderer...');
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new Renderer(this.canvas);
    await this.renderer.init();

    this.camera = new Camera(75 * Math.PI / 180, this.renderer.aspect, 0.1, 1000);

    this.inputManager = new InputManager(this);
    this.world = new World(this);
    this.player = new Player(this);
    this.enemyManager = new EnemyManager(this);
    this.audioManager = new AudioManager(this);
    this.lootManager = new LootManager(this);
    this.particleSystem = new ParticleSystem(this);
    this.vehicleManager = new VehicleManager(this);
    this.npcManager = new NpcManager(this);

    this._updateLoading(40, 'Loading world assets...');
    this.world.init();
    await this.world.loadCityAssets();

    this._updateLoading(65, 'Spawning player...');
    const safeSpawn = this.world.findSafeSpawn(0, 0, 60);
    this.player.position.set(safeSpawn.x, safeSpawn.y, safeSpawn.z);
    this.player.yaw = 0;
    this.player.pitch = 0;

    this.player.init();
    this.inputManager.init();
    await this.enemyManager.init();
    await this.npcManager.init();
    this.audioManager.init();
    this.lootManager.init();
    this.particleSystem.init();
    await this.vehicleManager.init();

    this._updateLoading(85, 'Setting up UI...');
    window.addEventListener('resize', () => this.onWindowResize());
    this.setupUI();
    this.lastTime = performance.now();
    this.animate();

    this._updateLoading(100, 'Ready!');
    setTimeout(() => {
      const loading = document.getElementById('loading');
      if (loading) loading.classList.add('hidden');
    }, 400);
    console.log('Game initialized');
  }

  _updateLoading(pct, text) {
    const bar = document.getElementById('loading-bar-fill');
    if (bar) bar.style.width = pct + '%';
    const label = document.getElementById('loading-text');
    if (label && text) label.textContent = text;
  }

  setupUI() {
    this.settings = this._defaultSettings();
    this._loadSettings();
    this._pendingSettings = null;

    const screens = {
      main: document.getElementById('main-menu'),
      settings: document.getElementById('settings-menu'),
      about: document.getElementById('about-menu'),
      credits: document.getElementById('credits-menu'),
    };
    const showScreen = (name) => {
      Object.values(screens).forEach(s => s.classList.add('hidden'));
      screens[name].classList.remove('hidden');
    };

    document.getElementById('btn-resume').addEventListener('click', () => {
      this.player.lock();
      this.canvas.requestPointerLock();
    });

    document.getElementById('btn-settings').addEventListener('click', () => showScreen('settings'));
    document.getElementById('btn-about').addEventListener('click', () => showScreen('about'));
    document.getElementById('btn-credits').addEventListener('click', () => showScreen('credits'));

    document.querySelectorAll('.btn-back').forEach(btn => {
      btn.addEventListener('click', () => showScreen(btn.dataset.target || 'main'));
    });

    this._setupSettingsControlCenter(showScreen);
    this._applySettingsToUI();
    this._applyAllSettings();

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.canvas) {
        this.player.lock();
      } else {
        if (this.isRunning) this.player.unlock();
      }
    });
  }

  _showFeedback(text) {
    const el = document.getElementById('set-feedback');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._feedbackTimer);
    this._feedbackTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  _setupSettingsControlCenter(showScreen) {
    const cats = document.querySelectorAll('.settings-cat');
    const panes = document.querySelectorAll('.settings-pane');

    cats.forEach(cat => {
      cat.addEventListener('click', () => {
        cats.forEach(c => c.classList.remove('active'));
        panes.forEach(p => p.classList.remove('active'));
        cat.classList.add('active');
        const pane = document.getElementById('pane-' + cat.dataset.cat);
        if (pane) pane.classList.add('active');
      });
    });

    const searchInput = document.getElementById('settings-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
          panes.forEach(p => p.style.display = '');
          document.querySelectorAll('.set-card').forEach(c => c.style.display = '');
          return;
        }
        let foundAny = false;
        panes.forEach(pane => {
          let paneHasMatch = false;
          pane.querySelectorAll('.set-card').forEach(card => {
            const searchData = (card.dataset-search || '').toLowerCase() + ' ' + card.textContent.toLowerCase();
            const match = searchData.includes(query);
            card.style.display = match ? '' : 'none';
            if (match) paneHasMatch = true;
          });
          pane.style.display = paneHasMatch ? 'block' : 'none';
          if (paneHasMatch) foundAny = true;
        });
        if (!foundAny) {
          panes.forEach(p => p.style.display = 'none');
        }
      });
    }

    const closeBtn = document.getElementById('settings-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => showScreen('main'));

    const setupToggle = (id, key, callback, instant) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', () => {
        el.classList.toggle('on');
        const v = el.classList.contains('on');
        this.settings[key] = v;
        if (instant !== false) {
          if (callback) callback(v);
          this._persistSettings();
          this._showFeedback('Saved');
        }
      });
    };

    const setupSlider = (id, valId, key, transform, callback) => {
      const slider = document.getElementById(id);
      const valEl = document.getElementById(valId);
      if (!slider) return;
      slider.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        this.settings[key] = transform ? transform(v) : v;
        if (valEl) valEl.textContent = v + (valEl.textContent.includes('%') ? '%' : '');
        if (callback) callback(v);
        this._persistSettings();
        this._showFeedback('Saved');
      });
    };

    const setupSelect = (id, key, callback) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', (e) => {
        this.settings[key] = e.target.value;
        if (callback) callback(e.target.value);
        this._persistSettings();
        this._showFeedback('Saved');
      });
    };

    // General
    setupSelect('set-language', 'language');
    document.getElementById('set-reset-all')?.addEventListener('click', () => {
      this._resetAllSettings();
      this._showFeedback('Settings reset');
    });
    document.getElementById('set-export')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(this.settings, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'zombie-shooter-settings.json'; a.click();
      URL.revokeObjectURL(url);
      this._showFeedback('Settings exported');
    });
    document.getElementById('set-import')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json';
      input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const imported = JSON.parse(ev.target.result);
            Object.assign(this.settings, imported);
            this._persistSettings();
            this._applySettingsToUI();
            this._applyAllSettings();
            this._showFeedback('Settings imported');
          } catch (err) { this._showFeedback('Import failed'); }
        };
        reader.readAsText(file);
      });
      input.click();
    });

    // Appearance
    setupSelect('set-theme', 'theme', (v) => this._applyTheme(v));
    document.querySelectorAll('.set-color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        document.querySelectorAll('.set-color-swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
        this.settings.accentColor = sw.dataset.color;
        this._applyAccentColor(sw.dataset.color);
        this._persistSettings();
        this._showFeedback('Saved');
      });
    });
    setupSlider('set-uiscale', 'val-uiscale', 'uiScale', null, (v) => {
      document.documentElement.style.fontSize = v + '%';
    });
    setupToggle('set-motion', 'motionEffects');
    setupSelect('set-crosshair', 'crosshairStyle', (v) => this._updateCrosshairStyle(v));

    // Renderer
    setupSlider('set-renderscale', 'val-renderscale', 'renderScale', v => v / 100, (v) => {
      if (this.renderer) this.renderer.setRenderScale(v / 100);
    });
    setupSlider('set-fov', 'val-fov', 'fov', null, (v) => {
      if (this.camera) { this.camera.fov = v * Math.PI / 180; this.camera.updateAspect(this.renderer.aspect); }
    });
    setupToggle('set-aa', 'aa', (v) => { if (this.renderer) this.renderer.setMSAA(v); });
    setupToggle('set-shadows', 'shadows');
    setupToggle('set-bloom', 'bloom');
    setupToggle('set-grid', 'grid', (v) => { if (this.renderer) this.renderer.setGridVisible(v); });
    setupSelect('set-fpscap', 'fpsCap', (v) => { this.settings.fpsCap = parseInt(v); });
    setupSelect('set-particles', 'particleQuality');

    // Audio
    const setupAudioSlider = (id, valId, key, amKey) => {
      const slider = document.getElementById(id);
      const valEl = document.getElementById(valId);
      if (!slider) return;
      slider.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        this.settings[key] = v / 100;
        if (valEl) valEl.textContent = v + '%';
        if (this.audioManager) {
          const am = this.audioManager;
          if (amKey === 'masterVolume' && am.setMasterVolume) am.setMasterVolume(v / 100);
          else if (amKey === 'musicVolume' && am.setMusicVolume) am.setMusicVolume(v / 100);
          else am[amKey] = v / 100;
        }
        this._persistSettings();
        this._showFeedback('Saved');
      });
    };
    setupAudioSlider('set-master', 'val-master', 'masterVolume', 'masterVolume');
    setupAudioSlider('set-music', 'val-music', 'musicVolume', 'musicVolume');
    setupAudioSlider('set-sfx', 'val-sfx', 'sfxVolume', 'sfxVolume');
    setupAudioSlider('set-voice', 'val-voice', 'voiceVolume', 'voiceVolume');

    // Controls
    setupSlider('set-sensitivity', 'val-sensitivity', 'sensitivity', v => v * 0.0004, (v) => {
      if (this.player) this.player.mouseSensitivity = v * 0.0004;
    });
    setupToggle('set-invert', 'invertMouse', (v) => { if (this.player) this.player.invertMouse = v; });
    document.getElementById('set-view-keys')?.addEventListener('click', () => {
      showScreen('about');
    });

    // Gameplay
    setupSelect('set-difficulty', 'difficulty', (v) => {
      if (this.enemyManager) this.enemyManager.setDifficulty(parseInt(v));
    });
    setupToggle('set-fps', 'showFps', (v) => {
      const fps = document.getElementById('fps-counter');
      if (fps) fps.style.display = v ? 'block' : 'none';
    });
    setupToggle('set-position', 'showPosition', (v) => {
      const pos = document.getElementById('hud-top');
      if (pos) pos.style.display = v ? 'flex' : 'none';
    });
    setupToggle('set-autoreload', 'autoReload');

    // Developer
    setupToggle('set-debug', 'debugOverlay');
    setupToggle('set-logs', 'consoleLogs');
    setupToggle('set-experimental', 'experimentalFlags');
    setupToggle('set-shadercache', 'shaderCache');
    document.getElementById('set-clear-shaders')?.addEventListener('click', () => {
      try { localStorage.removeItem('shaderCache'); } catch(e) {}
      this._showFeedback('Shader cache cleared');
    });
    document.getElementById('set-hard-reset')?.addEventListener('click', () => {
      if (confirm('Hard reset will reload the page. Continue?')) location.reload();
    });

    // About pane — detect GPU info
    if (navigator.gpu) {
      navigator.gpu.requestAdapterInfo?.().then(info => {
        const el = document.getElementById('set-gpu-info');
        if (el && info) el.textContent = `${info.vendor || 'Unknown'} — ${info.architecture || 'Unknown'} — ${info.description || 'WebGPU'}`;
      }).catch(() => {
        const el = document.getElementById('set-gpu-info');
        if (el) el.textContent = 'WebGPU adapter (info unavailable)';
      });
    }

    // Footer
    document.getElementById('set-footer-reset')?.addEventListener('click', () => {
      this._resetAllSettings();
      this._showFeedback('Reset to defaults');
    });
    document.getElementById('set-footer-cancel')?.addEventListener('click', () => showScreen('main'));
    document.getElementById('set-footer-apply')?.addEventListener('click', () => {
      this._applyAllSettings();
      this._persistSettings();
      this._showFeedback('Settings applied');
      showScreen('main');
    });
  }

  _defaultSettings() {
    return {
      renderScale: 1.0, fov: 75, aa: true, shadows: true, bloom: true, grid: true,
      fpsCap: 60, particleQuality: 'medium',
      masterVolume: 0.8, musicVolume: 0.3, sfxVolume: 0.7, voiceVolume: 0.6,
      difficulty: 3, sensitivity: 0.002, crosshairStyle: 'cross-dot',
      showFps: false, showPosition: true, autoReload: true,
      theme: 'dark', accentColor: '#00ff88', uiScale: 100, motionEffects: true,
      invertMouse: false, language: 'English',
      debugOverlay: false, consoleLogs: true, experimentalFlags: false, shaderCache: true,
    };
  }

  _persistSettings() {
    try {
      localStorage.setItem('zombie-shooter-settings', JSON.stringify(this.settings));
    } catch (e) {
      console.warn('Failed to save settings:', e);
    }
  }

  _loadSettings() {
    try {
      const raw = localStorage.getItem('zombie-shooter-settings');
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') Object.assign(this.settings, saved);
    } catch (e) {
      console.warn('Failed to load settings:', e);
    }
  }

  _applySettingsToUI() {
    const s = this.settings;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const toggle = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle('on', on); };
    const text = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set('set-renderscale', Math.round(s.renderScale * 100));
    text('val-renderscale', Math.round(s.renderScale * 100) + '%');
    set('set-fov', s.fov);
    text('val-fov', s.fov);
    toggle('set-aa', s.aa);
    toggle('set-shadows', s.shadows);
    toggle('set-bloom', s.bloom);
    toggle('set-grid', s.grid);
    set('set-fpscap', s.fpsCap);
    set('set-particles', s.particleQuality);

    set('set-master', Math.round(s.masterVolume * 100));
    text('val-master', Math.round(s.masterVolume * 100) + '%');
    set('set-music', Math.round(s.musicVolume * 100));
    text('val-music', Math.round(s.musicVolume * 100) + '%');
    set('set-sfx', Math.round(s.sfxVolume * 100));
    text('val-sfx', Math.round(s.sfxVolume * 100) + '%');
    set('set-voice', Math.round(s.voiceVolume * 100));
    text('val-voice', Math.round(s.voiceVolume * 100) + '%');

    set('set-difficulty', s.difficulty);
    toggle('set-fps', s.showFps);
    toggle('set-position', s.showPosition);
    toggle('set-autoreload', s.autoReload);

    set('set-sensitivity', Math.round(s.sensitivity / 0.0004));
    text('val-sensitivity', Math.round(s.sensitivity / 0.0004));
    toggle('set-invert', s.invertMouse);

    set('set-theme', s.theme);
    set('set-crosshair', s.crosshairStyle);
    set('set-uiscale', s.uiScale);
    text('val-uiscale', s.uiScale + '%');
    toggle('set-motion', s.motionEffects);

    toggle('set-debug', s.debugOverlay);
    toggle('set-logs', s.consoleLogs);
    toggle('set-experimental', s.experimentalFlags);
    toggle('set-shadercache', s.shaderCache);
  }

  _applyAllSettings() {
    const s = this.settings;
    if (this.renderer) {
      this.renderer.setRenderScale(s.renderScale);
      this.renderer.setMSAA(s.aa);
      this.renderer.setGridVisible(s.grid);
    }
    if (this.camera) {
      this.camera.fov = s.fov * Math.PI / 180;
      this.camera.updateAspect(this.renderer.aspect);
    }
    if (this.audioManager) {
      this.audioManager.setMasterVolume?.(s.masterVolume);
      this.audioManager.setMusicVolume?.(s.musicVolume);
      this.audioManager.sfxVolume = s.sfxVolume;
      this.audioManager.voiceVolume = s.voiceVolume;
    }
    if (this.player) this.player.mouseSensitivity = s.sensitivity;
    if (this.enemyManager) this.enemyManager.setDifficulty(s.difficulty);
    this._applyTheme(s.theme);
    this._applyAccentColor(s.accentColor);
    this._updateCrosshairStyle(s.crosshairStyle);
    document.documentElement.style.fontSize = s.uiScale + '%';
  }

  _applyTheme(theme) {
    if (theme === 'light') {
      document.body.style.background = '#e0e0ea';
    } else {
      document.body.style.background = '#0a0a14';
    }
  }

  _applyAccentColor(color) {
    document.documentElement.style.setProperty('--accent', color);
  }

  _resetAllSettings() {
    this.settings = this._defaultSettings();
    this._persistSettings();
    this._applySettingsToUI();
    this._applyAllSettings();
  }

  _updateCrosshairStyle(style) {
    const ch = document.getElementById('crosshair');
    if (!ch) return;
    ch.querySelectorAll('.ch-line').forEach(el => el.style.display = 'none');
    const dot = ch.querySelector('.ch-dot');
    if (dot) dot.style.display = 'none';
    if (style === 'cross' || style === 'cross-dot') {
      ch.querySelectorAll('.ch-line').forEach(el => el.style.display = 'block');
    }
    if (style === 'dot' || style === 'cross-dot') {
      if (dot) dot.style.display = 'block';
    }
    if (style === 'circle') {
      if (dot) { dot.style.display = 'block'; dot.style.width = '16px'; dot.style.height = '16px'; dot.style.borderRadius = '50%'; dot.style.background = 'transparent'; dot.style.border = '2px solid rgba(0,255,136,0.8)'; }
    } else {
      if (dot) { dot.style.width = '2px'; dot.style.height = '2px'; dot.style.borderRadius = '50%'; dot.style.background = '#00ff88'; dot.style.border = 'none'; }
    }
  }

  start() {
    this.isRunning = true;
    if (this.blocker) this.blocker.classList.add('hidden');
    if (this.crosshair) this.crosshair.classList.add('visible');
    if (this.hud) this.hud.classList.add('visible');
    const hudTop = document.getElementById('hud-top');
    if (hudTop && this.settings?.showPosition) hudTop.classList.add('visible');
    if (this.enemyManager?.updateWaveTimerDisplay) this.enemyManager.updateWaveTimerDisplay();
  }

  pause() {
    this.isRunning = false;
    if (this.blocker) this.blocker.classList.remove('hidden');
    if (this.crosshair) this.crosshair.classList.remove('visible');
    if (this.hud) this.hud.classList.remove('visible');
    const hudTop = document.getElementById('hud-top');
    if (hudTop) hudTop.classList.remove('visible');
  }

  gameOver() {
    this.isRunning = false;
    if (document.exitPointerLock) document.exitPointerLock();
    if (this.blocker) this.blocker.classList.remove('hidden');
    const deathOverlay = document.getElementById('death-overlay');
    if (deathOverlay) {
      deathOverlay.classList.remove('active', 'banner-on');
      deathOverlay.style.opacity = '';
    }
    const gameOverEl = document.getElementById('game-over');
    if (gameOverEl) gameOverEl.classList.remove('hidden');
    const finalKills = document.getElementById('final-kills');
    if (finalKills) finalKills.textContent = this.enemyManager.killCount;
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const now = performance.now();
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (this.isRunning) {
      const dying = !!this.player?.isDying;
      const worldDelta = dying ? delta * 0.22 : delta;
      this.player.update(delta);
      if (!dying) {
        this.world.update(delta);
        this.enemyManager.update(delta);
        this.npcManager?.update(delta);
        this.lootManager.update(delta);
        if (!this.player.isInVehicle) this.vehicleManager.update(delta);
      } else {
        this.enemyManager.update(worldDelta);
        this.npcManager?.update(worldDelta);
      }
      this.particleSystem.update(delta);

      if (this.player.isInVehicle && this.player.vehicle) {
        const speedEl = document.getElementById('vehicle-speed');
        const v = this.player.vehicle.velocity;
        const speedMs = Math.sqrt(v.x * v.x + v.z * v.z);
        if (speedEl) speedEl.textContent = Math.round(speedMs * 3.6) + ' km/h';
      }
    }

    if (this.settings?.showFps) {
      this._fpsAccum = (this._fpsAccum || 0) + 1;
      this._fpsTimer = (this._fpsTimer || 0) + delta;
      if (this._fpsTimer >= 0.5) {
        const fps = Math.round(this._fpsAccum / this._fpsTimer);
        const fpsEl = document.getElementById('fps-counter');
        if (fpsEl) fpsEl.textContent = fps + ' FPS';
        this._fpsAccum = 0;
        this._fpsTimer = 0;
      }
    }

    this.renderer.render(this.camera);
  }

  onWindowResize() {
    this.renderer.resize();
    this.camera.updateAspect(this.renderer.aspect);
  }
}
