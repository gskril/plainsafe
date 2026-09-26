import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// SPEC §8.1: CSP as defence in depth, production builds only (the dev server needs inline HMR code).
// connect-src is broad on purpose: RPCs are user-defined and netguard enforces the real allowlist.
// Plain http: only for a local node, as setup allows.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  'connect-src https: wss: http://localhost:* http://127.0.0.1:*',
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const csp = (): Plugin => ({
  name: 'plainsafe-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
})

// Settings → About (SPEC §3.12): version, commit and the dependencies actually installed.
function buildInfo() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const git = (...args: string[]) => {
    try {
      return execFileSync('git', args, { encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
  const commit = git('rev-parse', 'HEAD') || 'unknown'
  const dirty = git('status', '--porcelain') !== ''
  const dependencies = Object.keys(pkg.dependencies ?? {})
    .sort()
    .map((name) => {
      const dep = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8'))
      return { name, version: dep.version as string, license: (dep.license ?? '') as string }
    })
  return { version: pkg.version as string, commit, dirty, dependencies }
}

export default defineConfig({
  base: './',
  define: { __PLAINSAFE_BUILD__: JSON.stringify(buildInfo()) },
  plugins: [react(), tailwindcss(), csp()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
})
