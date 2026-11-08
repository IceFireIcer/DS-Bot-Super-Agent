# DS Bot Super-agent core

This private ESM package hosts the independent TypeScript core. Its public Cordis plugin exposes only the instance-bound Engine; the existing DS Bot entry point does not feed it requests.

## Requirements

- Node.js 22.19 or newer.
- An explicitly configured, absolute, writable SQLite database path isolated for this instance.
- An explicit instance ID and trusted desktop source configuration. `allowedActorIds` is a deployment-owned allowlist, not data from the submitted request.

The core does not read `DSH_HOME`, migrate or inspect a user's DSH data, or enable non-local environments. Without a configured native Session adapter, accepted work remains pending with `worker-not-enabled`. T02 adds the optional Router/Worker execution path below.

## Use from Cordis

```js
import { Context } from '@deepseek-ai/cordis'
import * as Superagent from 'ds-bot-superagent'

const ctx = new Context()
await ctx.plugin(Superagent, {
  databasePath: '/var/lib/ds-bot-superagent/private.sqlite',
  instanceId: 'private',
  source: {
    sourceInstanceId: 'desktop-one',
    actorId: 'local-user',
    allowedActorIds: ['local-user'],
  },
})
const engine = ctx.get('superagent')
const receipt = await engine.submit({ commandId: 'request-1', eventId: 'message-1', text: 'Inspect the project.' })
const work = await engine.getTicket(receipt.ticketId)
await ctx.fiber.dispose()
```

The receiving desktop adapter binds `sourceInstanceId` and `actorId` in plugin configuration. Request fields cannot replace identity, policy or mandate scope. Reuse the stable `commandId` for transport retries. A reused command or event ID with different content is an `IDENTITY_CONFLICT`. The returned work keeps the original text and records an immutable explicit Mandate and pending local intent.

## Command-line entry

Build the package, then use the same public plugin and Engine through the isolated CLI:

```powershell
npm ci
npm run build
$db = Join-Path $PWD '.dsh-test-superagent/state.sqlite'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $db) | Out-Null
node dist/cli.js submit --database $db --instance private --source desktop-one --actor local-user --allow-actor local-user --command request-1 --event message-1 --text 'Inspect the project.'
node dist/cli.js query --database $db --instance private --source desktop-one --actor local-user --allow-actor local-user --ticket <ticket-id>
node dist/cli.js receipt --database $db --instance private --source desktop-one --actor local-user --allow-actor local-user --command request-1
```

The CLI emits one JSON result on stdout. Keep the database in an isolated project test directory; never point it at a running DSH or any existing DSH data. Do not place secrets in command arguments.

## Validation

```sh
npm ci
npm run typecheck
npm test
npm run lint
npm run mock
```

`npm test` rebuilds before running tests and stops if the build fails. Use the same entry for a file or a named regression:

```sh
npm test -- test/execution.test.mjs
npm test -- --test-name-pattern="Engine notices" test/execution.test.mjs
```

Native model fixtures in `dev/native-mock.mjs` accept a responder returning a synchronous or asynchronous iterable of provider chunks. Use `async function*` for asynchronous responses; a Promise-returning async function is rejected before Session startup. `routerResponse` handles the supplied notification tools, including coalesced turns.

The mock uses deterministic explicit requests rather than a model and places its temporary SQLite database in the OS temp directory, deleting it and closing its Cordis fiber on exit. `npm run mock` reports elapsed single-request p50/p95/max for 50 SQLite commits, 20 parallel deliveries for one event, and the re-opened CLI receipt; no worker or model is started. On Windows x64 with local Node 25.4.0, the 2026-11-04 recheck measured p50 0.76 ms, p95 1.24 ms, max 1.88 ms per serial submit; the twenty retries returned one Ticket. This small disk-backed local-path sample is a development baseline, not a production storage benchmark or SLA.

SQLite schema version 2 accepts empty databases and upgrades version 1 atomically. A version-1 upgrade first creates a verified, consistent SQLite backup beside the database (`<database>.before-v2-<unique-id>.sqlite`). Retain that backup for recovery. Unsupported versions, unexpected versioned table layouts and nonempty unversioned databases are rejected before schema mutation. Same-process transactions are serialized on one worker-backed `DatabaseSync` connection with a 128-command admission limit; SQLite's default cross-process lock wait is 250 ms. The callback transaction capability expires before commit. An unknown COMMIT is reconciled with the original command ID and fingerprint on a fresh connection under `BEGIN IMMEDIATE`; unavailable reconciliation remains `COMMIT_UNKNOWN`. Rollback-confirmed deadlock/serialization failures retry the whole database-only command, at most three attempts.

## Durable effects

Acceptance writes a Router notice and an acknowledgement Outbox intent in the same transaction as the work and command receipt. They remain pending until trusted deployment adapters are configured. Inspect them through `engine.effects.list(cursor?)`, `engine.effects.receipt(id, generation)` or the CLI `effects` action (`--after` accepts a returned cursor).

`Effects.enqueue(transaction, { key, stream, scope, payload })` and `Effects.cancel(transaction, identity)` compose with the public instance-scoped `AsyncTx`. The transaction also offers `replace`, `remove` and bounded `scan` with an exclusive ID cursor. `Storage.reconnect()` must return an independent connection implementing the same locking contract. Adapters for future backends must implement these operations together.

