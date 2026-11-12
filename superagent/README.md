# DS Bot Super-agent core

This private ESM package hosts the independent TypeScript core. Its public Cordis plugin exposes only the instance-bound Engine; the existing DS Bot entry point does not feed it requests.

## Requirements

- Node.js 24 or newer.
- An explicitly configured, absolute, writable SQLite database path isolated for this instance.
- An explicit instance ID and trusted desktop source configuration. `allowedActorIds` is a deployment-owned allowlist, not data from the submitted request.

The runtime core does not read `DSH_HOME` or use a user's DSH data as its working store. The opt-in `ds-superagent/legacy-archive` importer reads only an absolute legacy source the operator names, writes a separate read-only archive, and never executes the old Agent loop; it is not part of a running Engine. The core runs on an explicitly configured local Environment or a separately paired remote fs/search/command Environment; the two never substitute for each other silently. Without a configured native Session adapter, accepted work remains pending with `worker-not-enabled`. T02 adds the optional Router/Worker execution path below.

## Use from Cordis

```js
import { Context } from '@deepseek-ai/cordis'
import * as Superagent from 'ds-superagent'

const ctx = new Context()
await ctx.plugin(Superagent, {
  databasePath: '/var/lib/ds-superagent/private.sqlite',
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

## ds-bot Host factory

The existing `ds-bot` Host can consume the public Engine through the optional
`botExecutionAdapter` service. Load `ds-superagent/ds-bot-host` before `ds-bot`
and configure an absolute business database path; the plugin publishes the
adapter and closes it with its own Host effect.

```js
import * as DsBotHost from 'ds-superagent/ds-bot-host'

await ctx.plugin(DsBotHost, {
  databasePath: '/absolute/isolated/ds-bot-ui.sqlite',
  router: { provider, model },
  worker: { provider, model },
})
```

The factory creates one Engine per UI Session over one shared business store.
The Host's public `sessionPersistence` service owns the native Agent logs, so a
restart can resume the same Session. Without explicit routes, the factory reads
the profile's `agentDefaultModel` selection; a missing route or database path
fails at startup. A per-scope `dispose` stops Effects, shuts down the Engine and
closes the native Session adapter; the adapter refuses new work after close.

## The ds-superagent DSH profile

`ds-superagent/profile` is the standalone profile host. It reads `DSH_HOME`,
creates the business store at `<DSH_HOME>/core/state.sqlite`, publishes
`botExecutionAdapter`, and closes every Engine and native Session with the Host
effect. The app selects it with `DS_BOT_PROFILE=ds-superagent`; its DSH home is
`<app data>/superagent`, so the old `ds-bot` team and Sessions are not touched.

The bundle patch mounts `ds-superagent/profile`. The app then adds the existing
`ds-bot` chat UI as a later bundle and a small overlay that sets
`executionAdapterRequired: true`. The profile fails closed when the adapter,
database path or model route is missing.

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

## PostgreSQL business storage

`ds-superagent/postgres-storage` exports `PostgresStorage.open(options)`, which implements the same `Storage`/`AsyncTx` contract as SQLite, so `Engine` commands and queries run unchanged on PostgreSQL. Pass either an explicit `connectionString`, or `host`, `port`, `user`, `password`, `database` and `ssl`. `maxConnections` defaults to 8 (1–64), `lockTimeoutMs` to 1500 (1–60000) and `statementTimeoutMs` to 4000 (1–60000). Transactions use `READ COMMITTED`.

```js
import { Engine } from 'ds-superagent'
import { PostgresStorage } from 'ds-superagent/postgres-storage'

