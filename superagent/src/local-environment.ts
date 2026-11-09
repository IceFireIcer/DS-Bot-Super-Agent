import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, matchesGlob, sep, parse } from 'node:path'
import { CoreError, identifier } from './model.js'
import type { EnvironmentConfig, ExecutionEnvironment, PreparedEnvironment } from './environment.js'
import { protectedPath } from './path-safety.js'
import { sanitizeSecrets } from './sanitize.js'

export type LocalPermission = 'read' | 'write' | 'search' | 'command'
export interface LocalCommand { argv: string[]; timeoutMs: number; backgroundTimeoutMs?: number }
export type LocalEnvironmentConfig = EnvironmentConfig
export interface Artifact { path: string; bytes: number; sha256: string }
export interface LocalToolFact { tool: string; outcome: 'success' | 'failed'; output: Record<string, unknown> }
export interface LocalJobOutput { text: string; lossy: boolean }
export interface LocalJobResult { exitCode: number | null; cancelled: boolean; truncated: boolean; settled: boolean }

/** One background process range: bounded offset reads, a termination verb and exit facts. */
export interface LocalJob {
  /** Stable device job identity, present when the process runs outside this Host. */
  readonly jobId?: string
  readonly done: Promise<LocalJobResult>
  read(): { stdout: LocalJobOutput; stderr: LocalJobOutput }
  terminate(): void
  waitForExit(signal?: AbortSignal): Promise<boolean>
}

class BoundLocalJob implements LocalJob {
  readonly done: Promise<LocalJobResult>
  constructor(private readonly handle: SubprocessHandle, private readonly deadline: AbortSignal, private readonly sanitize: (text: string) => string) {
    this.done = (async () => {
      const outcome = await handle.done
      const settled = await handle.waitForExit(AbortSignal.timeout(2000))
      const stdout = handle.collected.stdout!.readFrom(0)
      const stderr = handle.collected.stderr!.readFrom(0)
      return { exitCode: outcome.exitCode, cancelled: deadline.aborted, truncated: stdout.lossy || stderr.lossy, settled }
    })()
    // Job state is read through its caller's own await; an unobserved rejection must not crash the Host.
    void this.done.catch(() => {})
  }

  read() {
    const read = (reader: { readFrom(offset: number): { text: string; lossy: boolean } }) => {
      const delta = reader.readFrom(0)
      return { text: delta.lossy ? '' : this.sanitize(delta.text), lossy: delta.lossy }
    }
    return { stdout: read(this.handle.collected.stdout!), stderr: read(this.handle.collected.stderr!) }
  }

  terminate() { this.handle.terminate() }

  waitForExit(signal?: AbortSignal) { return this.handle.waitForExit(signal) }
}

export class LocalEnvironment implements ExecutionEnvironment {
  readonly kind = 'local' as const
  readonly config: Readonly<LocalEnvironmentConfig>
  private closed = false
  private rootIdentity: string | undefined
  private constructor(private readonly context: Context, config: LocalEnvironmentConfig) {
    this.config = structuredClone(config)
    Object.freeze(this.config.allowedActorIds)
    Object.freeze(this.config.permissions)
    for (const command of Object.values(this.config.commands)) { Object.freeze(command.argv); Object.freeze(command) }
    Object.freeze(this.config.commands)
    Object.freeze(this.config)
  }

