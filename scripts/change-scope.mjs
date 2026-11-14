import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const usage = `Usage: node scripts/change-scope.mjs [--base <ref>] [--head <ref>] [--all] [--full] [--github-output] [--json]
Classifies daily checks by changed paths. --full requires every release check regardless of paths.`

const scopes = ['test', 'superagent', 'app', 'mobile', 'app_package', 'docker']
const docs = path => path === 'LICENSE' || path === 'NOTICE' || path === 'CHANGELOG.md'
  || path.startsWith('docs/') || path.startsWith('.agents/') || path.startsWith('super-agent-references/')
  || path.endsWith('.md')

export function classifyChanges(paths, { full = false } = {}) {
  if (full) return { docsOnly: false, ...Object.fromEntries(scopes.map(scope => [scope, true])) }
  const result = Object.fromEntries(scopes.map(scope => [scope, false]))
  let docsOnly = true
  for (const raw of paths) {
    const path = raw.replaceAll('\\', '/').replace(/^\.\//u, '')
    if (!path) continue
    if (docs(path)) continue
    docsOnly = false
    if (path.startsWith('ds-bot/')) {
      result.test = true
    } else if (path.startsWith('superagent/')) result.superagent = true
    else if (path.startsWith('app/')) {
      result.app = true
    } else if (path.startsWith('mobile/')) result.mobile = true
    else if (path.startsWith('docker/') || path === 'docker-compose.yml' || path === '.dockerignore') result.docker = true
    else if (path.startsWith('scripts/')) {
      // The scan job runs scripts/*.test.mjs for every change.
    } else {
      // Unknown paths and workflow edits run the daily checks. Install/update matrices
      // belong to the release gate; they must not turn every push into a release rehearsal.
      for (const scope of ['test', 'superagent', 'app', 'mobile']) result[scope] = true
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
  let full = false
  let githubOutput = false
  let json = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--help') { console.log(usage); return }
    if (args[index] === '--all') { all = true; continue }
    if (args[index] === '--full') { full = true; continue }
    if (args[index] === '--github-output') { githubOutput = true; continue }
    if (args[index] === '--json') { json = true; continue }
    if (args[index] === '--base' && args[index + 1] && !args[index + 1].startsWith('-')) { base = args[++index]; continue }
    if (args[index] === '--head' && args[index + 1] && !args[index + 1].startsWith('-')) { head = args[++index]; continue }
    throw new Error(usage)
  }
  if (all && base) throw new Error('--all cannot be combined with --base.')
  const result = classifyChanges(all || full ? ['__all__'] : changedPaths(base ?? 'HEAD^', head), { full })
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
