import { CoreError } from './model.js'

export const maxRemoteOutputBytes = 8192

export interface RemoteOutputWindow {
  text: string
  nextOffset: number
  lossy: boolean
}

export function completeUtf8Length(buffer: Uint8Array) {
  let index = buffer.length - 1
  let continuation = 0
  while (index >= 0 && (buffer[index]! & 0xc0) === 0x80 && continuation < 3) {
    index--
    continuation++
  }
  if (index < 0) return 0
  const lead = buffer[index]!
  const needed = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1
  return buffer.length - index >= needed ? buffer.length : index
}

/**
 * One bounded byte stream with whole-stream offsets. It never consumes a read, and a partial UTF-8
 * character at the end is held back until later bytes complete it.
 */
export class BoundedOutput {
  private buffer: Buffer = Buffer.alloc(0)
  private base = 0
  private total = 0
  private lossy = false
  constructor(private readonly maxBytes = maxRemoteOutputBytes) {}

  static load(buffer: Buffer, total: number) {
    const output = new BoundedOutput()
    output.reset(buffer.subarray(Math.max(0, buffer.length - maxRemoteOutputBytes)), total - Math.min(buffer.length, maxRemoteOutputBytes),
      total, total > maxRemoteOutputBytes)
    return output
  }

  append(chunk: Buffer) {
    this.total += chunk.length
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    if (this.buffer.length > this.maxBytes) this.buffer = this.buffer.subarray(this.buffer.length - this.maxBytes)
    this.base = this.total - this.buffer.length
    this.lossy = this.base > 0
  }

  reset(buffer: Buffer, base: number, total: number, lossy: boolean) {
    const retained = buffer.length > this.maxBytes ? buffer.subarray(buffer.length - this.maxBytes) : buffer
    this.buffer = retained
    this.total = total
    this.base = Math.max(base, total - retained.length)
    this.lossy = lossy || this.base > 0
  }

  get nextOffset() { return this.total }
  get tail() { return this.buffer }
  get truncated() { return this.lossy }

  read(offset: number): RemoteOutputWindow {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.total) {
      throw new CoreError('INVALID_INPUT', 'Output offsets must address bytes already observed for this job.')
    }
    if (offset < this.base) {
      return { text: this.buffer.toString('utf8'), nextOffset: this.total, lossy: true }
    }
    const relativeOffset = offset - this.base
    if (relativeOffset > 0 && (this.buffer[relativeOffset]! & 0xc0) === 0x80) {
      throw new CoreError('INVALID_INPUT', 'Output offsets must lie on a UTF-8 character boundary.')
    }
    const slice = this.buffer.subarray(relativeOffset)
    const safe = completeUtf8Length(slice)
    return { text: slice.subarray(0, safe).toString('utf8'), nextOffset: offset + safe, lossy: false }
  }
}
