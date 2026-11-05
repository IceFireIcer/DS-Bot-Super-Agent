import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const script = fileURLToPath(new URL('./branch-status.mjs', import.meta.url))

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), 'dsbot-branch-status-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const repository = join(directory, 'repository')
  mkdirSync(repository)
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture User', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '--initial-branch=main')
  writeFileSync(join(repository, 'tracked.txt'), 'initial\n')
  git('add', '.')
  git('commit', '-m', 'Initial fixture')
  return { directory, repository, git, run: (...args) => spawnSync(process.execPath, [script, ...args], { cwd: repository, encoding: 'utf8' }) }
}

test('the CLI reports merged and unique branches plus missing worktrees without changing repository state', context => {
  const { directory, repository, git, run } = fixture(context)
  git('branch', 'integrated')
  git('switch', '-c', 'unfinished')
  writeFileSync(join(repository, 'tracked.txt'), 'unfinished work\n')
  git('commit', '-am', 'Independent fixture change')
  git('switch', 'main')
  const missingPath = join(directory, 'missing worktree')
  git('worktree', 'add', '-b', 'abandoned', missingPath)
  rmSync(missingPath, { recursive: true, force: true })
  writeFileSync(join(repository, 'untracked.txt'), 'preserve\n')
  const snapshot = () => [git('show-ref'), git('worktree', 'list', '--porcelain'), git('status', '--porcelain')]
  const before = snapshot()
  const result = run('--base', 'main')
  assert.equal(result.status, 0, result.stderr)
  const status = JSON.parse(result.stdout)
  assert.equal(status.base, 'main')
  assert.equal(status.currentBranch, 'main')
  assert.equal(status.workingTreeClean, false)
  const branches = Object.fromEntries(status.branches.map(branch => [branch.name, branch]))
  assert.equal(branches.integrated.uniqueCommits, 0)
  assert.equal(branches.integrated.mergedIntoBase, true)
  assert.equal(branches.unfinished.uniqueCommits, 1)
  assert.equal(branches.unfinished.mergedIntoBase, false)
  assert.equal(branches.abandoned.worktrees[0].exists, false)
  assert.equal(branches.abandoned.worktrees[0].prunable, true)
  assert.deepEqual(snapshot(), before)
})

test('the CLI reports upstream divergence and missing refs using local facts, including detached HEAD', context => {
  const { directory, repository, git, run } = fixture(context)
  git('remote', 'add', 'origin', join(directory, 'remote.git'))
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  git('branch', '--set-upstream-to=origin/main', 'main')
  git('switch', '-c', 'remote-side')
  writeFileSync(join(repository, 'tracked.txt'), 'remote change\n')
  git('commit', '-am', 'Remote fixture change')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  git('switch', 'main')
  writeFileSync(join(repository, 'tracked.txt'), 'local change\n')
  git('commit', '-am', 'Local fixture change')
  const result = run('--base', 'main')
  assert.equal(result.status, 0, result.stderr)
  const main = JSON.parse(result.stdout).branches.find(branch => branch.name === 'main')
  assert.equal(main.upstream, 'origin/main')
  assert.equal(main.ahead, 1)
  assert.equal(main.behind, 1)
  git('update-ref', '-d', 'refs/remotes/origin/main')
  git('switch', '--detach')
  const detached = run('--base', 'main')
  assert.equal(detached.status, 0, detached.stderr)
  const status = JSON.parse(detached.stdout)
  assert.equal(status.currentBranch, null)
  const missing = status.branches.find(branch => branch.name === 'main')
  assert.equal(missing.upstreamMissing, true)
  assert.equal(missing.ahead, undefined)
  assert.equal(missing.behind, undefined)
  for (const args of [['--base', 'missing'], ['--base', '--help'], ['--delete', 'main']]) {
    assert.equal(run(...args).status, 1)
  }
})