Configure `effects.handlers` in the Cordis plugin, or construct an `Effects` instance explicitly. Each `relay`, `notice` or `outbox` handler implements `execute(effect, { idempotencyKey, signal })` and optionally `reconcile` with the same arguments. Return `success`, or `transient`, `permanent`, `unknown`, `defer` with a public, non-sensitive reason. Only return `transient`/`defer` from execution when it is safe to try again. Throws, invalid responses, expired deadlines and interrupted running attempts require reconciliation; they never authorize blind replay. Unsuccessful reconciliation preserves unknown; only a query-confirmed `not-applied` result permits another execution under the original idempotency key and remaining attempt budget. Unknown outcomes without a reconciliation adapter remain visible and block their own ordered lane. The idempotency key contains the immutable row identity and payload generation. A confirmed completed key suppresses duplicate delivery; explicit cancellation permits recreation with a new identity.

Handlers run after the claim transaction commits. `start()` scans immediately and periodically; `wake()` only hints, and `drain()` permits explicit recovery. `stop()` clears the timer and waits for the current bounded adapter operation and its settlement. A scope is ordered independently in each stream, while other scopes remain eligible. Defaults: 1,000 queued effects (hard cap), three attempts (maximum ten), 1 s initial backoff capped at 60 s, 10 s adapter deadline, and 1 s scans. Enumeration reads at most ten pages of 100 effects; each claim rechecks earlier active operations under its write lock, within the same 1,000-record bound. Failed records retain reasons until explicitly cancelled. Outbox receipts additionally expose `pending`, `sent` or `dropped`; unknown never means sent. Adapters must honor cancellation and implement platform idempotency/query reconciliation; SQLite alone cannot guarantee exactly-once external delivery. Real GitHub and Feishu channels remain with T25–T30.

## Outbox purposes and delivery receipts

T18 makes each outgoing message a durable delivery record with a purpose, basis, destination, sequence and Effect identity. `engine.getTicketDeliveries(ticketId)` reports `pending`, `sent` or `dropped`, the bounded attempt count and a non-sensitive reason. The conversation projection hides dropped rows while the delivery query retains them as evidence.

Pass `delivery: { channel }` to the Cordis plugin, or the tenth `Engine` argument, to bind an external `DeliveryChannel`. Its `deliver(delivery, { idempotencyKey, signal })` returns `success`, `transient`, `permanent` or `unknown`; an `unknown` outcome is only retried through `reconcile` with the same key. Without a channel, `localDeliveryChannel` treats the isolated local record as the receipt.

Before dispatch, the handler revalidates the purpose: an acknowledgement must match the accepted request and original message; an answer must name a current trusted human question with an explicit fact and return to that question; a result must match the current ready report and an unconstrained Ticket; an attention must still be the current waiting-human question. Ordinary progress has no outbox path, and one Ticket's stream keeps acknowledgement ahead of result.

## Assignment retry and recovery evidence

`engine.retryTicket({ commandId, ticketId, reason })` starts a fresh Assignment generation for the same Ticket, Worker Session and retained directory. The old generation ends first; the current ready report stops being current, while report history remains readable. `conversation(ticketId).recovery` returns the old/new Assignment identities, the requester, the reason and the four required checks: retained Session and directory, version-control state, external actions reconciled by original ID, and preserved stop/waiting-human/revoked authority.

A retry is refused while this runtime still has a live turn, while the Ticket is stopped or waiting for a human, while an Effect has an unknown external outcome, while preview cleanup is unconfirmed, or while the previous Assignment still has running/cancelling/unknown jobs or subagents. A blocked attempt still records `recovery-blocked` and `blockedWork`; replaying the command returns the same decision. Late job, subagent, report and Effect callbacks remain tied to the Assignment ID and generation that produced them.

## Host lease and writer fencing

T20 wraps every business transaction in a durable instance lease. A Host acquires a monotonically increasing epoch with a non-reusable token, renews it on each guarded transaction, and releases it on `shutdown()`. An unexpired lease held by another Host rejects reads, writes, stop commands and Outbox settlement with `HOST_LEASED`. An expired lease still requires an explicit `engine.acquireHost()` before a new Host gets the next epoch; merely losing contact never grants write authority.

The default Host identity is stable per machine so CLI invocations and same-machine crash recovery continue the same instance. Deployments that run two independent Hosts must configure distinct `host.hostId` values. `engine.getHostLease()` exposes the epoch, token, acquisition/renewal and expiry facts. Session persistence keeps its own writer epoch, and assignment callbacks still verify Assignment ID and generation; the business database lock is never treated as proof that a device process has stopped.

## Context cards and bounded reads

T21 adds `engine.readContext({ ticketId, ref, after?, maxBytes? })`. A card carries a stable reference, title, short summary, one UTF-8 byte page, facts, a pagination cursor and the next reachable references. Supported references are the Ticket, its trigger, decision, mandate, current or historical report, current or historical Attention, one delivery, one reachable source event, or the history of one reachable source object/thread.

