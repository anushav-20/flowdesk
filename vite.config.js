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
        // CI fails if coverage of these layers drops below today's levels. The domain logic (shared/,
        // lib/, hooks/) is held to a high bar; the workspace UI pages have no per-page minimum yet
        // (Playwright end-to-end tests are the planned next step — see README "Future improvements").
        thresholds: {
          'shared/**': { statements: 80, branches: 65, functions: 85, lines: 85 },
          'src/lib/**': { statements: 85, branches: 80, functions: 75, lines: 85 },
          'src/hooks/**': { statements: 75, branches: 65, functions: 80, lines: 75 },
          'src/workspace/engine/**': { statements: 50, branches: 45, functions: 40, lines: 50 },
        },
      },
    },
  }
})
