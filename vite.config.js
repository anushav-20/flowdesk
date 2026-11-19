/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const routerMode = env.VITE_ROUTER_MODE || 'browser'

  return {
    plugins: [react()],
    // Clean URLs (/blog/5) need absolute asset paths, or nested routes would request /blog/assets/….
    // Hash/memory routing always serves from one URL, so relative paths work on any host or sub-path.
    base: routerMode === 'browser' ? '/' : './',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      },
    },
    build: {
      target: 'es2020',
      rollupOptions: {
        output: {
          // Long-lived vendor chunk: app deploys don't invalidate the cached React/router code
          manualChunks: (id) =>
            id.includes('node_modules/react') || id.includes('node_modules/scheduler') ? 'vendor' : undefined,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.js'],
      include: ['src/**/*.test.{js,jsx}', 'shared/**/*.test.js'],
      css: false,
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{js,jsx}', 'shared/**/*.js'],
        exclude: ['src/main.jsx', 'src/test/**', '**/*.test.{js,jsx}', 'src/data/**'],
        reporter: ['text', 'html', 'lcov'],
        // CI fails if coverage drops below these levels
        thresholds: { statements: 75, branches: 70, functions: 75, lines: 75 },
      },
    },
  }
})