Pages default to 4 KiB and are capped at 16 KiB. `pagination.truncated` is explicit, and concatenating pages through the returned cursor reconstructs the full text. Reads are limited to the Ticket's own facts and to source events from its original Thread or a legal subscription; guessing another Thread's event or paging through it is rejected. The `read_context` Worker tool uses the same contract, so a Worker can read the original request instead of trusting a Router summary. The local preview exposes the same query at `/context` and has a “Read original request” action in its evidence panel.

## Context rollover

T22 treats a Worker turn whose DSH `turn/end` reason is `max-tokens` as context exhaustion. The live turn builds a DSH fork seed from the Session prefix, records a `session-rollover` with the old/new Session and Assignment, goal, Mandate, constraints, unread Inputs and evidence references, ends the old Assignment, and starts a new Session generation with an explicit handoff prompt. The old Session remains readable through `engine.getSessionHistory(sessionId, { after, limit })`.

If the process exits before the handoff relay runs, startup scans `context-rollover` intents and requeues the handoff for the current Assignment. A late event from the old Assignment still cannot wake the new generation. If the live fork cannot be built, the new Session starts without inherited history but keeps the same explicit goal/constraint/input handoff.

## Versioned role configuration

T23 adds `engine.getRoleConfig()` and `engine.updateRoleConfig({ commandId, expectedRevision, roles })`. The persisted configuration has Router and Worker profiles, each with a name, provider/model route, instructions and a bounded skill list. Saves use a revision CAS: a stale revision is rejected, a replayed command returns its original revision, and invalid keys, unknown placeholders, duplicate/reserved skills or oversized text are rejected instead of truncated.

Routes apply to the next real Router or Worker request; an in-flight Agent keeps its own options. Worker and Router requests write `role-config-use` records with the Session, role, revision and both routes, and `engine.getRoleConfigUses(sessionId)` exposes them. Allowed instruction placeholders are `{{goal}}`, `{{constraints}}` and `{{evidence}}`. Instructions and skills become role prompt text only: they never add tools, widen a Mandate, change an Environment or grant device access.

## Supervision read model

`engine.getSupervision()` rebuilds a risk-ordered view from public facts: waiting-human first, then unknown effects/jobs or failed setup, then stopping/stopped, ready, running/pending and ended. Every item carries the next action, the trigger/Decision/Mandate/Assignment/report/Attention/stop identities behind it, current message receipts and per-part health. An unknown effect or old job marks only its own Ticket blocked.

The local preview serves the same data at `/supervision` and renders a “Needs you” panel with answer, stop, resume, setup retry and Assignment retry. Same-origin `/requeue`, `/unsubscribe` and `/dismiss-eval` expose the authorized manual re-evaluation, subscription removal and unavailable-Eval dismissal paths. A refresh only rereads durable facts; it does not resend a command.

## External source adapters

`SourceKind` now covers `desktop`, `github`, `feishu` and `schedule`. A source can scope dynamic Threads with `allowedThreadPrefixes` instead of a fixed `allowedThreadIds` list.

`GitHubSource` maps issues, pull requests, reviews, CI and comments to stable repo/number Threads, filters the source's own messages, and advances a durable `channel-cursor` only after `receiveSource` records each event. `FeishuSource` does the same for tenant/chat/message identities. Both reject another repo, tenant or chat scope and keep equal numbers/user IDs isolated by source instance.

`ScheduleSource` has a stable rule ID, timezone, interval, persistent `schedule-state` and occurrence IDs. Replaying a tick produces no duplicate, and missed windows follow `skip`, `once` or bounded `all` catch-up. Pausing still records due occurrences for later evaluation.

These adapters are protocol cores only: real GitHub/Feishu network clients, setup/health, member sync, real-channel acceptance and a real scheduled run remain outstanding. PR delivery tracking, cross-channel destination changes and proactive preparation (T26/T27/T29) are not implemented yet.

Run `npm run build` then `node dev/effects.mjs` for the isolated 100-notice workload. It reports enqueue latency and scan time, closes storage and removes its temporary database. Restore upgrade backups only while the isolated Host is stopped, and reconcile external actions before resuming; restoring a database does not undo an external action. Session backups and recovery belong to the Session persistence tickets.

This internal package is licensed Apache-2.0 as part of the repository. Its implementation is original and imports public DSH and Node APIs. It does not copy code or text from the research prototype. External source/channel, remote device and PostgreSQL support remain outstanding.

## Native Router and Worker preview

Router notices opt into a durable batch handler with at most seven items. Effects claims each group under one write transaction, retains individual identities and generations, and settles each outcome separately. An unhandled notice remains pending for bounded retry; unknown outcomes still require reconciliation. The Engine integration tests exercise this path through the real Effects dispatcher and DSH loop. Handlers without a batch adapter retain serial dispatch.

T02 uses public `ctx.agents.create()` and `resume()`, the native DSH agent loop and tool pipeline, and the deployment's public Session persistence provider. It targets DSH 0.2.1-rc.4. `new NativeSessions(ctx, { router: { provider, model }, worker: { provider, model }, timeoutMs? })` binds explicit routes. Pass that adapter as `sessions` in the Cordis plugin config, or as the fifth `Engine` constructor argument. The host must already mount DSH agents, loop, LLM, tools, system prompt, Session registry, projections and persistence. Caller owns the adapter and its `close()` lifecycle; the plugin stops its Effects before closing business storage.