const storage = await PostgresStorage.open({ connectionString: process.env.SUPERAGENT_DATABASE_URL })
const engine = new Engine(storage, 'private', { sourceInstanceId: 'desktop-one', actorId: 'local-user', allowedActorIds: ['local-user'] })
```

Each transaction applies connection budgets, ensures its Instance coordinator row, then opens a `READ COMMITTED` transaction and takes `SELECT … FOR UPDATE` on that row before reading receipts/state or writing records. This is the fixed lock order: one Instance serializes, different Instances proceed independently. Explicit connection setup enforces the search path and budgets even when the connection string contains its own `options`. A `55P03` lock timeout is never reported as an accepted command, and command transactions contain no external side effects.

Errors are mapped as `40001 → SERIALIZATION_FAILURE`, `40P01 → DEADLOCK`, `55P03 → LOCK_TIMEOUT`, `57014 → STATEMENT_TIMEOUT`, `23505 → RECORD_EXISTS`, including server-confirmed failures at COMMIT. Errors thrown by the transaction callback itself are not server errors: `CoreError` and domain errors pass through unchanged, so a Session ownership or format error keeps its type. A lost COMMIT acknowledgement becomes `COMMIT_UNKNOWN`; command processing reconnects and looks up the original `commandId` under the same Instance lock. The whole database-only command retries serialization failures and deadlocks at most three attempts. Connection acquisition is bounded at 5000 ms; lock/statement budgets also cover initialization and the coordinator insert. The attempt limit is a count, not an elapsed-time deadline for arbitrary callback code. Transaction capabilities expire before COMMIT/ROLLBACK and cannot be used after the callback returns.

Schema version 1 consists of `ds_superagent_meta`, `ds_superagent_instances` and `ds_superagent_records` (`body jsonb`, with an identity `seq` for insertion order; `list` follows it, `scan` orders by `id` with byte collation). Versioned layouts, column types, nullability, identity and primary keys are checked on open. Unsupported or orphaned schemas are rejected with `UNSUPPORTED_SCHEMA`. A legacy `records(instance_id, kind, id, body text)` table upgrades only with an absolute `backupDirectory`: under an exclusive legacy-table lock, a logical backup is written, synced and compared in full, then the new tables, copy, old-table rename and version row commit together. Any failure rolls back and keeps the old table. To restore the backup into an empty isolated database, create the four legacy text NOT NULL columns, insert each backup record's `instance_id`, `kind`, `id`, and text `body`, then reopen with a backup directory to upgrade. This restores business records; it does not restore database permissions or external state.

The test suite runs a real embedded PostgreSQL 17 instance on loopback with `fsync=on` and `synchronous_commit=on`; that is an isolated contract harness, not a production deployment. Replication, failover, power-loss durability, TLS and connection-pool tuning are not covered. The same schema can also hold Session records under the separate `session-store` Instance namespace; Session persistence and business facts are still reported separately, and restoring the business database does not roll back Sessions or external side effects.

## Durable effects

Acceptance writes a Router notice and an acknowledgement Outbox intent in the same transaction as the work and command receipt. They remain pending until trusted deployment adapters are configured. Inspect them through `engine.effects.list(cursor?)`, `engine.effects.receipt(id, generation)` or the CLI `effects` action (`--after` accepts a returned cursor).

`Effects.enqueue(transaction, { key, stream, scope, payload })` and `Effects.cancel(transaction, identity)` compose with the public instance-scoped `AsyncTx`. The transaction also offers `replace`, `remove` and bounded `scan` with an exclusive ID cursor. `Storage.reconnect()` must return an independent connection implementing the same locking contract. Adapters for future backends must implement these operations together.

Configure `effects.handlers` in the Cordis plugin, or construct an `Effects` instance explicitly. Each `relay`, `notice` or `outbox` handler implements `execute(effect, { idempotencyKey, signal })` and optionally `reconcile` with the same arguments. Return `success`, or `transient`, `permanent`, `unknown`, `defer` with a public, non-sensitive reason. Only return `transient`/`defer` from execution when it is safe to try again. Throws, invalid responses, expired deadlines and interrupted running attempts require reconciliation; they never authorize blind replay. Unsuccessful reconciliation preserves unknown; only a query-confirmed `not-applied` result permits another execution under the original idempotency key and remaining attempt budget. Unknown outcomes without a reconciliation adapter remain visible and block their own ordered lane. The idempotency key contains the immutable row identity and payload generation. A confirmed completed key suppresses duplicate delivery; explicit cancellation permits recreation with a new identity.

Handlers run after the claim transaction commits. `start()` scans immediately and periodically; `wake()` only hints, and `drain()` permits explicit recovery. `stop()` clears the timer and waits for the current bounded adapter operation and its settlement. A scope is ordered independently in each stream, while other scopes remain eligible. Defaults: 1,000 queued effects (hard cap), three attempts (maximum ten), 1 s initial backoff capped at 60 s, 10 s adapter deadline, and 1 s scans. Enumeration reads at most ten pages of 100 effects; each claim rechecks earlier active operations under its write lock, within the same 1,000-record bound. Failed records retain reasons until explicitly cancelled. Outbox receipts additionally expose `pending`, `sent` or `dropped`; unknown never means sent. Adapters must honor cancellation and implement platform idempotency/query reconciliation; SQLite alone cannot guarantee exactly-once external delivery. Real GitHub and Feishu channels are provided by `GitHubCliTransport`, `FeishuOpenApi` and `FeishuDeliveryChannel`.

## Outbox purposes and delivery receipts

T18 makes each outgoing message a durable delivery record with a purpose, basis, destination, sequence and Effect identity. `engine.getTicketDeliveries(ticketId)` reports `pending`, `sent` or `dropped`, the bounded attempt count and a non-sensitive reason. The conversation projection hides dropped rows while the delivery query retains them as evidence.

Pass `delivery: { channel }` to the Cordis plugin, or the tenth `Engine` argument, to bind an external `DeliveryChannel`. Its `deliver(delivery, { idempotencyKey, signal })` returns `success`, `transient`, `permanent` or `unknown`; an `unknown` outcome is only retried through `reconcile` with the same key. `FeishuDeliveryChannel` replies in place to the Feishu message named by the delivery destination and reuses a SHA-256-derived `uuid` (32 characters) on retries and reconcile, matching Feishu's one-hour deduplication window. Without a channel, `localDeliveryChannel` treats the isolated local record as the receipt.

Before dispatch, the handler revalidates the purpose: an acknowledgement must match the accepted request and original message; an answer must name a current trusted human question with an explicit fact and return to that question; a result must match the current ready report and an unconstrained Ticket; an attention must still be the current waiting-human question. Ordinary progress has no outbox path, and one Ticket's stream keeps acknowledgement ahead of result.

## Assignment retry and recovery evidence

`engine.retryTicket({ commandId, ticketId, reason })` starts a fresh Assignment generation for the same Ticket, Worker Session and retained directory. The old generation ends first; the current ready report stops being current, while report history remains readable. `conversation(ticketId).recovery` returns the old/new Assignment identities, the requester, the reason and the four required checks: retained Session and directory, version-control state, external actions reconciled by original ID, and preserved stop/waiting-human/revoked authority.

A retry is refused while this runtime still has a live turn, while the Ticket is stopped or waiting for a human, while an Effect has an unknown external outcome, while preview cleanup is unconfirmed, or while the previous Assignment still has running/cancelling/unknown jobs or subagents. A blocked attempt still records `recovery-blocked` and `blockedWork`; replaying the command returns the same decision. Late job, subagent, report and Effect callbacks remain tied to the Assignment ID and generation that produced them.

## Host lease and writer fencing

T20 wraps every business transaction in a durable instance lease. A Host acquires a monotonically increasing epoch with a non-reusable token, renews it on each guarded transaction, and releases it on `shutdown()`. An unexpired lease held by another Host rejects reads, writes, stop commands and Outbox settlement with `HOST_LEASED`. An expired lease still requires an explicit `engine.acquireHost()` before a new Host gets the next epoch; merely losing contact never grants write authority.

The default Host identity is stable per machine, but the lease is owned by a process: another process, even on the same machine and with the same `hostId`, never renews a live lease and gets `HOST_LEASED` until that lease expires or is released. Deployments that run two independent Hosts should still configure distinct `host.hostId` values. `engine.getHostLease()` exposes the epoch, token, acquisition/renewal and expiry facts. Session persistence keeps its own writer epoch, and assignment callbacks still verify Assignment ID and generation; the business database lock is never treated as proof that a device process has stopped.

`apply()` acquires the lease at startup, so the plugin, the CLI and the app boot as a Host instead of borrowing authority. `engine.acquireHost()` also takes over the work left by the Host it replaced. The new epoch and a pending `host-takeover` record commit together; until every Ticket is reconciled, new submissions, accepted source work, Attention answers, resumes and retries fail with `HOST_TAKEOVER_PENDING`. A lease released by a clean stop resumes the next epoch without a takeover; a lapsed, unreleased lease is treated as a possibly live replacement and is reconciled. The old Host, including a resurrected process, stays fenced by its lease token. Reconciliation inspects device ranges and remote jobs by their original IDs, preserves stops, human questions and revoked authority, adopts a live device range by its stable job ID, and ends the old Assignment before creating a successor with a recovery note. Unprovable external work becomes a waiting-human question instead of a successor. `engine.getHostTakeover()` returns the per-Ticket outcome and blocker evidence for the current epoch.

## Authenticated client access

T45 adds a dedicated authenticated entry for a desktop client. `engine.createClientAccess()` creates the store on this Engine's Host-fenced storage. `ClientAccess.enroll({ commandId, label, grants })` returns a `sc1.<clientId>.<secret>` credential once; only its SHA-256 is persisted. A grant names the serving Instance and explicit `read` and/or `command` capabilities; another Instance is rejected instead of creating an inert grant. Replaying the enrollment command returns the same client without the secret, while a revocation is visible to the next request without a reconnect.

`createClientGateway(engine, access, { host, port, tls })` serves `/instances/<instanceId>/state`, `events`, `tickets/:id`, `conversations/:id` and `receipts/:id` to `read` clients, and `commands/{submit,answer,stop,resume,retry,status}` to `command` clients. A loopback listener may use HTTP; any non-loopback bind requires TLS key and certificate or fails with `TRANSPORT_INSECURE`. There are no device, background-job, preview, subagent or Worker-tool routes, so a client grant does not widen execution authority.

The event journal stores each state snapshot, Attention transition and result under a stable content key. Attention and result events are projected from the durable histories, so a client that was offline through more than one result still receives every missed result. `events?after=<cursor>&limit=<1-500>` returns an exclusive-cursor page, so a disconnected client catches up once without re-running a command; a successfully committed command records one receipt even when its HTTP response was lost. The loopback chat server may be given `{ clients }` to expose the trusted local `GET /clients`, `POST /clients` and `POST /clients/revoke` administration routes. Those routes are not the public client API. The current protocol is polling-based; journal keys have no reclamation policy yet, and the real desktop-to-isolated-Host combination remains part of T55.

## Independent Watchdog

T47 adds an operational loop outside the Host: `Watchdog` (`ds-superagent/watchdog`) takes a `WatchdogHost` adapter, probes the service, classifies what it sees, and records every inspection in the durable `watchdog-state` record. The default interval is one hour; each inspection makes at most one restart attempt.

```js
import { Watchdog } from 'ds-superagent/watchdog'

const watchdog = new Watchdog({
  instanceId, storage, host, intervalMs: 3_600_000, graceMs: 300_000,
  notify: notification => deliverToOperator(notification),
})
watchdog.start()
```

The classification is deliberately narrow:

| Observation | Action |
| --- | --- |
| The service is healthy, paused, reconciling a takeover, or has Tickets waiting for a person/device/external condition | None; normal waiting is not a failure. |
| A source is `failed`, an unknown external effect exists, or setup is missing/failed | No restart. Notify once per unchanged error and record the component/setup facts. |
| The service itself is unreachable or its process is gone | Stop the Host gracefully, wait up to the grace period (default five minutes), start a replacement, and probe again. A successful recovery is silent. |
| The Host did not stop in time, did not start, or is still unhealthy | Do not force-kill and do not loop. Escalate to a person with the action and result recorded. |
| More than `maxRestarts` (default 3) in `restartWindowMs` (default 6 h) | Stop restarting and escalate once; the budget is part of every inspection record. |

`WatchdogHost.start()` is required to acquire the Host lease and finish the replacement takeover before it resolves, so the Watchdog never resumes stopped work, a pause, a revocation, or an unknown effect itself: the Host's fencing/takeover path (T44) owns that reconciliation. The Watchdog only asks, waits, and records. Notifications are deduplicated by the unchanged error fingerprint and cleared after health, a normal wait, or a successful recovery; health and recovery therefore stay quiet.

`ProcessWatchdogHost` (`ds-superagent/watchdog-process`) supervises a real child process. The child writes an atomic status file (PID, timestamp, epoch, sources, setups, normal waits, takeover/pause facts) and listens for one IPC `shutdown` message. A status older than `staleMs` or a dead PID is a service failure. The adapter never sends a force kill: if the child does not exit within the grace period, `stop()` returns `timeout` and the Watchdog escalates. `dispose()` exists only for test/rehearsal cleanup.

The CLI entry is `ds-superagent-watchdog` (`node dist/watchdog-cli.js`):

```sh
node dist/watchdog-cli.js \
  --database /absolute/path/state.sqlite --instance private \
  --status /absolute/path/host-status.json \
  --host-command node --host-arg /absolute/path/host.mjs \
  --host-arg --status --host-arg /absolute/path/host-status.json
