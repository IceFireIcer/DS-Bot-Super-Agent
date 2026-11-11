import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CoreError } from './model.js'
import type { GitHubEvent } from './channels.js'
import type { GitHubTransport } from './pollers.js'
import type { GitHubComment, GitHubReplyRequest, GitHubReplyTransport } from './github-delivery.js'

const execFileAsync = promisify(execFile)
const pageSize = 100
const maxPages = 10

export interface GitHubApiRequest { allowMissing?: boolean; method?: 'GET' | 'POST'; body?: { body: string }; host?: string; signal?: AbortSignal }
export type GitHubApiRunner = (path: string, request?: GitHubApiRequest) => Promise<unknown>

export interface GitHubCliTransportOptions {
  command?: string
  maxBuffer?: number
  /** Inject the API call for tests; the default runs the authenticated `gh api`. */
  runner?: GitHubApiRunner
}

/** Real GitHub transport over the authenticated `gh api` CLI; no token is stored or printed. */
export class GitHubCliTransport implements GitHubTransport {
  private readonly command: string
  private readonly maxBuffer: number
  private readonly runner: GitHubApiRunner | undefined
  constructor(options: GitHubCliTransportOptions = {}) {
    this.command = options.command ?? 'gh'
    this.maxBuffer = options.maxBuffer ?? 4 * 1024 * 1024
    this.runner = options.runner
  }

  async listEvents(request: { owner: string; repo: string; cursor?: string; signal: AbortSignal }) {
    request.signal.throwIfAborted()
    const run = this.runner ?? this.cliRunner(request.signal)
    const events = await this.mapEvents(run, request.owner, request.repo)
    return { events: request.cursor === undefined ? events : events.filter(event => event.cursor > request.cursor!) }
  }

  private cliRunner(signal: AbortSignal): GitHubApiRunner {
    return async (path, options = {}) => {
      try {
        const { stdout } = await execFileAsync(this.command, ['api', path], { maxBuffer: this.maxBuffer, signal })
        return JSON.parse(stdout)
      } catch (error) {
        if (signal.aborted) throw new CoreError('SOURCE_STOPPED', 'The GitHub API request was stopped.')
        const detail = error instanceof Error ? error.message : String(error)
        if (options.allowMissing && isMissingResource(detail)) return undefined
        throw new CoreError('SOURCE_FAILED', `GitHub API request failed for ${path}: ${detail}`)
      }
    }
  }

  async mapEvents(run: GitHubApiRunner, owner: string, repo: string): Promise<GitHubEvent[]> {
    const repository = `${owner}/${repo}`
    const base = `repos/${repository}`
    const issues = await listPages(run, `${base}/issues?state=all&sort=updated&direction=asc&per_page=${pageSize}`)
    const events: GitHubEvent[] = []
    for (const issue of issues) {
      if (!issue?.pull_request) { events.push(issueEvent(issue, repository)); continue }
      const pull = await run(`${base}/pulls/${issue.number}`, { allowMissing: true }) as Record<string, any> | undefined
      if (!pull) { events.push(deletedPullEvent(issue, repository)); continue }
      events.push(pullEvent(pull, repository))
      const reviews = await run(`${base}/pulls/${pull.number}/reviews`)
      if (Array.isArray(reviews)) for (const review of reviews) if (review?.submitted_at) events.push(reviewEvent(review, pull.number, repository))
      if (pull.head?.sha) {
        const checks = await run(`${base}/commits/${pull.head.sha}/check-runs?per_page=${pageSize}`, { allowMissing: true }) as Record<string, any> | undefined
        if (Array.isArray(checks?.check_runs)) for (const checkRun of checks.check_runs) if (checkRun?.id) events.push(checkRunEvent(checkRun, pull.number, repository, pull.updated_at))
      }
    }
    return events.sort((left, right) => left.cursor.localeCompare(right.cursor))
  }
}

/** `gh api` reports the status explicitly; a bare 404 in the resource path is not a missing resource. */
export function isMissingResource(detail: string) {
  return /\bHTTP 404\b/u.test(detail)
}

/** Exact-target lookup and comment POST over GitHub's documented REST API. The runner is a transport test seam. */
export class GitHubCliReplyTransport implements GitHubReplyTransport {
  constructor(private readonly options: GitHubCliTransportOptions = {}) {}

