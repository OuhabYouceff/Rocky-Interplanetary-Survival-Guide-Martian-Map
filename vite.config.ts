import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  // Cesium: use its prebuilt single-file ES module (types still come from the 'cesium' package)
  resolve: { alias: [{ find: /^cesium$/, replacement: '/node_modules/cesium/Build/Cesium/index.js' }] },
  optimizeDeps: { exclude: ['cesium'] },
  // two pages: the app, and the phone AR page (WebXR floor scan on Android, AR Quick Look on iPhone)
  build: { rollupOptions: { input: { main: 'index.html', ar: 'ar.html' } } },
})