```

It runs the loop at the declared interval (default one hour); `--once` is a diagnostic inspection that stops the Host it started after a recovery. The Host entry is deployment-specific: it must mount the public Engine, write the status file and listen for the IPC `shutdown` message, as `dev/t47-host.mjs` does.

`node dev/t47-acceptance.mjs` runs the Windows native rehearsal twice: a local SQLite Host and a hosted PostgreSQL Host (embedded PostgreSQL, shared business backend). Each Host is killed, the Watchdog records a healthy inspection, restarts the Host through the lease/takeover path, and the new epoch reconciles the seeded running Assignment through the native `Execution` takeover. The 2026-11-11 Windows 11 / Node 24.22.2 run recorded for both recipes: epoch 1 → 2, `takeover.state: completed`, one Ticket with `resumed` outcome, budget `1/2`, and no notification because the recovery was clean.

The Watchdog is not the semantic supervisor of T48: it does not judge whether the work is making progress or propose changing a goal. Those proposals need their own evidence and human approval. A Host that the Watchdog did not start needs a deployment-specific `WatchdogHost` control adapter; `ProcessWatchdogHost` deliberately reports `timeout` rather than signalling a process it cannot ask gracefully.

## Semantic supervision

T48 adds `engine.createSupervisor()` (`ds-superagent/supervisor`). One inspection compares the Ticket's request, Mandate, reports, tool facts, delivery state, direction version and job/subagent facts; it does not judge a process by liveness or elapsed time alone. The `SupervisorSnapshot` and every proposal keep the full observation, recommendation, impact and version.

```js
import { createSessionAssessor } from 'ds-superagent/supervisor-session'

const supervisor = engine.createSupervisor({
  assess: createSessionAssessor(sessions, { sessionId: 'supervisor-private', version: 'prompt-v1' }),
  stallMs: 30 * 60_000, stallObservations: 3, version: 'supervisor-r1',
})
const report = await supervisor.inspect()
```

The deterministic findings are:

| Observation | Finding |
| --- | --- |
| attention waiting, device/external wait, stop, paused, ready or ended | `normal-wait`/`ready`/`ended`; no assessment and no proposal |
| unknown effects/jobs | `unknown`; call the existing `reconcileRemoteWork` (or `reconcileStop` while stopping) first |
| the same progress fingerprint for the configured observations/time | `no-progress` |
| the same tool-fact fingerprint repeating | `loop` |
| the independent Session judges the work has drifted | `deviation` |

`createSessionAssessor` uses a stable Session id separate from the Router and every Worker, the public DSH Agent loop, one `record_supervision` tool, and no work, Router, delivery, approval, device or configuration tools. The assessment records its model route and prompt/config version. A real model endpoint is deployment configuration; the tests use the mock model and do not claim real-model judgment quality.

Proposals are durable `supervisor-proposal` facts and are shown as `supervisorProposals` on each `getSupervision()` item while proposed. One proposal is open per Ticket, unchanged evidence is deduplicated, and the default budget is two proposals per six hours. `supervisor.inspect()` never pauses, stops, edits or retries anything. `supervisor.decide({ commandId, proposalId, decision, reason })` claims the proposal atomically, then:

- an approved `pause` calls the existing `engine.stopTicket`; this is a stop, not a reversible pause, and the impact says an explicit resume is required;
- an approved `correct` calls `engine.correctTicket`, which adds one authorized direction input (`supervisor-correction`) for the Worker; the Supervisor executes no tool and does not change the Mandate;
- a rejection records the decision and reason and executes nothing.

The decision command has a stable fingerprint and a `deciding` claim, so a reused command ID across proposals is rejected and concurrent approvals execute one action. The action's result or error is stored on the proposal; replaying the same command ID returns the original decision.

The Supervisor does not change roles, prompts, models, policies or permissions. Those versioned configuration changes belong to T49. The default tests cover deterministic normal-wait/loop/no-progress/deviation, budgets, dedupe, unknown reconciliation, the real direction input, and approval/rejection; `test/supervisor-session.test.mjs` runs the independent Session through the real DSH Agent loop with the mock model.

## Trusted behavior configuration

T49 lets an explicitly authorized maintainer change versioned prompts and trigger rules through `engine.updateBehaviorFromInstruction({ commandId, instruction, expectedRoleRevision?, expectedPolicyRevision?, signal? }, interpreter)`. The authoring permission is `DesktopSource.authoringActorIds`, a subset of `allowedActorIds`. When it is configured, the direct `updateRoleConfig` and `updateIntakePolicy` settings paths require the same actor too; `origin: 'sync'` is the system-sync exception. Source text has no path into this command.

The interpreter is constrained before the Engine applies anything:

| Target | Allowed | Fixed |
| --- | --- | --- |
| Roles | prompt instructions and skills | role names, provider/model routes, tools and permissions |
| Policy | intake `mode` and trigger `rules` | budgets, requester/bot allowlists, self actor ids and the assessor |

Router prompts must keep `{{goal}}`; Worker prompts must keep `{{goal}}` and `{{constraints}}`; the complete roles JSON is at most 64 KiB and individual names/instructions/skills reuse the `validateRoleConfig` limits. Policy changes are merged into the current policy and validated with `validateIntakePolicy`. Unknown fields, tools, allowlists, budgets, devices, publication rights, stop/pause/resume and config-write keys are rejected.

`createSessionConfigInterpreter(sessions, { sessionId, version })` runs an independent Session through the public DSH Agent loop with one `propose_behavior_change` tool; it records at most one change per instruction, records the current route from `sessions.getRoutes().router`, and has no work, Router, approval, device or config-write tools.

Each instruction is a durable `behavior-instruction` record with the original request, fingerprint, expected revisions, complete change, summary, interpreter version/model, effective role/policy revision and status. The lifecycle is `interpreting` → `applying` → `applied`/`conflict`/`failed`; a crash after interpretation resumes the stored change instead of re-interpreting, and action command IDs are idempotent. The settings CAS is rechecked inside the commit transaction; role changes use the T23 request boundary and `role-config-use` records, while policy changes use the T25 in-flight Eval invalidation and live Ticket notices.

A revision conflict stores one `config-draft` per instruction with the pending change and current revisions; it never overwrites the newer configuration, and replaying the same instruction does not duplicate the draft. Drafts are queried with `getConfigDraft`/`listConfigDrafts`; reapplying is an explicit new revision, not an automatic replay.

The config command never cancels a human stop, grants a device or publication permission, or gives the Watchdog/Supervisor a write path. There is no chat/settings UI or remote authoring route in this ticket; the public Engine command is the entry point. The tests use deterministic/injected interpreters and the mock Session; no real-model endpoint sample was run.

## Legacy read-only archive

T50 adds `ds-superagent/legacy-archive`: an opt-in migration importer for a legacy DS Bot home (`bot/state.json`, `sessions`, `memory`, and optional workspace and attachment data). It reads the source, never writes it, and never starts an old Agent or creates a new Ticket queue. The source and target must be separate absolute paths and the target must be empty or an existing archive store.

```js
import { prepareLegacyArchive, verifyLegacyArchive, publishLegacyArchive } from 'ds-superagent/legacy-archive'