  async getActor(request: GitHubReplyRequest) {
    const user = await this.api('user', { host: request.host, signal: request.signal }) as Record<string, unknown>
    if (!user || typeof user.login !== 'string' || !user.login) throw new CoreError('GITHUB_TRANSPORT_UNKNOWN', 'The authenticated GitHub actor could not be verified.')
    return user.login
  }

  private async api(path: string, request: GitHubApiRequest & { signal: AbortSignal }) {
    request.signal.throwIfAborted()
    if (this.options.runner) return this.options.runner(path, request)
    const args = ['api', '--hostname', request.host ?? 'github.com', '--method', request.method ?? 'GET', path]
    if (request.body) args.push('--input', '-')
    return new Promise<unknown>((resolve, reject) => {
      const child = execFile(this.options.command ?? 'gh', args, { maxBuffer: this.options.maxBuffer ?? 4 * 1024 * 1024,
        signal: request.signal, timeout: 30000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          const status = stderr.match(/\bHTTP (\d{3})\b/u)?.[1]
          reject(new CoreError(status ? `GITHUB_HTTP_${status}` : 'GITHUB_TRANSPORT_UNKNOWN', 'The GitHub API did not return a confirmed response.'))
        } else {
          try { resolve(JSON.parse(stdout)) } catch { reject(new CoreError('GITHUB_TRANSPORT_UNKNOWN', 'The GitHub API returned an unreadable response.')) }
        }
      })
      child.stdin?.on('error', () => { /* The callback classifies an early CLI exit; never print request content. */ })
      child.stdin?.end(request.body ? JSON.stringify(request.body) : undefined)
    })
  }

  async getTarget(request: GitHubReplyRequest & { objectId: string }) {
    const match = /^(pr|issue):([1-9]\d*)(?::(comment|review):([1-9]\d*))?$/u.exec(request.objectId)
    if (!match) throw new CoreError('INVALID_INPUT', 'A GitHub reply needs an exact native issue, PR, comment or review reference.')
    const number = Number(match[2])
    if (!Number.isSafeInteger(number)) throw new CoreError('INVALID_INPUT', 'The GitHub discussion number is out of range.')
    const base = `repos/${request.owner}/${request.repo}`
    const path = match[3] === 'comment' ? `${base}/issues/comments/${match[4]}`
      : match[3] === 'review' ? `${base}/pulls/${number}/reviews/${match[4]}` : `${base}/${match[1] === 'pr' ? 'pulls' : 'issues'}/${number}`
    const value = await this.api(path, { host: request.host, signal: request.signal }) as Record<string, any>
    const url = new URL(String(value?.html_url))
    if (url.protocol !== 'https:' || url.hostname !== request.host
      || ![`/${request.owner}/${request.repo}/issues/${number}`, `/${request.owner}/${request.repo}/pull/${number}`].includes(url.pathname)
      || match[3] && String(value.id) !== match[4] || !match[3] && value.number !== number) {
      throw new CoreError('INVALID_INPUT', 'Native GitHub target evidence belongs to a different resource.')
    }
    if (match[3] === 'comment') {
      const issue = new URL(String(value.issue_url))
      const apiHost = request.host === 'github.com' ? 'api.github.com' : request.host
      if (issue.protocol !== 'https:' || issue.hostname !== apiHost || !issue.pathname.endsWith(`/${base}/issues/${number}`)) {
        throw new CoreError('INVALID_INPUT', 'The GitHub comment does not belong to the requested discussion.')
      }
    }
    return { number, url: value.html_url as string }
  }

  async listComments(request: GitHubReplyRequest & { number: number; page: number }) {
    const value = await this.api(`repos/${request.owner}/${request.repo}/issues/${request.number}/comments?per_page=100&page=${request.page}`,
      { host: request.host, signal: request.signal })
    if (!Array.isArray(value) || value.length > 100) throw new CoreError('GITHUB_TRANSPORT_UNKNOWN', 'GitHub returned an invalid comment page.')
    return { items: value.map(comment => this.comment(comment)), hasMore: value.length === 100 }
  }

  async createComment(request: GitHubReplyRequest & { number: number; body: string }) {
    return this.comment(await this.api(`repos/${request.owner}/${request.repo}/issues/${request.number}/comments`,
      { host: request.host, signal: request.signal, method: 'POST', body: { body: request.body } }))
  }

  private comment(value: any): GitHubComment {
    if (!value || !Number.isSafeInteger(value.id) || value.id <= 0 || typeof value.html_url !== 'string'
      || typeof value.body !== 'string' || typeof value.user?.login !== 'string') throw new CoreError('GITHUB_TRANSPORT_UNKNOWN', 'GitHub did not return a complete native comment receipt.')
    return { id: String(value.id), url: value.html_url, body: value.body, authorId: value.user.login }
  }
}

