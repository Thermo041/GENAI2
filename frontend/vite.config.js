import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: { port: 4173 },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Keep React in its own long-cached chunk. Monaco is loaded via dynamic
        // import from the code viewer, so rolldown splits it automatically and
        // it never lands in the initial page graph.
        manualChunks(id) {
          if (/node_modules[\/](react|react-dom|react-router|scheduler)[\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});
