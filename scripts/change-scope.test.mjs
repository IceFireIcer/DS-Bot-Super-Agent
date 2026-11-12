import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { classifyChanges } from './change-scope.mjs'

const script = fileURLToPath(new URL('./change-scope.mjs', import.meta.url))

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), 'dsbot-change-scope-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const repository = join(directory, 'repository')
  execFileSync('git', ['init', '--initial-branch=main', repository], { stdio: 'ignore' })
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture User', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  writeFileSync(join(repository, 'README.md'), 'base\n')
  git('add', '.')
  git('commit', '-m', 'Initial fixture')
  return {
    repository, git,
    run: (args, env = {}) => spawnSync(process.execPath, [script, ...args], { cwd: repository, encoding: 'utf8', env: { ...process.env, ...env } }),
  }
}

test('documentation changes skip product jobs while code changes select their job', () => {
  assert.deepEqual(classifyChanges(['docs/vision.md', 'README.md', 'LICENSE']), {
    docsOnly: true, test: false, superagent: false, app: false, mobile: false, app_package: false, docker: false,
  })
  assert.deepEqual(classifyChanges(['ds-bot/src/host/roster.js', 'scripts/scan.mjs']), {
    docsOnly: false, test: true, superagent: false, app: false, mobile: false, app_package: false, docker: true,
  })
  assert.deepEqual(classifyChanges(['superagent/src/engine.ts']), {
    docsOnly: false, test: false, superagent: true, app: false, mobile: false, app_package: false, docker: false,
  })
  assert.deepEqual(classifyChanges(['app/main.js', 'mobile/App.tsx']), {
    docsOnly: false, test: false, superagent: false, app: true, mobile: true, app_package: true, docker: false,
  })
})

test('workflow and unknown changes run every job and --all does the same', () => {
  for (const path of ['.github/workflows/test.yml', 'start.ps1', '.editorconfig']) {
    assert.deepEqual(classifyChanges([path]), {
      docsOnly: false, test: true, superagent: true, app: true, mobile: true, app_package: true, docker: true,
    })
  }
})

test('the CLI writes GitHub outputs and reads a base/head diff', context => {
  const { repository, git, run } = fixture(context)
  git('switch', '-c', 'docs')
  writeFileSync(join(repository, 'docs.md'), 'documentation\n')
  git('add', '.')
  git('commit', '-m', 'Documentation change')
  const output = join(repository, 'output.txt')
  writeFileSync(output, '')
  const result = run(['--base', 'main', '--head', 'docs', '--github-output'], { GITHUB_OUTPUT: output })
  assert.equal(result.status, 0, result.stderr)
  assert.match(readFileSync(output, 'utf8'), /^test=false$/mu)
  assert.match(readFileSync(output, 'utf8'), /^docs_only=true$/mu)
  const json = run(['--base', 'main', '--head', 'docs', '--json'])
  assert.equal(json.status, 0, json.stderr)
  assert.equal(JSON.parse(json.stdout).docsOnly, true)
  const all = run(['--all', '--json'])
  assert.equal(all.status, 0, all.stderr)
  assert.equal(JSON.parse(all.stdout).docker, true)
  for (const args of [['--base', 'missing'], ['--base'], ['--all', '--base', 'main'], ['--bad']]) assert.equal(run(args).status, 1)
})
