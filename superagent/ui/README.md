# DS Super-agent UI

This package is a copy of the DS Bot client source in `src/client/`, kept
separate so the Super-agent profile can modify its own chat surface. The build
changes only the generated bundle id:

- source: copied from `ds-bot/src/client/`
- client bundle: `client.js`, id `ds-superagent-ui`
- protocol: the narrow `/api/superagent` channel, supplied by `ds-superagent-host`

The chat shell, cells, question cards, theme and layout styles originate from
the copied `ds-bot/src/client/` surface. The Super-agent entry keeps only one
conversation and the v1 feed; unsupported team controls are not mounted.

Copy provenance (Apache-2.0, the repository's existing DS Bot notice applies):

- `src/client/` and `src/shared/` started as the DS Bot source at `5914737`.
- `superagent-chat.js` copies the `Composer` and `Chat` DOM structure and sizing
  from the repository's existing `app/ui/src/chat.js` and `app/ui/src/app.css`;
  it adapts their data connection to the v1 feed and omits unsupported tools.
- `ChatRows`, `Bubbles`, `PendingQuestion`, `BotAvatar`, theme colors and styles
  remain the copied DS Bot implementations.
- The new entry replaces the copied team orchestration entry; it does not mount
  team, groups, browser, attachments, steer, memory, schedules, usage or keys.
- Unused copied feature modules remain source-only for provenance and future
  work; the build enables tree shaking. No legacy UI sources are modified.

## Build

```sh
node scripts/build-client.mjs
node scripts/build-client.mjs --check
npm test
```
