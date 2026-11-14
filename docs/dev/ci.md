# CI modes

Daily pushes and pull requests into `dev` use a short validation path:

- Repository script tests, implementation evidence checks and the tracked-file leak scan always run.
- Changed packages run their checks in parallel. The plugin keeps its complete unit tests, generated-client check and lint on Linux with the pinned DSH; the app keeps its profile tests; mobile keeps its typecheck.
- Super-agent typecheck/lint run separately from its tests. Tests run the six product smoke files in `scripts/superagent-ci-tests.mjs`, plus changed test files, tests named after changed modules and tests directly importing a changed module/helper. The log lists the selection. Indirect dependency coverage is deferred to the full gate.
- App installation, update and uninstall matrices and older DSH compatibility checks do not run on daily pushes. Docker build/migration checks run when Docker files change.
- New pushes cancel older daily runs for the same event/ref. npm downloads are cached; installed dependency trees are recreated with `npm ci`.

Full validation ignores path filters. It runs every Super-agent test in four independent Windows shards, the complete plugin compatibility matrix, all app/mobile checks, Windows/macOS arm64/macOS x64/Linux package checks (including installation and updates), and Docker startup/migration checks. Tests retain the existing per-runner concurrency limit because process/PTY fixtures compete for machine resources.

Full validation runs automatically for pull requests into `main` and as a required dependency of `release.yml` for both pre-releases and stable releases, including manual release dry runs. The release workflow cannot publish npm packages or upload release artifacts unless this gate succeeds. The GitHub `release: published` trigger means the release page already exists at that point; the release PR checks provide the validation before that page is published.

For an extra full check on any branch, open **DS-SuperAgent CI → Run workflow**, and enable **full**. A normal manual run uses the daily smoke selection. Branch protection continues to require **Test result**; a required failed, cancelled or skipped job fails that gate in both modes. Passing daily CI is not evidence that the complete release matrix passed.
