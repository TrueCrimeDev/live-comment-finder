import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: { target: 'es2022', sourcemap: true, emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
