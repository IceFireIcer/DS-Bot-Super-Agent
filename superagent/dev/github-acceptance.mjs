import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from '../dev/native-mock.mjs'

const exec = promisify(execFile)
const repoPath = process.env.SUPERAGENT_TEST_REPO ?? 'E:/FolderForVibeCoding/Multi-Agent-DevelopProj/SuperAgentTest'
const repo = 'IceFireIcer/SuperAgentTest'
const ownerName = 'IceFireIcer'
const repoName = 'SuperAgentTest'
const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
const branch = `acceptance/t26-${stamp}`
const run = async (command, args, cwd = repoPath) => {
  const { stdout } = await exec(command, args, { cwd, maxBuffer: 4 * 1024 * 1024 })
  return stdout.trim()
}
const gh = (...args) => run('gh', args)
let branchCreated = false
let native, sessions, storage, desktop, github, poller, directory
const existingIssue = process.env.SUPERAGENT_EXISTING_ISSUE
const existingPr = process.env.SUPERAGENT_EXISTING_PR
const existingBranch = process.env.SUPERAGENT_EXISTING_BRANCH

try {
  await run('git', ['checkout', 'main'])
  await run('git', ['pull', '--ff-only'])
  const remote = await run('git', ['remote', 'get-url', 'origin'])
  if (!/SuperAgentTest/iu.test(remote)) throw new Error(`SUPERAGENT_TEST_REPO must be an isolated SuperAgentTest checkout; origin is ${remote}.`)
  const issueUrl = existingIssue ? undefined : await gh('issue', 'create', '--repo', repo, '--title', `Super-agent acceptance issue ${stamp}`,
    '--body', 'This isolated issue exercises real GitHub source reception for the Super-agent acceptance run.')
  const issueNumber = existingIssue ? Number(existingIssue) : Number(issueUrl.match(/\/issues\/(\d+)$/u)?.[1])
  if (!issueNumber) throw new Error('The created issue number could not be parsed.')

  if (!existingPr) {
    await run('git', ['checkout', '-b', branch, 'main'])
    branchCreated = true
    await writeFile(join(repoPath, 'src/acceptance.js'), `export const acceptanceStamp = '${stamp}'\n`)
    await writeFile(join(repoPath, 'test/acceptance.test.mjs'), "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\nimport { acceptanceStamp } from '../src/acceptance.js'\n\ntest('records the acceptance stamp', () => {\n  assert.match(acceptanceStamp, /^\\d{4}-\\d{2}-\\d{2}T/u)\n})\n")
    await run('git', ['add', 'src/acceptance.js', 'test/acceptance.test.mjs'])
    await run('git', ['commit', '-m', 'Record a dated acceptance change'])
    await run('git', ['push', '-u', 'origin', branch])
  }
  const prUrl = existingPr ? undefined : await gh('pr', 'create', '--repo', repo, '--base', 'main', '--head', branch,
    '--title', `Super-agent acceptance pull request ${stamp}`, '--body', `Fixes #${issueNumber}\n\nThis PR is created only for the isolated Super-agent acceptance run.`)
  const prNumber = existingPr ? Number(existingPr) : Number(prUrl.match(/\/pull\/(\d+)$/u)?.[1])
  if (!prNumber) throw new Error('The created pull request number could not be parsed.')
  if (!existingPr) await gh('api', `repos/${repo}/pulls/${prNumber}/reviews`, '-f', 'event=COMMENT',
    '-f', 'body=Acceptance review: the isolated change is ready for the merge path.')
  const reviewList = JSON.parse(await gh('api', `repos/${repo}/pulls/${prNumber}/reviews`))
  const review = Array.isArray(reviewList) ? reviewList.at(-1) : reviewList
  if (!review?.id) throw new Error('The real pull-request review was not created.')

  const { headRefOid } = JSON.parse(await gh('pr', 'view', String(prNumber), '--repo', repo, '--json', 'headRefOid'))
  const waitForChecks = async () => {
    for (let index = 0; index < 60; index++) {
      const list = JSON.parse(await gh('api', `repos/${repo}/commits/${headRefOid}/check-runs`))
      const runs = Array.isArray(list.check_runs) ? list.check_runs : []
      if (runs.length && runs.every(item => item.status === 'completed')) return runs
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    throw new Error('The real check run did not complete within the acceptance deadline.')
  }
  const checks = await waitForChecks()

  directory = await mkdtemp(join(tmpdir(), 'ds-bot-github-acceptance-'))
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  native = await nativeContext(join(directory, 'sessions'), async function* (options) {
    const user = options.messages.filter(message => message.role === 'user').at(-1)
    const text = user.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const completed = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
    if (options.model === 'worker') {
      if (!completed) yield* toolResponse('report_ready', { result: `Prepared: ${text}`, evidence: 'Used the isolated acceptance request.' })
      else yield* textResponse('Recorded.')
      return
    }
    yield* routerResponse(options)
  })
  sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const hostOptions = { hostId: 'acceptance-host', leaseMs: 60000 }
  desktop = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    {}, sessions, [], {}, {}, {}, {}, hostOptions)
  github = new core.Engine(storage, 'private', { kind: 'github', sourceInstanceId: `github:${repo}`, actorId: 'acceptance',
    allowedActorIds: ['acceptance'], allowedThreadPrefixes: [`github:${repo}#`], versionOrder: 'sequence' }, {}, undefined, [], {}, {}, {}, {}, hostOptions)
  const source = new core.GitHubSource(storage, 'private', github, { owner: ownerName, repo: repoName })
  poller = new core.GitHubPoller(source, new core.GitHubCliTransport(), ownerName, repoName, { intervalMs: 1000, setup: async () => { await gh('api', `repos/${repo}`) } })
  const untilReady = async ticketId => {
    for (let index = 0; index < 30; index++) {
      await desktop.effects.drain()
      const conversation = await desktop.conversation(ticketId)
      if (conversation.status === 'ready' || conversation.status === 'waiting-human') return conversation
    }
    return desktop.conversation(ticketId)
  }
  const untilResult = async ticketId => {
    for (let index = 0; index < 30; index++) {
      await desktop.effects.drain()
      const conversation = await desktop.conversation(ticketId)
      if (conversation.messages.some(message => message.purpose === 'result')) return conversation
    }
    return desktop.conversation(ticketId)
  }
  const firstPoll = await poller.pollOnce()
  const issue = await github.getSourceObject({ threadId: `github:${repo}#${issueNumber}`, objectId: `issue:${issueNumber}` })
  const pull = await github.getSourceObject({ threadId: `github:${repo}#${prNumber}`, objectId: `pr:${prNumber}` })
  const reviewObject = await github.getSourceObject({ threadId: `github:${repo}#${prNumber}`, objectId: `pr:${prNumber}:review:${review.id}` })
  if (!issue || !pull || !reviewObject) throw new Error('Real GitHub issue, PR or review event was not recorded.')
  const checkObject = await github.getSourceObject({ threadId: `github:${repo}#${prNumber}`, objectId: `pr:${prNumber}:ci:${checks[0].id}` })
  if (!checkObject) throw new Error('The real GitHub check-run event was not recorded.')

  const t26 = await desktop.submit({ commandId: `t26-request-${stamp}`, eventId: `t26-message-${stamp}`, text: 'Prepare the greeting change.' })
  await desktop.bindDeliveryCondition({ commandId: `t26-bind-${stamp}`, ticketId: t26.ticketId, kind: 'pr', sourceInstanceId: `github:${repo}`,
    repo, number: prNumber, basis: `Real pull request #${prNumber} created by the isolated acceptance worker.` })
  const beforeMerge = await untilReady(t26.ticketId)
  if (beforeMerge.lifecycle !== 'open' || beforeMerge.deliveryPending !== true) throw new Error('The ready result did not wait for the real PR delivery condition.')

  const prState = JSON.parse(await gh('pr', 'view', String(prNumber), '--repo', repo, '--json', 'state,mergedAt'))
  if (prState.state !== 'MERGED') await gh('pr', 'merge', String(prNumber), '--repo', repo, '--squash', '--delete-branch', '--admin')
  const secondPoll = await poller.pollOnce()
  const mergedPull = await github.getSourceObject({ threadId: `github:${repo}#${prNumber}`, objectId: `pr:${prNumber}` })
  if (!mergedPull || !/merged/iu.test(mergedPull.text ?? '')) throw new Error('The real merged PR event was not observed.')
  await desktop.effects.drain()
  await desktop.reconcileDeliveryCondition({ commandId: `t26-merge-${stamp}`, ticketId: t26.ticketId,
    sourceInstanceId: `github:${repo}`, text: mergedPull.text })
  await untilResult(t26.ticketId)
  const afterMerge = await desktop.conversation(t26.ticketId)
  if (afterMerge.lifecycle !== 'ended' || afterMerge.deliveryConditions[0]?.result !== 'merged') {
    const direction = await desktop.getTicketDirection(t26.ticketId)
    throw new Error(`The Ticket did not close on the real merged PR condition: ${JSON.stringify({ mergedText: mergedPull.text,
      status: afterMerge.status, reason: afterMerge.reason, reports: afterMerge.reports.length, lifecycle: afterMerge.lifecycle,
      conditions: afterMerge.deliveryConditions, pending: afterMerge.deliveryPending,
      pendingInputs: direction?.inputs.filter(input => input.state === 'pending' && !input.delivery?.completedAt).length,
      effects: (await desktop.effects.list()).items.map(effect => ({ key: effect.key, stream: effect.stream, scope: effect.scope, state: effect.state, reason: effect.reason, attempts: effect.attempts })) })}`)
  }

  const t27 = await desktop.submit({ commandId: `t27-request-${stamp}`, eventId: `t27-message-${stamp}`, text: 'Deliver the result to the linked pull request.' })
  const target = await desktop.setDeliveryTarget({ commandId: `t27-target-${stamp}`, ticketId: t27.ticketId, purpose: 'result',
    sourceInstanceId: `github:${repo}`, threadId: `github:${repo}#${prNumber}`, objectId: `pr:${prNumber}`,
    evidence: 'The real merged pull request is the authorized follow-up destination.', evidenceEventId: mergedPull.eventId })
  const t27Conversation = await untilResult(t27.ticketId)
  const result = t27Conversation.messages.find(message => message.purpose === 'result')
  if (!result || result.destination.sourceInstanceId !== `github:${repo}` || result.destination.eventId !== `pr:${prNumber}`) {
    throw new Error(`The real GitHub delivery target did not redirect the result: ${JSON.stringify({ target,
      status: t27Conversation.status, messages: t27Conversation.messages,
      storedTarget: await desktop.getDeliveryTarget(t27.ticketId, 'result'),
      effects: (await desktop.effects.list()).items.map(effect => ({ key: effect.key, stream: effect.stream, scope: effect.scope, state: effect.state, reason: effect.reason })) })}`)
  }

  await poller.start()
  const loopStart = Date.now()
  while (poller.health().passes < 1 && Date.now() - loopStart < 30000) await new Promise(resolve => setTimeout(resolve, 200))
  await poller.stop()
  const loopHealth = poller.health()
  if (loopHealth.passes < 1 || loopHealth.state !== 'stopped') throw new Error(`The real polling loop did not complete a pass and stop: ${JSON.stringify(loopHealth)}`)

  console.log(JSON.stringify({ repo, issueNumber, prNumber, reviewId: review.id, branch: existingBranch ?? branch,
    firstPoll, secondPoll, ci: { id: checks[0].id, name: checks[0].name, conclusion: checks[0].conclusion }, pollingLoop: loopHealth,
    beforeMerge: { lifecycle: beforeMerge.lifecycle, deliveryPending: beforeMerge.deliveryPending },
    afterMerge: { lifecycle: afterMerge.lifecycle, condition: afterMerge.deliveryConditions[0] },
    deliveryTarget: target, resultDestination: result.destination }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), issue: undefined }))
  process.exitCode = 1
} finally {
  await desktop?.effects.stop().catch(() => {})
  await github?.effects.stop().catch(() => {})
  await sessions?.close().catch(() => {})
  await native?.fiber.dispose().catch(() => {})
  await storage?.close().catch(() => {})
  if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {})
  if (branchCreated) {
    await gh('api', '-X', 'DELETE', `repos/${repo}/git/refs/heads/${branch}`).catch(() => {})
    await run('git', ['checkout', 'main']).catch(() => {})
    await run('git', ['branch', '-D', branch]).catch(() => {})
  }
}
