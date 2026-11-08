/** Source and response helpers shared by the T16 integration test and its crash fixture. */
export function sourceConfig() {
  return {
    sourceInstanceId: 'desktop', actorId: 'user', allowedActorIds: ['user'], allowedThreadIds: ['room'], versionOrder: 'sequence',
    intake: { mode: 'auto', maxBatchSize: 5, maxAttempts: 1, timeoutMs: 5000, allowedRequesterIds: ['alice'], allowedBotActorIds: [],
      rules: [{ id: 'human-direct', actorKinds: ['human'], addressing: ['direct'], mode: 'explicit' }] },
  }
}

export function lastUserText(options) {
  const user = options.messages.filter(message => message.role === 'user').at(-1)
  return user.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

export function completedToolCount(options) {
  const user = options.messages.filter(message => message.role === 'user').at(-1)
  return options.messages.slice(options.messages.lastIndexOf(user) + 1).filter(message => message.role === 'tool').length
}
