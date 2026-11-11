import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SqliteStorage } from '../dist/storage.js'
import { Watchdog } from '../dist/watchdog.js'

const healthy = () => ({ service: 'healthy', hostId: 'host-a', epoch: 1, sources: [], setups: [], normalWaits: 0 })
const failed = (detail = 'The Host process is gone.') => ({ service: 'failed', sources: [], setups: [], normalWaits: 0, detail })

function fakeHost(initial) {
  const calls = { probe: 0, stop: 0, start: 0 }
  let probe = initial
  const host = {
    calls,
    stopResult: 'stopped',
    stopError: undefined,
    stopHangs: false,
    startError: undefined,
    afterStart: healthy(),
    setProbe(next) { probe = next },
    async probe() { calls.probe += 1; return probe },
    async stop() {
      calls.stop += 1
      if (host.stopHangs) return new Promise(() => {})
      if (host.stopError !== undefined) throw host.stopError
      return host.stopResult
    },
    async start() {
      calls.start += 1
      if (host.startError !== undefined) throw host.startError
      probe = host.afterStart
    },
  }
  return host
}

async function open(t, { initial = healthy(), maxRestarts = 3, restartWindowMs = 60_000, historyLimit = 100, notify } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-superagent-watchdog-'))
  const storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  t.after(async () => { await storage.close().catch(() => {}); await rm(directory, { recursive: true, force: true }) })
  const host = fakeHost(initial)
  const notifications = []
  let clock = 1_000
  const watchdog = new Watchdog({
    instanceId: 'private', storage, host, intervalMs: 20, graceMs: 50, probeTimeoutMs: 1_000, startTimeoutMs: 1_000,
    maxRestarts, restartWindowMs, historyLimit, version: 't47-test', now: () => clock,
    notify: (notification) => { notifications.push(notification); return notify?.(notification) }, log: { warn: () => {}, error: () => {} },
  })
  return { watchdog, host, notifications, storage, advance: (ms = 1_000) => { clock += ms } }
}

test('a healthy Host and a normal wait are silent and never restart', async t => {
  const app = await open(t)
  assert.equal((await app.watchdog.inspectOnce()).kind, 'healthy')
  app.host.setProbe({ ...healthy(), normalWaits: 2 })
  const waiting = await app.watchdog.inspectOnce()
  assert.equal(waiting.kind, 'normal-wait')
  assert.equal(waiting.action, 'none')
  assert.equal(app.host.calls.stop, 0)
  assert.equal(app.host.calls.start, 0)
  assert.deepEqual(app.notifications, [])
  const state = await app.watchdog.getState()
  assert.equal(state.last.kind, 'normal-wait')
  assert.equal(state.history.length, 2)
})

test('a paused Host and a takeover in progress are normal waits', async t => {
  const app = await open(t)
  app.host.setProbe({ ...healthy(), paused: true })
  assert.equal((await app.watchdog.inspectOnce()).kind, 'normal-wait')
  app.host.setProbe({ ...healthy(), takeoverPending: true })
  assert.equal((await app.watchdog.inspectOnce()).kind, 'normal-wait')
  assert.equal(app.host.calls.stop + app.host.calls.start, 0)
})

test('a source failure and unknown effects are reported without restarting, and unchanged errors are deduped', async t => {
  const app = await open(t)
  app.host.setProbe({ ...healthy(), sources: [{ id: 'github:o/r', state: 'failed', error: 'SOURCE_FAILED' }] })
  const first = await app.watchdog.inspectOnce()
  assert.equal(first.kind, 'component-failure')
  assert.equal(first.action, 'none')
  assert.equal(first.result, 'notified')
  assert.equal(app.host.calls.stop, 0)
  const second = await app.watchdog.inspectOnce()
  assert.equal(second.kind, 'component-failure')
  assert.equal(second.result, 'suppressed')
  assert.equal(app.notifications.length, 1)
  app.host.setProbe({ ...healthy(), sources: [{ id: 'github:o/r', state: 'failed', error: 'SOURCE_REVOKED' }] })
  assert.equal((await app.watchdog.inspectOnce()).result, 'notified')
  assert.equal(app.notifications.length, 2)
  app.host.setProbe({ ...healthy(), unknownEffects: 2 })
  const unknown = await app.watchdog.inspectOnce()
  assert.equal(unknown.kind, 'component-failure')
  assert.equal(app.host.calls.stop, 0)
})

