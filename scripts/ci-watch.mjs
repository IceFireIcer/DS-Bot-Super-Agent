import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const usage = `Usage: node scripts/ci-watch.mjs [run-id] [--timeout <seconds>] [--interval <seconds>] [--jobs <name,...>] [--repo <owner/repo>] [--json]
Watches one GitHub Actions run. It refuses a run whose head differs from HEAD, prints a job only
when its status changes, and fetches compact failed-step logs when the run fails.`

export function parseArgs(args) {
  const options = { timeout: 1800, interval: 10, jobs: [], json: false, repo: undefined, runId: undefined }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--help') return { help: true }
    if (arg === '--json') { options.json = true; continue }
    if (['--timeout', '--interval', '--jobs', '--repo'].includes(arg)) {
      const value = args[++index]
      if (!value || value.startsWith('-')) throw new Error(`${arg} needs a value.\n${usage}`)
      if (arg === '--timeout' || arg === '--interval') {
        const seconds = Number(value)
        if (!Number.isInteger(seconds) || seconds < 1) throw new Error(`${arg} must be a positive integer.`)
        options[arg.slice(2)] = seconds
      } else if (arg === '--jobs') options.jobs = value.split(',').map(name => name.trim()).filter(Boolean)
      else options.repo = value
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Unknown argument ${arg}.\n${usage}`)
    if (options.runId) throw new Error(`Only one run id is accepted.\n${usage}`)
    options.runId = arg
  }
  return options
}

export function redact(text) {
  return text
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu, '[redacted]')
    .replace(/\b(Bearer|token[=:])\s*[A-Za-z0-9._~+/=-]{12,}/giu, '$1 [redacted]')
}

export function compactLog(text, limit = 120) {
  const lines = redact(text).split(/\r?\n/u).filter(Boolean)
  const selected = lines.filter(line => /##\[error\]|\bError:|\bFAIL\b|✖|failed|timed out/iu.test(line))
  const tail = lines.slice(-Math.floor(limit / 2))
  return [...new Set([...selected, ...tail])].slice(-limit)
}

export function matchingJobs(jobs, filters) {
  if (!filters.length) return jobs
  const lowered = filters.map(filter => filter.toLowerCase())
  return jobs.filter(job => lowered.some(filter => job.name.toLowerCase() === filter || job.name.toLowerCase().includes(filter)))
}

export function diffJobs(previous, current) {
  const before = new Map(previous.map(job => [job.name, `${job.status}/${job.conclusion ?? ''}`]))
  return current.flatMap(job => {
    const state = `${job.status}/${job.conclusion ?? ''}`
    return before.get(job.name) === state ? [] : [{ name: job.name, state, previous: before.get(job.name) ?? null }]
  })
}

export function failedSteps(run) {
  return run.jobs.flatMap(job => job.conclusion === 'failure'
    ? [{ job: job.name, steps: (job.steps ?? []).filter(step => step.conclusion === 'failure').map(step => step.name) }]
    : [])
}

function gh(args, options) {
  try {
    return execFileSync('gh', options.repo ? [...args, '--repo', options.repo] : args, {
      encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error && error.stderr ? String(error.stderr).trim() : ''
    throw new Error(`gh ${args.join(' ')} failed${detail ? `: ${detail}` : '.'}`)
  }
}

function readRun(id, options) {
  const run = JSON.parse(gh(['run', 'view', String(id), '--json', 'status,conclusion,headSha,url,workflowName,jobs'], options))
  run.jobs = matchingJobs(run.jobs, options.jobs)
  if (!run.jobs.length) throw new Error(`No job matches ${options.jobs.join(', ')}.`)
  return run
}

function latestRun(options) {
  const branch = (() => {
    try { return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim() } catch { return '' }
  })()
  const args = ['run', 'list', '--limit', '1', '--json', 'databaseId']
  if (branch) args.push('--branch', branch)
  const runs = JSON.parse(gh(args, options))
  if (!runs[0]) throw new Error('No workflow run was found.')
  return runs[0].databaseId
}

function jobLine(job) {
  const state = job.conclusion ? `${job.status}/${job.conclusion}` : job.status
  const failed = (job.steps ?? []).filter(step => step.conclusion === 'failure').map(step => step.name)
  return `${job.name}: ${state}${failed.length ? ` (failed: ${failed.join(', ')})` : ''}`
}

async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function main(args) {
  const options = parseArgs(args)
  if (options.help) { console.log(usage); return }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const runId = options.runId ?? latestRun(options)
  const deadline = Date.now() + options.timeout * 1000
  let previous = []
  let run
  while (true) {
    run = readRun(runId, options)
    if (run.headSha !== head) {
      throw new Error(`Run ${runId} is for head ${run.headSha}, but HEAD is ${head}. Check out that commit first.`)
    }
    const changes = diffJobs(previous, run.jobs)
    if (!previous.length) {
      if (options.json) console.log(JSON.stringify({ type: 'run', id: runId, head: run.headSha, url: run.url, workflow: run.workflowName }))
      else console.log(`Run ${runId} · ${run.workflowName} · ${run.url}\nHead ${run.headSha}`)
    }
    for (const change of changes) {
      if (options.json) console.log(JSON.stringify({ type: 'job', ...change }))
      else console.log(jobLine(run.jobs.find(job => job.name === change.name)))
    }
    previous = run.jobs
    if (run.status === 'completed') break
    if (Date.now() >= deadline) throw new Error(`Timed out after ${options.timeout}s waiting for run ${runId}.`)
    await wait(options.interval * 1000)
  }
  const failures = failedSteps(run)
  if (options.json) console.log(JSON.stringify({ type: 'final', id: runId, status: run.status, conclusion: run.conclusion, url: run.url, failures }))
  else console.log(`\nRun ${runId} completed: ${run.conclusion}.`)
  if (run.conclusion !== 'success') {
    if (failures.length && !options.json) {
      console.log('Failed steps:')
      for (const failure of failures) console.log(`- ${failure.job}: ${failure.steps.join(', ') || 'job failed'}`)
    }
    let logs = ''
    try { logs = gh(['run', 'view', String(runId), '--log-failed'], options) } catch {}
    const compact = compactLog(logs)
    if (compact.length) {
      if (options.json) console.log(JSON.stringify({ type: 'failure-log', lines: compact }))
      else {
        console.log('Compact failure log:')
        console.log(compact.join('\n'))
      }
    }
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : 'CI run could not be watched.')
    process.exitCode = 1
  })
}
