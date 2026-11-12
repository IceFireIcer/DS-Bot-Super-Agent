import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, routerResponse, textResponse, toolResponse } from '../dev/native-mock.mjs'
import { createModelBudget, createRealModelRuntime } from './real-model-adapter.mjs'
import { readEnvironment } from './t57-env-check.mjs'

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
const realModel = process.env.SUPERAGENT_ACCEPTANCE_MODEL === 'real'
const modelConfig = readEnvironment().model
const modelEndpoint = modelConfig.url
const modelId = modelConfig.id
const modelProvider = modelConfig.provider
const modelKey = modelConfig.key
let modelBudget, modelRegistration

if (process.argv.includes('--t27')) await t27Scenario()
else {
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
  if (realModel) {
    if (!modelKey) throw new Error('Set SUPERAGENT_MODEL_KEY or POKEXIAO_API_KEY for a real-model acceptance run.')
    modelBudget = createModelBudget({ maxRequests: Number(process.env.SUPERAGENT_MODEL_MAX_REQUESTS ?? 16),
      maxTokens: Number(process.env.SUPERAGENT_MODEL_MAX_TOKENS ?? 40_000) })
    const runtime = createRealModelRuntime({ provider: modelProvider, endpoint: modelEndpoint, apiKey: modelKey, model: modelId, budget: modelBudget })
    native = await nativeContext(join(directory, 'sessions'), () => { throw new Error('The real-model acceptance must not call the mock responder.') })
    modelRegistration = native.llm.registerAdapter([runtime.provider], runtime.adapter)
    sessions = new core.NativeSessions(native, { router: { provider: runtime.provider, model: runtime.model },
      worker: { provider: runtime.provider, model: runtime.model }, timeoutMs: 55_000 })
  } else native = await nativeContext(join(directory, 'sessions'), async function* (options) {
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
  if (!realModel) sessions = new core.NativeSessions(native, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  const hostOptions = { hostId: 'acceptance-host', leaseMs: 60000 }
  const effectsOptions = realModel ? { operationTimeoutMs: 60_000 } : {}
  desktop = new core.Engine(storage, 'private', { sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'] },
    effectsOptions, sessions, [], {}, {}, {}, {}, hostOptions)
  github = new core.Engine(storage, 'private', { kind: 'github', sourceInstanceId: `github:${repo}`, actorId: 'acceptance',
    allowedActorIds: ['acceptance'], allowedThreadPrefixes: [`github:${repo}#`], versionOrder: 'sequence' }, effectsOptions, undefined, [], {}, {}, {}, {}, hostOptions)
  const source = new core.GitHubSource(storage, 'private', github, { owner: ownerName, repo: repoName })
  poller = new core.GitHubPoller(source, new core.GitHubCliTransport(), ownerName, repoName, {
    intervalMs: 1000, pollTimeoutMs: Number(process.env.SUPERAGENT_GITHUB_POLL_TIMEOUT_MS ?? 60_000),
    setup: async () => { await gh('api', `repos/${repo}`) },
  })
  const waitForConversation = async (ticketId, predicate) => {
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      await desktop.effects.drain()
      const conversation = await desktop.conversation(ticketId)
      if (predicate(conversation)) return conversation
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return desktop.conversation(ticketId)
  }
  const untilReady = ticketId => waitForConversation(ticketId, conversation => conversation.status === 'ready')
  const untilResult = ticketId => waitForConversation(ticketId,
    conversation => conversation.messages.some(message => message.purpose === 'result' && message.state === 'sent'))
  const firstPoll = await poller.pollOnce()
  const issue = await github.getSourceObject({ threadId: `github:${repo}#${issueNumber}`, objectId: `issue:${issueNumber}` })
  const pull = await github.getSourceObject({ threadId: `github:${repo}#${prNumber}`, objectId: `pr:${prNumber}` })
  const reviewObject = await github.getSourceObject({ threadId: `github:${repo}#${prNumber}`, objectId: `pr:${prNumber}:review:${review.id}` })
  if (!issue || !pull || !reviewObject) throw new Error('Real GitHub issue, PR or review event was not recorded.')
  const checkObject = await github.getSourceObject({ threadId: `github:${repo}#${prNumber}`, objectId: `pr:${prNumber}:ci:${checks[0].id}` })
  if (!checkObject) throw new Error('The real GitHub check-run event was not recorded.')

  const t26 = await desktop.submit({ commandId: `t26-request-${stamp}`, eventId: `t26-message-${stamp}`,
    text: 'Prepare a greeting change in the isolated acceptance project. Report a short confirmation and cite the isolated acceptance request as evidence. Do not ask for clarification and do not change files.' })
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

  await t27Scenario(prNumber)

  await poller.start()
  const loopStart = Date.now()
  while (poller.health().passes < 1 && Date.now() - loopStart < 150_000) await new Promise(resolve => setTimeout(resolve, 200))
  await poller.stop()
  const loopHealth = poller.health()
  if (loopHealth.passes < 1 || loopHealth.state !== 'stopped') throw new Error(`The real polling loop did not complete a pass and stop: ${JSON.stringify(loopHealth)}`)

  if (realModel && modelBudget.exceeded) throw new Error('The real-model GitHub acceptance exceeded its declared budget.')
  console.log(JSON.stringify({ repo, issueNumber, prNumber, reviewId: review.id, branch: existingBranch ?? (existingPr ? undefined : branch),
    model: realModel ? { provider: modelProvider, id: modelId, endpoint: new URL(modelEndpoint).host, budget: modelBudget } : 'mock',
    firstPoll, secondPoll, ci: { id: checks[0].id, name: checks[0].name, conclusion: checks[0].conclusion }, pollingLoop: loopHealth,
    beforeMerge: { lifecycle: beforeMerge.lifecycle, deliveryPending: beforeMerge.deliveryPending },
    afterMerge: { lifecycle: afterMerge.lifecycle, condition: afterMerge.deliveryConditions[0] },
    t27: 'The dedicated T27 scenario above records the real association, negative references and native outbound receipt.' }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), issue: undefined }))
  process.exitCode = 1
} finally {
  const failures = []
  for (const dispose of [
    () => poller?.stop(),
    () => desktop?.effects.stop(),
    () => github?.effects.stop(),
    () => desktop?.shutdown(),
    () => github?.shutdown(),
    () => sessions?.close(),
    () => modelRegistration?.(),
    () => native?.fiber.dispose(),
    () => storage?.close(),
    async () => {
      if (!directory) return
      if (!directory.startsWith(join(tmpdir(), 'ds-bot-github-acceptance-'))) throw new Error('Unexpected GitHub acceptance cleanup directory.')
      await rm(directory, { recursive: true, force: true })
    },
  ]) {
    try { await dispose() } catch (error) { failures.push(error) }
  }
  if (branchCreated) {
    for (const dispose of [
      async () => {
        try { await gh('api', '-X', 'DELETE', `repos/${repo}/git/refs/heads/${branch}`) }
        catch (error) { if (!/Reference does not exist|HTTP 422/u.test(error instanceof Error ? error.message : String(error))) throw error }
      },
      () => run('git', ['checkout', 'main']),
      () => run('git', ['branch', '-D', branch]),
    ]) {
      try { await dispose() } catch (error) { failures.push(error) }
    }
  }
  if (failures.length) {
    console.error(JSON.stringify({ cleanupErrors: failures.map(error => error instanceof Error ? error.message : String(error)) }))
    process.exitCode = 1
  }
}
}

/** Explicit live-write mode: three synthetic corrections and one result comment in an existing isolated PR discussion, including closed PRs. */
async function t27Scenario(pr = Number(existingPr)) {
  if (!Number.isSafeInteger(pr) || pr < 1) throw new Error('--t27 requires SUPERAGENT_EXISTING_PR in IceFireIcer/SuperAgentTest.')
  const work = await mkdtemp(join(tmpdir(), 'ds-superagent-t27-live-'))
  let db, context, runtime, owner, receiver, denied
  const failures = []
  const http = async (path, body) => {
    const args = ['api', path]
    if (body) {
      const input = join(work, 'request.json')
      await writeFile(input, JSON.stringify(body))
      args.push('--method', 'POST', '--input', input)
    }
    const { stdout } = await exec('gh', args, { cwd: work, maxBuffer: 4 * 1024 * 1024, timeout: 30000, windowsHide: true })
    return JSON.parse(stdout)
  }
  try {
    const user = await http('user')
    const pull = await http(`repos/${repo}/pulls/${pr}`)
    if (typeof user.login !== 'string' || pull.base?.repo?.full_name !== repo) throw new Error('The configured PR or authenticated GitHub actor could not be verified.')
    db = await SqliteStorage.open(join(work, 'state.sqlite'))
    context = await nativeContext(join(work, 'sessions'), function* (options) {
      if (options.model === 'router') { yield* routerResponse(options); return }
      const message = options.messages.filter(item => item.role === 'user').at(-1)
      const text = message.content.filter(item => item.type === 'text').map(item => item.text).join('')
      const done = options.messages.slice(options.messages.lastIndexOf(message) + 1).some(item => item.role === 'tool')
      if (text.includes('Use revision B.') && !done) yield* toolResponse('report_ready', {
        result: `T27 ${stamp}: revision B prepared.`, evidence: 'The retained native DSH Session processed the owner-authorized real PR correction.',
      })
      else yield* textResponse('Revision A remains a draft until a verified correction arrives.')
    })
    runtime = new core.NativeSessions(context, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
    const channel = new core.GitHubDeliveryChannel(new core.GitHubCliReplyTransport(), { storage: db, instanceId: 't27-live', sources: [
      { sourceInstanceId: `github:${repo}`, host: 'github.com', owner: ownerName, repo: repoName, actorId: user.login },
    ] })
    const delivery = {
      deliver: (item, receipt) => item.destination.sourceInstanceId === 'desktop' ? core.localDeliveryChannel.deliver(item, receipt) : channel.deliver(item, receipt),
      reconcile: (item, receipt) => item.destination.sourceInstanceId === 'desktop' ? core.localDeliveryChannel.deliver(item, receipt) : channel.reconcile(item, receipt),
    }
    owner = new core.Engine(db, 't27-live', { sourceInstanceId: 'desktop', actorId: 'owner', allowedActorIds: ['owner'] }, {}, runtime, [], {}, {}, {}, { channel: delivery })
    const binding = { kind: 'github', sourceInstanceId: `github:${repo}`, actorId: 'github-receiver', allowedActorIds: ['github-receiver'],
      allowedThreadIds: [`github:${repo}#${pr}`], versionOrder: 'sequence',
      intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: [user.login], allowedBotActorIds: [], rules: [] } }
    receiver = new core.Engine(db, 't27-live', binding)
    denied = new core.Engine(db, 't27-live', { ...binding, intake: { ...binding.intake, allowedRequesterIds: [] } })
    const source = new core.GitHubSource(db, 't27-live', receiver, { owner: ownerName, repo: repoName })
    const first = await owner.submit({ commandId: 'start-A', eventId: `start-${stamp}`, text: 'Prepare revision A within the isolated acceptance task.' })
    const unrelated = await owner.submit({ commandId: 'unrelated', eventId: `unrelated-${stamp}`, text: 'An unrelated private acceptance task.' })
    for (let index = 0; index < 8; index++) await owner.effects.drain()
    const before = await owner.conversation(first.ticketId)
    const original = await owner.getTicket(first.ticketId)
    const reference = await owner.getTicketReference(first.ticketId)
    const other = await owner.getTicketReference(unrelated.ticketId)
    const negative = []
    let selected
    for (const [name, body] of [['wrong', `${other}\nT27 ${stamp}: Use revision B.`], ['ambiguous', `${reference}\n${other}\nT27 ${stamp}: Use revision B.`],
      ['correct', `${reference}\nT27 ${stamp}: Use revision B.`]]) {
      const comment = await http(`repos/${repo}/issues/${pr}/comments`, { body })
      const verified = await http(`repos/${repo}/issues/comments/${comment.id}`)
      if (verified.body !== body || verified.user?.login !== user.login || verified.id !== comment.id) throw new Error('The native comment identity, author or content did not match the request.')
      const received = await source.receive({ repo, number: pr, kind: 'comment', action: 'created', deliveryId: `t27-${comment.id}`, cursor: String(comment.id),
        id: String(comment.id), authorId: verified.user.login, authorKind: 'human', body: verified.body, updatedAt: verified.updated_at })
      const command = { commandId: `link-${name}`, ticketId: first.ticketId, eventId: received.eventId, reference, reason: 'The desktop owner authorized the exact native PR discussion comment.', retargetResult: true }
      if (name !== 'correct') {
        try { await owner.associateSourceEvent(command, receiver); throw new Error(`The ${name} reference was unexpectedly accepted.`) }
        catch (error) { if (error.code !== 'ASSOCIATION_REFERENCE_INVALID') throw error; negative.push({ commentId: comment.id, kind: name, code: error.code }) }
      } else {
        try { await owner.associateSourceEvent({ ...command, commandId: 'denied-actor' }, denied); throw new Error('An unlisted native human was unexpectedly accepted.') }
        catch (error) { if (error.code !== 'ACTOR_NOT_ALLOWED') throw error; negative.push({ commentId: comment.id, kind: 'unauthorized', code: error.code }) }
        const revoked = await receiver.getIntakePolicy()
        await receiver.updateIntakePolicy({ commandId: 'restore-native-actor', expectedRevision: revoked.revision, policy: binding.intake })
        selected = { commentId: comment.id, url: verified.html_url, association: await owner.associateSourceEvent(command, receiver) }
      }
    }
    for (let index = 0; index < 16; index++) await owner.effects.drain()
    const after = await owner.conversation(first.ticketId)
    const result = after.messages.find(item => item.purpose === 'result')
    if (after.status !== 'ready' || !result || result.state !== 'sent' || after.assignments[0].id !== before.assignments[0].id
      || after.assignments[0].sessionId !== before.assignments[0].sessionId || JSON.stringify((await owner.getTicket(first.ticketId)).mandate) !== JSON.stringify(original.mandate)
      || (await owner.getTicketDirection(first.ticketId)).directionVersion !== 2) throw new Error('The real A-to-B association did not retain Ticket, Assignment, Session and Mandate with one direction increment.')
    const idempotencyKey = JSON.stringify([result.effectId, result.effectGeneration])
    const platform = await channel.getReceipt(idempotencyKey)
    if (!platform) throw new Error('The Outbox has no durable native GitHub receipt.')
    const posted = await http(`repos/${repo}/issues/comments/${platform.messageId}`)
    if (posted.user?.login !== user.login || posted.html_url !== platform.url || !posted.body.includes(platform.marker)
      || !posted.body.includes(`T27 ${stamp}: revision B prepared.`) || posted.body.includes(original.trigger.text)) throw new Error('The actual GitHub result or privacy check failed.')
    const reconciliation = await channel.reconcile(result, { idempotencyKey, signal: new AbortController().signal })
    if (reconciliation.type !== 'success') {
      const reason = 'reason' in reconciliation ? reconciliation.reason.match(/^[A-Z][A-Z0-9_]{0,79}/u)?.[0] ?? 'UNCLASSIFIED' : 'UNCLASSIFIED'
      console.error(JSON.stringify({ stage: 'native-result-reconciliation', type: reconciliation.type, reason,
        sourceInstanceId: result.destination.sourceInstanceId, platformMessageId: platform.messageId }))
      throw new Error(`Native result reconciliation failed: ${reconciliation.type}/${reason}.`)
    }
    console.log(JSON.stringify({ model: 'mock', repo, pr, ticketId: first.ticketId, directionVersion: 2, assignmentId: after.assignments[0].id,
      sessionId: after.assignments[0].sessionId, correction: selected, negative, platform, realOutboundVerified: true,
      limits: ['No real-model semantic judgement', 'No second device or desktop UI binding'] }, null, 2))
  } catch (error) {
    failures.push(error)
  } finally {
    const cleanups = [owner, receiver, denied].flatMap(engine => [() => engine?.effects.stop(), () => engine?.shutdown()])
    cleanups.push(() => runtime?.close(), () => context?.fiber.dispose(), () => db?.close(), () => {
      if (!work.startsWith(join(tmpdir(), 'ds-superagent-t27-live-'))) throw new Error('Unexpected T27 cleanup directory.')
      return rm(work, { recursive: true, force: true })
    })
    for (const cleanup of cleanups) { try { await cleanup() } catch (error) { failures.push(error) } }
  }
  if (failures.length) throw new AggregateError(failures, 'T27 acceptance or cleanup failed.')
}
