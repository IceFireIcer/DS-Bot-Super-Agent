import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { APPROVAL_ENV, checkUiBoundary, uiChanges } from './check-ui-boundary.mjs'

const script = fileURLToPath(new URL('./check-ui-boundary.mjs', import.meta.url))

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), 'dsbot-ui-boundary-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const repository = join(directory, 'repository')
  mkdirSync(repository)
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture User', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '--initial-branch=main')
  mkdirSync(join(repository, 'docs'))
  writeFileSync(join(repository, 'docs', 'readme.md'), 'base\n')
  git('add', '.')
  git('commit', '-m', 'Initial fixture')
  return {
    repository, git,
    run: (args, env = {}) => spawnSync(process.execPath, [script, ...args], { cwd: repository, encoding: 'utf8', env: { ...process.env, ...env } }),
    runAt: (cwd, args, env = {}) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } }),
  }
}

test('the boundary lists only product UI changes', () => {
  assert.deepEqual(uiChanges([
    'app/main.js',
    'app/ui/index.html',
    'ds-bot/src/client/chat.js',
    'ds-bot/client.js',
    'ds-bot/src/host/roster.js',
    'docs/ui.md',
  ]), ['app/ui/index.html', 'ds-bot/client.js', 'ds-bot/src/client/chat.js'])
  assert.equal(checkUiBoundary({ paths: ['docs/ui.md'], approved: false }).allowed, true)
})

test('the CLI fails on UI changes without the approval marker and passes with it', context => {
  const { repository, run } = fixture(context)
  mkdirSync(join(repository, 'app', 'ui'), { recursive: true })
  writeFileSync(join(repository, 'app', 'ui', 'index.html'), 'changed\n')
  writeFileSync(join(repository, 'docs', 'readme.md'), 'documentation\n')
  const refused = run(['--base', 'main', '--json'])
  assert.equal(refused.status, 1, refused.stderr)
  assert.deepEqual(JSON.parse(refused.stderr), {
    base: 'main', approved: false, files: ['app/ui/index.html'], allowed: false,
  })
  const approved = run(['--base', 'main', '--json'], { [APPROVAL_ENV]: '1' })
  assert.equal(approved.status, 0, approved.stderr)
  assert.deepEqual(JSON.parse(approved.stdout), {
    base: 'main', approved: true, files: ['app/ui/index.html'], allowed: true,
  })
})

test('the CLI accepts committed and untracked non-UI changes and rejects bad arguments', context => {
  const { repository, git, run, runAt } = fixture(context)
  git('switch', '-c', 'docs')
  writeFileSync(join(repository, 'docs', 'readme.md'), 'committed\n')
  git('commit', '-am', 'Documentation change')
  writeFileSync(join(repository, 'docs', 'new.md'), 'untracked\n')
  const clean = run(['--base', 'main'])
  assert.equal(clean.status, 0, clean.stderr)
  assert.match(clean.stdout, /UI boundary intact/)
  mkdirSync(join(repository, 'app', 'ui'), { recursive: true })
  mkdirSync(join(repository, 'sub'))
  writeFileSync(join(repository, 'app', 'ui', 'new.html'), 'untracked UI\n')
  const nested = runAt(join(repository, 'sub'), ['--base', 'main', '--json'])
  assert.equal(nested.status, 1, nested.stderr)
  assert.deepEqual(JSON.parse(nested.stderr).files, ['app/ui/new.html'])
  for (const args of [['--base', 'missing'], ['--base'], ['--unknown']]) assert.equal(run(args).status, 1)
})
