import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const fileEnv = {
  ...loadEnvFile(join(root, '.env')),
  ...loadEnvFile(join(root, '.env.local')),
};
const apiBase = (
  process.env.LEADERBOARD_API ||
  process.env.VITE_LEADERBOARD_API ||
  fileEnv.LEADERBOARD_API ||
  fileEnv.VITE_LEADERBOARD_API ||
  'https://leaderboards-opal.vercel.app'
).replace(/\/$/, '');
const writeKey =
  process.env.LEADERBOARD_WRITE_KEY ||
  process.env.VITE_LEADERBOARD_WRITE_KEY ||
  fileEnv.LEADERBOARD_WRITE_KEY ||
  fileEnv.VITE_LEADERBOARD_WRITE_KEY ||
  '';

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

cpSync(join(root, 'index.html'), join(dist, 'index.html'));
cpSync(join(root, 'js'), join(dist, 'js'), { recursive: true });
cpSync(join(root, 'assets'), join(dist, 'assets'), { recursive: true });

const cityPack = join(root, 'assets', 'CityPack');
if (!existsSync(cityPack)) {
  console.error('Missing assets/CityPack — required for ship');
  process.exit(1);
}

const indexPath = join(dist, 'index.html');
let html = readFileSync(indexPath, 'utf8');
html = html
  .replaceAll('__LEADERBOARD_API__', apiBase)
  .replaceAll('__LEADERBOARD_WRITE_KEY__', writeKey);
writeFileSync(indexPath, html);

console.log(`dist ready (leaderboard ${writeKey ? 'submit enabled' : 'read-only'})`);
