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

Handlers run after the claim transaction commits. `start()` scans immediately and periodically; `wake()` only hints, and `drain()` permits explicit recovery. `stop()` clears the timer and waits for the current bounded adapter operation and its settlement. A scope is ordered independently in each stream, while other scopes remain eligible. Defaults: 1,000 queued effects (hard cap), three attempts (maximum ten), 1 s initial backoff capped at 60 s, 10 s adapter deadline, and 1 s scans. Enumeration reads at most ten pages of 100 effects; each claim rechecks earlier active operations under its write lock, within the same 1,000-record bound. Failed records retain reasons until explicitly cancelled. Outbox receipts additionally expose `pending`, `sent` or `dropped`; unknown never means sent. Adapters must honor cancellation and implement platform idempotency/query reconciliation; SQLite alone cannot guarantee exactly-once external delivery. Router/Worker Session integration and purpose/authorization rules for result, answer and attention remain with T02/T18.

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

Press Ctrl+C to stop. The runner stops the server and Effects, disposes native agents/context, closes SQLite and removes its own temporary state. No credential or existing DSH data is used. Full SQLite Session persistence, restart recovery, fencing, local tools and real external delivery remain with T03/T15–T20 and later tickets; the preview uses the first-party JSONL provider configured to an isolated directory. Code and UI are original, importing published DSH APIs rather than copying implementation.

`node dev/native-load.mjs` verifies ten requests and twenty retries with the same native loop and isolated persistence. It requires one Router plus ten Worker Sessions, twenty delivered acknowledgement/result messages, and no new model calls from retries; it prints timings and closes all resources. This deterministic, no-network workload measures development overhead rather than model quality or provider latency.

## Local tool preview

T03 binds an explicit `LocalEnvironment` to an Instance, Actor, absolute root, permission set and fixed command map. The environment mounts DSH's public `dsh-fs-local` and `dsh-subprocess-local` providers, so file reads/writes, search and configured commands use the same execution world. Model tools are `write_file`, `read_file`, `glob`, `grep` and `run_command`; the last accepts a configured name only. Arbitrary argv, shell text, PTY, async jobs, remote process trees and unverified tool combinations are rejected.

The Worker receives the bound working directory through the native Agent Session, writes and verifies files, and must run a configured verification command after the final write before submitting ready. It then lists relative artifact paths; the engine stores current byte count and SHA-256 plus bounded tool facts. Local tools are sealed after report submission, preventing a late mutation from leaving a stale ready hash. Command cancellation waits for the provider-managed range to exit. Lossy output is withheld entirely; short output is sanitized before it enters facts or the UI. A setup failure keeps its bounded exit facts visible and waits for an explicit retry against the same physical root.

`node dev/local-chat.mjs` starts a loopback preview with a temporary project directory and a scripted model. Select `sample-project`, ask `Create answer.txt containing hello, then verify it.`, and expand the result evidence. The preview writes a real file, searches it, runs the configured Node command, and shows the SHA-256 and each tool fact. Browser evidence uses an isolated context and no credentials; it demonstrates local execution through native DSH loops and does not claim a real-model or remote-device run. T03's full recovery, remote job, device fencing and host replacement behavior remains assigned to later tickets.
