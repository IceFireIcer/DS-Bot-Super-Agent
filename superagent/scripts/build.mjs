import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const typescript = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
const declarations = spawnSync(process.execPath, [typescript, '--noEmit', 'false', '--declaration', '--emitDeclarationOnly', '--outDir', 'dist'], { stdio: 'inherit' })
if (declarations.error) throw declarations.error
if (declarations.status !== 0) process.exit(declarations.status ?? 1)

const entryPoints = ['index', 'storage', 'commands', 'postgres-storage', 'sqlite-worker', 'cli', 'session-persistence', 'session-persistence-postgres', 'remote-device', 'client-access', 'client-gateway'].map(name => `src/${name}.ts`).filter(existsSync)
if (entryPoints.length) await build({ entryPoints, outdir: 'dist', platform: 'node', target: 'node22', format: 'esm', bundle: true, splitting: true, packages: 'external' })
