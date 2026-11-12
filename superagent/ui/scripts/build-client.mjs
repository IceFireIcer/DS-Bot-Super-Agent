// Build client.js from src/client.js. The output uses the same module wrapper
// as DSH's other client plugins; it is committed and checked in tests.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'src', 'client.js'), 'utf8')
const output = [
  '// Generated from src/client.js by `node scripts/build-client.mjs`. Do not edit by hand.',
  'window.__ModuleLoader__.load({',
  "  id: 'ds-superagent-ui',",
  '  factory: (require) => {',
  '    const module = { exports: {} }',
  '    const exports = module.exports',
  source,
  "    return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })",
  '  },',
  '})',
  '',
].join('\n')

if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(join(root, 'client.js'), 'utf8') } catch { /* missing counts as stale */ }
  if (current !== output) {
    console.error('client.js is stale; run `npm run build`.')
    process.exitCode = 1
  }
} else {
  writeFileSync(join(root, 'client.js'), output)
}