  static async open(config: LocalEnvironmentConfig): Promise<LocalEnvironment> {
    config = structuredClone(config)
    identifier(config.id, 'environmentId')
    identifier(config.instanceId, 'instanceId')
    if (!isAbsolute(config.root) || !Array.isArray(config.allowedActorIds) || !Array.isArray(config.permissions) || config.permissions.some(permission => !['read', 'write', 'search', 'command'].includes(permission))) throw new CoreError('INVALID_CONFIG', 'A local environment needs an absolute directory, explicit actors and supported permissions.')
    for (const actor of config.allowedActorIds) identifier(actor, 'allowedActorId')
    if (!config.commands || typeof config.commands !== 'object' || Object.keys(config.commands).length > 16) throw new CoreError('INVALID_CONFIG', 'Configure at most sixteen named commands.')
    for (const [name, command] of Object.entries(config.commands)) {
      identifier(name, 'command name')
      if (!Array.isArray(command.argv) || !command.argv[0] || command.argv.length > 64 || command.argv.some(value => typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value) > 16384) || !Number.isInteger(command.timeoutMs) || command.timeoutMs < 50 || command.timeoutMs > 10000) throw new CoreError('INVALID_CONFIG', 'Commands need bounded fixed argv and a 50–10000 ms deadline.')
      if (command.backgroundTimeoutMs !== undefined && (!Number.isInteger(command.backgroundTimeoutMs) || command.backgroundTimeoutMs < command.timeoutMs || command.backgroundTimeoutMs > 3600000)) throw new CoreError('INVALID_CONFIG', 'A background command deadline must be an integer between its foreground deadline and one hour.')
    }
    if (config.setup && (!Object.hasOwn(config.commands, config.setup) || !config.permissions.includes('command'))) throw new CoreError('INVALID_CONFIG', 'The setup command and command permission must be configured explicitly.')
    const context = new Context()
    try {
      await context.plugin(LocalFileSystem, { cwd: config.root })
      await context.plugin(LocalSubprocessRuntime)
      return new LocalEnvironment(context, config)
    } catch { await context.fiber.dispose(); throw new CoreError('LOCAL_PROVIDER_UNAVAILABLE', 'The public local DSH providers could not be mounted.') }
  }

  authorize(identity: { instanceId: string; actorId: string }) {
    if (this.closed) throw new CoreError('ENVIRONMENT_CLOSED', 'The local environment is closed.')
    if (identity.instanceId !== this.config.instanceId || !this.config.allowedActorIds.includes(identity.actorId)) throw new CoreError('ENVIRONMENT_DENIED', 'This actor or instance cannot use the local environment.')
  }

  async verifyRoot(signal?: AbortSignal) {
    let prefix = parse(this.config.root).root
    for (const part of this.config.root.slice(prefix.length).split(/[\\/]/u).filter(Boolean)) {
      prefix = resolve(prefix, part)
      if ((await this.context.fs.lstat(prefix, {}, signal))?.type === 'symlink') throw new CoreError('SETUP_FAILED', 'The working directory and its ancestors must not be symbolic links or junctions.')
    }
    // FsVersion is an opaque freshness token; directory writes change it too.
    const observed = await stat(this.config.root, { bigint: true })
    if (!observed.isDirectory() || observed.ino === 0n) throw new CoreError('SETUP_FAILED', 'A stable local working directory identity is required.')
    const identity = `${observed.dev}:${observed.ino}:${observed.birthtimeNs}`
    if (this.rootIdentity !== undefined && this.rootIdentity !== identity) throw new CoreError('ENVIRONMENT_CHANGED', 'The physical working directory changed; configure a new Environment instead of retrying this binding.')
    this.rootIdentity = identity
  }

  async prepare(identity: { instanceId: string; actorId: string }, signal?: AbortSignal): Promise<BoundLocalEnvironment> {
    signal?.throwIfAborted()
    this.authorize(identity)
    try {
      const fs = this.context.fs
      await this.verifyRoot()
      const root = await fs.resolve(this.config.root)
      if ((await fs.stat(root))?.type !== 'directory' || (await fs.lstat(this.config.root))?.type === 'symlink') throw new CoreError('SETUP_FAILED', 'The configured working directory must exist and be a real directory.')
      const bound = new BoundLocalEnvironment(this, this.context, root, { ...identity })
      for (const command of Object.values(this.config.commands)) await this.context.subprocess.resolveExecutable(command.argv[0]!)
      if (this.config.setup) {
        const result = await bound.command(this.config.setup, signal)
        if (result.exitCode !== 0 || result.cancelled || result.truncated) throw new LocalSetupError(result)
      }
      return bound
    } catch (error) {
      if (error instanceof LocalSetupError || error instanceof CoreError) throw error
      throw new CoreError('SETUP_FAILED', 'The directory or executable checks failed in this local environment.')
    }
  }

  async close() { this.closed = true; await this.context.fiber.dispose() }
}

export class LocalSetupError extends CoreError {
  constructor(readonly output: Record<string, unknown>) { super('SETUP_FAILED', 'The configured directory setup command failed; inspect its bounded output and retry explicitly.') }
}

export class BoundLocalEnvironment implements PreparedEnvironment {
  readonly cwd: string
  constructor(private readonly owner: LocalEnvironment, private readonly context: Context, private readonly root: FsTarget, private readonly identity: { instanceId: string; actorId: string }) { this.cwd = context.fs.processPath(root) }