async function listPages(run: GitHubApiRunner, path: string): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = []
  for (let page = 1; page <= maxPages; page++) {
    const batch = await run(`${path}&page=${page}`)
    if (!Array.isArray(batch)) throw new CoreError('SOURCE_FAILED', 'GitHub returned an invalid issue list.')
    items.push(...batch)
    if (batch.length < pageSize) return items
  }
  throw new CoreError('SOURCE_BUDGET', `GitHub issue pagination exceeded ${maxPages} pages.`)
}

function cursorFor(updatedAt: string, kind: string, id: unknown) {
  return `${updatedAt}#${kind}#${String(id).padStart(12, '0')}`
}

function issueEvent(issue: Record<string, any>, repository: string): GitHubEvent {
  const edited = typeof issue.created_at === 'string' && String(issue.updated_at) > issue.created_at
  const action = issue.state === 'closed' ? 'closed' : issue.state_reason === 'reopened' ? 'reopened' : edited ? 'edited' : 'created'
  return { deliveryId: `issue-${issue.id}-${issue.updated_at}`, cursor: cursorFor(issue.updated_at, 'issue', issue.number), repo: repository,
    kind: 'issue', action, number: issue.number, id: String(issue.id), authorId: issue.user?.login ?? 'github', authorKind: 'human',
    title: issue.title, body: issue.body ?? '', updatedAt: issue.updated_at, state: issue.state }
}

function pullEvent(pull: Record<string, any>, repository: string): GitHubEvent {
  const state = pull.merged_at ? 'merged' : pull.state === 'closed' ? 'closed' : 'open'
  return { deliveryId: `pr-${pull.id}-${pull.updated_at}`, cursor: cursorFor(pull.updated_at, 'pr', pull.number), repo: repository,
    kind: 'pull_request', action: pull.state === 'closed' ? 'closed' : 'created', number: pull.number, id: String(pull.id),
    authorId: pull.user?.login ?? 'github', title: pull.title, body: pull.body ?? '', updatedAt: pull.updated_at,
    draft: Boolean(pull.draft), state }
}

function reviewEvent(review: Record<string, any>, number: number, repository: string): GitHubEvent {
  return { deliveryId: `review-${review.id}-${review.submitted_at}`, cursor: cursorFor(review.submitted_at, 'review', review.id),
    repo: repository, kind: 'review', action: 'reviewed', number, id: String(review.id), authorId: review.user?.login ?? 'github',
    body: review.body ?? `Review state ${review.state}`, updatedAt: review.submitted_at }
}

function checkRunEvent(checkRun: Record<string, any>, number: number, repository: string, fallback: string): GitHubEvent {
  const updatedAt = checkRun.completed_at ?? checkRun.started_at ?? fallback
  return { deliveryId: `ci-${checkRun.id}-${updatedAt}`, cursor: cursorFor(updatedAt, 'ci', checkRun.id), repo: repository, kind: 'ci',
    action: checkRun.status === 'completed' ? 'completed' : 'created', number, id: String(checkRun.id),
    authorId: checkRun.app?.slug ?? 'github-actions', authorKind: 'ci',
    body: `Check run ${checkRun.name ?? 'unnamed'} ${checkRun.conclusion ?? checkRun.status}.${checkRun.details_url ? `\n\n${checkRun.details_url}` : ''}`,
    updatedAt }
}

function deletedPullEvent(issue: Record<string, any>, repository: string): GitHubEvent {
  return { deliveryId: `pr-deleted-${issue.id}-${issue.updated_at}`, cursor: cursorFor(issue.updated_at, 'deleted', issue.number),
    repo: repository, kind: 'pull_request', action: 'deleted', number: issue.number, id: String(issue.id),
    authorId: issue.user?.login ?? 'github', title: issue.title, updatedAt: issue.updated_at,
    deletionEvidence: `GitHub returned 404 for pull request #${issue.number} while the repository listing still contained it.` }
}
