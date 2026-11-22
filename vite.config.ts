/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `base: './'` keeps every asset URL relative, so the same build works at
// https://user.github.io/hippo/, on a custom domain, or from any sub-path.
// PWA plugin configuration is added in src/app work (see docs/PRD.md FR-8).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
