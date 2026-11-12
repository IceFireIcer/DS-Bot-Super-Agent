import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const APPROVAL_ENV = 'DSBOT_UI_CHANGE_APPROVED'
const prefixes = ['app/ui/', 'ds-bot/src/client/']
const files = new Set(['ds-bot/client.js'])

const usage = `Usage: node scripts/check-ui-boundary.mjs [--base <ref>] [--json]
Lists changes under app/ui/, ds-bot/src/client/ and ds-bot/client.js. Those files need
an explicit UI change request, marked with ${APPROVAL_ENV}=1 in the environment.`

export function uiChanges(paths) {
  return [...new Set(paths.map(path => path.replaceAll('\\', '/').replace(/^\.\//u, '')))]
    .filter(path => prefixes.some(prefix => path.startsWith(prefix)) || files.has(path))
    .sort()
}

export function checkUiBoundary({ paths, approved }) {
  const changed = uiChanges(paths)
  return { files: changed, allowed: changed.length === 0 || approved }
}

let repository
function git(...args) {
  repository ??= execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  return execFileSync('git', args, {
    cwd: repository,
    encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })
}

function resolveBase(requested) {
  const candidates = requested ? [requested] : ['origin/dev', 'dev', 'HEAD']
  for (const candidate of candidates) {
    try {
      git('rev-parse', '--verify', `${candidate}^{commit}`)
      return candidate
    } catch {
      if (requested) throw new Error(`Base ${requested} is not a commit in this repository.`)
    }
  }
  throw new Error('No base commit is available.')
}

function changedPaths(base) {
  const committed = git('diff', '--name-only', base).split(/\r?\n/u).filter(Boolean)
  const untracked = git('ls-files', '--others', '--exclude-standard').split(/\r?\n/u).filter(Boolean)
  return [...committed, ...untracked]
}

function main(args) {
  let base
  let json = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--help') { console.log(usage); return }
    if (args[index] === '--json') { json = true; continue }
    if (args[index] === '--base' && args[index + 1]) { base = args[++index]; continue }
    throw new Error(usage)
  }
  const resolved = resolveBase(base)
  const approved = process.env[APPROVAL_ENV] === '1'
  const result = checkUiBoundary({ paths: changedPaths(resolved), approved })
  if (json) console.log(JSON.stringify({ base: resolved, approved, ...result }, null, 2))
  else if (result.allowed) console.log(result.files.length ? `UI changes are approved (base ${resolved}):\n${result.files.join('\n')}` : `UI boundary intact (base ${resolved}).`)
  if (!result.allowed) {
    if (json) console.error(JSON.stringify({ base: resolved, approved, ...result }, null, 2))
    else console.error(`UI files changed without an explicit request (base ${resolved}):\n${result.files.join('\n')}\n\nGet the user's approval, then set ${APPROVAL_ENV}=1 for this check.`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'UI boundary could not be checked.')
    process.exitCode = 1
  }
}