test('a policy component failure is reported without restarting', async t => {
  const app = await open(t)
  app.host.setProbe({ ...healthy(), components: [{ id: 'policy', kind: 'policy', state: 'failed', error: 'POLICY_INVALID' }] })
  const result = await app.watchdog.inspectOnce()
  assert.equal(result.kind, 'component-failure')
  assert.equal(result.action, 'none')
  assert.equal(app.host.calls.stop, 0)
  assert.match(app.notifications[0].message, /policy/u)
})

test('a missing or failed setup is reported without restarting the Host', async t => {
  const app = await open(t)
  app.host.setProbe({ ...healthy(), setups: [{ id: 'desktop', state: 'missing' }] })
  const missing = await app.watchdog.inspectOnce()
  assert.equal(missing.kind, 'setup-missing')
  assert.equal(missing.action, 'none')
  assert.equal(app.host.calls.stop, 0)
  app.host.setProbe({ ...healthy(), setups: [{ id: 'desktop', state: 'failed', error: 'SETUP_FAILED' }] })
  const failedSetup = await app.watchdog.inspectOnce()
  assert.equal(failedSetup.kind, 'setup-failed')
  assert.equal(app.notifications.length, 2)
})

test('a service failure is replaced gracefully and a successful recovery is silent', async t => {
  const app = await open(t, { initial: failed() })
  app.host.afterStart = { ...healthy(), hostId: 'host-b', epoch: 2 }
  const recovery = await app.watchdog.inspectOnce()
  assert.equal(recovery.kind, 'recovered')
  assert.equal(recovery.action, 'restart')
  assert.equal(recovery.result, 'recovered')
  assert.equal(recovery.epoch, 2)
  assert.equal(app.host.calls.stop, 1)
  assert.equal(app.host.calls.start, 1)
  assert.equal(recovery.budget.used, 1)
  assert.deepEqual(app.notifications, [])
  const state = await app.watchdog.getState()
  assert.deepEqual(state.last.observation, { service: 'failed', sources: [], setups: [], normalWaits: 0, detail: 'The Host process is gone.' })
  assert.equal(state.last.after.epoch, 2, 'the observation after the restart is kept')
})

test('a Host that does not stop within the grace period is not killed or restarted', async t => {
  const app = await open(t, { initial: failed() })
  app.host.stopResult = 'timeout'
  const result = await app.watchdog.inspectOnce()
  assert.equal(result.kind, 'restart-timeout')
  assert.equal(result.action, 'restart')
  assert.equal(result.result, 'notified')
  assert.equal(app.host.calls.stop, 1)
  assert.equal(app.host.calls.start, 0)
  assert.equal(app.notifications.length, 1)
  assert.equal(app.notifications[0].escalate, true)
  assert.equal(result.budget.used, 1)
})

test('a Host that cannot start again, or is still failed, asks a person', async t => {
  const app = await open(t, { initial: failed() })
  app.host.startError = new Error('HOST_LEASED')
  const startFailed = await app.watchdog.inspectOnce()
  assert.equal(startFailed.kind, 'restart-failed')
  assert.equal(startFailed.result, 'notified')
  assert.equal(app.notifications.at(-1).escalate, true)
  app.host.startError = undefined
  app.host.afterStart = failed('The Host is still unhealthy.')
  const stillFailed = await app.watchdog.inspectOnce()
  assert.equal(stillFailed.kind, 'restart-failed')
  assert.equal(app.host.calls.start, 2)
})

test('changed restart errors are not suppressed as the same error', async t => {
  const app = await open(t, { initial: failed() })
  app.host.stopError = new Error('stop failed: A')
  const first = await app.watchdog.inspectOnce()
  assert.equal(first.result, 'notified')
  app.host.stopError = new Error('stop failed: B')
  const second = await app.watchdog.inspectOnce()
  assert.equal(second.result, 'notified', 'the changed detail is news')
  assert.equal(app.notifications.length, 2)
  app.host.stopError = new Error('stop failed: B')
  const unchanged = await app.watchdog.inspectOnce()
  assert.equal(unchanged.result, 'suppressed', 'the same detail is deduped')
})

