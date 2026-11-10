import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { CoreError } from './model.js'
import type { EnvironmentLocation } from './environment.js'

export const maxWorkCopyFiles = 2000
export const maxWorkCopyChanges = 500
export const maxWorkCopyScanBytes = 16 * 1024 * 1024
export const maxWorkCopyChangeBytes = 8 * 1024 * 1024
export const maxWorkCopyPatchBytes = 1024 * 1024

export type WorkCopyFileState = 'tracked' | 'modified' | 'added' | 'deleted' | 'untracked'

export interface WorkCopyFile {
  path: string
  state: WorkCopyFileState
  executable: boolean
  bytes: number
  sha256: string
}

export interface WorkCopyDigest { bytes: number; sha256: string }

export interface WorkCopySnapshot {
  root: string
  git: { commit: string; branch?: string }
  files: WorkCopyFile[]
  changes: WorkCopyFile[]
  totalBytes: number
  scanBytes: number
  patch: WorkCopyDigest
}

export interface WorkCopyBlocker { code: string; message: string }

export interface WorkCopyComparison {
  status: 'prepared' | 'verified' | 'handoff-blocked'
  blockers: WorkCopyBlocker[]
  filesToCopy: WorkCopyFile[]
  totalBytes: number
}

export interface HandoffCopyView {
  id: string
  instanceId: string
  ticketId: string
  assignmentId: string
  source: EnvironmentLocation
  target: EnvironmentLocation
  baseCommit: string
  branch?: string
  files: WorkCopyFile[]
  patch: WorkCopyDigest
  totalBytes: number
  status: 'prepared' | 'verified' | 'handoff-blocked'
  blockers: WorkCopyBlocker[]
  preparedAt: number
  verifiedAt?: number
}

export const workCopyGaps = {
  gitUnavailable: 'git-unavailable',
  notRepository: 'not-a-git-repository',
  notRepositoryRoot: 'not-the-repository-root',
  noCommit: 'repository-has-no-commit',
  rename: 'rename-not-supported',
  symlink: 'symbolic-link-not-supported',
  scanBudget: 'work-copy-scan-budget',
  changeBudget: 'work-copy-change-budget',
  patchBudget: 'work-copy-patch-budget',
  inspectMissing: 'work-copy-inspection-unavailable',
} as const

export class WorkCopyUnsupported extends CoreError {
  constructor(message: string, readonly gaps: string[]) {
    super('WORK_COPY_UNSUPPORTED', `${message} Gaps: ${gaps.join(', ')}.`)
  }
}

function gitFailure(stdout: string, stderr: string, code: number | null) {
  const detail = (stderr || stdout).trim().slice(0, 500)
  return new CoreError('WORK_COPY_GIT_FAILED', `Git inspection failed${code === null ? '' : ` (${code})`}${detail ? `: ${detail}` : '.'}`)
}

function runGit(root: string, args: string[], limit: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let stderr = ''
    let size = 0
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new WorkCopyUnsupported('Git inspection exceeded its declared time budget.', [workCopyGaps.scanBudget]))
    }, 15000)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
    }
    child.stdout.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        child.kill('SIGKILL')
        finish(new WorkCopyUnsupported('Git inspection exceeded its output budget.', [workCopyGaps.scanBudget]))
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk })
    child.once('error', error => {
      finish((error as NodeJS.ErrnoException).code === 'ENOENT'
        ? new WorkCopyUnsupported('Git is not available in this execution world.', [workCopyGaps.gitUnavailable])
        : error)
    })
    child.once('exit', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const output = Buffer.concat(chunks)
      if (code !== 0) reject(gitFailure(output.toString('utf8'), stderr, code))
      else resolvePromise(output)
    })
  })
}

function relativeGitPath(root: string, value: string) {
  const path = value.split(sep).join('/')
  if (!path || isAbsolute(path) || path.split('/').includes('..') || path.includes('\0')) {
    throw new WorkCopyUnsupported('The work copy contains a path outside its root.', [workCopyGaps.scanBudget])
  }
  return resolve(root, ...path.split('/'))
}

