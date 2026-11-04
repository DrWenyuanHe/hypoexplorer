import { resolve } from 'node:path';
import { preview } from 'vite';

// A programmatic option avoids shell interpolation for paths with spaces.
await preview({
  // Smoke the existing artifact without rerunning source fingerprinting or build plugins.
  configFile: false,
  build: { outDir: resolve(process.env.SMOKE_DIST_DIR || 'dist') },
  preview: { host: '127.0.0.1', port: 4179, strictPort: true },
});
