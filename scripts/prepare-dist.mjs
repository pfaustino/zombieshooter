import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

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

console.log('dist ready');
