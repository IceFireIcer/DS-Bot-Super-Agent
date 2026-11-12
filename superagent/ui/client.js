// Generated from src/client.js by `node scripts/build-client.mjs`. Do not edit by hand.
window.__ModuleLoader__.load({
  id: 'ds-superagent-ui',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
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

    return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
