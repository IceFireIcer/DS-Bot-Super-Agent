import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

export function checkRecord(text, resolveCommit) {
  const problems = []
  for (const [index, line] of text.split('\n').entries()) {
    if (line.includes('待提交')) problems.push({ line: index + 1, reason: 'Replace the pending-commit placeholder with the implementation or review commit.' })
    if (resolveCommit) for (const match of line.matchAll(/`([a-f0-9]{7,40})`/gu)) {
      if (!resolveCommit(match[1])) problems.push({ line: index + 1, reason: `Commit ${match[1]} is absent from local history.` })
    }
  }
  return problems
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith('.md') ? [join(directory, entry.name)] : [])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const resolveCommit = process.argv.includes('--check-refs') ? ref => {
    try { execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: root, stdio: 'ignore' }); return true }
    catch { return false }
  } : undefined
  const problems = files(join(root, 'docs/superagent/implementation')).flatMap(file => checkRecord(readFileSync(file, 'utf8'), resolveCommit).map(problem => `${file}:${problem.line}: ${problem.reason}`))
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1 }
  else console.log('Implementation records have no pending-commit placeholders; references checked against local history when requested.')
}
