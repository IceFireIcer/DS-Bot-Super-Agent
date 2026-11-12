import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const usage = `Usage: node scripts/change-scope.mjs [--base <ref>] [--head <ref>] [--all] [--github-output] [--json]
Classifies changed paths into the CI jobs that must run. An unrecognized path runs every job.`

const scopes = ['test', 'superagent', 'app', 'mobile', 'app_package', 'docker']
const docs = path => path === 'LICENSE' || path === 'NOTICE' || path === 'CHANGELOG.md'
  || path.startsWith('docs/') || path.startsWith('.agents/') || path.startsWith('super-agent-references/')
  || path.endsWith('.md')

export function classifyChanges(paths) {
  const result = Object.fromEntries(scopes.map(scope => [scope, false]))
  let docsOnly = true
  for (const raw of paths) {
    const path = raw.replaceAll('\\', '/').replace(/^\.\//u, '')
    if (!path) continue
    if (docs(path)) continue
    docsOnly = false
    if (path.startsWith('ds-bot/')) {
      result.test = true
      result.docker = true
    } else if (path.startsWith('superagent/')) result.superagent = true
    else if (path.startsWith('app/')) {
      result.app = true
      result.app_package = true
    } else if (path.startsWith('mobile/')) result.mobile = true
    else if (path.startsWith('docker/') || path === 'docker-compose.yml' || path === '.dockerignore') result.docker = true
    else if (path.startsWith('scripts/')) {
      // The scan job runs scripts/*.test.mjs for every change.
    } else if (path.startsWith('.github/workflows/')) {
      // A workflow change can alter any job, so validate the whole matrix.
      for (const scope of scopes) result[scope] = true
    } else {
      for (const scope of scopes) result[scope] = true
    }
  }
  return { docsOnly, ...result }
}

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  }).trim()
}

function changedPaths(base, head) {
  for (const ref of [base, head]) git('rev-parse', '--verify', `${ref}^{commit}`)
  return git('diff', '--name-only', base, head).split(/\r?\n/u).filter(Boolean)
}

function writeOutputs(result) {
  const target = process.env.GITHUB_OUTPUT
  if (!target) throw new Error('GITHUB_OUTPUT is not set.')
  const lines = scopes.map(scope => `${scope}=${result[scope]}`)
  lines.push(`docs_only=${result.docsOnly}`)
  appendFileSync(target, `${lines.join('\n')}\n`)
}

function main(args) {
  let base
  let head = 'HEAD'
  let all = false
  let githubOutput = false
  let json = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--help') { console.log(usage); return }
    if (args[index] === '--all') { all = true; continue }
    if (args[index] === '--github-output') { githubOutput = true; continue }
    if (args[index] === '--json') { json = true; continue }
    if (args[index] === '--base' && args[index + 1] && !args[index + 1].startsWith('-')) { base = args[++index]; continue }
    if (args[index] === '--head' && args[index + 1] && !args[index + 1].startsWith('-')) { head = args[++index]; continue }
    throw new Error(usage)
  }
  if (all && base) throw new Error('--all cannot be combined with --base.')
  const result = all ? classifyChanges(['__all__']) : classifyChanges(changedPaths(base ?? 'HEAD^', head))
  if (githubOutput) writeOutputs(result)
  if (json || !githubOutput) console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Change scope could not be read.')
    process.exitCode = 1
  }
}