The Router sees only assignment or current-report delivery tools. A Worker receives the original request text, `report_ready`, `ask_human`, protected add/remove tools for non-required Thread subscriptions, and `handback_input` during a source follow-up. The fixed Router Session is resumed for later notices in the same runtime; each Ticket has one Worker Assignment and its own Session. Native logs are persisted separately from business metadata and ready reports. Ordinary assistant text, an error or idle status cannot produce a result. A result must reference the current Assignment's ready report and goes through the same ordered Outbox as its acknowledgement, to the original message in the isolated conversation store. `engine.conversation(ticketId)` returns pending/running/waiting-human/ready, Attention, Assignment, reports and delivered messages. The native turn budget defaults to 15 s (configurable 100–60,000 ms) and eight model steps; the Effects deadline must exceed the turn budget and defaults to 60 s when native execution is enabled. Provider cancellation remains cooperative.

An accepted versioned-source Ticket subscribes its original Thread. Authorized human direct or mention follow-ups become stable `WorkInput` records, increment the Ticket direction version and resume the same Worker Session; Router evaluation returns `ALREADY_OWNED` while the Thread has an owner. `engine.getTicketDirection(ticketId)` exposes subscriptions, accepted Inputs, every context/owned fan-out decision and any recovery decision. `engine.conversation(ticketId)` keeps latest report/message projections and exposes `reportHistory`/`messageHistory` so a natural-ended Ticket can resume without losing prior evidence. Ownership and history queries fail explicitly above 1,000 records.

`engine.addThreadSubscription`, `removeThreadSubscription`, `attachSourceEvent`, `requeueSourceEvent` and `addTicketNote` are the T07 management boundary. Subscriptions can be `worker` (human follow-ups become Inputs) or `context` (background only). Original/source-bound subscriptions are required and protected. A Worker can remove only a non-required subscription that the same Assignment added. Handback keeps a reason and blocks manual requeue until every owner has handed back. `requeueSourceEvent` creates a fresh evaluated Decision/Ticket history and requires an Intake Policy; it never reattaches the message to a Ticket that just handed it back. `dismissEvaluation` durably acknowledges only an unavailable Eval. Notes and context-only events do not alter Mandate, direction version or execution authority.

`ask_human` creates a durable Attention and ends the current Assignment in `waiting-human`. `engine.getTicketAttention(ticketId)` and `engine.conversation(ticketId)` expose current and historical questions. Answer with `engine.answerAttention`; direct local-preview answers use trusted actor identity, while channel answers must provide a current `sourceEventId` from the question Thread and matching human recipient. A valid answer clears only its own waiting constraint, appends an Input and resumes the same Session. Answered or superseded questions reject later answers. Questions answered before Outbox delivery settle the stale delivery as dropped.

`engine.stopTicket` persists a human stop before cancelling pending work. A running Assignment is shown as `stopping` until its Session or setup command exits; only then does the stop carry cancellation confirmation and display `stopped`. Follow-ups and restarts keep the stop. `engine.resumeTicket` rechecks the current source authorization and creates a new Assignment generation while retaining the Ticket, Session history and configured directory. Waiting-human, unknown effects, an unconfirmed cancellation or another source instance block resume. The local chat preview exposes separate stop, stopping, stopped and resume controls through its same-origin routes.

`engine.updateIntakePolicy` persists the off/observe/auto configuration under a source-scoped revision, rejects stale expected revisions and member-sync revisions, and invalidates only this source's in-flight Evals. It requeues their candidates under the new Policy and notifies only affected live Tickets; policy text never changes the trusted actor allowlist or an existing Mandate. `engine.setProcessingPaused` keeps recording source events while blocking new acceptance, Evals, Input delivery and effect dispatch. An Eval already delivered to its assessor freezes its timeout and becomes `EVAL_PAUSED`; resume starts a fresh evaluation instead of accepting the late result. The local chat preview reports global processing separately from waiting-human and Ticket stop controls.

Run the isolated browser entry with a scripted, key-free model:

```sh
npm ci
npm run build
node dev/chat.mjs
```

Open the printed loopback URL and ask `What is 2 + 2?`. The mock completes addition requests and deliberately leaves other requests unfinished. It supplies streaming provider chunks to actual DSH Router/Worker Sessions; it does not emulate the agent loop. The chat shows status, the acknowledgement, the result and expandable report/Session evidence. Requests keep their stable identity on retry; the tab remembers accepted conversations across refresh. The HTTP entry binds an available port on 127.0.0.1, checks Host/Origin, bounds JSON input and serves a nonce-based CSP. It is a single trusted local preview, not a multi-user deployment or replacement for the existing Bot UI.

Press Ctrl+C to stop. The runner stops the server and Effects, disposes native agents/context, closes SQLite and removes its own temporary state. No credential or existing DSH data is used. The native adapter's SQLite Session persistence, restart recovery and writer fencing now live in session-persistence-sqlite (T15); this browser preview still uses the first-party JSONL provider configured to an isolated directory. Real external delivery remains with T16–T20 and later tickets. Code and UI are original, importing published DSH APIs rather than copying implementation.

