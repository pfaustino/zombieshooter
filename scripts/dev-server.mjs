/**
 * Tiny static server that injects leaderboard env into index.html from .env.
 * Usage: node scripts/dev-server.mjs  [port=8080]
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8080);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const fileEnv = { ...loadEnvFile(join(root, '.env')), ...loadEnvFile(join(root, '.env.local')) };
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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = join(root, urlPath.replace(/^\//, ''));
    if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    let body = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();
    if (urlPath === '/index.html') {
      let html = body.toString('utf8');
      html = html.replaceAll('__LEADERBOARD_API__', apiBase).replaceAll('__LEADERBOARD_WRITE_KEY__', writeKey);
      body = Buffer.from(html, 'utf8');
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(500); res.end(String(err));
  }
}).listen(port, () => {
  console.log(`http://localhost:${port}  (leaderboard ${writeKey ? 'submit enabled' : 'read-only'})`);
});