await prepareLegacyArchive({ source, target, batchId, sourceIdentity, profile, mapping })
await verifyLegacyArchive(target, batchId)
await publishLegacyArchive(target, batchId)
```

`prepareLegacyArchive` writes `.staging/<batchId>` and a `manifest.json`; nothing is visible in `archives/` until `publish`. The manifest records the source path/identity/profile, source digest and state revision, batch ID, mapping/digest, summary counts, Session checksums, commands, and review items. The same batch is idempotent while source and mapping are unchanged; changed content is `ARCHIVE_CONFLICT`. A batch ID, role ID or Session ID that could escape a path is rejected.

Session logs are checked for the known `session.v<version>.jsonl[.zstd|.zst|.gz|.br]` format, version, decompression, JSON, and contiguous `seq`. Missing, newer, malformed, or gapped history leaves the archive `invalid` and un-publishable. `verify` rehashes staging and recomputes the source digest; `publish` verifies again before the atomic rename. A tampered staging copy, a source changed after prepare, or an existing target is not published.

The explicit `mapping.roles` prepares role records from reviewed Bot fields; role names/models remain archive facts, `permissions` is empty, `sourceMainBot` is only evidence, and `readOnly` is true. `mapping.sharedMemory` selects `team`/`group:<roomId>` scopes; all archived memory stays historical, but `readLegacyObject` marks mapped memory `shared: true` and private memory `shared: false`. `bot/workspace` and `attachments` are opt-in through `include`, so the default archive follows D18's team/group/memory/Session scope.

Old `works`, `requests`, `questions`, live `agents`, and `inflight.json` are review items, not new work. Unfinished, stopped, and unknown work is listed for a person; completed work and old refs remain readable through `work:`, `request:`, `question:`, `agent:`, `inflight:`, `bot:`, `room:`, `role:`, `review:`, `memory:`, `session:`, `file:`, and `attachment:` references. There is no old agent loop, no Main Bot authority, and no new queue.

Credentials (`.credentials.yaml`/`.env`) and raw profile patches are not copied. The archive has bounded file/byte limits and is local-file based; the Engine does not import it automatically. The tests use fictional isolated legacy homes, including cancellation, retry, missing/newer/zstd history, and source-digest invariance; no user DSH data is used. T51 prepares quiescence and the gap buffer; T52 activates the current entry; T53 provides abandon and reverse handoff.

## Switchover preparation and gap intake

T51 adds `ds-superagent/switchover`: the preparation half of a migration, not activation. `Switchover.begin` requires a published T50 archive and the current, unexpired Host lease epoch. It records `quiescing`, asks the caller's `LegacyCore` to stop old consumption and to persistently disable the old restart entry, then binds the old intake's loopback port itself. A lock inside the old home is recorded as evidence only (`usedAsFence: false`); the actual port bind rejects an old process that never learned the new lock. If the bind or restart-disable proof is missing, the record stays `quiescing` with a blocker.

`quiesced` also needs two old-core snapshots separated by a bounded settle window. Active turns, jobs and pending outbound must be empty; increments must be zero; every source cursor must be complete; acceptance receipts must not be pending or unknown; and the two snapshots must have the same digest. A later recheck that sees a new increment, a changed source revision or an unreachable restart entry downgrades the record back to `quiescing`.

The isolated intake speaks newline-delimited JSON and acknowledges only after SQLite commit. A stable ID is derived from the source instance, thread, object and native version. Inputs become `held` for T52, `legacy-accepted` when the old receipt already accepted them, or `quarantined` when the identity, cursor or receipt is missing or unreliable. The final snapshot is re-read against every buffered input: a receipt must exist in old facts; a held input that old actually accepted becomes `legacy-accepted`; a claimed acceptance without old evidence, an incomparable receipt cursor or an uncovered cursor is quarantined. Nothing in this module creates a Ticket, Assignment, Effect or old Agent loop.

`Switchover` exposes `begin`, `recheck`, `status`, `ingestGapInput`, `listGapInputs`, `getGapInput` and `close`. `LegacyCore` (`stop`, `disableRestart`, `restartDisabled`, `snapshot`) is supplied by the host for its real old process/service. The tests run a fictional old launcher/receiver and a separate new runner over real TCP and SQLite: the old launcher is renamed on quiesce, the new runner survives SIGKILL and rebinds the same port, buffered ownership is recovered, old receipts are not replayed, and the new database still has zero Tickets and Effects. T52 owns activation and buffer release; T53 owns abandon and reverse handoff.

## Activation and the current entry

T52 adds `ds-superagent/activation`. `Activation.activate` runs the T51 final recheck and then, in one command transaction, writes the activation manifest (`currentCore: ds-superagent`, batch, new Host epoch, switchover/archive digests, final checkpoints and gap counts), an `activation-command` receipt, activation history, the per-gap release ledger, and switches the `switchover` record to `active`. It refuses a batch that is not quiesced, whose archive/host epoch changed, or whose gap buffer changed after the final recheck. A COMMIT whose response is lost is reconciled by the original activation command ID.

`Activation.gate()` checks the active manifest and the current Host lease, including its owner process token. `engine.setActivationGate(gate)` makes `receiveSource`, source assessment, every acceptance path and `Effects.enqueue` fail with `CORE_NOT_ACTIVE` until activation; a replay of an existing command receipt still returns the original result. The plugin accepts `activationGate` in its config and installs it in `apply`.

Activation releases only `held` gap input, with the stable command `release:<activationId>:<gapId>`. Legacy-accepted and quarantined inputs become `skipped` and never become new work. Each release is claimed once per call, unknown outcomes remain visible, and bounded retries reuse the same release command; a successful release also marks the original `switchover` gap record `released`/`released-to-current-entry`. The process drill stops a real old receiver and launcher, commits activation in a child process that exits after its external acceptance, and shows the parent cannot release under another process's lease. The isolated Engine test reads the old review through the archive, creates a new Session for post-activation work and keeps a manual stop. Cross-process holder takeover and real Electron application data remain T55; T53 owns reverse handoff.

## Abandonment and reverse handoff

T53 adds `ds-superagent/reversal`. Before activation, `Reversal.abandon` re-runs the final quiescence check, scans every gap input, and leaves the old entry disabled when any held or quarantined ownership needs review. Only a gap empty of review items lets it mark the `switchover` record `abandoned`, release the entry and call the old launcher's `enableRestart`; the command is idempotent and does not touch the archive, another batch or the source.

After activation, `Reversal.reverse` changes the activation record to `stopping` immediately, so the Engine gate rejects new receive/accept/Effect writes. The caller's `ReverseControl.stopAndSnapshot()` then stops new turns, jobs and outbound and returns durable evidence: active work, unknown effects/jobs, pending receipts, manual stops and old-core compatibility. Any unresolved item keeps the record `blocked`; a clear snapshot becomes `ready`. A newer Host epoch may resume the same reverse command, and an interrupted stop is retried without a second external effect. `completeReverse` rechecks the current Host owner/epoch and old-core compatibility before calling `enableRestart`; it then marks the activation `reversed` and the switchover `abandoned`. The old queue is never replayed by this path.

The tests cover a held-quarantine abandon blocker, another published archive surviving an abandon, a real Engine outbound backlog blocking reverse, unknown effects and compatibility blockers, interrupted reverse resumption, a newer Host epoch, and a real invalid old launcher drill. The process test releases a real held gap into the new core, exits a reverse child after its stop marker, resumes under a newer Host, reopens the real old launcher and verifies the old receipts stay empty and the source state is unchanged.

## Collaboration load comparison

T54 adds `dev/collaboration-bench.mjs`, a fixed mock workload (`seed=20261111`, 6 initial requests, 6 same-thread follow-ups, 20 ms Worker turns, Router batch limit 20, 2 normal + 1 priority slot) that runs the same stream as one Native Session, as independent Router/Worker tickets, and as a subscribed Ticket with direct follow-ups. It reports acceptance/response p50/p95, Router calls and batches, Worker calls, direct-follow-up ratio, notifications, duplicate replay, and state reopen in JSON. The captured result is `docs/superagent/implementation/t54-bench.json`; it is a development measurement, not a product SLA.

The mock reports no token usage; the run records that explicitly instead of inventing tokens. The budget table in `docs/superagent/implementation/t54.md` compares the declared Effects/slots/jobs/subagents/Input/Host/Watchdog/Supervisor/switchover/activation/PostgreSQL/SQLite budgets with historical evidence. Real-model token/latency, remote and managed Hosts, proactive/supervisor reruns, unknown outcomes and crash recovery remain explicitly unverified in this ticket.

## Context cards and bounded reads

T21 adds `engine.readContext({ ticketId, ref, after?, maxBytes? })`. A card carries a stable reference, title, short summary, one UTF-8 byte page, facts, a pagination cursor and the next reachable references. Supported references are the Ticket, its trigger, decision, mandate, current or historical report, current or historical Attention, one delivery, one reachable source event, or the history of one reachable source object/thread.

Pages default to 4 KiB and are capped at 16 KiB. `pagination.truncated` is explicit, and concatenating pages through the returned cursor reconstructs the full text. Reads are limited to the Ticket's own facts and to source events from its original Thread or a legal subscription; guessing another Thread's event or paging through it is rejected. The `read_context` Worker tool uses the same contract, so a Worker can read the original request instead of trusting a Router summary. The local preview exposes the same query at `/context` and has a “Read original request” action in its evidence panel.

## Context rollover

T22 treats a Worker turn whose DSH `turn/end` reason is `max-tokens` as context exhaustion. The live turn builds a DSH fork seed from the Session prefix, records a `session-rollover` with the old/new Session and Assignment, goal, Mandate, constraints, unread Inputs and evidence references, ends the old Assignment, and starts a new Session generation with an explicit handoff prompt. The old Session remains readable through `engine.getSessionHistory(sessionId, { after, limit })`.

If the process exits before the handoff relay runs, startup scans `context-rollover` intents and requeues the handoff for the current Assignment. A late event from the old Assignment still cannot wake the new generation. If the live fork cannot be built, the new Session starts without inherited history but keeps the same explicit goal/constraint/input handoff.

## Versioned role configuration

T23 adds `engine.getRoleConfig()` and `engine.updateRoleConfig({ commandId, expectedRevision, roles })`. The persisted configuration has Router and Worker profiles, each with a name, provider/model route, instructions and a bounded skill list. Saves use a revision CAS: a stale revision is rejected, a replayed command returns its original revision, and invalid keys, unknown placeholders, duplicate/reserved skills or oversized text are rejected instead of truncated.

Routes apply to the next real Router or Worker request; an in-flight Agent keeps its own options. Worker and Router requests write `role-config-use` records with the Session, role, revision and both routes, and `engine.getRoleConfigUses(sessionId)` exposes them. Allowed instruction placeholders are `{{goal}}`, `{{constraints}}` and `{{evidence}}`. Instructions and skills become role prompt text only: they never add tools, widen a Mandate, change an Environment or grant device access.

`updateRoleConfig(..., { verify })` may run an asynchronous model/account check first. The save still uses the in-transaction `expectedRevision` CAS, so a newer save during verification wins and the older checked result is rejected with `CONFIG_REVISION_CONFLICT`.

## Supervision read model

`engine.getSupervision()` rebuilds a risk-ordered view from public facts: waiting-human first, then unknown effects/jobs or failed setup, then stopping/stopped, ready, running/pending and ended. Every item carries the next action, the trigger/Decision/Mandate/Assignment/report/Attention/stop identities behind it, current message receipts and per-part health. An unknown effect or old job marks only its own Ticket blocked.

The local preview serves the same data at `/supervision` and renders a “Needs you” panel with answer, stop, resume, setup retry and Assignment retry. Same-origin `/requeue`, `/unsubscribe` and `/dismiss-eval` expose the authorized manual re-evaluation, subscription removal and unavailable-Eval dismissal paths. A refresh only rereads durable facts; it does not resend a command.

## External source adapters

`SourceKind` now covers `desktop`, `github`, `feishu` and `schedule`. A source can scope dynamic Threads with `allowedThreadPrefixes` instead of a fixed `allowedThreadIds` list.

`GitHubSource` maps issues, pull requests, reviews, CI and comments to stable repo/number Threads, filters the source's own messages, and advances a durable `channel-cursor` only after `receiveSource` records each event. `FeishuSource` does the same for tenant/chat/message identities, marks p2p messages as direct, group mentions as `mention` and other group discussion as `ambient`, and treats an edit as a new native version only when Feishu reported an update time. Both reject another repo, tenant or chat scope and keep equal numbers/user IDs isolated by source instance.

`ScheduleSource` has a stable rule ID, timezone, interval, persistent `schedule-state` and occurrence IDs derived from the rule's local wall clock. Rules are revisioned: interval, text or catch-up changes create a new revision, a timezone change is refused, and `ruleHistory()` plus per-occurrence evidence are queryable with cursors. Replaying a tick produces no duplicate; missed windows follow `skip`, `once` or bounded `all` catch-up, skip local times a DST gap removed, and never fire a repeated local hour twice. Pausing still records due occurrences for later evaluation, and authorized `system` occurrences still pass the normal intake Gate.

`GitHubPoller` and `FeishuPoller` run setup before reception, keep per-source health (`setup`/`polling`/`failed`/`stopped`) and a durable cursor. A failed pass reports its own source error and does not advance the cursor; `stop()` aborts and awaits the current pass. `GitHubPoller` can use the real authenticated `gh api` transport; `FeishuPoller` can use `FeishuOpenApi`, which caches a tenant token, refreshes it once on an invalid-token response, pages chat message history and lists chat members. `ScheduleRunner` ticks immediately and then on its interval, and clears its timer on stop.

A poll separates malformed/out-of-scope items (counted as `malformed` and skipped with the cursor advanced) from a recording failure (counted as `failedItems`, page stop, cursor retained). Poller health exposes both counters so one source's bad item does not become an instance-wide failure.

`syncSourceMembers` stores a Feishu source's native member snapshot under a strictly increasing revision, isolated by source instance. Older/equal revisions are refused, commands replay without duplication, and the history is queryable. Applying a sync to an Intake Policy remains a trusted deployment step.

GitHub's isolated repository acceptance (T25–T27), a real isolated scheduled run (T28), a real-model proactive sample (T29), the Feishu OpenAPI transport with protocol fixtures (T30) and the in-place Feishu answer flow with protocol/end-to-end fixtures (T31) are recorded. A real Feishu tenant/group run remains outstanding and was deferred by the maintainer.

T57 adds `dev/t57-env-check.mjs`, `dev/t57-model-acceptance.mjs` and a real-model mode for `dev/github-acceptance.mjs`. The environment check verifies a real model request, the test repository's write permission and the configured Feishu tenant/chats without printing credentials; missing Feishu settings are `unverified`, not passed. The model sample drives the real public DSH loop through a bounded OpenAI-compatible `LlmAdapter` and covers cross-channel intent, scope/injection resistance, a Supervisor semantic probe and a trusted configuration instruction. The GitHub run uses the real model for Router/Worker, a real check run and the existing real GitHub delivery channel with a read-back native receipt. The 2026-11-12 run passed model and GitHub; Feishu remains unverified because no tenant/chat credentials were configured.

## P/R delivery conditions and destination changes

`bindDeliveryCondition` ties one or more P/R conditions to a Ticket. A ready result can be delivered, but while any condition is `open` or `draft` the Ticket stays open and `conversation.deliveryPending` is true. `reconcileDeliveryCondition` advances the condition from received source text (`merged`/`closed`/`open`) and retains its result and evidence. Multiple P/Rs are independent; a pending follow-up Input also delays final completion.

`setDeliveryTarget` records an authorized actor's new result/answer destination, the target source/thread/object and evidence in `delivery-target-decision`. The result Outbox uses that target and keeps confirmations, questions and answers on their own messages. A target change from another source instance is rejected; without a recorded target the original request destination still applies.
An optional `evidenceEventId` is checked in the same store: the event must exist and its source instance, Thread and object must match the named target. A named but mismatched target is refused.

These are core behaviors only: the isolated real-repository create/review/merge path and a real desktop→GitHub A→B scenario are not yet verified.

`findContextCandidates(ticketId, text, limit?)` returns bounded token-overlap candidates only from Threads already reachable by that Ticket. It returns references and snippets; it never creates a subscription, routes work or merges similar topics.

## Proactive rules

`updateProactiveRules` stores revisioned observe/auto rules with actor/addressing/text matching, communication mode, an optional scope and a per-window run budget. Observe records `proactive-run` only. Auto acts only on the current recorded source event, suppresses repeated bot/CI text and ambient noise, reserves budget in a transaction, and prepares in an isolated directory outside that transaction through an injected callback; authorized system schedule occurrences can prepare. A useful summary is `prepared` with artifacts verified for containment, size, SHA-256 and a byte budget inside the isolated directory; no useful result is `silent`; errors/timeouts are `failed`; exhausted budget is visible and does not widen authority. Preparation never creates an Outbox, PR, message or merge permission. Pausing global processing skips evaluation.

Real-model intent/scope quality, false-trigger and effective-delivery samples remain outstanding.

Run `npm run build` then `node dev/effects.mjs` for the isolated 100-notice workload. It reports enqueue latency and scan time, closes storage and removes its temporary database. Restore upgrade backups only while the isolated Host is stopped, and reconcile external actions before resuming; restoring a database does not undo an external action. Session backups and recovery belong to the Session persistence tickets.

This internal package is licensed Apache-2.0 as part of the repository. Its implementation is original and imports public DSH and Node APIs. It does not copy code or text from the research prototype. Remote PTY/process-tree cleanup, PostgreSQL and the later device handoff tickets remain outstanding.

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

T03 binds an explicit `LocalEnvironment` to an Instance, Actor, absolute root, permission set and fixed command map. The environment mounts DSH's public `dsh-fs-local` and `dsh-subprocess-local` providers, so file reads/writes, search and configured commands use the same execution world. Model tools are `write_file`, `read_file`, `glob`, `grep` and `run_command`; the last accepts a configured name only. With T37's `assetsPath`/`skillsPath`, the same Worker also gets `save_attachment`, `read_asset` and `list_skills`; no unsupported asset tool is advertised. Arbitrary argv, shell text, PTY, remote process trees and unverified tool combinations are rejected; the only background execution is the configured `start_command` below.

The Worker receives the bound working directory through the native Agent Session, writes and verifies files, and must run a configured verification command after the final write before submitting ready. It then lists relative artifact paths; the engine stores current byte count and SHA-256 plus bounded tool facts. Local tools are sealed after report submission, preventing a late mutation from leaving a stale ready hash. Command cancellation waits for the provider-managed range to exit. Lossy output is withheld entirely; short output is sanitized before it enters facts or the UI. A setup failure keeps its bounded exit facts visible and waits for an explicit retry against the same physical root.

`node dev/local-chat.mjs` starts a loopback preview with a temporary project directory and a scripted model. Select `sample-project`, ask `Create answer.txt containing hello, then verify it.`, and expand the result evidence. The preview writes a real file, searches it, runs the configured Node command, and shows the SHA-256 and each tool fact. Browser evidence uses an isolated context and no credentials; it demonstrates local execution through native DSH loops and does not claim a real-model or remote-device run. T03's full recovery, remote job, device fencing and host replacement behavior remains assigned to later tickets.

## Paired remote file, search and command execution

T32 adds a second `ExecutionEnvironment` kind. `RemoteDevice` runs on the device with one explicit absolute root and an explicit grant for each `(instanceId, environmentId, allowedActorIds, permissions)` tuple. It exposes `read`, `write` and `search`; T33 adds `command` when the operator configures named commands and a durable jobs path. It does not run a Router, Worker, DSH Session, business store or Outbox there.

Pairing uses a one-time eight-digit device code, an X25519 host key, an Ed25519 device signature and a pinned device-key fingerprint. The signature binds the transcript, device exchange key and sealed pairing payload; the host must pass `expectedDeviceId` and `expectedDeviceKey`, and the device rejects a mismatched grant. After pairing, every RPC payload is AES-256-GCM encrypted and authenticated with a key derived from the two X25519 keys and the pairing transcript. Requests are bounded by a one-minute clock window and a replay set. The device re-reads its current grants on every RPC, so removing or narrowing a grant applies to existing pairings. Neither API logs the pairing code or a credential.

```js
const device = await RemoteDevice.open({ deviceId: 'device-two', root: '/srv/work',
  jobsPath: '/var/lib/superagent/device-jobs',
  commands: {
    verify: { argv: ['node', 'scripts/verify.mjs'], timeoutMs: 5000, backgroundTimeoutMs: 300000 },
  },
  grants: [{ instanceId: 'private', environmentId: 'remote-project', allowedActorIds: ['local-user'],
    permissions: ['read', 'write', 'search', 'command'] }], statePath: '/var/lib/superagent/device-state.json' })