`node dev/native-load.mjs` verifies ten requests and twenty retries with the same native loop and isolated persistence. It requires one Router plus ten Worker Sessions, twenty delivered acknowledgement/result messages, and no new model calls from retries; it prints timings and closes all resources. This deterministic, no-network workload measures development overhead rather than model quality or provider latency.

## Concurrent Worker slots

T11 gives every Worker turn a durable slot owned by one Assignment. A slot covers directory preparation, launch, wake-up and the active turn, and is released when the turn reports ready, asks a human, is stopped, ends idle or throws. A turn that ends with background jobs still running keeps its slot until that work is gone (see "Asynchronous background jobs"). The state is queryable through `engine.listSlots()`: `limits` is the declared budget, `holding` lists the Assignments that own a slot (with `priority`, `activation` and `phase`), and `waiting` lists the queued Tickets with their reason (`SLOTS_FULL` or `PRIORITY_WAITING`). `engine.conversation(ticketId).slot` shows the same facts per Ticket, and a queued Ticket reports `slot-queued` or `slot-priority-waiting` as its intent reason, so a user can see why work has not started.

Launches use the normal budget (`slots: { maxSlots }`, default 2). A person's follow-up or a status request may use a bounded extra slot (`maxPrioritySlots`, default 1). The extra slot is only an overflow: while normal capacity is free, new admissions still take a normal slot, so priority holds can never exceed their own bound. A person's follow-up jumps the queue ahead of waiting launches and cannot be starved by a burst of automatic events; while a priority admission is waiting, new launches report `PRIORITY_WAITING`.

Effects dispatch each lane independently, so a slow Worker turn delays only its own lane; a pass skips a lane that is already running, so work that arrives later is never queued behind it. A relay whose turn is waiting for a slot returns `defer`, which keeps its attempt budget intact, and a slot release wakes the dispatcher instead of waiting for the next scan. `engine.requestStatus({ commandId, ticketId })` is a restricted command: it runs only for an idle Worker that ended a turn without a result, and it rejects a stopped Ticket, a waiting-human question or a Ticket that never ran. The status turn gets one fact-only tool, `report_status`, and no delivery tools, so it cannot report ready, ask a question or change subscriptions; the recorded text appears as `conversation(ticketId).statusReport` and never completes the Ticket.

Run `npm run build` then `node dev/slots.mjs` for the declared workload (two normal slots, one extra slot, six Tickets, a 400 ms mock turn, a 50 ms scan). On Windows x64 with Node 25.4.0 the 2026-11-07 runs kept the peak of concurrent Worker turns at 3 (the declared bound), showed 4 Tickets queued for slots, delivered a person's follow-up on the extra slot in about 4 ms while all four launches stayed queued, and finished every launch in roughly 2030-2080 ms against a 3600 ms fairness bound. These are development figures for this deterministic mock workload, not a production latency SLA.

## Local tool preview

T03 binds an explicit `LocalEnvironment` to an Instance, Actor, absolute root, permission set and fixed command map. The environment mounts DSH's public `dsh-fs-local` and `dsh-subprocess-local` providers, so file reads/writes, search and configured commands use the same execution world. Model tools are `write_file`, `read_file`, `glob`, `grep` and `run_command`; the last accepts a configured name only. Arbitrary argv, shell text, PTY, remote process trees and unverified tool combinations are rejected; the only background execution is the configured `start_command` below.

The Worker receives the bound working directory through the native Agent Session, writes and verifies files, and must run a configured verification command after the final write before submitting ready. It then lists relative artifact paths; the engine stores current byte count and SHA-256 plus bounded tool facts. Local tools are sealed after report submission, preventing a late mutation from leaving a stale ready hash. Command cancellation waits for the provider-managed range to exit. Lossy output is withheld entirely; short output is sanitized before it enters facts or the UI. A setup failure keeps its bounded exit facts visible and waits for an explicit retry against the same physical root.

`node dev/local-chat.mjs` starts a loopback preview with a temporary project directory and a scripted model. Select `sample-project`, ask `Create answer.txt containing hello, then verify it.`, and expand the result evidence. The preview writes a real file, searches it, runs the configured Node command, and shows the SHA-256 and each tool fact. Browser evidence uses an isolated context and no credentials; it demonstrates local execution through native DSH loops and does not claim a real-model or remote-device run. T03's full recovery, remote job, device fencing and host replacement behavior remains assigned to later tickets.

## Asynchronous background jobs

T12 lets a Worker start one configured command in the background and continue its turn. `start_command` returns a job identity at once (`jobId`, command, `running`, `startedAt`) instead of waiting for the process; `job_status` reads that job's state, confirmed exit and bounded retained output, and `cancel_job` is the Worker's own cancellation. A background job is owned by the Assignment generation that started it and records its Environment, so identities never cross Tickets or generations. Output is read from the provider's bounded window (8192 bytes per stream) without consuming it, and a truncated stream is withheld rather than showing a partial secret.

`engine.listJobs(ticketId)` and `engine.getJob(ticketId, jobId)` expose the durable facts; `engine.cancelJob({ commandId, ticketId, jobId, reason })` is the trusted-actor cancellation command, idempotent per command ID and `IDENTITY_CONFLICT` on a reused ID with another reason. `engine.conversation(ticketId).jobs` lists the same summaries, and the local chat preview adds same-origin `GET /jobs`, `GET /job` and `POST /cancel-job`.

