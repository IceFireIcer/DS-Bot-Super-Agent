import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const usage = 'Usage: node scripts/branch-status.mjs [--base <local-branch>]\nReports local Git facts as JSON without fetching, pruning, deleting or changing branches.'

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })
}

function main(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return }
  if (args.length && (args.length !== 2 || args[0] !== '--base' || !args[1])) throw new Error(usage)
  const base = args[1] ?? 'feat/1-superagent-integration'
  const baseRef = `refs/heads/${base}`
  git('show-ref', '--verify', baseRef)
  const baseCommit = git('rev-parse', '--verify', baseRef).trim()
  const currentBranch = git('branch', '--show-current').trim() || null
  const worktrees = []
  let worktree
  for (const field of git('worktree', 'list', '--porcelain', '-z').split('\0')) {
    if (field.startsWith('worktree ')) {
      worktree = { path: field.slice(9), exists: existsSync(field.slice(9)), prunable: false }
      worktrees.push(worktree)
    } else if (field.startsWith('branch ')) worktree.branch = field.slice(7)
    else if (field === 'prunable' || field.startsWith('prunable ')) worktree.prunable = true
  }
  const branches = git('for-each-ref', '--format=%(refname)%09%(upstream)%09%(objectname)', 'refs/heads/').trim().split('\n').filter(Boolean).map(line => {
    const [ref, upstreamRef, commit] = line.trim().split('\t')
    const uniqueCommits = Number(git('rev-list', '--count', `${baseCommit}..${commit}`).trim())
    const branch = {
      name: ref.slice('refs/heads/'.length), commit, uniqueCommits, mergedIntoBase: uniqueCommits === 0,
      worktrees: worktrees.filter(entry => entry.branch === ref).map(({ path, exists, prunable }) => ({ path, exists, prunable })),
    }
    if (upstreamRef) {
      branch.upstream = upstreamRef.replace(/^refs\/(heads|remotes)\//u, '')
      const resolved = git('for-each-ref', '--format=%(objectname)', upstreamRef).trim()
      branch.upstreamMissing = !resolved
      if (resolved) {
        const [behind, ahead] = git('rev-list', '--left-right', '--count', `${resolved}...${commit}`).trim().split(/\s+/u).map(Number)
        branch.ahead = ahead
        branch.behind = behind
      }
    }
    return branch
  })
  console.log(JSON.stringify({ base, baseCommit, currentBranch, workingTreeClean: !git('status', '--porcelain').trim(), branches }, null, 2))
}

try { main(process.argv.slice(2)) }
catch (error) {
  console.error(error instanceof Error ? error.message : 'Branch status could not be read.')
  process.exitCode = 1
}
