import { execFile } from 'node:child_process'
import { access, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

let settings
let binaries
let closing
let started = false
let stopRequested = false
let failed = false

function command(file, args, timeout = 180_000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, env: { ...process.env, LC_MESSAGES: 'C' } }, error => {
      if (error) reject(new Error('The isolated PostgreSQL lifecycle command failed.', { cause: error.code }))
      else resolve()
    })
  })
}

async function stop() {
  stopRequested = true
  if (closing) return closing
  closing = (async () => {
    const hasPostmaster = settings && await access(join(settings.directory, 'cluster', 'postmaster.pid')).then(() => true, () => false)
    if (settings && binaries && (started || hasPostmaster)) {
      await command(binaries.pg_ctl, ['-D', join(settings.directory, 'cluster'), '-m', 'fast', '-w', '-t', '60', 'stop'], 90_000)
      started = false
    }
    process.exitCode = failed ? 1 : 0
    process.disconnect?.()
  })()
  return closing
}

const fail = async () => {
  failed = true
  process.exitCode = 1
  if (process.connected) process.send?.({ type: 'failed' }, () => {})
  try { await stop() } catch { process.exitCode = 1; process.disconnect?.() }
}

process.once('disconnect', () => { void stop().catch(fail) })
process.once('SIGTERM', () => { void stop().catch(fail) })
process.once('SIGINT', () => { void stop().catch(fail) })
process.on('message', message => {
  if (message?.type === 'stop') { void stop().catch(fail); return }
  if (message?.type !== 'start' || settings) return
  settings = message
  void (async () => {
    const target = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`
    if (!['windows-x64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'].includes(target)) throw new Error('Unsupported test platform.')
    // The binary package exports these command paths; importing it installs no global exit hooks.
    binaries = await import(`@embedded-postgres/${target}`)
    const passwordPath = join(settings.directory, 'password')
    await writeFile(passwordPath, `${settings.password}\n`, { mode: 0o600 })
    try {
      await command(binaries.initdb, ['-D', join(settings.directory, 'cluster'), '--auth=password', '--username=postgres',
        `--pwfile=${passwordPath}`, '--locale=C', '--encoding=UTF8'])
    } finally { await rm(passwordPath, { force: true }) }
    if (stopRequested) { await stop(); return }
    await command(binaries.pg_ctl, ['-D', join(settings.directory, 'cluster'), '-l', join(settings.directory, 'postgres.log'), '-w', '-t', '90',
      '-o', `-h 127.0.0.1 -p ${settings.port} -c fsync=on -c synchronous_commit=on`, 'start'])
    started = true
    if (stopRequested || !process.connected) {
      closing = undefined
      await stop()
      return
    }
    process.send({ type: 'ready' }, () => {})
  })().catch(fail)
})
