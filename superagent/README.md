# DS Bot Super-agent core

This private ESM package hosts the independent TypeScript core. Its public Cordis plugin exposes only the instance-bound Engine; the existing DS Bot entry point does not feed it requests.

## Requirements

- Node.js 22.19 or newer.
- An explicitly configured, absolute, writable SQLite database path isolated for this instance.
- An explicit instance ID and trusted desktop source configuration. `allowedActorIds` is a deployment-owned allowlist, not data from the submitted request.

The core does not read `DSH_HOME`, migrate or inspect a user's DSH data, create sessions, start a Worker, or enable non-local environments. Accepted work remains pending with the reason `worker-not-enabled`; T02 adds the DSH mock-model loop.

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

The mock uses deterministic explicit requests rather than a model and places its temporary SQLite database in the OS temp directory, deleting it and closing its Cordis fiber on exit. `npm run mock` reports elapsed single-request p50/p95/max for 50 SQLite commits, 20 parallel deliveries for one event, and the re-opened CLI receipt; no worker or model is started. On Windows x64 with local Node 25.4.0, the 2026-11-04 recheck measured p50 0.76 ms, p95 1.24 ms, max 1.88 ms per serial submit; the twenty retries returned one Ticket. This small disk-backed local-path sample is a development baseline, not a production storage benchmark or SLA.

SQLite schema version 1 is created only in an empty or version-1 database. Future versions and nonempty unversioned databases are rejected unchanged. Same-process transactions are globally serialized on one worker-backed `DatabaseSync` connection with a 128-command admission limit; SQLite's configured default cross-process lock wait is 250 ms. The callback transaction capability expires before commit. Commit or worker outcomes that cannot be confirmed remain unresolved; query the original command ID before trying again.

This internal package is licensed Apache-2.0 as part of the repository. The T01 implementation is original and uses the public `@deepseek-ai/cordis` 4.0.5 interface and Node's public `node:sqlite`, `node:worker_threads`, and `node:crypto` modules. It does not copy code or text from the research prototype. There is no Session adapter, real DSH model execution, external source/channel, remote device or PostgreSQL support yet.
