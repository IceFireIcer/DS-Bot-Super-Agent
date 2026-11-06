import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { Engine, NativeSessions, LocalEnvironment, createChatServer } from '../dist/index.js'
import { SqliteStorage } from '../dist/storage.js'
import { nativeContext, toolResponse, textResponse, routerResponse } from './native-mock.mjs'

export async function* localDemonstration(options) {
  const user = options.messages.filter(message => message.role === 'user').at(-1)
  const results = options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool')
  if (options.signal?.aborted) return
  if (options.model === 'worker') {
    const plan = [
      ['write_file', { path: 'answer.txt', text: 'hello\n' }], ['read_file', { path: 'answer.txt' }],
      ['glob', { pattern: '*.txt' }], ['grep', { pattern: 'hello' }], ['run_command', { name: 'verify' }],
      ['report_ready', { result: 'Created answer.txt containing hello and verified it with a local command.', evidence: 'Read the file, found it by glob, matched line 1 with grep, and ran the configured verification command successfully.', artifacts: 'answer.txt' }],
    ]
    const next = plan[results.length]
    yield* next ? toolResponse(next[0], next[1], `local-${results.length}`) : textResponse('Ready.')
  } else yield* routerResponse(options)
}

export async function localPreview() {
  const directory = await mkdtemp(join(tmpdir(), 'ds-bot-local-chat-'))
  const root = join(directory, 'project')
  let context, storage, sessions, environment, engine, chat
  const close = async () => {
    await chat?.close(); await engine?.effects.stop(); await sessions?.close(); await context?.fiber.dispose(); await storage?.close(); await environment?.close()
    await rm(directory, { recursive: true, force: true })
  }
  try {
    await mkdir(root)
    environment = await LocalEnvironment.open({ id: 'sample-project', instanceId: 'local-preview', root, allowedActorIds: ['local-user'], permissions: ['read', 'write', 'search', 'command'], commands: {
      verify: { argv: [process.execPath, '-e', "const fs=require('node:fs');const text=fs.readFileSync('answer.txt','utf8');if(text!=='hello\\n')process.exit(1);console.log('Verified answer.txt: hello')"], timeoutMs: 2000 },
    } })
    context = await nativeContext(join(directory, 'sessions'), localDemonstration)
    storage = await SqliteStorage.open(join(directory, 'state.sqlite'))
    sessions = new NativeSessions(context, { router: { provider: 'mock', model: 'router' }, worker: { provider: 'mock', model: 'worker' } })
    engine = new Engine(storage, 'local-preview', { sourceInstanceId: 'desktop', actorId: 'local-user', allowedActorIds: ['local-user'] }, { scanIntervalMs: 50 }, sessions, [environment])
    chat = await createChatServer(engine)
    engine.effects.start()
    return { url: chat.url, engine, root, close }
  } catch (error) { await close(); throw error }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const preview = await localPreview()
  console.log(JSON.stringify({ url: preview.url, environment: 'sample-project', model: 'scripted mock through native DSH loops; actual local files and command', request: 'Create answer.txt containing hello, then verify it.' }))
  try { await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]) }
  finally { await preview.close() }
}
