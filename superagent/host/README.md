# DS Super-agent Host

This package registers `/api/superagent` through DSH's public
`connection.fetch.register`. It consumes the profile's `superagentUi` service;
it does not import or mount the DS Bot Host.

The six v1 endpoints are `state`, `send`, `evidence`, `answer`, `stop`, and
`resume`. Requests are JSON `{ endpoint, payload }`; responses are
`{ ok: true, value }` or `{ ok: false, error: { code, message } }`.
Commands require a stable `requestId`. Unsupported commands return
`superagent/unsupported`. Authentication belongs to the existing DSH carrier.

`state` returns durable message items, current Ticket controls, and a bounded
sequence cursor. Clients merge messages by stable `id` and continue while
`hasMore` is true. `evidence` accepts a Ticket, context `ref`, and optional
`after` byte cursor, and returns a public Engine context card.
