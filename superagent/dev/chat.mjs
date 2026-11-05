import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { Engine, NativeSessions, createChatServer } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, demonstrationResponse } from './native-mock.mjs'

const directory = await mkdtemp(join(tmpdir(), 'ds-bot-native-chat-'))
let context
let sessions
let storage
let engine
let chat
try {
  context = await nativeContext(join(directory, 'sessions'), demonstrationResponse)
  storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
  sessions = new NativeSessions(context, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
  engine = new Engine(storage, 'preview', { sourceInstanceId: 'desktop-preview', actorId: 'local-user', allowedActorIds: ['local-user'] }, { scanIntervalMs: 50 }, sessions)
  chat = await createChatServer(engine)
  engine.effects.start()
  console.log(JSON.stringify({ url: chat.url, model: 'scripted mock through native DSH Router/Worker loops', request: 'What is 2 + 2?', ephemeral: true }))
  await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')])
} finally {
  await chat?.close()
  await engine?.effects.stop()
  await sessions?.close()
  await context?.fiber.dispose()
  await storage?.close()
  await rm(directory, { recursive: true, force: true })
}
