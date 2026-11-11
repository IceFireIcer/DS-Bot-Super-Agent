# T55 — unchanged plugin and desktop app regressions

This report supplies the existing-suite regression evidence for [T55 / #83](https://github.com/IceFireIcer/DS-SuperAgent/issues/83). It is verification only: no production code, tests, generated bundles, dependency manifests, or lockfiles were changed by this validation task. No commit was made.

## Environment and execution

- Date: **2026-11-11**, Asia/Shanghai (UTC+08:00).
- Repository: the current `DS-Bot-Super-Agent` checkout.
- Branch and HEAD at start and finish: `dev`, `221c743544417623e00e14346bc5962550848b71`.
- OS: **Windows 11 Pro**, `Windows_NT 10.0.26200`, `win32`, `x64` (reported by Node's `node:os`).
- Node: **v24.22.2**, executable from the existing isolated `node-v24.22.2-win-x64` runtime.
- npm: **11.19.1**, from the same runtime directory.
- Each command prepended that runtime directory to its own process `PATH`; the tests and their Node children therefore used the requested runtime.
- The four commands ran concurrently, once each, without test filters, retrying failures, changing test concurrency, or modifying scripts.
- For each test suite, process-local `TEMP` and `TMP` pointed to `.dsh-test-t55-regressions/<suite>-temp`, and `DSH_HOME` pointed to `.dsh-test-t55-regressions/<suite>-home`, where `<suite>` is `ds-bot` or `app`. Test helpers additionally create their own disposable fixtures. No test targeted the user's DSH data or desktop application data.
- No `DSH_HARNESS` or `NODE_OPTIONS` override was inherited. The installed plugin test harness is `ds-bot/dev/harness`; its declared DSH version is `0.2.1-rc.4`.

## Current results

All times below are on 2026-11-11, UTC+08:00. Test durations are the Node test runner's reported durations, rather than npm wrapper wall time.

| Working directory | Exact command | Start → finish | Exit | Observed result |
| --- | --- | --- | ---: | --- |
| `ds-bot/` | `npm test` | 16:40:30.234 → 16:41:30.003 | 0 | **1,433 tests: 1,431 passed, 0 failed, 2 skipped, 0 cancelled, 0 todo**; 22 suites; 57,342.1893 ms |
| `ds-bot/` | `node scripts/build-client.mjs --check` | 16:40:30.099 → 16:40:31.181 | 0 | Generated `client.js` and `office.js` match their source builds; no output and no files written |
| `ds-bot/` | `npm run lint` | 16:40:30.099 → 16:40:32.994 | 0 | **39 warnings**, no reported errors; command passed with warnings |
| `app/` | `npm test` | 16:40:30.265 → 16:41:18.571 | 0 | **244 tests: 243 passed, 0 failed, 1 skipped, 0 cancelled, 0 todo**; 25 suites; 45,576.4445 ms |

Combined test accounting: **1,677 discovered, 1,674 passed, 0 failed, 3 skipped, 0 cancelled, 0 todo**. Skipped tests are included in the discovered count and excluded from the passed count.

### Skipped coverage

| Suite / source | Test | Actual reason | Evidence limitation |
| --- | --- | --- | --- |
| `ds-bot/test/office.test.js:736` | `unpack refuses a symlinked file inside the destination` | Runtime `t.skip('no symlink privilege')` after Windows returned `EPERM` when creating a file symlink | File-symlink unpack refusal was not exercised in this run; this is a privilege-dependent skip, not a pass |
| `ds-bot/test/work-dir.test.js:1068` | `the folder is checked as DSH gets it, spaces and all` | Explicit Windows skip: `Windows drops trailing spaces from names` | Trailing-space folder behavior was not exercised on this OS |
| `app/test/host-process.test.mjs:18` | `the Linux Host loads sharp only in its plain Node child` | Explicit `skip: process.platform === 'win32'` | Linux plain-Node image-host execution was not exercised on this OS |

### Warnings and diagnostic attribution

There are **no current test failures** to assign to a behavior ticket from these four commands. The lint result still contains 39 existing-source warnings; the full file, line, rule and message inventory is in `ds-bot-lint.log`. They were not fixed as part of T55.

Test logs also contain caught errors and warnings; these must not be counted as failed tests merely because their text says `Error`:

- `browser result Error: offline` comes from the offline submission/retry fixture in `ds-bot/test/bot-browsers.test.js`, which deliberately rejects the first submission and verifies cached retry behavior.
- `Ops did not move to its working folder: down` comes from `ds-bot/test/work-dir.test.js:1298`, which explicitly makes `resolveAgent` throw and verifies that the group folder still saves.
- App import warnings about the malformed `broken/cordis.patch.yml` originate from `app/test/import.test.mjs:70`, which constructs that malformed fixture.
- `group title for You, Chief not updated: TypeError: Cannot read properties of undefined (reading 'session')` was also observed. Its catch/log location is `ds-bot/src/host/roster.js:395` (`retitleRoom`). The suite passed, but this run does **not** establish whether the underlying undefined agent is an intentional fixture condition or a product defect. Attribute any follow-up to the existing plugin group-title / Session-resolution behavior and its fixtures; do not treat it as a T55 implementation fix or silently claim the diagnostic is resolved.

These are observations of the unchanged source in this run. No historical failing run was rerun or reclassified here. In particular, this report does not claim that older `superagent` CI failures are fixed: these commands cover `ds-bot` and `app`, not the `superagent` suite. The parent's T47 native Host crash demonstrations, including SQLite and embedded PostgreSQL, are separate evidence and are not included in these totals.

## Local evidence and scope

Raw stdout/stderr and exact start/end/exit metadata are retained under the ignored repository directory **`.dsh-test-t55-regressions/`**:

| Check | Combined stdout/stderr | Command metadata |
| --- | --- | --- |
| Plugin full tests | `ds-bot-test.log` | `ds-bot-test.result.json` |
| Generated bundles | `ds-bot-generated-check.log` (empty on success) | `ds-bot-generated-check.result.json` |
| Plugin lint | `ds-bot-lint.log` | `ds-bot-lint.result.json` |
| Desktop app full tests | `app-test.log` | `app-test.result.json` |

`git check-ignore .dsh-test-t55-regressions/probe.log` confirmed the directory is ignored. These local logs are not committed artifacts. `git status --porcelain -- ds-bot app` was empty before execution, and `git diff --name-only -- ds-bot app` was empty after execution. Concurrent T55 files owned by other tasks were left untouched.

No app build, GUI, interactive desktop launch, smoke bench, real-model request, external channel scenario, second-device experiment, or deployment was started by this task. All four command sessions exited normally. This report provides the requested Windows regression checks only; it does not establish complete four-goal T55 product acceptance.
