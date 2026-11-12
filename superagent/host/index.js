export const name = 'ds-superagent-host'
export const inject = ['connection', 'superagentUi']

export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/superagent', methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      let result
      try {
        const body = await request.json()
        if (!body || typeof body.endpoint !== 'string' || body.payload !== undefined
          && (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload))) {
          throw Object.assign(new Error('A request needs an endpoint and an object payload.'), { code: 'INVALID_INPUT' })
        }
        result = { ok: true, value: await ctx.superagentUi.handle(body.endpoint, body.payload) }
      } catch (error) {
        result = { ok: false, error: { code: error.code === 'UNSUPPORTED_CAPABILITY' ? 'superagent/unsupported' : error.code ?? 'superagent/error',
          message: error.message ?? 'Request failed.' } }
      }
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    },
  }))
}