A turn that ends with `running` background work does not report idle: the Ticket shows `worker-background`, keeps its slot and initializes no report until the work is accounted for. When it exits, the completion event wakes the same Worker Session with the state, exit code and bounded output. That wake is automatic input: the Ticket normally still holds its own slot, so the wake reuses it; when it does not (`activation: 'background'`), admission never uses the bounded extra slot reserved for a person. A late completion only wakes work when the Ticket is open, unconstrained, and the Assignment ID *and* generation are still current, so a stop, a waiting question, a ready handoff or a replaced Assignment never resurrects the work.

Cleanup is by ownership. `stopTicket` records the cancellation inside the same transaction and then terminates the process ranges; a Worker's `cancel_job` and an Assignment that hands back or ends (`waiting-human`, ready) do the same. An accepted preview is the one exception: it is removed from the execution-work index and survives the handoff until explicit cancellation or stop (see "Acceptance previews"). `cancelled` is only written after the managed range is observed empty (`cancelling` shows the pending state first), with the bounded output tail captured before the handle is dropped; a range this Host cannot observe becomes `unknown` instead, so it never reads as stopped. Each job also has a declared wait (`jobs.waitMs`, default 30 minutes, 100 ms–1 h): at the limit the range is terminated and recorded as `cancelled`/`deadline`, never as a delivered result. A preview is exempt from this wait. `jobs.maxPerTicket` (default 4) bounds concurrent jobs per Ticket and is enforced inside the starting transaction, so overlapping starts cannot both pass. A process whose exit cannot be confirmed is `unknown` with `settled: false` and `succeeded: false`; so is a record from an earlier Host, and a `running` record this process no longer holds — which is why an interrupted settlement cannot hold a slot forever.

Job records are evidence: nothing deletes them automatically. A Ticket's job query is bounded at 100 records (newest first), so a long-lived Ticket keeps answering while older records stay in the store.

Run `npm run build` then `node dev/jobs.mjs` for the declared workload: a real 12-second Windows child process, a 60-second declared wait and a 50 ms scan. On Windows x64 with Node 25.4.0 the 2026-11-08 runs returned the starting turn in about 173 ms while the command was still running, answered an unrelated request in about 333 ms during that command, cancelled on a direction change in about 24 ms including the wait for confirmed quiescence (leaving no slot held), and delivered the completion event to the originating Worker in about 375 ms with exit code 0 and no result reported. These are development figures for this deterministic mock-model workload over a real local process, not a production latency SLA.

An accepted versioned source may bind a local Environment explicitly with `acceptSource({ commandId, threadId, objectId, expectedEventId, environmentId })`, matching `submit`; without it, an accepted Ticket has no working directory and no local tools. A `LocalCommand` may declare `backgroundTimeoutMs` (from its own `timeoutMs` up to one hour) for the background deadline; `start_command` uses it instead of the foreground deadline.

## Delegated subagents

T13 lets a Worker delegate bounded subtasks to real DSH child Agents with `delegate_subagent`, `subagent_status` and `cancel_subagent`. A child is created through the public `ctx.agents.create({ parentAgent, meta: { cwd, origin: 'subagent', delegationDepth, parentSession }, setup })` seam, so DSH records the live ownership and the durable lineage. Its tools are the parent's already-authorised local work tools only (`write_file`, `read_file`, `glob`, `grep`, `run_command`), registered into the child's own scope after clearing the global surface; a child never gets this Ticket's job tools, so it can neither observe nor cancel its parent's background commands. Its calls keep their own accounting, so they neither consume the parent turn's tool budget nor satisfy the parent's `report_ready` verification rule. It never receives Router tools, `report_ready`, `ask_human`, subscription or handback tools, or `delegate_subagent`, so it cannot deliver a result, ask a person, widen authority or nest further. The child runs in the parent Assignment's bound directory under the same Mandate and Worker model route, and every child tool call re-checks that Mandate, the Assignment and its own subtask state.

Delegation returns a stable identity at once; the turn does not wait. The completion arrives as a later event on the same Worker Session with the bounded result (`subagents.maxResultBytes`, 16 KiB by default, marked when shortened) and the delegating generation, and it is never a ready report. While a child runs the Ticket keeps `worker-background` and its slot, exactly like a background job, and the wake is automatic input that never takes the person's extra slot. A late result only wakes the Assignment generation that delegated it: a stop, a waiting question, a ready handoff or a replaced Assignment never resurrects it. A Ticket reports at most its newest 100 subtask records; older ones stay stored as evidence.