  private async target(path: string, signal?: AbortSignal) {
    if (typeof path !== 'string' || !path || path.length > 1024 || isAbsolute(path) || path.includes(':') || path.split(/[\\/]/u).includes('..') || protectedPath(path)) throw new CoreError('PATH_DENIED', 'Use a relative non-sensitive path inside the bound working directory.')
    const fs = this.context.fs
    await this.owner.verifyRoot(signal)
    const currentRoot = await fs.resolve(this.owner.config.root, signal ? { signal } : {})
    if (!fs.contains(this.root, currentRoot) || !fs.contains(currentRoot, this.root)) throw new CoreError('ENVIRONMENT_CHANGED', 'The working directory identity changed; setup must be checked again.')
    let prefix = this.cwd
    for (const part of path.split(/[\\/]/u).filter(part => part !== '.')) {
      prefix = resolve(prefix, part)
      if ((await fs.lstat(prefix, {}, signal))?.type === 'symlink') throw new CoreError('PATH_DENIED', 'Symbolic links are not enabled in this local tool combination.')
    }
    const target = await fs.resolve(path, { cwd: this.cwd, ...(signal ? { signal } : {}) })
    if (!fs.contains(this.root, target) || protectedPath(relative(this.cwd, fs.processPath(target)))) throw new CoreError('PATH_DENIED', 'The path resolves outside the authorized working directory.')
    return target
  }

  private permission(name: LocalPermission) {
    this.owner.authorize(this.identity)
    if (!this.owner.config.permissions.includes(name)) throw new CoreError('PERMISSION_DENIED', 'This local capability was not enabled by the deployment.')
  }

  sanitize(text: string) {
    return sanitizeSecrets(text).split(this.cwd).join('<workdir>')
  }

  async artifact(path: string, signal?: AbortSignal): Promise<Artifact> {
    this.permission('read')
    const target = await this.target(path, signal)
    const bytes = await this.context.fs.readBytes(target, signal, 65536)
    return { path: relative(this.cwd, this.context.fs.processPath(target)).split(sep).join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  }

  async command(name: string, signal?: AbortSignal) {
    this.permission('command')
    const configured = Object.hasOwn(this.owner.config.commands, name) ? this.owner.config.commands[name] : undefined
    if (!configured) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Only configured command names can run; arbitrary argv, Shell, PTY and remote tools are not enabled.')
    await this.target('.', signal)
    const deadline = AbortSignal.timeout(configured.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    const executable = await this.context.subprocess.resolveExecutable(configured.argv[0]!, {}, combined)
    const handle = this.context.subprocess.spawn({ argv: [executable, ...configured.argv.slice(1)], cwd: this.cwd, stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } }, graceMs: 250, signal: combined })
    try {
      const outcome = await handle.done
      const settled = await handle.waitForExit(AbortSignal.timeout(2000))
      if (!settled) throw new CoreError('COMMAND_UNKNOWN', 'The local process range did not confirm exit; no retry is authorized.')
      const stdout = handle.collected.stdout!.readFrom(0)
      const stderr = handle.collected.stderr!.readFrom(0)
      return { exitCode: outcome.exitCode, cancelled: combined.aborted, stdout: stdout.lossy ? '[Truncated output withheld to protect credentials.]' : this.sanitize(stdout.text), stderr: stderr.lossy ? '[Truncated output withheld to protect credentials.]' : this.sanitize(stderr.text), truncated: stdout.lossy || stderr.lossy }
    } catch (error) {
      handle.terminate()
      await handle.waitForExit(AbortSignal.timeout(2000)).catch(() => false)
      if (error instanceof CoreError) throw error
      throw new CoreError('COMMAND_FAILED', 'The local command could not complete; provider diagnostics are withheld to protect credentials.')
    }
  }

