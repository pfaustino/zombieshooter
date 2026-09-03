const AUDIO_ASSETS = {
  music: 'assets/melodyayresgriffiths-what-we-lost-tv-movie-game-theme-zombie-virus-apocalypse-143267.mp3',
  zombieGrowl: [
    'assets/dragon-studio-zombie-sound-357975.mp3',
    'assets/dragon-studio-zombie-sound-2-357976.mp3',
  ],
};

export class AudioManager {
  constructor(game) {
    this.game = game;
    this.context = null;
    this.masterGain = null;
    this.initialized = false;
    this.masterVolume = 0.5;
    this.sfxVolume = 0.7;
    this.musicVolume = 0.3;
    this.voiceVolume = 0.6;
    this.buffers = {};
    this._musicSource = null;
    this._musicGain = null;
    this._lastZombieVoice = 0;
  }

  init() {
    document.addEventListener('click', () => this.initContext(), { once: true });
    document.addEventListener('keydown', () => this.initContext(), { once: true });
  }

  async initContext() {
    if (this.initialized) return;
    try {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.context.destination);
      this.buffers = {};
      this.initialized = true;
      await this._loadSamples();
      this.startAmbient();
      this.startMusic();
    } catch (e) { console.warn('Web Audio API not supported:', e); }
  }

  async _loadSamples() {
    const loadOne = async (key, url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        const data = await res.arrayBuffer();
        this.buffers[key] = await this.context.decodeAudioData(data.slice(0));
      } catch (err) {
        console.warn(`Failed to load audio ${url}:`, err);
      }
    };
    await loadOne('music', AUDIO_ASSETS.music);
    for (let i = 0; i < AUDIO_ASSETS.zombieGrowl.length; i++) {
      await loadOne(`zombie${i}`, AUDIO_ASSETS.zombieGrowl[i]);
    }
  }

  _playBuffer(buffer, { volume = 1, loop = false, rate = 1, destination = null } = {}) {
    if (!this.initialized || !buffer) return null;
    if (this.context.state === 'suspended') this.context.resume();
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = rate;
    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(destination || this.masterGain);
    source.start(0);
    return { source, gain };
  }

  startMusic() {
    if (!this.initialized || !this.buffers.music || this._musicSource) return;
    this._musicGain = this.context.createGain();
    this._musicGain.gain.value = 0;
    this._musicGain.connect(this.masterGain);
    const played = this._playBuffer(this.buffers.music, {
      volume: 1,
      loop: true,
      destination: this._musicGain,
    });
    if (!played) return;
    this._musicSource = played.source;
    const now = this.context.currentTime;
    this._musicGain.gain.linearRampToValueAtTime(0.55 * this.musicVolume, now + 2.5);
  }

  stopMusic() {
    if (this._musicGain && this.context) {
      const now = this.context.currentTime;
      this._musicGain.gain.linearRampToValueAtTime(0, now + 1.5);
    }
    if (this._musicSource) {
      const src = this._musicSource;
      setTimeout(() => { try { src.stop(); } catch (_) {} }, 1600);
      this._musicSource = null;
    }
  }

  _playZombieVoice({ volume = 0.55, minGap = 0.35 } = {}) {
    if (!this.initialized) return false;
    const nowMs = performance.now();
    if (nowMs - this._lastZombieVoice < minGap * 1000) return false;
    const clips = [this.buffers.zombie0, this.buffers.zombie1].filter(Boolean);
    if (clips.length === 0) return false;
    this._lastZombieVoice = nowMs;
    const buffer = clips[Math.floor(Math.random() * clips.length)];
    const rate = 0.92 + Math.random() * 0.16;
    this._playBuffer(buffer, {
      volume: volume * this.sfxVolume * this.voiceVolume,
      rate,
    });
    return true;
  }

  playProceduralGunshot() {
    if (!this.initialized) return;
    const now = this.context.currentTime;
    const bufferSize = this.context.sampleRate * 0.1;
    const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.context.createBufferSource();
    noise.buffer = buffer;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.1);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.8 * this.sfxVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    noise.connect(filter); filter.connect(gain); gain.connect(this.masterGain);
    noise.start(now); noise.stop(now + 0.1);
    this.playTone(80, 0.05, 0.3, 'sine');
  }

  playWeaponAction(weaponName, action) {
    if (!this.initialized) return;
    if (action === 'shot') this.playProceduralGunshot();
  }

  playHit() {
    if (!this.initialized) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.08);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.4 * this.sfxVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    osc.connect(gain); gain.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.1);
  }

  playEnemyHit() {
    if (!this.initialized) return;
    if (this._playZombieVoice({ volume: 0.28, minGap: 0.12 })) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 800;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.3 * this.sfxVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.connect(filter); filter.connect(gain); gain.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.12);
  }

  playEnemyDeath() {
    if (!this.initialized) return;
    if (this._playZombieVoice({ volume: 0.7, minGap: 0.05 })) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.4);
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + 0.4);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.35 * this.sfxVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    osc.connect(filter); filter.connect(gain); gain.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.45);
  }

  playPlayerDamage() {
    if (!this.initialized) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.15);
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 400;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.5 * this.sfxVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.connect(filter); filter.connect(gain); gain.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.2);
    this.playTone(60, 0.08, 0.4, 'square');
  }

  playEnemyAttack(type) {
    if (!this.initialized) return;
    if (this._playZombieVoice({ volume: 0.65, minGap: 0.45 })) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.setValueAtTime(140, now + 0.05);
    osc.frequency.setValueAtTime(100, now + 0.1);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.2);
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 600;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.3 * this.sfxVolume * this.voiceVolume, now);
    gain.gain.linearRampToValueAtTime(0.35 * this.sfxVolume * this.voiceVolume, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    osc.connect(filter); filter.connect(gain); gain.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.25);
    return gain;
  }

  playFootstep() {
    if (!this.initialized) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80 + Math.random() * 20, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.05);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.15 * this.sfxVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
    osc.connect(gain); gain.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.08);
  }

  playJump() {
    if (!this.initialized) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.15);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.2 * this.sfxVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.connect(gain); gain.connect(this.masterGain);
    osc.start(now); osc.stop(now + 0.15);
  }

  playReload() {
    if (!this.initialized) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const times = [0, 0.12, 0.25, 0.38];
    const freqs = [300, 200, 400, 150];
    times.forEach((t, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freqs[i], now + t);
      osc.frequency.exponentialRampToValueAtTime(freqs[i] * 0.5, now + t + 0.05);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.15 * this.sfxVolume, now + t);
      gain.gain.exponentialRampToValueAtTime(0.01, now + t + 0.06);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + t);
      osc.stop(now + t + 0.08);
    });
  }

  playEmptyGun() {
    if (!this.initialized) return;
    this.playTone(400, 0.02, 0.15, 'square');
  }

  playLootPickup(type = 'coin') {
    if (!this.initialized) return;
    const now = this.context.currentTime;
    const chords = {
      coin: [880, 1175],
      cowboyhat: [660, 880, 990],
      potion: [523, 784],
    };
    const freqs = chords[type] || chords.coin;
    freqs.forEach((freq, i) => {
      const t = now + i * 0.05;
      const osc = this.context.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      const gain = this.context.createGain();
      gain.gain.setValueAtTime(0.22 * this.sfxVolume, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  startAmbient() {
    if (!this.initialized) return;
    // Keep a quiet procedural bed under the music track.
    const bedLevel = this.buffers.music ? 0.03 : 0.08;
    const ctx = this.context;
    const now = ctx.currentTime;

    this.ambientNodes = [];
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0;
    this.ambientGain.gain.linearRampToValueAtTime(bedLevel * this.musicVolume, now + 4);

    const reverb = this._createReverb(4, 2.5);
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.6;
    this.ambientGain.connect(reverb);
    reverb.connect(reverbGain);
    reverbGain.connect(this.masterGain);
    this.ambientGain.connect(this.masterGain);

    const droneFreqs = [55, 55.5, 82.5, 110, 164.81];
    const droneTypes = ['sawtooth', 'sine', 'triangle', 'sawtooth', 'sine'];
    const droneFilters = [120, 200, 300, 250, 400];

    for (let i = 0; i < droneFreqs.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = droneTypes[i];
      osc.frequency.value = droneFreqs[i];

      const detuneLfo = ctx.createOscillator();
      detuneLfo.frequency.value = 0.05 + i * 0.03;
      const detuneGain = ctx.createGain();
      detuneGain.gain.value = 3 + i * 2;
      detuneLfo.connect(detuneGain);
      detuneGain.connect(osc.detune);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = droneFilters[i];
      filter.Q.value = 2;

      const filterLfo = ctx.createOscillator();
      filterLfo.frequency.value = 0.02 + i * 0.015;
      const filterLfoGain = ctx.createGain();
      filterLfoGain.gain.value = droneFilters[i] * 0.3;
      filterLfo.connect(filterLfoGain);
      filterLfoGain.connect(filter.frequency);

      const gain = ctx.createGain();
      gain.gain.value = 0.15 / (i + 1);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ambientGain);
      osc.start(now);
      detuneLfo.start(now);
      filterLfo.start(now);
      this.ambientNodes.push(osc, detuneLfo, filterLfo);
    }

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = (Math.random() * 2 - 1) * 0.3;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 200;
    noiseFilter.Q.value = 0.5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.03;

    const noiseLfo = ctx.createOscillator();
    noiseLfo.frequency.value = 0.08;
    const noiseLfoGain = ctx.createGain();
    noiseLfoGain.gain.value = 0.02;
    noiseLfo.connect(noiseLfoGain);
    noiseLfoGain.connect(noiseGain.gain);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.ambientGain);
    noise.start(now);
    noiseLfo.start(now);
    this.ambientNodes.push(noise, noiseLfo);

    this._startHeartbeat();
    this._startEerieStingers();
  }

  _startHeartbeat() {
    if (!this.initialized || !this.ambientNodes) return;
    const ctx = this.context;
    const beat = () => {
      if (!this.ambientNodes) return;
      const now = ctx.currentTime;
      this._playHeartbeatPulse(now, 0.12);
      this._playHeartbeatPulse(now + 0.18, 0.08);
      const nextDelay = 1.2 + Math.random() * 0.6;
      this._heartbeatTimer = setTimeout(beat, nextDelay * 1000);
    };
    beat();
  }

  _playHeartbeatPulse(now, volume) {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(60, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.15);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume * this.musicVolume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.ambientGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  _startEerieStingers() {
    if (!this.initialized || !this.ambientNodes) return;
    const ctx = this.context;
    const notes = [220, 233.08, 311.13, 415.30, 466.16, 622.25];
    const playStinger = () => {
      if (!this.ambientNodes) return;
      const now = ctx.currentTime;
      const freq = notes[Math.floor(Math.random() * notes.length)];
      const osc = ctx.createOscillator();
      osc.type = Math.random() > 0.5 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      osc.detune.setValueAtTime(Math.random() * 20 - 10, now);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq * 2;
      filter.Q.value = 5;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.06 * this.musicVolume, now + 1.5);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 4);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ambientGain);
      osc.start(now);
      osc.stop(now + 4.5);

      const nextDelay = 8 + Math.random() * 15;
      this._stingerTimer = setTimeout(playStinger, nextDelay * 1000);
    };
    this._stingerTimer = setTimeout(playStinger, 5000);
  }

  _createReverb(seconds, decay) {
    const ctx = this.context;
    const length = ctx.sampleRate * seconds;
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    return convolver;
  }

  stopAmbient() {
    if (this._heartbeatTimer) clearTimeout(this._heartbeatTimer);
    if (this._stingerTimer) clearTimeout(this._stingerTimer);
    if (this.ambientGain) {
      const now = this.context.currentTime;
      this.ambientGain.gain.linearRampToValueAtTime(0, now + 2);
    }
    if (this.ambientNodes) {
      const nodes = this.ambientNodes;
      setTimeout(() => {
        nodes.forEach(n => { try { n.stop(); } catch (e) {} });
      }, 2500);
    }
    this.ambientNodes = null;
    this.stopMusic();
  }

  setMusicVolume(volume) {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.ambientGain) {
      const bedLevel = this.buffers.music ? 0.03 : 0.08;
      this.ambientGain.gain.value = bedLevel * this.musicVolume;
    }
    if (this._musicGain) {
      this._musicGain.gain.value = 0.55 * this.musicVolume;
    }
  }

  playTone(frequency, duration, volume, type = 'sine') {
    if (!this.initialized) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = type; osc.frequency.value = frequency;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(volume * this.sfxVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
    osc.connect(gain); gain.connect(this.masterGain);
    osc.start(now); osc.stop(now + duration);
  }

  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) this.masterGain.gain.value = this.masterVolume;
  }
}
