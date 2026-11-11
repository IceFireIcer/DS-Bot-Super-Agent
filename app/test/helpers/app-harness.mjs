// The main process of the app, with the Electron parts as a test double: the window, the
// tray and the Host, without a display, without DSH and without the data of the user.
// The loader (test/helpers/loader.mjs) puts the test doubles in place of "electron".
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { paths, state } from './fake-electron.mjs'
import { hold } from './fake-host-process.mjs'

/** Wait until the app has done something, so that the test does not guess a moment. */
export const waitFor = async (check, what, timeout = 20_000) => {
  const until = Date.now() + timeout
  for (;;) {
    if (check()) return
    if (Date.now() > until) throw new Error(`the app did not ${what}`)
    await new Promise(resolve => { setTimeout(resolve, 10) })
  }
}

/**
 * Start the app on throwaway folders: the places are chosen already and the one-time notice
 * is answered, so that the app asks nothing. The Host answers when the test lets it.
 * @param {{ packaged?: boolean }} options whether the app is a packaged one, with an updater
 */
export const startApp = async ({ packaged = true } = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-main-home-'))
  process.once('exit', () => {
    const roots = [home, paths.root]
    const expected = [join(tmpdir(), 'ds-bot-main-home-'), join(tmpdir(), 'ds-bot-fake-user-data-')]
    const failures = []
    for (const [directory, prefix] of roots.map((directory, index) => [directory, expected[index]])) {
      if (!directory.startsWith(prefix)) {
        failures.push(new Error(`Unexpected app-test cleanup directory: ${directory}`))
        continue
      }
      try { rmSync(directory, { recursive: true, force: true, maxRetries: 5 }) } catch (error) { failures.push(error) }
    }
    if (failures.length) console.error(`DS Bot app-test cleanup failed: ${failures.map(error => error instanceof Error ? error.message : String(error)).join('; ')}`)
  })
  const workspace = join(home, 'workspace')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(paths.userData, { recursive: true })
  writeFileSync(join(paths.userData, 'locations.json'), JSON.stringify({ dataDir: home, workspace }))
  writeFileSync(join(paths.userData, 'tray-close-acknowledged'), '')
  hold()
  await import('../../src/main.mjs')
  // The app is a packaged one, so that it has an updater. The flag comes after the start,
  // because a packaged app starts on the canonical path of its own.
  state.packaged = packaged
  return { home, workspace }
}

/** A packaged app checks updates before offering a failed Host again; keep that local. */
export const startEmptyUpdateFeed = async () => {
  const previous = process.env.DS_BOT_UPDATE_URL
  let requests = 0
  const server = createServer((_request, response) => {
    requests += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('[]')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  process.env.DS_BOT_UPDATE_URL = `http://127.0.0.1:${String(address.port)}/releases`
  return {
    requests: () => requests,
    close: async () => {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      if (previous === undefined) delete process.env.DS_BOT_UPDATE_URL
      else process.env.DS_BOT_UPDATE_URL = previous
    },
  }
}

/** The window of the app: the last one it built. */
export const window = () => state.windows.at(-1)

/** The entries of the tray's menu: the status, Open, Quit, with lines between them. */
export const trayMenu = () => state.tray.menu.template

/** The tray's entries, by what they do: the status row moved the indices once already. */
export const trayOpen = () => trayMenu().find(item => item.label === 'Open DS Bot')
export const trayQuit = () => trayMenu().find(item => item.label === 'Quit DS Bot')
