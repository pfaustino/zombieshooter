/** Shared leaderboards API (https://github.com/pfaustino/leaderboards). */

const GAME_ID = 'zombieshooter';
const NAME_KEY = 'zombieshooterLeaderboardName';
const LOCAL_BEST_KEY = 'zombieshooterLocalBest';
const NAME_RE = /^[\w\s\-.'!?]+$/;

function env() {
  const e = (typeof window !== 'undefined' && window.__LEADERBOARD_ENV__) || {};
  let apiBase = String(e.apiBase || '').replace(/\/$/, '');
  let writeKey = String(e.writeKey || '');
  if (!apiBase || apiBase.includes('__LEADERBOARD_')) {
    apiBase = 'https://leaderboards-opal.vercel.app';
  }
  if (writeKey.includes('__LEADERBOARD_')) writeKey = '';
  return { apiBase, writeKey };
}

export function isConfigured() {
  return Boolean(env().writeKey);
}

export function validateName(raw) {
  const name = String(raw || '').trim().slice(0, 24);
  if (!name || !NAME_RE.test(name)) return '';
  return name;
}

export function getSavedName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

export function setSavedName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
}

export function getLocalBest() {
  try {
    const raw = localStorage.getItem(LOCAL_BEST_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLocalBest(run) {
  const prev = getLocalBest();
  if (prev && Number(prev.kills) >= Number(run.kills)) return prev;
  const next = {
    name: run.name || getSavedName() || 'YOU',
    kills: Math.floor(run.kills),
    wave: Math.floor(run.wave || 1),
    at: Date.now(),
  };
  try { localStorage.setItem(LOCAL_BEST_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export async function fetchLeaderboard(limit = 50) {
  const { apiBase } = env();
  try {
    const res = await fetch(`${apiBase}/api/leaderboard?game=${GAME_ID}&limit=${limit}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, rows: data.rows || [] };
  } catch {
    return { ok: false, error: 'Could not reach leaderboard server' };
  }
}

export async function submitScore(player, kills, meta = {}) {
  const { apiBase, writeKey } = env();
  if (!writeKey) return { ok: false, error: 'not configured' };
  const name = validateName(player);
  if (!name) return { ok: false, error: 'invalid name' };
  const value = Math.floor(Number(kills));
  if (!Number.isFinite(value) || value < 1) return { ok: false, error: 'score too low' };

  try {
    const res = await fetch(`${apiBase}/api/score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Game-Key': writeKey,
      },
      body: JSON.stringify({
        game: GAME_ID,
        player: name,
        value,
        meta,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error || `HTTP ${res.status}` };
    return { ok: true, updated: Boolean(body.updated), body };
  } catch {
    return { ok: false, error: 'network error' };
  }
}

function setStatus(text, kind = '') {
  for (const id of ['lb-status', 'lb-modal-status', 'go-lb-status']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = text || '';
    el.className = 'lb-status' + (kind ? ` ${kind}` : '');
  }
}

function renderRows(listEl, rows) {
  if (!listEl) return;
  if (!rows.length) {
    listEl.innerHTML = '<div class="lb-empty">No scores yet — be the first.</div>';
    return;
  }
  listEl.innerHTML = rows.map((r, i) => {
    const wave = r.meta?.wave != null ? ` · wave ${r.meta.wave}` : '';
    return `<div class="lb-row"><span class="lb-rank">${i + 1}</span><span class="lb-name">${escapeHtml(r.player)}</span><span class="lb-score">${Math.floor(r.value)}${wave}</span></div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function renderGlobalList(listEl) {
  if (!listEl) return;
  listEl.innerHTML = '<div class="lb-empty">Loading…</div>';
  const result = await fetchLeaderboard(50);
  if (!result.ok) {
    listEl.innerHTML = `<div class="lb-empty">${escapeHtml(result.error)}</div>`;
    return;
  }
  renderRows(listEl, result.rows);
}

export function openModal() {
  const modal = document.getElementById('leaderboard-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  renderGlobalList(document.getElementById('lb-modal-list'));
}

export function closeModal() {
  document.getElementById('leaderboard-modal')?.classList.add('hidden');
}

/**
 * Called from gameOver — save local best, auto-submit if named, refresh board.
 * @param {{ kills: number, wave: number }} run
 */
export async function handleGameOver(run) {
  const kills = Math.floor(run.kills || 0);
  const wave = Math.floor(run.wave || 1);
  saveLocalBest({ kills, wave, name: getSavedName() });

  const nameInput = document.getElementById('go-lb-name');
  if (nameInput && !nameInput.value) nameInput.value = getSavedName();

  const listEl = document.getElementById('go-lb-list');
  setStatus('');

  if (kills >= 1 && isConfigured()) {
    const name = validateName(nameInput?.value || getSavedName());
    if (name) {
      setSavedName(name);
      setStatus('Submitting…');
      const result = await submitScore(name, kills, { wave });
      if (result.ok) {
        setStatus(result.updated ? 'Score submitted!' : 'Best score unchanged.', 'ok');
      } else {
        setStatus(result.error || 'Submit failed', 'error');
      }
    } else {
      setStatus('Enter a name to submit your score.');
    }
  } else if (kills < 1) {
    setStatus('Need at least 1 kill to submit.');
  } else if (!isConfigured()) {
    setStatus('Global board is read-only on this build.');
  }

  await renderGlobalList(listEl);
}

export async function submitFromGameOver(run) {
  const nameInput = document.getElementById('go-lb-name');
  const name = validateName(nameInput?.value);
  if (!name) {
    setStatus('Name: letters, numbers, spaces, . - \' ! ? (max 24).', 'error');
    return;
  }
  setSavedName(name);
  const kills = Math.floor(run.kills || 0);
  const wave = Math.floor(run.wave || 1);
  saveLocalBest({ kills, wave, name });
  if (kills < 1) {
    setStatus('Need at least 1 kill to submit.', 'error');
    return;
  }
  if (!isConfigured()) {
    setStatus('Global board is read-only on this build.', 'error');
    return;
  }
  setStatus('Submitting…');
  const result = await submitScore(name, kills, { wave });
  if (result.ok) {
    setStatus(result.updated ? 'Score submitted!' : 'Best score unchanged.', 'ok');
  } else {
    setStatus(result.error || 'Submit failed', 'error');
  }
  await renderGlobalList(document.getElementById('go-lb-list'));
}

export function wireUi(getLastRun) {
  document.getElementById('btn-leaderboard')?.addEventListener('click', () => openModal());
  document.getElementById('lb-modal-close')?.addEventListener('click', () => closeModal());
  document.getElementById('leaderboard-modal')?.addEventListener('click', (e) => {
    if (e.target?.id === 'leaderboard-modal') closeModal();
  });
  document.getElementById('go-lb-submit')?.addEventListener('click', () => {
    submitFromGameOver(getLastRun?.() || { kills: 0, wave: 1 });
  });
  const nameInput = document.getElementById('go-lb-name');
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitFromGameOver(getLastRun?.() || { kills: 0, wave: 1 });
  });
}
