// Minimal end-to-end harness: a test registry, the mock relay (in process,
// so tests can inspect the filters it received), the built app served by
// `vite preview` under a sub-path, and Playwright's Chromium.
//
// `@playwright/test` is not installed, so tests are plain async functions
// using node:assert. `playwright` is resolved like `require` would (a global
// install works), falling back to `playwright-core`.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

export function loadPlaywright() {
  try {
    return require('playwright')
  } catch {
    return require('playwright-core')
  }
}

/** @type {{ name: string, fn: (ctx: any) => Promise<void> }[]} */
export const tests = []
export function test(name, fn) {
  tests.push({ name, fn })
}

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const SUBPATH = '/hippo/'

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

/** Starts `vite preview` for dist/ under SUBPATH; resolves once it answers. */
export async function startPreview(port) {
  const child = spawn(process.execPath, [ROOT + 'node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1', '--base', SUBPATH], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))
  const url = `http://127.0.0.1:${port}${SUBPATH}`
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return { url, stop: () => child.kill('SIGTERM') }
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) throw new Error(`vite preview exited:\n${output}`)
    await new Promise((r) => setTimeout(r, 100))
  }
  child.kill('SIGTERM')
  throw new Error(`vite preview did not start:\n${output}`)
}
