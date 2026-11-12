# DS Super-agent UI

The chat surface for the `ds-superagent` DSH profile. It is a separate client
bundle (`client.js`) and a narrow Host plugin (`index.js`):

- the client mounts `/api/superagent/page` as the full window;
- the page uses `/api/superagent` for `state`, `request`, `answer`, `stop` and
  `resume`;
- the Host plugin drives the public `botExecutionAdapter`; it never reaches
  into the Engine or the old `ds-bot` team UI.

The surface shows one continuous conversation, the current result, an Attention
question, stop/resume, and the verification report. Groups, browsers,
attachments, steer and the old team settings are not part of v1 and are not
rendered.

## Build

```sh
node scripts/build-client.mjs
node scripts/build-client.mjs --check
npm test
```

`client.js` is generated from `src/client.js` and is committed. The page is
`page.html`, served by the Host route.
