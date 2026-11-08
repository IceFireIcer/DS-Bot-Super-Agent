import { Context } from '@deepseek-ai/cordis'
import * as plugin from './index.js'
import { CoreError } from './model.js'

const usage = 'Usage: node dist/cli.js <submit|receipt|query|list|effects|source-receive|source-query|source-history|source-receipt|source-accept> --database <absolute-path> --instance <id> --source <id> --actor <id> --allow-actor <id>. Source actions also require --allow-thread <id> --version-order <sequence|opaque>; see superagent/README.md for action options.'

async function main(args: string[]) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return }
  const action = args.shift()
  const actions: Record<string, { required: string[]; optional?: string[] }> = {
    submit: { required: ['command', 'event', 'text'] }, receipt: { required: ['command'] }, query: { required: ['ticket'] }, list: { required: [] }, effects: { required: [], optional: ['after'] },
    'source-receive': { required: ['command', 'thread', 'object', 'type', 'version'], optional: ['text', 'deletion-evidence'] },
    'source-query': { required: ['thread', 'object'] }, 'source-history': { required: ['thread', 'object'], optional: ['after', 'limit'] },
    'source-receipt': { required: ['command'] }, 'source-accept': { required: ['command', 'thread', 'object', 'expected-event'] },
  }
  if (!action || !Object.hasOwn(actions, action)) throw new CoreError('INVALID_INPUT', usage)
  const sourceAction = action.startsWith('source-')
  const common = ['database', 'instance', 'source', 'actor', 'allow-actor', ...(sourceAction ? ['allow-thread', 'version-order'] : [])]
  const extra = actions[action]!.required
  const values = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2)
    const value = args[i + 1]
    if (!args[i]?.startsWith('--') || !key || ![...common, ...extra, ...(actions[action]!.optional ?? [])].includes(key) || values.has(key) || value === undefined) {
      throw new CoreError('INVALID_INPUT', 'Unknown, repeated or incomplete command option. Use --help.')
    }
    values.set(key, value)
  }
  const required = (key: string) => {
    const value = values.get(key)
    if (!value) throw new CoreError('INVALID_INPUT', 'A required command option is missing. Use --help.')
    return value
  }
  const versionOrder = sourceAction ? required('version-order') : undefined
  if (versionOrder !== undefined && versionOrder !== 'sequence' && versionOrder !== 'opaque') throw new CoreError('INVALID_INPUT', 'Use sequence or opaque native version ordering.')
  const config: plugin.Config = {
    databasePath: required('database'), instanceId: required('instance'),
    source: { sourceInstanceId: required('source'), actorId: required('actor'), allowedActorIds: [required('allow-actor')],
      ...(versionOrder ? { versionOrder, allowedThreadIds: [required('allow-thread')] } : {}) },
  }
  for (const key of extra) required(key)
  const ctx = new Context()
  try {
    await ctx.plugin(plugin, config)
    const engine = ctx.get('superagent')
    if (!engine) throw new CoreError('SETUP_FAILED', 'The Super-agent plugin did not start.')
    const ref = sourceAction && action !== 'source-receipt' ? { threadId: required('thread'), objectId: required('object') } : undefined
    const type = action === 'source-receive' ? required('type') : undefined
    if (type !== undefined && !['created', 'edited', 'deleted'].includes(type)) throw new CoreError('INVALID_INPUT', 'Use created, edited or deleted native events.')
    const result = action === 'source-receive' ? await engine.receiveSource({ ...ref!, commandId: required('command'), type: type as 'created' | 'edited' | 'deleted', version: required('version'),
      ...(values.has('text') ? { text: required('text') } : {}), ...(values.has('deletion-evidence') ? { deletionEvidence: required('deletion-evidence') } : {}) })
      : action === 'source-query' ? await engine.getSourceObject(ref!)
      : action === 'source-history' ? await engine.getSourceHistory(ref!, { ...(values.has('after') ? { after: required('after') } : {}), ...(values.has('limit') ? { limit: Number(required('limit')) } : {}) })
      : action === 'source-receipt' ? await engine.getSourceReceipt(required('command'))
      : action === 'source-accept' ? await engine.acceptSource({ ...ref!, commandId: required('command'), expectedEventId: required('expected-event') })
      : action === 'submit' ? await engine.submit({ commandId: required('command'), eventId: required('event'), text: required('text') })
      : action === 'receipt' ? await engine.getReceipt(required('command'))
      : action === 'query' ? await engine.getTicket(required('ticket'))
      : action === 'effects' ? await engine.effects.list(values.get('after'))
      : await engine.listTickets()
    console.log(JSON.stringify(result ?? null))
  } finally { await ctx.fiber.dispose() }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(JSON.stringify({ code: error instanceof CoreError ? error.code : 'COMMAND_FAILED', message: error instanceof Error ? error.message : 'The command failed.' }))
  process.exitCode = 1
})
