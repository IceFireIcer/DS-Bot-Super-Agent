// Test-only LLM provider for the real ds-superagent profile check. The Host
// uses the public DSH LLM runtime; this adapter answers the Router/Worker
// turns without a network key.
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { routerResponse, toolResponse } from '../../superagent/dev/native-mock.mjs'

export const name = 't60-mock-llm'
export const inject = ['llm']

export function apply(ctx) {
  class MockAdapter extends LlmAdapter {
    async *stream(options) {
      if (options.model === 'router') { yield* routerResponse(options); return }
      yield* toolResponse('report_ready', { result: 'Completed the T60 copy check.',
        evidence: 'The real profile completed the mock request.' })
    }
  }
  ctx.llm.registerAdapter(['mock'], new MockAdapter())
}
