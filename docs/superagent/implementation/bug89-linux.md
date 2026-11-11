# Issue #89 Linux PostgreSQL Verification

Date: 2026-11-11 (Asia/Shanghai). Scope: isolated verification of [#89](https://github.com/IceFireIcer/DS-SuperAgent/issues/89) on the user-designated temporary Ubuntu host. This report is the only repository path changed by this verification task. No system packages/users/services, production database, remote device data, credentials or DSH_HOME were modified.

## Source identity

- Git base: `339993bffb112ef69cc4b9761b559cc4f6bbf429`.
- Worktree included current in-progress integration changes. A 93-file source/dependency/test-fixture snapshot was hashed before transfer, archive and manifest SHA-256 verified on both sides, then every extracted file SHA-256 was checked before install and again after tests.
- Manifest SHA-256: `f8cce93d3814ae23d6ba397d22162eae332f7355e0d86ec3a7375b5828faaa97`.
- Archive SHA-256: `787b61674acecfe1ce04635ba824e9396e4055e03b5d9da450653f89689daaac`.
- Eleven paths differed semantically from the named base in the snapshot; 48 other reported path differences were line-ending-only. The semantic differences were `superagent/src/engine.ts`, `feishu-api.ts`, `feishu-delivery.ts`, `feishu-runtime.ts`, `feishu-sync.ts`, `github-api.ts`, `github-delivery.ts`, `index.ts`, `outbox.ts`, `source-events.ts`, and `work-inputs.ts`. Relevant PostgreSQL owner/harness/tests and package manifests were included and individually hashed. This is a snapshot identity, not a claim that all concurrent parent work was included.
- No credentials were placed in the archive. npm used a host-local isolated cache under the temporary verification directory.

## Host and bounded commands

Host: designated Ubuntu 6.8 x86_64 server, ordinary `ubuntu` user UID 1000; Node `v24.15.0`, npm `11.12.1`. The test fixture uses the `@embedded-postgres/linux-x64` PostgreSQL 17.11 binaries, `initdb` and `pg_ctl` directly, so the test process did not need root or a system PostgreSQL service.

Within a single outer 570-second bound, with `npm ci` bounded at 240 seconds, build at 90 seconds and tests at 240 seconds:

```sh
npm ci --no-audit --no-fund
npm run build
node --test --test-concurrency=2 \
  test/postgres-lifecycle.test.mjs \
  test/postgres-storage.test.mjs \
  test/session-persistence-postgres.test.mjs \
  test/host-takeover-process.test.mjs
```

No Feishu-only test was selected. Install and build both exited 0.

## Result

**37/37 passed, 0 failed, 0 skipped; Node test duration 19.62 s; command exit 0.** Breakdown: PostgreSQL lifecycle 2/2, PostgreSQL Storage 22/22, PostgreSQL Session persistence 12/12, Host takeover process 1/1. This includes the exact Windows-CI exit-hook reproduction test, lifecycle cleanup test, embedded PostgreSQL operations, Session writer/failure cases and actual two-process Host takeover. The log did not contain `SYNCHRONOUS TERMINATION NOTICE`.

This is targeted Linux regression evidence for #89 at the snapshot above. It does not certify Windows CI, the full suite, unrelated new desktop/cross-channel features, or the parent's final integration tree unless its file hashes match this manifest.

## Cleanup

The tests stopped their PostgreSQL owners. Post-run inspection found no owned Node/PostgreSQL process and no temporary database child directories except Node's compile cache. The isolated remote directory `/<isolated-run-root>`, including npm cache and compile cache, was removed after verification. No package installs or changes were made globally.

## Temporary GitHub TLS relay

Separately, to let the parent validate the resulting commit through GitHub while direct local HTTPS was failing, a short-lived SSH local forward is listening only on `127.0.0.1:7327`, owned by SSH PID `67876`. Route: local loopback → the same designated Ubuntu host → `github.com:443`. SSH used `StrictHostKeyChecking=yes`, `BatchMode=yes`, and the already trusted host entry. A bounded `curl --resolve github.com:7327:127.0.0.1 https://github.com:7327/` completed in 1.05 s with normal CA certificate verification and HTTP 301. No git config, proxy config, credential, token or persistent SSH config was changed. Keep this process only until the parent finishes its authorized GitHub validation, then stop PID 67876.
