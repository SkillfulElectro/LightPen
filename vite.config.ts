import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    hmr: { port: 1421 },
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    // pdf.js and MediaPipe are inherently large; split them out of the app chunk.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
          mediapipe: ['@mediapipe/tasks-vision'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
});
