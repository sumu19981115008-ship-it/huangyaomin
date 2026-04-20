import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5174 },
  build: { outDir: 'dist' },
  // Phaser 使用本地文件，不打包进 bundle
  optimizeDeps: {
    exclude: [],
  },
});
