import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const build = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' })
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)

const args = process.argv.slice(2)
const selected = args.filter(arg => !arg.startsWith('-') && arg.endsWith('.test.mjs'))
const flags = args.filter(arg => !selected.includes(arg))
const files = selected.length ? selected : readdirSync(new URL('../test/', import.meta.url)).filter(name => name.endsWith('.test.mjs')).map(name => `test/${name}`)
const tests = spawnSync(process.execPath, ['--test', ...flags, ...files], { cwd: root, stdio: 'inherit' })
if (tests.error) throw tests.error
process.exit(tests.status ?? 1)