test('a component or setup failure keeps the Host up even when the service probe also failed', async t => {
  const app = await open(t, { initial: { ...failed(), setups: [{ id: 'desktop', state: 'missing' }] } })
  assert.equal((await app.watchdog.inspectOnce()).kind, 'setup-missing')
  assert.equal(app.host.calls.stop + app.host.calls.start, 0)
  app.host.setProbe({ ...failed(), sources: [{ id: 'github:o/r', state: 'failed', error: 'SOURCE_FAILED' }] })
  assert.equal((await app.watchdog.inspectOnce()).kind, 'component-failure')
  assert.equal(app.host.calls.stop + app.host.calls.start, 0)
})

test('a stop that ignores the grace signal is cut off as a timeout, without a second Host', async t => {
  const app = await open(t, { initial: failed() })
  app.host.stopHangs = true
  const result = await app.watchdog.inspectOnce()
  assert.equal(result.kind, 'restart-timeout')
  assert.equal(result.result, 'notified')
  assert.equal(app.host.calls.start, 0)
})

test('a failed notification is retried instead of being recorded as delivered', async t => {
  const app = await open(t, { initial: { ...healthy(), setups: [{ id: 'desktop', state: 'missing' }] }, notify: () => { throw new Error('channel down') } })
  const first = await app.watchdog.inspectOnce()
  assert.equal(first.result, 'failed')
  const second = await app.watchdog.inspectOnce()
  assert.equal(second.result, 'failed', 'the same error is tried again because it was never delivered')
  const state = await app.watchdog.getState()
  assert.equal(state.notifiedFingerprint, undefined)
})

test('the grace period cannot exceed five minutes', async t => {
  const app = await open(t)
  assert.throws(() => new Watchdog({
    instanceId: 'private', storage: app.storage, host: app.host, graceMs: 300_001,
  }), /graceMs/u)
})

test('the restart budget stops a repeated failure and asks a person once', async t => {
  const app = await open(t, { initial: failed(), maxRestarts: 1, restartWindowMs: 60_000 })
  app.host.afterStart = healthy()
  assert.equal((await app.watchdog.inspectOnce()).kind, 'recovered')
  app.host.setProbe(failed())
  const exhausted = await app.watchdog.inspectOnce()
  assert.equal(exhausted.kind, 'budget-exhausted')
  assert.equal(exhausted.action, 'none')
  assert.equal(app.host.calls.stop, 1, 'the second failure did not start another restart')
  assert.equal(app.host.calls.start, 1)
  assert.equal(app.notifications.length, 1)
  assert.equal(app.notifications[0].escalate, true)
  app.advance(1_000)
  assert.equal((await app.watchdog.inspectOnce()).result, 'suppressed', 'the unchanged budget error is not repeated')
})

test('a healthy inspection clears the dedupe key so a later recurrence is news again', async t => {
  const app = await open(t)
  app.host.setProbe({ ...healthy(), setups: [{ id: 'desktop', state: 'missing' }] })
  assert.equal((await app.watchdog.inspectOnce()).result, 'notified')
  app.host.setProbe(healthy())
  assert.equal((await app.watchdog.inspectOnce()).kind, 'healthy')
  app.host.setProbe({ ...healthy(), setups: [{ id: 'desktop', state: 'missing' }] })
  assert.equal((await app.watchdog.inspectOnce()).result, 'notified')
  assert.equal(app.notifications.length, 2)
})

test('the loop inspects again on its interval and stops without touching the Host', async t => {
  const app = await open(t)
  app.watchdog.start()
  await new Promise(resolve => setTimeout(resolve, 70))
  await app.watchdog.stop()
  assert.ok(app.host.calls.probe >= 2, 'the loop made more than one inspection')
  assert.equal(app.host.calls.stop + app.host.calls.start, 0)
  const state = await app.watchdog.getState()
  assert.equal(state.last.kind, 'healthy')
})
