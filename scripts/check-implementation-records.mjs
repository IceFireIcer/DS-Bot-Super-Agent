import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

export const tickets = Array.from({ length: 60 }, (_, index) => `T${String(index + 1).padStart(2, '0')}`)
export const plannedTickets = new Set(['T57', 'T58', 'T59', 'T60'])
export const reviewDebt = new Set(['T18', 'T19', 'T20', 'T21', 'T22', 'T23', 'T24', 'T25', 'T26', 'T28', 'T29', 'T32'])
export const linkDebt = new Set([
  'docs/superagent/implementation/reviews/t33.md:../issues/T33.md',
  'docs/superagent/implementation/reviews/t34.md:../issues/T34.md',
  'docs/superagent/implementation/reviews/t35.md:../issues/T35.md',
  'docs/superagent/implementation/reviews/t36.md:../issues/T36.md',
])

export function classifyReference(text) {
  if (/^\d+$/u.test(text)) return 'number'
  if (/^[a-f0-9]{7,40}$/u.test(text) && /[a-f]/u.test(text)) return 'commit'
  return 'other'
}

export function checkRecord(text, resolveCommit) {
  const problems = []
  for (const [index, line] of text.split('\n').entries()) {
    if (line.includes('待提交')) problems.push({ line: index + 1, reason: 'Replace the pending-commit placeholder with the implementation or review commit.' })
    if (resolveCommit) for (const match of line.matchAll(/`([^`]+)`/gu)) {
      if (classifyReference(match[1]) === 'commit' && !resolveCommit(match[1])) {
        problems.push({ line: index + 1, reason: `Commit ${match[1]} is absent from local history.` })
      }
    }
  }
  return problems
}

export function localLinks(text) {
  const links = []
  let fenced = false
  for (const [index, raw] of text.split('\n').entries()) {
    if (/^\s*```/u.test(raw)) { fenced = !fenced; continue }
    if (fenced) continue
    const line = raw.replace(/`[^`]*`/gu, '')
    for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
      let target = match[1].replace(/^<|>$/gu, '')
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/|[A-Za-z]:[\\/]|\\\\)/iu.test(target)) continue
      target = target.split(/[?#]/u)[0]
      if (!target) continue
      try { target = decodeURIComponent(target) } catch {}
      links.push({ line: index + 1, target })
    }
  }
  return links
}

export function checkLinks(file, text, root, debt = linkDebt) {
  const problems = []
  const debtSeen = new Set()
  const source = relative(root, file).replaceAll('\\', '/')
  for (const link of localLinks(text)) {
    const target = normalize(join(dirname(file), link.target))
    if (existsSync(target)) continue
    const key = `${source}:${link.target}`
    if (debt.has(key)) { debtSeen.add(key); continue }
    problems.push({ line: link.line, reason: `Relative link ${link.target} does not exist.` })
  }
  return { problems, debtSeen }
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith('.md') ? [join(directory, entry.name)] : [])
}

function named(directory, pattern) {
  return new Set(readdirSync(directory).filter(name => pattern.test(name)).map(name => name.replace(/\.md$/u, '')))
}

export function checkCoverage(root) {
  const implementation = join(root, 'docs/superagent/implementation')
  const issues = join(root, 'docs/superagent/issues')
  const reviews = join(implementation, 'reviews')
  const problems = []
  const expected = new Set(tickets.map(ticket => ticket.toLowerCase()))
  const issueNames = named(issues, /^T\d+\.md$/u)
  const recordNames = named(implementation, /^t\d+\.md$/u)
  const reviewNames = named(reviews, /^t\d+\.md$/u)
  for (const ticket of tickets) {
    const id = ticket.toLowerCase()
    if (!issueNames.has(ticket)) problems.push(`Missing issue record docs/superagent/issues/${ticket}.md.`)
    if (plannedTickets.has(ticket)) continue
    if (!recordNames.has(id)) problems.push(`Missing implementation record docs/superagent/implementation/${id}.md.`)
    if (!reviewNames.has(id) && !reviewDebt.has(ticket)) problems.push(`Missing standalone review docs/superagent/implementation/reviews/${id}.md; add it or record the gap in reviewDebt.`)
  }
  for (const name of issueNames) if (!tickets.includes(name)) problems.push(`Issue record ${name}.md is not in the ticket allowlist.`)
  for (const name of recordNames) if (!expected.has(name)) problems.push(`Implementation record ${name}.md is not in the ticket allowlist.`)
  for (const name of reviewNames) if (!expected.has(name)) problems.push(`Review ${name}.md is not in the ticket allowlist.`)
  return problems
}

export function checkRepository(root, { checkRefs = false } = {}) {
  const implementation = join(root, 'docs/superagent/implementation')
  const resolveCommit = checkRefs ? ref => {
    try {
      execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: root, stdio: 'ignore' })
      return true
    } catch { return false }
  } : undefined
  const problems = []
  const debtSeen = new Set()
  for (const file of files(implementation)) {
    const text = readFileSync(file, 'utf8')
    for (const problem of checkRecord(text, resolveCommit)) problems.push(`${relative(root, file).replaceAll('\\', '/')}:${problem.line}: ${problem.reason}`)
    const links = checkLinks(file, text, root)
    for (const key of links.debtSeen) debtSeen.add(key)
    for (const problem of links.problems) problems.push(`${relative(root, file).replaceAll('\\', '/')}:${problem.line}: ${problem.reason}`)
  }
  problems.push(...checkCoverage(root))
  const warnings = [...linkDebt].filter(key => !debtSeen.has(key)).map(key => `Historical link debt no longer applies: ${key}`)
  const reviews = join(implementation, 'reviews')
  for (const ticket of reviewDebt) {
    if (existsSync(join(reviews, `${ticket.toLowerCase()}.md`))) warnings.push(`Historical review debt no longer applies: ${ticket}`)
  }
  return { problems, warnings }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const { problems, warnings } = checkRepository(root, { checkRefs: process.argv.includes('--check-refs') })
  for (const warning of warnings) console.warn(`warning: ${warning}`)
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  } else console.log('Implementation records pass placeholder, coverage and relative-link checks; commit references were checked against local history when requested.')
}
