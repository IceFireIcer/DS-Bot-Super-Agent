import { Context } from '@deepseek-ai/cordis'
import * as plugin from './index.js'
import { CoreError } from './model.js'

const usage = 'Usage: node dist/cli.js <submit|receipt|query|list|effects> --database <absolute-path> --instance <id> --source <id> --actor <id> --allow-actor <id> [--command <id> --event <id> --text <request> | --ticket <id> | --after <cursor>]'

async function main(args: string[]) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return }
  const action = args.shift()
  if (!action || !['submit', 'receipt', 'query', 'list', 'effects'].includes(action)) throw new CoreError('INVALID_INPUT', usage)
  const common = ['database', 'instance', 'source', 'actor', 'allow-actor']
  const extra = action === 'submit' ? ['command', 'event', 'text'] : action === 'receipt' ? ['command'] : action === 'query' ? ['ticket'] : []
  const values = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2)
    const value = args[i + 1]
    if (!args[i]?.startsWith('--') || !key || ![...common, ...extra, ...(action === 'effects' ? ['after'] : [])].includes(key) || values.has(key) || value === undefined) {
      throw new CoreError('INVALID_INPUT', 'Unknown, repeated or incomplete command option. Use --help.')
    }
    values.set(key, value)
  }
  const required = (key: string) => {
    const value = values.get(key)
    if (!value) throw new CoreError('INVALID_INPUT', 'A required command option is missing. Use --help.')
    return value
  }
  const config = {
    databasePath: required('database'), instanceId: required('instance'),
    source: { sourceInstanceId: required('source'), actorId: required('actor'), allowedActorIds: [required('allow-actor')] },
  }
  for (const key of extra) required(key)
  const ctx = new Context()
  try {
    await ctx.plugin(plugin, config)
    const engine = ctx.get('superagent')
    if (!engine) throw new CoreError('SETUP_FAILED', 'The Super-agent plugin did not start.')
    const result = action === 'submit' ? await engine.submit({ commandId: required('command'), eventId: required('event'), text: required('text') })
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
