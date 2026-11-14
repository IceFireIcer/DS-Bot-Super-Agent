import * as Profile from '../../dist/profile.js'
import { nativeContext, textResponse } from '../../dev/native-mock.mjs'

const args = process.argv.slice(2)
const argument = name => args[args.indexOf(`--${name}`) + 1]
const home = argument('home')
const sessionsPath = argument('sessions')
if (!home || !sessionsPath) throw new Error('Pass isolated --home and --sessions directories.')
process.env.DSH_HOME = home
let native
try {
  native = await nativeContext(sessionsPath, function* (request) {
    if (request.model !== 'main') throw new Error('Ordinary chat must call Main.')
    yield* textResponse('Hello from the independent Main.')
  })
  await native.plugin(Profile, {
    main: { provider: 'mock', model: 'main' },
    router: { provider: 'mock', model: 'router' },
    worker: { provider: 'mock', model: 'worker' },
  })
  const product = native.get('superagentProduct')
  const binding = await product.dispatch('open')
  const otherWindow = await product.dispatch('open')
  await product.dispatch('send', { instanceId: binding.instanceId, commandId: 'profile-message', text: 'Hello Main.' })
  const history = await product.dispatch('history', { instanceId: binding.instanceId })
  let crossInstanceDenied = false
  try { await product.dispatch('history', { instanceId: 'another-private-scope' }) }
  catch (error) { crossInstanceDenied = error.code === 'SOURCE_NOT_AUTHORIZED' }
  console.log(JSON.stringify({ mainId: binding.mainId, sameMain: otherWindow.mainId === binding.mainId,
    userMessages: history.messages.filter(message => message.role === 'user').length,
    mainMessages: history.messages.filter(message => message.role === 'main').length,
    legacyAdapter: native.get('botExecutionAdapter') !== undefined, crossInstanceDenied }))
} finally { await native?.fiber.dispose() }
