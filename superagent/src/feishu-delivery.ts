import { createHash } from 'node:crypto'
import { CoreError } from './model.js'
import type { DeliveryChannel, DeliveryContext, DeliveryResult, DeliveryView } from './deliveries.js'
import { FeishuApiError } from './feishu-api.js'

export interface FeishuReplyTransport {
  replyMessage(request: { messageId: string; text: string; uuid: string; signal: AbortSignal }): Promise<{ messageId: string }>
}

export interface FeishuDeliveryChannelOptions {
  /** IM replies are kept short; the full text remains in the Ticket. */
  maxTextChars?: number
}

/**
 * Deliver confirmations, questions, answers and results back into the exact Feishu
 * message that started the work. Feishu deduplicates the same uuid for one hour, so
 * a retry or reconcile inside that window cannot post twice.
 */
export class FeishuDeliveryChannel implements DeliveryChannel {
  private readonly maxTextChars: number
  constructor(private readonly transport: FeishuReplyTransport, options: FeishuDeliveryChannelOptions = {}) {
    this.maxTextChars = options.maxTextChars ?? 4000
    if (!Number.isInteger(this.maxTextChars) || this.maxTextChars < 200 || this.maxTextChars > 150000) {
      throw new CoreError('INVALID_CONFIG', 'A Feishu IM reply budget is 200–150000 characters.')
    }
  }

  deliver(delivery: DeliveryView, context: DeliveryContext): Promise<DeliveryResult> {
    return this.send(delivery, context)
  }

  reconcile(delivery: DeliveryView, context: DeliveryContext): Promise<DeliveryResult> {
    return this.send(delivery, context)
  }

  private async send(delivery: DeliveryView, context: DeliveryContext): Promise<DeliveryResult> {
    if (!delivery.destination.sourceInstanceId.startsWith('feishu:')) {
      return { type: 'permanent', reason: 'DESTINATION_MISMATCH: the delivery target is not a Feishu source.' }
    }
    const messageId = nativeMessageId(delivery.destination.eventId)
    if (!messageId) return { type: 'permanent', reason: 'DESTINATION_UNSUPPORTED: the target is not a Feishu message.' }
    const text = this.imText(delivery.text)
    if (Buffer.byteLength(JSON.stringify({ text })) > 150 * 1024) {
      return { type: 'permanent', reason: 'MESSAGE_TOO_LARGE: the reply exceeds the Feishu text limit.' }
    }
    try {
      await this.transport.replyMessage({ messageId, text, uuid: uuidFor(context.idempotencyKey), signal: context.signal })
      return { type: 'success' }
    } catch (error) {
      if (error instanceof FeishuApiError) {
        const status = error.httpStatus ?? 0
        if (status === 429 || status >= 500) return { type: 'transient', reason: `FEISHU_HTTP_${status}` }
        if (error.feishuCode === 99991400 || error.feishuCode === 99991663) return { type: 'transient', reason: `FEISHU_${error.feishuCode}` }
        if (error.feishuCode === 230110) return { type: 'permanent', reason: 'DESTINATION_GONE: the Feishu message was deleted.' }
        if (error.feishuCode !== undefined && [230002, 230006, 230013, 230027, 230073, 231203, 231204].includes(error.feishuCode)) {
          return { type: 'permanent', reason: `FEISHU_${error.feishuCode}` }
        }
        return { type: 'unknown', reason: `FEISHU_${error.feishuCode ?? 'UNKNOWN'}` }
      }
      if (error instanceof CoreError && error.code === 'SOURCE_STOPPED') return { type: 'transient', reason: 'SOURCE_STOPPED' }
      if (error instanceof CoreError && (error.code === 'INVALID_INPUT' || error.code === 'INVALID_CONFIG')) {
        return { type: 'permanent', reason: error.code }
      }
      return { type: 'transient', reason: error instanceof Error ? error.message.slice(0, 200) : 'FEISHU_UNKNOWN' }
    }
  }

  private imText(text: string) {
    if (text.length <= this.maxTextChars) return text
    const suffix = '\n\n[Truncated for Feishu. The full text is in the Ticket.]'
    return text.slice(0, Math.max(0, this.maxTextChars - suffix.length)) + suffix
  }
}

function nativeMessageId(eventId: string) {
  return eventId.startsWith('message:') ? eventId.slice('message:'.length) : undefined
}

/** Feishu accepts at most 50 characters and deduplicates this value for one hour. */
function uuidFor(idempotencyKey: string) {
  return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)
}