const endpoint = await device.start()

const environment = await RemoteEnvironment.pair({ id: 'remote-project', instanceId: 'private',
  allowedActorIds: ['local-user'], permissions: ['read', 'write', 'search', 'command'], endpoint,
  pairingCode: codeReadOutOfBand, expectedDeviceId: device.deviceId,
  expectedDeviceKey: device.deviceKeyFingerprint })
const engine = new Engine(storage, 'private', source, {}, sessions, [environment])
```

An Assignment fixes the remote Environment before the Worker turn. `conversation(ticketId).assignments[0].environment` and `executionLocation` expose `kind: remote`, the device ID, incarnation and device root. The Worker receives only the permissions granted to that Environment. Without `command` it has no `run_command`, background job or subagent tools; with `command` and configured names it gets `run_command`, `start_command`, `job_status`, `keep_preview` and `cancel_job`. Paths are resolved on the device, and `glob`/`grep` return relative paths, line numbers and text. A remote ready report requires a successful post-write command when command capability exists; otherwise it requires a successful post-write `read_file` or `grep`.

The device resolves the executable itself; the host never sends a target key, file target or local executable path as the program. Job identity is `job:<instanceId>:<environmentId>:<deviceIncarnation>:<uuid>`. The device rejects the same job ID with different parameters, and a lost start response is reconciled by inspecting that ID rather than starting the command again. Each job keeps a bounded 8192-byte stdout/stderr window readable by byte offset without consuming it; reads stop on UTF-8 boundaries and report `lossy` when the retained tail moved. Terminal records and their output survive a device daemon restart; a record that was still running when the daemon died becomes `unknown` instead of pretending the process is still observable. `terminate()` records `stopping`, signals the actual child and reports `cancelled` only after that child exits.

`RemoteBoundEnvironment.spawnCommand(name)` returns a synchronous public `RemoteJobHandle` with `done`, `terminate()`, `waitForExit()`, and offset-based `collected.stdout`/`stderr` readers. `startCommand(name)` exposes the same job as a Worker `LocalJob`; `attachCommand(jobId)` resumes observation from a new paired host. Foreground commands use the configured 50–10000 ms deadline; background commands use the configured background deadline (at most one hour). The device retains at most 64 job records and requires both `jobsPath` and `statePath` whenever commands are configured, so a restart retains the device incarnation and pairing.

T34 adds real PTY commands (`pty: true`). `spawnTerminal({ name, rows, cols })` returns a public `RemoteTerminalHandle` with an output stream, write/resize/signal operations and an awaited terminate; foreground/activity inspection is explicitly `undefined`/`unknown` when the device cannot prove it. Commands and terminals now expose top-level exit separately from managed-range quiet. On POSIX the device starts a separate process group and only marks `settled` after the group is gone; Windows uses `taskkill /T` with the weaker ConPTY boundary stated in the implementation record.

Remote stops persist `stopping` with `pendingDeviceConfirmation`. `inspectRange(jobId)`/`cancelRange(jobId)` query the original device range, and `Engine.reconcileStop` clears the pending flag only from a settled `exited`/`cancelled` snapshot or a settled recovery whose `rangeAlive` is `gone`. An offline stop still enforces the Ticket stop constraint immediately; reconnect cannot silently resume or report cancellation without device evidence.

T35 makes daemon restart a distinct, evidence-bearing recovery. The device job file records owner, working-directory identity, PID/process identity, original deadline, bounded output and recent recovery entries. A restarted daemon classifies a previously running job as `live-process` only when the POSIX start time and process group still identify the same range; a match restores bounded control and deadline enforcement, while `log-only` keeps the durable output and an unknown exit. PID-only platforms observe but never signal an unverifiable process. Host `JobRecord.remote` carries the same evidence, `Engine.reconcileRemoteWork({ commandId, ticketId? })` reattaches a live range or adopts a terminal fact by stable ID, and startup runs that reconciliation before Input recovery. An unknown owner, changed incarnation, missing record, revoked authority or unavailable device keeps the local outcome unknown and raises one evidence-backed Attention per job; later reconciliation does not duplicate it. Remote background and foreground commands commit a `starting` intent before sending the start request, so a Host crash between spawn and commit still has an original job ID to inspect, cancel or confirm. The remote protocol and saved Host connection state are v2; a pre-v2 state is rejected explicitly. Recovery never falls back to the Host filesystem or a different device.

T36 adds execution-target policy without moving an in-flight Assignment. The Instance policy defaults to `local`, is revisioned with `Engine.updateExecutionPolicy({ commandId, expectedRevision, policy })`, and persists its preferred Environment and required permissions. `Engine.getExecutionPolicy()` returns the current policy. `submit` and `acceptSource` accept a Ticket override of `local-only`, `remote-only` or `auto`; the target is stored with its source, and the target is resolved once when the Assignment is first created. `Engine.retryExecutionTarget({ commandId, ticketId })` re-probes after a waiting target becomes available; replaying its command ID returns the existing result instead of re-binding. A relay or follow-up that wakes an unbound Ticket goes through the same binding function, so it cannot run in the Host-local world while `remote-only` is waiting. `retryTicket` refuses to create an Assignment for an `environment-waiting` Ticket.

Selection evidence is saved as `execution-selection` and exposed through `conversation(ticketId).executionSelection` and `Engine.getExecutionSelection(ticketId)`. It records the requested and resolved target, policy revision, source, Host ID, final device/directory/version/fingerprint and one candidate row per Environment with eligibility reasons. Auto candidates must pass authorization, target kind, required permissions, a real probe (online status, directory match, version, fingerprint, capacity and unknown/full capacity rejection); an absent probe or unknown evidence is ineligible, not guessed. `remote-only` with no qualified device stays `environment-waiting` and creates no Assignment. Local means the active Host's local Environment; the model route remains independent of the execution target. A retained Assignment keeps its selected Environment, and a later policy change only affects future resolution. `listEnvironments()` remains the configured allowlist; no tool call can choose or switch a device. The remote protocol and saved Host connection state are v3, and the device status includes version, fingerprint and job capacity.

T37 keeps attachments, artifacts, long output and skills inside the bound execution world. A deployment may set `assetsPath` on a `LocalEnvironment` or `RemoteDevice`; the package stores verbatim files by SHA-256 in an `Instance + Environment` namespace, so two Environments sharing one root cannot read each other by digest. `assetsPath` must be outside a local or device working directory. `skillsPath` may point at a deployment-owned skill root; the package mounts the public `@deepseek-ai/dsh-skill` registry with `dsh-skill-filesystem`, disables default project/user roots, and never reads the user's `~/.dsh` or `~/.agents`. The device daemon mounts the same public provider and serves `skill.list`/`skill.get`; there is no Host-path fallback.

`PreparedEnvironment.artifact()` now carries an environment-bound `reference`. `saveAttachment()` writes exact bytes (at most 65536), `readAsset()` pages attachments, artifacts, spills and skills by byte offset with digest verification, and `spillReference(jobId, stream)` exposes the complete durable output of a background job (up to 1 MiB). A spill or file whose bytes no longer match the reference returns `REFERENCE_STALE`; an unavailable combination returns `ENVIRONMENT_UNSUPPORTED` with named gaps. `Engine.getEnvironmentCapabilities(environmentId)` reports attachment, spill and skill support and gaps; `Engine.saveEnvironmentAttachment({ commandId, environmentId, name, data, encoding?, mediaType? })` is idempotent by command ID; `Engine.readEnvironmentAsset({ environmentId, reference, offset?, maxBytes? })` re-prepares and verifies the original Environment before reading, so a reconnected device resumes the same reference. Workers get `save_attachment`, `read_asset` and `list_skills` only when the bound Environment supports them; `read_job_output` is a parent-only job tool. Delegated children inherit the same bound asset tools and directory.

T38 declares where browser, MCP and Office product capabilities execute. The desktop source may set `hostCapabilities: { browser: true, mcp: true }`; these are Host-only declarations and are never copied into a Ticket or a remote Environment. `submit` and `acceptSource` accept `capabilities: ['browser', 'mcp', 'office']`, stored on the Trigger and Mandate. `Engine.getCapabilityLocations()` returns the Instance's catalog: browser and MCP are `host` capabilities with Host credentials and privacy; Office is an `environment` capability that requires a skills provider, a configured `office` command, and the `read` plus `command` permissions. Every remote capability entry carries an explicit `remote-*-contract-unverified` gap, so a `remote-only` Ticket that asks for any of them stays `environment-waiting` without an Assignment. `conversation(ticketId).capabilityPlan` and `Engine.getCapabilityPlan(ticketId)` show the required locations, availability, blockers, credential scope and privacy scope. Resolution is read-only: it never adds a permission, device grant, Host path or publication right. The local chat preview exposes `GET /capabilities`, capability checkboxes, per-Ticket locations and a global catalog.

T39 adds a read-only preflight for a handoffable Git work copy. `Engine.prepareHandoffCopy({ commandId, ticketId, targetEnvironmentId })` inspects the fixed source Assignment and the requested target Environment, records their locations, the base commit, every modified/added/deleted/untracked path with byte count and SHA-256, the bounded binary patch hash and the total transfer bytes. `Engine.verifyHandoffCopy({ commandId, ticketId })` re-reads both sides and requires the target commit and hashes to match; `Engine.getHandoffCopy(ticketId)` returns the latest prepared/verified/`handoff-blocked` record. Unknown target changes, a different target commit, a source change after preparation, symbolic links, renames, missing Git, and scan/change/patch budgets are explicit blockers. Preflight never changes the Assignment, starts an execution, writes a target file or substitutes a Host path. `PreparedEnvironment.inspectWorkCopy()` is shared by local and paired-device Environments, and the device serves the bounded `workcopy.inspect` operation. The explicit sync itself remains outside T39; T40 consumes this manifest for the actual handoff.

T40 moves a Ticket's execution between Environments at a safe boundary. `Engine.requestHandoff({ commandId, ticketId, targetEnvironmentId, reason })` first re-resolves the target with the same explicit-target rules as T36/T38 (Ticket target kind, actor allowlist, probe online/directory/version/fingerprint, Instance permissions, required capabilities, capacity), so a target the Ticket excludes becomes `target-ineligible` instead of being used. It then records `handoff-requested` before it touches any execution range, and blocks with a named reason when the Ticket is ended, constrained, stopping, already has a ready report, failed setup, or still has an active Worker turn, background job, child Agent or preview. Any `starting`, `running`, `cancelling` or `unknown` range stops the handoff; settled jobs are recorded as `jobs-reconciled` evidence, and a remote job also needs `rangeSettled`. The prepared copy must be `verified` and still belong to this Assignment, source and target.

With the boundary clear, the source Session is flushed through the public Session contract (a live Agent flushes; otherwise a persisted Session must exist), then the target and copy are revalidated, and the switch commits in one transaction: the old Assignment ends, a new Assignment with the same `sessionId` and a fresh generation binds the target Environment, the old slot is released, the intent becomes `handoff-pending`, the relay is enqueued, and the completed record is written together with the `commandId` receipt. A reused command ID replays that record; an unfinished `requested`, `flushing` or `switching` record fails a new request with `HANDOFF_IN_PROGRESS` rather than overwriting progress (restart reconciliation is T41). The new generation may only start through that handoff relay, which records `promptStartedAt` in the same transaction that admits its slot, so other follow-ups wait; the turn receives an explicit handoff prompt naming the source and target roots and the verified copy instead of re-adding the original request. If that turn fails during setup, the marker is cleared in the same transaction and `retrySetup` requeues the same relay, so unconsumed work continues. Old-generation jobs, children, inputs and callbacks stay isolated by Assignment ID and generation; the Ticket, Mandate, Session history and both stores do not move.

T41 guards interruption and precedence around that switch. On startup the Host scans unfinished `handoff-state` records (`requested`, `flushing`, `switching`), reconciles each against current facts (Ticket constraint/stop/waiting-human, ready report, setup, unknown relay Effects, source Assignment id/generation/state, active turn/job/child/preview, source and target identity and authorization, re-verified work copy and target eligibility), then continues the same record instead of creating a new handoff. At most 25 are reconciled per start; a failing record becomes `handoff-recovery-failed` without stopping the others. Stop wins: `stopTicket` writes an unfinished handoff as `blocked` in the same transaction that records the stop, and `resumeTicket` only creates a new source Assignment. Pause rejects a new handoff and defers startup recovery; unknown relay outcomes block with `unknown-effect` while unknown outbox acknowledgements do not. Every blocker carries `nextOwner` (`operator`, `human` or `host`), and the local chat shows an `Execution handoff` panel with the state, source and target, last step and each blocker owner. A target that is offline or no longer authorized stays blocked; the handoff never falls back to the Host-local world.

`RemoteEnvironment.revoke()` asks the device to persist the revocation and then stops the host from using it. The device operator can also inspect pairings with `RemoteDevice.listPairings()` and revoke one locally with `revokePairing()`. `snapshot()` and `RemoteEnvironment.restore()` allow an explicit host restart path; the snapshot contains the host exchange private key and must be stored as a protected credential. A revoked or closed environment cannot export a new snapshot.

For a real device, write `{ "deviceId": "...", "root": "...", "grants": [...], "commands": {...}, "jobsPath": "...", "statePath": "...", "assetsPath": "...", "skillsPath": "..." }` to a protected config file. `assetsPath` and `skillsPath` are optional deployment roots; set them to serve attachments, spill and skills. Set `listenHost` to the interface to bind; a wildcard listener also needs a reachable `advertiseHost`. Then run:

```sh
node dev/remote-device.mjs --config /protected/device.json --pairing-code-file /protected/pairing-code.txt
```

The command writes the one-time code to the file with mode 0600 and prints only the endpoint, device ID, key fingerprint and code file path. Read the code out of band on the host. T32 was accepted with a Windows host against a temporary Ubuntu cloud device over an SSH-forwarded endpoint: reads, writes, glob, grep, artifact hashes, snapshot restore and persistent revocation all ran on the Linux device. T33 added a real Windows→Linux run for device-resolved executables, cwd/environment/output, disconnect and byte-offset resume, lost-start reconciliation, two-job isolation, confirmed cancellation, stable-ID reconnect and daemon-restart recovery. T35 reran the daemon-restart matrix cross-device: `dev/t35-acceptance.mjs` passed 26 checks covering live-process reattachment, log-only, deadline stop, unqueryable unknown, completed exit code/output and exact cancellation. Direct public exposure was not used; production network hardening, PTY/process-tree cleanup and device handoff remain later tickets.

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

T15 mounts the public DSH `SessionPersistence` service on the same SQLite transaction worker as the business store. `session-persistence-sqlite` (`ds-superagent/session-persistence`) takes `{ databasePath }` and stores the Session header, a contiguous event log and a writer row under the `session-meta`, `session-event` and `session-writer` record kinds. Event keys are zero-padded by sequence, so a scan yields the log in order; a non-contiguous append is refused with `assertContiguous`, and a stored log is re-verified with `validateStoredEvents`, checked for contiguity from seq 0, and compared with the header event count when read or opened for write. The header is checked for format version and identity, and a fork keeps `parentSession`, `isSeeded` and its `inheritedEventCount` cut.

`open(id, 'write')` succeeds only when no live writer row is active, so one Session has one writer; a second attempt raises `SessionAlreadyOwnedError`. The active row carries the owner PID: a crashed holder (dead PID) is taken over with a new epoch like the JSONL backend's kernel lock, while a live process or a second in-process instance is refused. Each `append`, `flush` and `close` re-reads the writer row in the same transaction and compares its `epoch` and activity flag, so a handle left behind by a replaced backend or a crash cannot silently write again: it raises `SessionOwnershipLostError` instead. `append` commits on every call, which is why the Agent loop's pre-publication seed (`appendUnstoredSuffix`) is already durable. A failed `flush` or `close` keeps write ownership: the handle stays open and can still append or flush, and it never reports success it did not observe. A created Session that is never materialized (no append or explicit flush) removes its own meta and writer rows on close, so a failure before publication leaves nothing behind for a later `stat()` to mistake for a resumable Session; a flushed empty Session survives. An append writes its events and the header cursor in one transaction, so a mid-batch failure leaves no partial log and can be retried; a failed live append stops the handle and surfaces the original error at `flush`/`close` instead of dropping later events. A service-wide `flush()` drains every open write handle and aggregates any failure without releasing a single owner.

The plugin routes `session/event` into the live append chain of the active handle, maps `session/flush` to `handle.flush()`, and drains plus releases on `session/disposed`. Because DSH stores the unpublished suffix before `prepared.publish()`, construction and resume records such as `session/end-seed` and interrupted-turn closers are readable when `session/created` is announced, not only after later live events. `NativeSessions` no longer keeps an in-process completion set; it asks the public `stat()` whether a Session is persisted and chooses `resume()` or `create()`, so a replaced adapter or a restart continues the same log. `node --test test/session-persistence.test.mjs test/native-runtime.test.mjs` covers the handle contract, writer fencing, crash takeover, service flush, interleaved Sessions, fork lineage, backend replacement, resume after replacement, cancellation, real DSH fork and pre-announce durability. This stores Session history; business facts keep their own records, and the two are reported separately.

## PostgreSQL Session persistence

T43 mounts the same public `SessionPersistence` contract on a shared PostgreSQL backend. `session-persistence-postgres` (`ds-superagent/session-persistence-postgres`) takes the same explicit options as `PostgresStorage`: either a `connectionString`, or `host`, `port`, `user`, `password`, `database` and `ssl`. It writes to the `session-store` Instance namespace, so its transactions are independent of business commands even when both use the same database and schema.

Writer ownership is a PostgreSQL session-level advisory lock on a dedicated pooled connection instead of a local PID check. Another process, or a second provider in the same process, receives `SessionAlreadyOwnedError`; `create` for an existing or actively created identity receives `SessionAlreadyExistsError`. PostgreSQL releases the lock when the holder closes the handle or its connection dies, so a crashed holder does not block a later writer, and a takeover still advances the durable writer epoch. Every `append`, `flush` and `close` re-reads the writer row and compares that epoch, and a handle whose lease connection was terminated raises `SessionOwnershipLostError` before mutating the log. Read handles take no lease, so another process can read the same history while a writer is active.

Each active write handle holds one lease connection; that pool uses the same `maxConnections` and timeout budgets as the main pool, so a deployment must size connections for its concurrent writers. Closing `PostgresStorage` releases leases that a failed final transaction could not release, so shutdown does not wait forever on a broken handle. The provider persists every `append` before returning, so DSH's pre-publication suffix is durable before `session/created` is announced; provider replacement or restart reads the complete history and never gives the old handle write access again.

`node --test test/session-persistence-postgres.test.mjs` runs twelve tests against the real embedded PostgreSQL 17.11 instance: the public handle contract and contiguous log, fork lineage, two operating-system processes contending and recovering a crashed holder, a terminated lease and a moved epoch, real server-side flush/close failures, a lost COMMIT acknowledgement, business-transaction independence, provider replacement, the DSH announcement barrier with its failure path, and Worker resume after the adapter is replaced. These use a loopback test cluster and the mock model, not a production database, replication or a real model. Connection credentials are generated per test run and never printed.

## Input recovery after restart

T16 gives every human follow-up Input separately queryable delivery facts. The existing `work-input` and `work-ownership` records still carry receipt and fan-out ownership. A new `delivery` field on the Input records `claimedAt` (a pre-send claim with a stable message ID, Assignment and Session), `sentAt` (handed to the native adapter), `persistedAt`/`persistedMessageId`/`persistedSeq` (only after the exact `user/message` is in durable Session history and the flush barrier passed) and `completedAt`/`outcome` (only when the Worker actually owned the work through a ready report, a human question or a handback). An idle turn leaves `state: pending`, so a persisted delivery is never shown as model-processed.

The message ID is derived from the Input ID and reused across restarts. Before sending, the Worker reads the public Session persistence log: if the original message is already there it does not append it again and instead runs a recovery turn (inspect Session history, files, version control and external state before continuing); if it is absent it resends the original text with the same message ID. `NativeSessions.run` accepts an explicit `messageId` and, for Input turns, waits for the matching `session/event` and flushes the Session before calling `onMessagePersisted`; a failed flush writes no receipt. A paginated `pending-input` index feeds the startup scan, which is registered through `Effects.setStartup` and awaited by `start()`/`drain()`/`stop()` before normal dispatch, so a restart settles the unread/read boundary before any stale inbox copy can race. The scan checks `work-ownership` and never re-attaches a handed-back or requeued Input; a retry keeps the Ticket and Session but creates a new Assignment generation. Recovery notes are numbered, capped at three per Input, and total delivery attempts at five; beyond that the Input keeps an `exhaustedAt` fact and the intent reads `recovery-exhausted` instead of looping. Relay effects also reconcile an unknown outcome by re-running, which is safe because the Worker re-checks the durable message boundary first.

`node --test test/input-recovery.test.mjs` runs real isolated child processes that exit before the claim, after the claim, after the append, after a provider flush failure, and after the persisted receipt. Reopening each database produces exactly one original user message, either the original resend or a numbered recovery note depending on the durable boundary, and finishes with `state: delivered` and `outcome: ready`. It also covers an idle turn followed by a restart and a handed-back Input that must not be re-attached. `Engine.getTicketDirection(ticketId).inputs` exposes the delivery and ownership facts; business facts and Session history remain separately queryable.