async function hashFile(root: string, path: string, state: WorkCopyFileState, budget: { files: number; bytes: number }) {
  if (budget.files >= maxWorkCopyFiles) throw new WorkCopyUnsupported('The work copy exceeds its file budget.', [workCopyGaps.scanBudget])
  const target = relativeGitPath(root, path)
  const observed = await lstat(target)
  if (observed.isSymbolicLink()) throw new WorkCopyUnsupported(`The work copy contains a symbolic link: ${path}.`, [workCopyGaps.symlink])
  if (!observed.isFile()) throw new WorkCopyUnsupported(`The work copy contains a non-file entry: ${path}.`, [workCopyGaps.scanBudget])
  if (budget.bytes + observed.size > maxWorkCopyScanBytes) throw new WorkCopyUnsupported('The work copy exceeds its scan budget.', [workCopyGaps.scanBudget])
  const bytes = await readFile(target)
  budget.files++
  budget.bytes += bytes.length
  return { path: path.split(sep).join('/'), state, executable: (observed.mode & 0o111) !== 0,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } satisfies WorkCopyFile
}

function parseStatus(output: Buffer) {
  const entries: { path: string; state: WorkCopyFileState }[] = []
  const parts = output.toString('utf8').split('\0')
  for (let index = 0; index < parts.length; index++) {
    const entry = parts[index]
    if (!entry) continue
    if (entry.length < 4 || entry[2] !== ' ') {
      throw new CoreError('WORK_COPY_GIT_FAILED', 'Git status returned an unexpected entry.')
    }
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    if (code.includes('R') || code.includes('C')) {
      throw new WorkCopyUnsupported('Renames and copies are not a supported work-copy change.', [workCopyGaps.rename])
    }
    const state: WorkCopyFileState = code === '??' ? 'untracked' : code.includes('D') ? 'deleted'
      : code.includes('A') ? 'added' : 'modified'
    entries.push({ path, state })
  }
  return entries
}

/** Reads a Git worktree into a bounded, Content-addressed preflight snapshot. */
export async function inspectWorkCopy(root: string): Promise<WorkCopySnapshot> {
  if (typeof root !== 'string' || !isAbsolute(root)) throw new CoreError('INVALID_CONFIG', 'A work-copy root must be absolute.')
  const top = (await runGit(root, ['rev-parse', '--show-toplevel'], 64 * 1024)).toString('utf8').trim()
  if (resolve(await realpath(root)) !== resolve(await realpath(top))) {
    throw new WorkCopyUnsupported('The configured root is not the repository root.', [workCopyGaps.notRepositoryRoot])
  }
  let commit: string
  try { commit = (await runGit(root, ['rev-parse', 'HEAD'], 64 * 1024)).toString('utf8').trim() }
  catch (error) {
    if (error instanceof WorkCopyUnsupported) throw error
    throw new WorkCopyUnsupported('The repository has no commit to hand off.', [workCopyGaps.noCommit])
  }
  if (!/^[a-f0-9]{40,64}$/u.test(commit)) throw new WorkCopyUnsupported('Git returned an invalid commit identity.', [workCopyGaps.noCommit])
  const branch = (await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'], 64 * 1024)).toString('utf8').trim()
  const status = parseStatus(await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 4 * 1024 * 1024))
  const changed = new Map(status.map(entry => [entry.path.split(sep).join('/'), entry.state]))
  const tracked = (await runGit(root, ['ls-files', '-z'], 4 * 1024 * 1024)).toString('utf8').split('\0').filter(Boolean)
  const budget = { files: 0, bytes: 0 }
  const files: WorkCopyFile[] = []
  for (const path of tracked) {
    const normalized = path.split(sep).join('/')
    const state = changed.get(normalized) ?? 'tracked'
    if (state === 'deleted') files.push({ path: normalized, state, executable: false, bytes: 0, sha256: '' })
    else files.push(await hashFile(root, normalized, state, budget))
    changed.delete(normalized)
  }
  for (const [path, state] of changed) {
    if (state === 'deleted') files.push({ path, state, executable: false, bytes: 0, sha256: '' })
    else files.push(await hashFile(root, path, state, budget))
  }
  const changes = files.filter(file => file.state !== 'tracked')
  if (changes.length > maxWorkCopyChanges) throw new WorkCopyUnsupported('The work copy exceeds its changed-file budget.', [workCopyGaps.changeBudget])
  const totalBytes = changes.filter(file => file.state !== 'deleted').reduce((sum, file) => sum + file.bytes, 0)
  if (totalBytes > maxWorkCopyChangeBytes) throw new WorkCopyUnsupported('The work copy exceeds its change budget.', [workCopyGaps.changeBudget])
  const patch = await runGit(root, ['diff', '--binary', 'HEAD', '--'], maxWorkCopyPatchBytes)
  if (patch.length > maxWorkCopyPatchBytes) throw new WorkCopyUnsupported('The work-copy patch exceeds its budget.', [workCopyGaps.patchBudget])
  return { root, git: { commit, ...(branch && branch !== 'HEAD' ? { branch } : {}) }, files,
    changes, totalBytes, scanBytes: budget.bytes, patch: { bytes: patch.length, sha256: createHash('sha256').update(patch).digest('hex') } }
}

