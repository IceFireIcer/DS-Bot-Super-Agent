// The Super-agent surface owns the whole window. The page is served by the
// same-origin Host route and talks to the narrow /api/superagent channel.
export function apply(ctx) {
  ctx.effect(() => {
    const frame = document.createElement('iframe')
    frame.src = '/api/superagent/page'
    frame.title = 'Super-agent'
    frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647;background:#fcfcfc'
    document.body.append(frame)
    return () => frame.remove()
  }, 'ds-superagent-ui: full surface')
}