Cleanup follows ownership. `stopTicket`, `cancelSubagent`, ready handoff and waiting-human cancel the child by reason, then end it through DSH's `agent.cancel({ kind: 'parent' })` and `whenIdle()`. On that active-cancellation path, `cancelled` is written only after the child is observed quiet within the cleanup budget; otherwise the record stays `unknown` and the Ticket stays `stopping` rather than pretending it stopped. A child that ends its own turn with a user, parent or disposal abort records that fact as `cancelled`. `subagents.maxPerTicket` (default 2) bounds concurrent children inside the starting transaction, `subagents.deadlineMs` (default 10 minutes) bounds one child, `subagents.cleanupMs` (default 5 s) bounds active cancellation confirmation, and `subagents.maxResultBytes` bounds one child's reported result. Every child tool call re-checks that the subtask is still running and its Assignment still current, so an unconfirmed child cannot keep mutating the shared directory. `engine.listSubagents(ticketId)`, `getSubagent(ticketId, subagentId)` and `cancelSubagent({ commandId, ticketId, subagentId, reason })` expose the facts; `conversation(ticketId).subagents` summarises them, and the local preview adds same-origin `GET /subagents`, `GET /subagent` and `POST /cancel-subagent`. `Engine.shutdown()` cancels and disposes every live child before Effects stop.

Two limits are deliberate. `parentAgent` is runtime ownership and disappears with the parent Agent, so a background child keeps durable lineage (`parentSession`/`origin`/`delegationDepth`) and is stopped by this core rather than by a cascade. This ticket does not use `@deepseek-ai/dsh-subagent`'s `startActivation`: its local path needs the working-directory, session-query and preset composition, which is a separate runtime migration. The child tool set is therefore registered explicitly through `ctx.agents.create`; nested delegation and streamed child output remain unsupported and are refused rather than emulated. A child's outcome is taken from its own Session `turn/end` fact, so `error`, `max-tokens`, `blocked` and `interrupted` turns are reported as failed rather than as successful subtasks.

Run `npm run build` then `node dev/subagents.mjs` for the declared workload (four subtasks, three steps each, 50 ms scan). On Windows x64 with Node 25.4.0 the 2026-11-08 runs handed the parent Ticket to background children in about 171–203 ms, ran four children concurrently, and kept the parent Ticket slot while they ran, with only the inherited work tools. These are development figures for this deterministic mock-model workload over real DSH child Agents and Sessions, not a production SLA.

## Acceptance previews

T14 lets a Worker explicitly keep a running managed job as a human acceptance preview with `keep_preview`. The tool takes the `jobId`, a bounded `purpose` and one relative `artifact` path; it verifies the artifact in the Assignment's bound Environment and records its path, byte count and SHA-256. It accepts only a live job started by the same Assignment generation, so it can never borrow another Ticket's process. A Ticket retains at most `jobs.maxPerTicket` pending previews (running, cancelling or unknown; default 4), enforced by a durable pending index in the same transaction that creates the preview. `engine.listPreviews(ticketId)`, `engine.getPreview(ticketId, previewId)` and `engine.conversation(ticketId).previews` expose the preview's ID, `jobId`, Ticket, Assignment, generation, Environment, command, purpose, artifact, state and `holdsSlot: false`. The local chat preview adds same-origin `GET /previews`, `GET /preview`, `POST /cancel-preview` and `POST /resolve-preview`.

At a ready report or `waiting-human` question, the slot is released in the same transaction that records the handoff. Ordinary background jobs are cancelled by Assignment ownership and child Agents are stopped through the T13 path; the explicit preview is removed from the active job index and from its 30-minute job wait. It therefore does not hold an execution slot, cannot consume the job budget, and its natural exit is only a durable preview fact (`exited` with the exit code); it never enqueues a Worker wake. Other jobs and subagents keep their existing rules.

The preview is a deliberate exception to Assignment-end cleanup because ready handoff already ends the current Assignment in this core. Its lifetime is until `cancelPreview({ commandId, ticketId, previewId, reason })`, a Ticket stop, its own exit, or Host shutdown. `stopTicket` and the stop-skip path include preview job IDs in their cancellation and confirmation set, and they do not confirm a stop while any preview cleanup is still running, cancelling or unknown. Cleanup remains ownership-scoped: only a process this core started is terminated, other Tickets keep running, and no user-owned process is discovered or signalled. `cancelPreview` writes `cancelled` only after the managed range is observed quiet; without that evidence it records `unknown` with `pendingConfirmation: true`. A later Host cannot prove an `unknown` range is gone, so `resolvePreview({ commandId, ticketId, previewId, reason })` lets a person record that decision as `resolved`; a current Host may then complete a stop that was waiting only on that preview. Resolving a preview never invents cancellation evidence for a stop owned by an earlier Host; T09's `CANCELLATION_UNCONFIRMED` barrier still applies. `engine.resumeTicket` refuses `PREVIEW_ACTIVE` until that pending cleanup is resolved.

`conversation(ticketId)` now exposes `stage` and `lifecycle` separately. `stage` is `idle`, `draft`, `ready`, `waiting-human`, `stopping`, `stopped`, `ended` or `pending`; `lifecycle` is the Ticket's independent `open`/`ended` fact. A current ready report keeps `stage: ready` even after its result delivery ends the Ticket, so `stage` and `lifecycle` stay separate. A ready report does not create a new Assignment, start a new turn, redo a side effect, or duplicate its delivery when queried again. Preview records are evidence: the active-preview budget is bounded by `jobs.maxPerTicket`, and list/get queries return the newest 100 records without letting old terminal records break the query. `node --test test/previews.test.mjs` covers ready and waiting-human handoff, ordinary-job and child-Agent cleanup, preview exit, ownership isolation, unconfirmed cleanup and human resolution, cross-Host stop safety, the preview budget, stage separation, and the same-origin query/cancel routes.