export function compareWorkCopy(source: WorkCopySnapshot, target: WorkCopySnapshot, mode: 'prepare' | 'verify'): WorkCopyComparison {
  const blockers: WorkCopyBlocker[] = []
  if (source.git.commit !== target.git.commit) {
    blockers.push({ code: 'target-commit-mismatch', message: `The target is at ${target.git.commit}, not ${source.git.commit}.` })
  }
  const sourceChanges = new Map(source.changes.map(file => [file.path, file]))
  const targetFiles = new Map(target.files.map(file => [file.path, file]))
  for (const file of target.files) {
    if (file.state === 'tracked') continue
    if (!sourceChanges.has(file.path)) {
      blockers.push({ code: 'unknown-target-change', message: `The target has an unlisted change at ${file.path}; it will not be overwritten.` })
    }
  }
  for (const change of source.changes) {
    const targetFile = targetFiles.get(change.path)
    if (!targetFile) {
      if (mode === 'verify') blockers.push({ code: 'target-missing-change', message: `The target is missing ${change.path}.` })
      continue
    }
    if (change.state === 'deleted') {
      if (mode === 'verify' && targetFile.state !== 'deleted') {
        blockers.push({ code: 'target-file-conflict', message: `The target still has ${change.path}.` })
      } else if (mode === 'prepare' && targetFile.state !== 'tracked' && targetFile.state !== 'deleted') {
        blockers.push({ code: 'target-file-conflict', message: `The target has its own change at deleted path ${change.path}.` })
      }
      continue
    }
    if (mode === 'prepare') {
      if (targetFile.state !== 'tracked' && (targetFile.state !== change.state || targetFile.sha256 !== change.sha256
        || targetFile.executable !== change.executable)) {
        blockers.push({ code: 'target-file-conflict', message: `The target already has a different change at ${change.path}.` })
      }
    } else if (targetFile.state === 'deleted' || targetFile.sha256 !== change.sha256 || targetFile.executable !== change.executable) {
      blockers.push({ code: 'target-file-conflict', message: `The target content at ${change.path} does not match the prepared copy.` })
    }
  }
  const unique = [...new Map(blockers.map(blocker => [blocker.code + blocker.message, blocker])).values()]
  return { status: unique.length ? 'handoff-blocked' : mode === 'verify' ? 'verified' : 'prepared',
    blockers: unique, filesToCopy: source.changes, totalBytes: source.totalBytes }
}

export function workCopySnapshotValue(value: unknown): WorkCopySnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CoreError('WORK_COPY_UNSUPPORTED', 'The work-copy inspection returned an invalid snapshot.')
  const snapshot = value as Partial<WorkCopySnapshot>
  if (typeof snapshot.root !== 'string' || !snapshot.git || typeof snapshot.git.commit !== 'string'
    || !Array.isArray(snapshot.files) || !Array.isArray(snapshot.changes) || typeof snapshot.totalBytes !== 'number'
    || typeof snapshot.scanBytes !== 'number' || !snapshot.patch || typeof snapshot.patch.bytes !== 'number'
    || typeof snapshot.patch.sha256 !== 'string') throw new CoreError('WORK_COPY_UNSUPPORTED', 'The work-copy inspection returned an invalid snapshot.')
  const states = new Set<WorkCopyFileState>(['tracked', 'modified', 'added', 'deleted', 'untracked'])
  const validFile = (file: WorkCopyFile) => Boolean(file) && typeof file.path === 'string' && !isAbsolute(file.path)
    && !file.path.split('/').includes('..') && states.has(file.state) && typeof file.executable === 'boolean'
    && Number.isSafeInteger(file.bytes) && typeof file.sha256 === 'string'
  if (!snapshot.files.every(validFile) || !snapshot.changes.every(validFile)) {
    throw new CoreError('WORK_COPY_UNSUPPORTED', 'The work-copy inspection returned an invalid file entry.')
  }
  return snapshot as WorkCopySnapshot
}
