export async function loadEngine() {
  if (window.PE) return window.PE;
  const paths = [
    './assets/particle-platform.min.js.gz',
    '../assets/particle-platform.min.js.gz',
    '/assets/particle-platform.min.js.gz',
  ];
  for (const p of paths) {
    try {
      await loadGzScript(p);
      if (window.PE) {
        const enginePaths = [
          './assets/particle-engine.min.js.gz',
          '../assets/particle-engine.min.js.gz',
          '/assets/particle-engine.min.js.gz',
        ];
        for (const ep of enginePaths) {
          try { await loadGzScript(ep); break; } catch (e) {}
        }
        return window.PE;
      }
    } catch (e) {}
  }
  console.warn('Particle Realms engine not loaded, running in standalone WebGPU mode');
  return null;
}

function loadGzScript(path) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ds = new DecompressionStream('gzip');
      const stream = blob.stream().pipeThrough(ds);
      const decompressed = await new Response(stream).text();
      const script = document.createElement('script');
      script.textContent = decompressed;
      document.head.appendChild(script);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