## SQLite Session persistence

T15 mounts the public DSH `SessionPersistence` service on the same SQLite transaction worker as the business store. `session-persistence-sqlite` (`ds-bot-superagent/session-persistence`) takes `{ databasePath }` and stores the Session header, a contiguous event log and a writer row under the `session-meta`, `session-event` and `session-writer` record kinds. Event keys are zero-padded by sequence, so a scan yields the log in order; a non-contiguous append is refused with `assertContiguous`, and a stored log is re-verified with `validateStoredEvents`, checked for contiguity from seq 0, and compared with the header event count when read or opened for write. The header is checked for format version and identity, and a fork keeps `parentSession`, `isSeeded` and its `inheritedEventCount` cut.

`open(id, 'write')` succeeds only when no live writer row is active, so one Session has one writer; a second attempt raises `SessionAlreadyOwnedError`. The active row carries the owner PID: a crashed holder (dead PID) is taken over with a new epoch like the JSONL backend's kernel lock, while a live process or a second in-process instance is refused. Each `append`, `flush` and `close` re-reads the writer row in the same transaction and compares its `epoch` and activity flag, so a handle left behind by a replaced backend or a crash cannot silently write again: it raises `SessionOwnershipLostError` instead. `append` commits on every call, which is why the Agent loop's pre-publication seed (`appendUnstoredSuffix`) is already durable. A failed `flush` or `close` keeps write ownership: the handle stays open and can still append or flush, and it never reports success it did not observe. A created Session that is never materialized (no append or explicit flush) removes its own meta and writer rows on close, so a failure before publication leaves nothing behind for a later `stat()` to mistake for a resumable Session; a flushed empty Session survives. An append writes its events and the header cursor in one transaction, so a mid-batch failure leaves no partial log and can be retried; a failed live append stops the handle and surfaces the original error at `flush`/`close` instead of dropping later events. A service-wide `flush()` drains every open write handle and aggregates any failure without releasing a single owner.

The plugin routes `session/event` into the live append chain of the active handle, maps `session/flush` to `handle.flush()`, and drains plus releases on `session/disposed`. Because DSH stores the unpublished suffix before `prepared.publish()`, construction and resume records such as `session/end-seed` and interrupted-turn closers are readable when `session/created` is announced, not only after later live events. `NativeSessions` no longer keeps an in-process completion set; it asks the public `stat()` whether a Session is persisted and chooses `resume()` or `create()`, so a replaced adapter or a restart continues the same log. `node --test test/session-persistence.test.mjs test/native-runtime.test.mjs` covers the handle contract, writer fencing, crash takeover, service flush, interleaved Sessions, fork lineage, backend replacement, resume after replacement, cancellation, real DSH fork and pre-announce durability. This stores Session history; business facts keep their own records, and the two are reported separately.

## Input recovery after restart

T16 gives every human follow-up Input separately queryable delivery facts. The existing `work-input` and `work-ownership` records still carry receipt and fan-out ownership. A new `delivery` field on the Input records `claimedAt` (a pre-send claim with a stable message ID, Assignment and Session), `sentAt` (handed to the native adapter), `persistedAt`/`persistedMessageId`/`persistedSeq` (only after the exact `user/message` is in durable Session history and the flush barrier passed) and `completedAt`/`outcome` (only when the Worker actually owned the work through a ready report, a human question or a handback). An idle turn leaves `state: pending`, so a persisted delivery is never shown as model-processed.

The message ID is derived from the Input ID and reused across restarts. Before sending, the Worker reads the public Session persistence log: if the original message is already there it does not append it again and instead runs a recovery turn (inspect Session history, files, version control and external state before continuing); if it is absent it resends the original text with the same message ID. `NativeSessions.run` accepts an explicit `messageId` and, for Input turns, waits for the matching `session/event` and flushes the Session before calling `onMessagePersisted`; a failed flush writes no receipt. A paginated `pending-input` index feeds the startup scan, which is registered through `Effects.setStartup` and awaited by `start()`/`drain()`/`stop()` before normal dispatch, so a restart settles the unread/read boundary before any stale inbox copy can race. The scan checks `work-ownership` and never re-attaches a handed-back or requeued Input; a retry keeps the Ticket and Session but creates a new Assignment generation. Recovery notes are numbered, capped at three per Input, and total delivery attempts at five; beyond that the Input keeps an `exhaustedAt` fact and the intent reads `recovery-exhausted` instead of looping. Relay effects also reconcile an unknown outcome by re-running, which is safe because the Worker re-checks the durable message boundary first.

`node --test test/input-recovery.test.mjs` runs real isolated child processes that exit before the claim, after the claim, after the append, after a provider flush failure, and after the persisted receipt. Reopening each database produces exactly one original user message, either the original resend or a numbered recovery note depending on the durable boundary, and finishes with `state: delivered` and `outcome: ready`. It also covers an idle turn followed by a restart and a handed-back Input that must not be re-attached. `Engine.getTicketDirection(ticketId).inputs` exposes the delivery and ownership facts; business facts and Session history remain separately queryable.
