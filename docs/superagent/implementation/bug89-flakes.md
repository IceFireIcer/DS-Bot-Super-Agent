# #89 ancillary jobs and work-copy verification

- Issue: [Windows CI failures #89](https://github.com/IceFireIcer/DS-SuperAgent/issues/89).
- Date: 2026-11-11, UTC+08:00. Native Windows, Node **v24.22.2** from the designated `node24-runtime/node-v24.22.2-win-x64` directory, prepended to process-local PATH.
- Scope: only `test/jobs.test.mjs` and `test/work-copy.test.mjs`. PostgreSQL is parent-owned. No production edits, build, full suite or commit were performed. Existing `dist` was used without rebuilding during parent integration; checkout HEAD observed after validation was `66be66a211a8bcf1981f9bd599d2dbb1ce85ea1e`.

## Bounded reproduction

Run from `superagent/`, with these two commands started concurrently in each of three sequential rounds:

```text
node --test --test-reporter=tap "--test-name-pattern=background work keeps its slot|a long command starts asynchronously" test/jobs.test.mjs
node --test --test-reporter=tap "--test-name-pattern=a different target commit|prepares and verifies a Git work copy" test/work-copy.test.mjs
```

Each child had an isolated `DSH_HOME`, `TEMP` and `TMP`, a 90-second process-tree timeout, and native Node 24 on PATH. This supplies concurrent real DSH/SQLite/subprocess/Git activity; it does not reproduce windows-latest hardware saturation. No synthetic CPU load was added during critical parent integration. Rounds 2–3 additionally set process-local `GIT_CONFIG_GLOBAL=NUL` and `GIT_CONFIG_NOSYSTEM=1` to test the fixture without inherited author identity. No user Git configuration was changed.

| Round | Jobs | Work-copy | Exit codes |
| --- | --- | --- | --- |
| 1, inherited Git configuration | 2 pass / 0 fail | 3 pass / 0 fail | 0 / 0 |
| 2, no inherited Git configuration | 2 pass / 0 fail | 2 pass / 1 fail | 0 / 1 |
| 3, no inherited Git configuration | 2 pass / 0 fail | 2 pass / 1 fail | 0 / 1 |

The work-copy pattern also matches the existing unknown-target test, accounting for three tests. No test was skipped or cancelled; no outer timeout fired. Jobs' target slot-budget test completed in approximately 503, 545 and 485 ms respectively. Its original queue timeout did **not** reproduce in three attempts. `longCommand()` already waits for a release file and declares a 120-second background deadline; `startCommand()` uses that deadline rather than its 5-second foreground deadline. No speculative jobs edit or blanket deadline increase was made. The original CI jobs failure remains unresolved by this worker.

Both red work-copy runs failed at `git commit -m target ahead` with **Author identity unknown / unable to auto-detect email address**, before reaching the handoff assertion. The source repository sets its own local author; `git clone` does not copy that configuration to the target. The target commit therefore depended on machine-global Git identity. This is a reproducible fixture defect; the available evidence does not establish that the original CI work-copy failure had the identical stderr.

## Minimal fix and green

The target fixture commit now supplies command-local `user.name=T39` and `user.email=t39@example.invalid`. It adds `target.txt` before committing, so its tree differs regardless of timestamps. An explicit comparison of source and target HEAD verifies the different-commit precondition before the public Engine `prepareHandoffCopy()` assertion. No production behavior or repository/user identity was changed.

With inherited Git configuration still disabled, ran:

```text
node --test --test-reporter=tap test/work-copy.test.mjs
node node_modules/oxlint/bin/oxlint -c ../ds-bot/.oxlintrc.json test/jobs.test.mjs test/work-copy.test.mjs
```

Result: **work-copy 9 pass / 0 fail / 0 skip**, exit **0**, duration **16,193.1348 ms**; targeted lint exit **0**. Existing public Engine tests cover handoff blockers and unchanged successful verification. No further retries were needed after the complete owned file passed.

Raw per-round logs and command/time/exit metadata remain in ignored `.dsh-test-bug89-flakes/round-N-{jobs,work-copy}/`; green output is `.dsh-test-bug89-flakes/green-work-copy.log`. All worker-launched test processes exited normally. This report does not claim full-suite, CI, PostgreSQL or #89 acceptance.

## Original CI log limitation and concurrency

Follow-up read-only inspection of the parent-fetched `.dsh-test-integration-20261111/ci89-original.log` (42,133 bytes) found `npm test` starting at 2026-11-10 15:15:12 UTC and an operation-cancelled notice at 16:32:35 UTC. Searches found no `not ok`, target test titles, queue-timeout, author-identity or `ERR_TEST_FAILURE` strings. This cancelled capture cannot attribute either ancillary failure to a root cause; missing failure text is not a passing result.

At inspection, `scripts/test.mjs` passed no explicit `--test-concurrency`, leaving file concurrency to Node's platform-dependent default. The current native runtime reports `availableParallelism() = 32`; this does not establish the original CI worker's effective concurrency. The worker's bounded two-process reproduction provides only modest concurrent-load evidence, not a controlled saturation comparison. An explicit default of two test files is reasonable resource containment while retaining concurrent-work, slot-budget and blocker assertions inside the tests, but a successful run with that setting must be recorded before claiming it resolves CI overload. No runner script was changed by this worker.

## Later integration result

The parent batch changed the runner default to **one test file on Windows** and **two on other platforms**. The final Windows full suite passed **515 tests: 513 pass / 0 fail / 2 existing platform skips**. The targeted work-copy file passed 9/9 with inherited Git identity disabled, and the original job slot test passed inside the full suite. The app package now runs its own legacy-importer integration test, so the core job no longer imports `app/src/import.mjs` without app/DSH dependencies.

This removes the observed workload and dependency failures but still does not establish windows-latest until CI runs the resulting pushed commit.
