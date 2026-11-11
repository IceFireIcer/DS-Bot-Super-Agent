#!/usr/bin/env node
import { SqliteStorage } from './storage.js'
import { PostgresStorage } from './postgres-storage.js'
import { Watchdog } from './watchdog.js'
import { ProcessWatchdogHost } from './watchdog-process.js'

const usage = 'Usage: node dist/watchdog-cli.js (--database <absolute-path> | --postgres <json>) --instance <id> --status <absolute-path> --host-command <command> [--host-arg <arg>]... [--interval-ms 3600000] [--grace-ms 300000] [--max-restarts 3] [--restart-window-ms 21600000] [--version <label>] [--once]'

function parse(args: string[]) {
  const values = new Map<string, string>()
  const hostArgs: string[] = []
  let once = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--once') { once = true; continue }
    if (arg === '--host-arg') {
      const value = args[++index]
      if (value === undefined) throw new Error('--host-arg needs a value.')
      hostArgs.push(value)
      continue
    }
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`)
    const key = arg.slice(2)
    const value = args[++index]
    if (!['database', 'postgres', 'instance', 'status', 'host-command', 'interval-ms', 'grace-ms', 'max-restarts', 'restart-window-ms', 'version'].includes(key) || value === undefined) throw new Error(`Unknown or incomplete option: ${arg}`)
    values.set(key, value)
  }
  return { values, hostArgs, once }
}

async function main() {
  const { values, hostArgs, once } = parse(process.argv.slice(2))
  const database = values.get('database')
  const postgres = values.get('postgres')
  const instanceId = values.get('instance')
  const statusPath = values.get('status')
  const command = values.get('host-command')
  if ((database === undefined && postgres === undefined) || instanceId === undefined || statusPath === undefined || command === undefined) throw new Error(usage)
  const storage = postgres === undefined ? await SqliteStorage.open(database!) : await PostgresStorage.open(JSON.parse(postgres))
  const graceMs = Number(values.get('grace-ms') ?? '300000')
  const host = new ProcessWatchdogHost({ command, args: hostArgs, statusPath, startTimeoutMs: 120000 })
  const watchdog = new Watchdog({
    instanceId, storage, host,
    intervalMs: Number(values.get('interval-ms') ?? '3600000'),
    graceMs,
    maxRestarts: Number(values.get('max-restarts') ?? '3'),
    restartWindowMs: Number(values.get('restart-window-ms') ?? '21600000'),
    version: values.get('version') ?? 'watchdog-1',
    notify: notification => { console.error(JSON.stringify(notification)) },
    onInspection: inspection => { console.log(JSON.stringify(inspection)) },
  })
  if (once) {
    await watchdog.inspectOnce()
    // A diagnostic run does not leave the Host it started behind; a timeout is reported and
    // is not forced.
    if (host.isRunning()) {
      const outcome = await host.stop({ graceMs, signal: AbortSignal.timeout(graceMs + 1000) })
      if (outcome === 'timeout') console.error('The Host did not stop within the grace period; it was left running.')
    }
    await storage.close()
    return
  }
  await new Promise<void>((resolve) => {
    const stop = () => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    watchdog.start()
  })
  await watchdog.stop()
  if (host.isRunning()) {
    const outcome = await host.stop({ graceMs, signal: AbortSignal.timeout(graceMs + 1000) })
    if (outcome === 'timeout') console.error('The Host did not stop within the grace period; it was left running.')
  }
  await storage.close()
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
