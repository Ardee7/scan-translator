import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    target: 'chrome120',
    rollupOptions: {
      input: { sidepanel: 'sidepanel.html', worker: 'src/worker.ts' },
      output: { entryFileNames: '[name].js', chunkFileNames: 'assets/[name]-[hash].js' },
    },
  },
});
