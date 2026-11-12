# DS Super-agent UI

This package is a copy of the DS Bot client source in `src/client/`, kept
separate so the Super-agent profile can modify its own chat surface. The build
changes only the generated bundle id:

- source: copied from `ds-bot/src/client/`
- client bundle: `client.js`, id `ds-superagent-ui`
- protocol: the existing `/api/bot` channel, supplied by `ds-superagent-host`

The copied surface still contains the team, group and browser panels. Those are
the next changes for this package; this copy is the starting point, not a new
UI written from scratch.

## Build

```sh
node scripts/build-client.mjs
node scripts/build-client.mjs --check
npm test
```
