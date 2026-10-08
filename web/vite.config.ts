import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'development-deployment',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const filename = req.url?.split('?')[0];
        if (filename !== '/imd-deployment.json' && !/^\/abi\/[A-Za-z_][A-Za-z0-9_]*\.json$/.test(filename ?? '')) return next();
        try {
          res.setHeader('Content-Type', 'application/json');
          res.end(readFileSync(resolve(import.meta.dirname, '../dist', filename!.slice(1))));
        } catch { res.statusCode = 503; res.end('Run npm run build before starting development.'); }
      });
    },
  }],
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
});
