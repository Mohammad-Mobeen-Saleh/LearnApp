/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0'),
  },
  plugins: [
    react(),
    VitePWA({
      // Neue Versionen werden erst nach Bestätigung aktiviert (kein Neuladen mitten im Spiel)
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'icons/logo.svg'],
      manifest: {
        id: '/',
        name: 'LernArcade',
        short_name: 'LernArcade',
        description: 'Lernfragen spielerisch üben, mit Minispielen wie Meteor Defense und Snake.',
        lang: 'de',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#070b1f',
        theme_color: '#0b1030',
        categories: ['education', 'games'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // App-Shell + Spiel-Code offline verfügbar machen
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Standardausschlüsse beibehalten; iOS-Startbilder nicht vorab laden (nur beim Installieren benötigt)
        globIgnores: ['**/node_modules/**/*', 'sw.js', 'workbox-*.js', 'splash/**'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Phaser ist gross; Standardlimit (2 MiB) anheben
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
  },
});
