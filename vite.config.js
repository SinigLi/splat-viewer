import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 4000,
  },
  optimizeDeps: {
    exclude: ['@mkkellogg/gaussian-splats-3d'],
  },
});
