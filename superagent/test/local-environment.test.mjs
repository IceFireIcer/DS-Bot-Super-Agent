import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, symlink, rename, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import * as core from '../dist/index.js'

async function fixture(context, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-local-tools-'))
  const root = join(directory, 'work')
  await mkdir(root)
  let environment
  context.after(async () => { await environment?.close(); await rm(directory, { recursive: true, force: true }) })
  environment = await core.LocalEnvironment.open({ id: 'work', instanceId: 'private', root, allowedActorIds: ['user'], permissions: ['read', 'write', 'search', 'command'], commands: { verify: { argv: [process.execPath, '-e', "const fs=require('node:fs'); console.log(fs.readFileSync('answer.txt','utf8'));"], timeoutMs: 2000 } }, ...extra })
  return { environment, root, directory }
}

test('bound filesystem, search and a real command see the same local files through public DSH providers', async context => {
  const { environment } = await fixture(context)
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  await bound.invoke('write_file', { path: 'answer.txt', text: 'hello\n' })
  assert.equal((await bound.invoke('read_file', { path: 'answer.txt' })).text, 'hello\n')
  assert.deepEqual((await bound.invoke('glob', { pattern: '*.txt' })).paths, ['answer.txt'])
  assert.deepEqual((await bound.invoke('grep', { pattern: 'hello' })).matches, [{ path: 'answer.txt', line: 1, text: 'hello' }])
  const command = await bound.invoke('run_command', { name: 'verify' })
  assert.equal(command.exitCode, 0)
  assert.equal(command.stdout.trim(), 'hello')
  const artifact = await bound.artifact('answer.txt')
  assert.equal(artifact.bytes, 6)
  assert.equal(artifact.sha256, '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03')
})

test('two directory bindings reject traversal, links, protected files, foreign actors and unsupported tools', async context => {
  const first = await fixture(context)
  const second = await fixture(context)
  const one = await first.environment.prepare({ instanceId: 'private', actorId: 'user' })
  const two = await second.environment.prepare({ instanceId: 'private', actorId: 'user' })
  await one.invoke('write_file', { path: 'answer.txt', text: 'first' })
  await two.invoke('write_file', { path: 'answer.txt', text: 'second' })
  assert.equal((await one.invoke('read_file', { path: 'answer.txt' })).text, 'first')
  assert.equal((await two.invoke('read_file', { path: 'answer.txt' })).text, 'second')
  await writeFile(join(first.root, '.npmrc'), 'fixture credential data')
  await symlink(second.root, join(first.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  for (const path of ['../answer.txt', '.env', '.npmrc', 'linked/answer.txt', second.root]) await assert.rejects(one.invoke('read_file', { path }), { code: 'PATH_DENIED' })
  assert.deepEqual((await one.invoke('glob', { pattern: '*' })).paths, ['answer.txt'])
  await assert.rejects(first.environment.prepare({ instanceId: 'other', actorId: 'user' }), { code: 'ENVIRONMENT_DENIED' })
  await assert.rejects(first.environment.prepare({ instanceId: 'private', actorId: 'intruder' }), { code: 'ENVIRONMENT_DENIED' })
  await assert.rejects(one.invoke('shell', { command: 'echo anything' }), { code: 'UNSUPPORTED_CAPABILITY' })
  await assert.rejects(one.invoke('run_command', { name: 'not-configured' }), { code: 'UNSUPPORTED_CAPABILITY' })
})

test('a real local command is cancelled and joined before returning, with bounded sanitized failure output', async context => {
  const { environment } = await fixture(context, { commands: {
    wait: { argv: [process.execPath, '-e', "console.log('started');require('node:fs').writeFileSync('started.txt','started');setInterval(()=>{},1000)"], timeoutMs: 5000 },
    fail: { argv: [process.execPath, '-e', "console.error('token=fixture-private-value'); process.exit(9)"], timeoutMs: 2000 },
  } })
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  const controller = new AbortController()
  const running = bound.invoke('run_command', { name: 'wait' }, controller.signal)
  void running.catch(() => {})
  context.after(() => controller.abort())
  const started = Date.now()
  while (true) {
    try { if ((await bound.invoke('read_file', { path: 'started.txt' })).text === 'started') break } catch {}
    if (Date.now() - started > 3000) { controller.abort(); await running; assert.fail('The configured command did not publish readiness within its budget.') }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  controller.abort()
  const result = await running
  assert.equal(result.cancelled, true)
  assert.equal(result.stdout.trim(), 'started')
  const failed = await bound.invoke('run_command', { name: 'fail' })
  assert.equal(failed.exitCode, 9)
  assert.match(failed.stderr, /token=\[redacted\]/u)
  assert.doesNotMatch(failed.stderr, /fixture-private-value/u)
})

test('read-only environments and failed preparation cannot enable writes or silently retry setup', async context => {
  const readonly = await fixture(context, { permissions: ['read', 'search'] })
  const bound = await readonly.environment.prepare({ instanceId: 'private', actorId: 'user' })
  await assert.rejects(bound.invoke('write_file', { path: 'answer.txt', text: 'denied' }), { code: 'PERMISSION_DENIED' })
  await assert.rejects(bound.invoke('run_command', { name: 'verify' }), { code: 'PERMISSION_DENIED' })
  const failed = await fixture(context, { setup: 'setup', commands: { setup: { argv: [process.execPath, '-e', "console.error('setup failed'); process.exit(7)"], timeoutMs: 2000 } } })
  await assert.rejects(failed.environment.prepare({ instanceId: 'private', actorId: 'user' }), error => error.code === 'SETUP_FAILED' && error.output.exitCode === 7 && error.output.stderr.includes('setup failed'))
})

test('truncated command diagnostics cannot expose a secret tail whose label was discarded', async context => {
  const { environment } = await fixture(context, { commands: { fail: { argv: [process.execPath, '-e', "console.error('password='+'fixture-value-'.repeat(1000));process.exit(9)"], timeoutMs: 2000 } } })
  const bound = await environment.prepare({ instanceId: 'private', actorId: 'user' })
  const result = await bound.invoke('run_command', { name: 'fail' })
  assert.equal(result.truncated, true)
  assert.doesNotMatch(result.stderr, /fixture-value/u)
})

test('setup rejects junction ancestors instead of rebinding a retry to another physical working directory', async context => {
  const original = await fixture(context)
  const alias = join(original.directory, 'alias')
  await symlink(original.root, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const nested = join(original.root, 'nested')
  await mkdir(nested)
  const replacement = await fixture(context, { root: join(alias, 'nested') })
  await assert.rejects(replacement.environment.prepare({ instanceId: 'private', actorId: 'user' }), { code: 'SETUP_FAILED' })
})

test('failed setup cannot retry in a replacement real directory at the same pathname', async context => {
  const { environment, root, directory } = await fixture(context, { setup: 'setup', commands: {
    setup: { argv: [process.execPath, '-e', "require('node:fs').writeFileSync('attempt.txt','attempt');process.exit(7)"], timeoutMs: 2000 },
  } })
  await assert.rejects(environment.prepare({ instanceId: 'private', actorId: 'user' }), { code: 'SETUP_FAILED' })
  await rename(root, join(directory, 'original'))
  await mkdir(root)
  await assert.rejects(environment.prepare({ instanceId: 'private', actorId: 'user' }), { code: 'ENVIRONMENT_CHANGED' })
  await assert.rejects(readFile(join(root, 'attempt.txt')), { code: 'ENOENT' })
  assert.equal(await readFile(join(directory, 'original', 'attempt.txt'), 'utf8'), 'attempt')
})
