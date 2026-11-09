import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as core from '../dist/index.js'

const issuesPath = 'repos/acme/repo/issues?state=all&sort=updated&direction=asc&per_page=100&page=1'

test('the GitHub CLI transport maps a real issues/PR/review/CI snapshot into ordered events', async () => {
  const transport = new core.GitHubCliTransport()
  const responses = new Map([
    [issuesPath, [
      { id: 11, number: 1, state: 'open', title: 'Issue one', body: 'Issue detail', updated_at: '2026-01-01T00:00:00Z', user: { login: 'alice' } },
      { id: 12, number: 2, state: 'closed', title: 'PR two', body: 'PR detail', updated_at: '2026-01-02T00:00:00Z', user: { login: 'alice' },
        pull_request: { url: 'https://api.github.com/repos/acme/repo/pulls/2' } },
    ]],
    ['repos/acme/repo/pulls/2', { id: 12, number: 2, state: 'closed', merged_at: '2026-01-03T00:00:00Z', title: 'PR two', body: 'PR detail',
      updated_at: '2026-01-03T00:00:00Z', draft: false, user: { login: 'alice' }, head: { sha: 'sha-2' } }],
    ['repos/acme/repo/pulls/2/reviews', [{ id: 21, state: 'COMMENTED', body: 'Looks good', submitted_at: '2026-01-02T12:00:00Z', user: { login: 'bob' } }]],
    ['repos/acme/repo/commits/sha-2/check-runs?per_page=100', { check_runs: [{ id: 31, name: 'test', status: 'completed', conclusion: 'success',
      started_at: '2026-01-03T00:05:00Z', completed_at: '2026-01-03T00:10:00Z', app: { slug: 'github-actions' } }] }],
  ])
  const events = await transport.mapEvents(async path => responses.get(path), 'acme', 'repo')
  assert.deepEqual(events.map(event => event.kind), ['issue', 'review', 'pull_request', 'ci'])
  assert.deepEqual(events.map(event => event.action), ['created', 'reviewed', 'closed', 'completed'])
  assert.equal(events[2].state, 'merged')
  assert.equal(events[2].number, 2)
  assert.equal(events[1].authorId, 'bob')
  assert.equal(events[3].authorKind, 'ci')
  assert.match(events[3].body, /Check run test success\./u)
  assert.deepEqual(events, [...events].sort((left, right) => left.cursor.localeCompare(right.cursor)))
  assert.equal(new Set(events.map(event => event.deliveryId)).size, events.length)
})

test('the GitHub CLI transport pages through the issue list and refuses to overrun its budget', async () => {
  const transport = new core.GitHubCliTransport()
  const pages = []
  const runner = async path => {
    pages.push(path)
    const page = Number(path.match(/&page=(\d+)$/u)?.[1])
    return page < 2 ? Array.from({ length: 100 }, (_, index) => ({ id: page * 1000 + index, number: page * 1000 + index, state: 'open',
      title: `Issue ${page}`, body: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', user: { login: 'alice' } })) : []
  }
  const events = await transport.mapEvents(runner, 'acme', 'repo')
  assert.equal(events.length, 100)
  assert.deepEqual(pages.map(path => path.split('&page=')[1]), ['1', '2'])
  const filler = async () => Array.from({ length: 100 }, (_, index) => ({ id: index, number: index + 1,
    state: 'open', title: 'Filler', body: '', updated_at: '2026-01-01T00:00:00Z', user: { login: 'alice' } }))
  await assert.rejects(transport.mapEvents(filler, 'acme', 'repo'), { code: 'SOURCE_BUDGET' })
})

test('a missing pull request becomes deletion evidence instead of a source failure', async () => {
  const transport = new core.GitHubCliTransport()
  const runner = async (path, request) => {
    if (path === issuesPath) return [{ id: 12, number: 2, state: 'open', title: 'PR two', updated_at: '2026-01-02T00:00:00Z', user: { login: 'alice' },
      pull_request: { url: 'https://api.github.com/repos/acme/repo/pulls/2' } }]
    if (path === 'repos/acme/repo/pulls/2') {
      assert.deepEqual(request, { allowMissing: true })
      return undefined
    }
    throw new Error(`Unexpected GitHub API path ${path}`)
  }
  const events = await transport.mapEvents(runner, 'acme', 'repo')
  assert.equal(events.length, 1)
  assert.equal(events[0].action, 'deleted')
  assert.equal(events[0].kind, 'pull_request')
  assert.match(events[0].deletionEvidence, /404/u)
})

test('an API failure that is not a missing resource stays a source failure', async () => {
  const transport = new core.GitHubCliTransport()
  const runner = async path => {
    if (path === issuesPath) {
      return [{ id: 13, number: 3, state: 'open', title: 'PR three', updated_at: '2026-01-02T00:00:00Z', user: { login: 'alice' },
        pull_request: { url: 'https://api.github.com/repos/acme/repo/pulls/3' } }]
    }
    throw new core.CoreError('SOURCE_FAILED', 'GitHub API request failed for repos/acme/repo/pulls/3: gh: Server Error (HTTP 500)')
  }
  await assert.rejects(transport.mapEvents(runner, 'acme', 'repo'), { code: 'SOURCE_FAILED' })
})

test('only the documented HTTP status counts as a missing resource', () => {
  assert.equal(core.isMissingResource('gh: Not Found (HTTP 404)'), true)
  assert.equal(core.isMissingResource('GitHub API request failed for repos/acme/repo/pulls/404: gh: Server Error (HTTP 500)'), false)
})

test('the CLI transport filters by the durable cursor and refuses an aborted request', async () => {
  const transport = new core.GitHubCliTransport({ runner: async () => [
    { id: 1, number: 1, state: 'open', title: 'Old', body: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', user: { login: 'alice' } },
    { id: 2, number: 2, state: 'open', title: 'New', body: '', created_at: '2026-02-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z', user: { login: 'alice' } },
  ] })
  const result = await transport.listEvents({ owner: 'acme', repo: 'repo', cursor: '2026-01-15T00:00:00Z#issue#000000000001',
    signal: new AbortController().signal })
  assert.deepEqual(result.events.map(event => event.number), [2])
  await assert.rejects(transport.listEvents({ owner: 'acme', repo: 'repo', signal: AbortSignal.abort() }), { name: 'AbortError' })
})
