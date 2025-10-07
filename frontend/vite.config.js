import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
      '@frontend': fileURLToPath(new URL('./src', import.meta.url)),
      '@mobile': fileURLToPath(new URL('../mobile/src', import.meta.url)),
      react: fileURLToPath(new URL('../node_modules/react', import.meta.url)),
      'react-dom/server': fileURLToPath(new URL('../node_modules/react-dom/server.browser.js', import.meta.url)),
      util: fileURLToPath(new URL('./src/polyfills/util.js', import.meta.url)),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1800,
  },
  server: {
    fs: {
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
    proxy: {
      // Proxy API calls during dev to the backend server
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
})