  /**
   * Starts one configured command as a background job. The job's own declared deadline bounds it;
   * the caller's own cancellation is deliberately not attached, because background work has to outlive
   * the turn that started it and is stopped through the durable job record instead.
   */
  async startCommand(name: string): Promise<LocalJob> {
    this.permission('command')
    const configured = Object.hasOwn(this.owner.config.commands, name) ? this.owner.config.commands[name] : undefined
    if (!configured) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Only configured command names can run; arbitrary argv, Shell, PTY and remote tools are not enabled.')
    if (name === this.owner.config.setup) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Setup is controlled by preparation and explicit retry, not model tools.')
    await this.target('.')
    const deadline = AbortSignal.timeout(configured.backgroundTimeoutMs ?? configured.timeoutMs)
    const executable = await this.context.subprocess.resolveExecutable(configured.argv[0]!, {}, deadline)
    const handle = this.context.subprocess.spawn({ argv: [executable, ...configured.argv.slice(1)], cwd: this.cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 8192 }, stderr: { maxBytes: 8192 } }, graceMs: 250, signal: deadline })
    return new BoundLocalJob(handle, deadline, text => this.sanitize(text))
  }

  async invoke(name: string, args: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    try { return await this.execute(name, args, signal) }
    catch (error) {
      if (error instanceof CoreError) throw error
      throw new CoreError('LOCAL_TOOL_FAILED', 'The bound local operation failed; provider diagnostics are withheld to protect credentials.')
    }
  }

  private async execute(name: string, args: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    signal?.throwIfAborted()
    if (name === 'run_command') {
      if (args.name === this.owner.config.setup) throw new CoreError('UNSUPPORTED_CAPABILITY', 'Setup is controlled by preparation and explicit retry, not model tools.')
      return this.command(args.name!, signal)
    }
    if (name === 'read_file') {
      this.permission('read')
      const target = await this.target(args.path!, signal)
      const bytes = await this.context.fs.readBytes(target, signal, 65536)
      return { text: this.sanitize(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
    }
    if (name === 'write_file') {
      this.permission('write')
      if (typeof args.text !== 'string' || Buffer.byteLength(args.text) > 65536) throw new CoreError('INVALID_INPUT', 'File writes are limited to 65536 UTF-8 bytes.')
      const target = await this.target(args.path!, signal)
      const observed = await this.context.fs.stat(target, signal)
      await this.context.fs.writeText(target, args.text, observed ? { kind: 'replaceIfVersion', version: observed.version } : { kind: 'createIfAbsent' }, signal)
      return { path: args.path!, bytes: Buffer.byteLength(args.text) }
    }
    if (name !== 'glob' && name !== 'grep') throw new CoreError('UNSUPPORTED_CAPABILITY', 'This local tool combination is not enabled.')
    this.permission('search')
    if (!args.pattern || args.pattern.length > 256) throw new CoreError('INVALID_INPUT', 'Search needs a bounded nonempty pattern.')
    const paths: string[] = []
    const matches: { path: string; line: number; text: string }[] = []
    const pending = ['.']
    let visited = 0
    let bytesRead = 0
    while (pending.length) {
      const directory = pending.shift()!
      const entries = await this.context.fs.listDir(await this.target(directory, signal), signal)
      for (const entry of entries) {
        if (++visited > 500) throw new CoreError('SEARCH_LIMIT', 'The bounded search exceeded 500 entries.')
        const path = directory === '.' ? entry.name : `${directory}/${entry.name}`
        if (protectedPath(path) || (await this.context.fs.lstat(resolve(this.cwd, path), {}, signal))?.type === 'symlink') continue
        await this.target(path, signal)
        if (entry.type === 'directory') { pending.push(path); continue }
        if (entry.type !== 'file') continue
        if (name === 'glob') { if (matchesGlob(path, args.pattern) || !args.pattern.includes('/') && matchesGlob(entry.name, args.pattern)) paths.push(path) }
        else {
          this.permission('read')
          const bytes = await this.context.fs.readBytes(entry.target, signal, 65536)
          bytesRead += bytes.length
          if (bytesRead > 1048576) throw new CoreError('SEARCH_LIMIT', 'The bounded search exceeded one MiB.')
          const text = new TextDecoder().decode(bytes)
          if (text.includes('\0')) continue
          for (const [index, line] of text.split(/\r?\n/u).entries()) if (line.includes(args.pattern)) matches.push({ path, line: index + 1, text: this.sanitize(line).slice(0, 1000) })
        }
        if (paths.length > 100 || matches.length > 100) throw new CoreError('SEARCH_LIMIT', 'Narrow the search to at most 100 results.')
      }
    }
    return name === 'glob' ? { paths: paths.sort() } : { matches }
  }
}
