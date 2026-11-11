// Check the resident Host with the real app and the real DSH: the window closes and the Host
// still serves; a second launch brings the same window back and starts no second Host; the
// explicit quit stops the Host. Throwaway folders only: no data of the user.
// Usage: node scripts/check-resident.mjs
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const home = mkdtempSync(join(tmpdir(), 'ds-bot-resident-home-'))
const shellData = mkdtempSync(join(tmpdir(), 'ds-bot-resident-shell-'))
const workspace = join(home, 'workspace')
mkdirSync(workspace, { recursive: true })
// The one-time close notice is answered in advance: the check is about the Host, not the box.
writeFileSync(join(shellData, 'tray-close-acknowledged'), '')
const port = 9600 + Math.floor(Math.random() * 300)
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...environment } = process.env
const env = { ...environment, DS_BOT_HOME: home, DS_BOT_SHELL_DATA: shellData, DS_BOT_WORKSPACE: workspace }
const children = []
const sockets = []

const fail = (message) => { throw new Error(message) }
const hostPort = () => JSON.parse(readFileSync(join(shellData, 'host-port.json'), 'utf8')).port
const originOf = (value) => value.replace(/\/\?.*$/u, '/')

async function target(deadline, what) {
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
      const page = targets.find(entry => entry.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//u.test(entry.url))
      if (page !== undefined) return page
    } catch { /* the debugging port is not listening yet */ }
    await sleep(300)
  }
  fail(`the app did not show its window (${what})`)
}

function devtools(url) {
  const socket = new WebSocket(url)
  sockets.push(socket)
  const pending = new Map()
  let next = 1
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  const opened = new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const call = (method, params = {}) => new Promise((done, reject) => {
    const id = next++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method} did not answer`))
    }, 20_000)
    pending.set(id, {
      resolve: value => { clearTimeout(timer); done(value) },
      reject: error => { clearTimeout(timer); reject(error) },
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return { opened, call, close: () => { socket.close() } }
}

async function start({ waitForWindow = true } = {}) {
  const child = spawn(electron, [root, `--remote-debugging-port=${String(port)}`], { stdio: 'ignore', env })
  children.push(child)
  const exited = new Promise((done) => { child.once('exit', (code, signal) => { done({ code, signal }) }) })
  if (waitForWindow) await target(Date.now() + 120_000, 'the first start')
  return { child, exited }
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`taskkill exited with code ${String(result.status)}`)
  } else child.kill('SIGKILL')
  const exited = await Promise.race([new Promise((done) => { child.once('exit', () => { done(true) }) }), sleep(10_000).then(() => false)])
  if (!exited) throw new Error(`the app process ${String(child.pid)} did not stop`)
}

async function text(cdp) {
  const result = await cdp.call('Runtime.evaluate', { expression: 'document.body.innerText.slice(0, 400)', returnByValue: true })
  return String(result.result.value ?? '')
}

async function waitForText(cdp, needle, deadline, what) {
  while (Date.now() < deadline) {
    if ((await text(cdp)).includes(needle)) return
    await sleep(500)
  }
  fail(`the page never showed ${needle} (${what})`)
}

async function waitForDown(origin) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(origin)
      await sleep(250)
    } catch { return true }
  }
  return false
}

async function waitForDebugDown() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(`http://127.0.0.1:${String(port)}/json/version`)
      await sleep(250)
    } catch { return true }
  }
  return false
}

async function quitGracefully(child) {
  const version = await (await fetch(`http://127.0.0.1:${String(port)}/json/version`)).json()
  const browser = new WebSocket(version.webSocketDebuggerUrl)
  sockets.push(browser)
  await new Promise((done, reject) => {
    browser.addEventListener('open', done, { once: true })
    browser.addEventListener('error', reject, { once: true })
  })
  browser.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  browser.close()
  const ended = await Promise.race([child.exited, sleep(60_000).then(() => undefined)])
  if (ended === undefined) fail('the app did not end after the quit')
  if (ended.code !== 0) fail(`the app ended with code ${String(ended.code)}`)
}

try {
  const first = await start()
  const page = await target(Date.now() + 120_000, 'the first window')
  const cdp = devtools(page.webSocketDebuggerUrl)
  await cdp.opened
  await cdp.call('Network.enable')
  const { cookies } = await cdp.call('Network.getCookies', { urls: [originOf(page.url)] })
  const cookie = cookies.map(entry => `${entry.name}=${entry.value}`).join('; ')
  if (cookie === '') fail('the Host left no cookie for the app')
  const origin = originOf(page.url)
  if (`http://127.0.0.1:${String(hostPort())}/` !== origin) fail(`the app and the Host disagree about the port: ${origin}`)

  // What the page shows is the Host's durable team, not a page of its own.
  await waitForText(cdp, 'Chief', Date.now() + 120_000, 'the first window')
  console.log('check-resident: the window shows the real Host and its team')

  // The window closes from the page: the app and the Host must go on.
  await cdp.call('Runtime.evaluate', { expression: 'window.close()' })
  await sleep(1_500)
  // A hidden window is not always listed by the debugging port. When it is listed, it must
  // say that it is hidden; when it is not, the app and the Host are what this check can see.
  const listed = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
  const hidden = listed.find(entry => entry.type === 'page' && entry.url.startsWith(origin))
  if (hidden !== undefined) {
    const hiddenPage = devtools(hidden.webSocketDebuggerUrl)
    await hiddenPage.opened
    const visibility = await hiddenPage.call('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true })
    if (visibility.result.value !== 'hidden') fail(`the window is still on the screen: ${String(visibility.result.value)}`)
  }
  const served = await fetch(origin, { headers: { cookie } })
  if (served.status !== 200) fail(`the Host stopped with the window: ${String(served.status)}`)
  console.log('check-resident: the close leaves the app and the same Host running')

  // A second copy hands itself to the one that runs: no second Host, and the window comes back.
  const beforePort = readFileSync(join(shellData, 'host-port.json'), 'utf8')
  const second = await start({ waitForWindow: false })
  const outcome = await Promise.race([second.exited, sleep(30_000).then(() => undefined)])
  if (outcome === undefined) { await stop(second.child); fail('the second copy did not hand itself over') }
  const back = await target(Date.now() + 30_000, 'the second launch')
  if (originOf(back.url) !== origin) fail(`the second launch opened another Host: ${back.url}`)
  if (readFileSync(join(shellData, 'host-port.json'), 'utf8') !== beforePort) fail('the second launch changed the Host port')
  const reopened = devtools(back.webSocketDebuggerUrl)
  await reopened.opened
  await waitForText(reopened, 'Chief', Date.now() + 60_000, 'the reopened window')
  console.log('check-resident: a second launch brings the same window and Host back')

  // The explicit quit is the one ordinary way out: the Host stops with it.
  await quitGracefully(first)
  if (!await waitForDown(origin)) fail('the Host is still listening after the quit')
  console.log('check-resident: the explicit quit ends the app and stops the Host')

  // A hard stop is an interruption, not a clean quit: the same data and port come back.
  const interrupted = await start()
  const interruptedPage = await target(Date.now() + 120_000, 'the restart')
  const interruptedCdp = devtools(interruptedPage.webSocketDebuggerUrl)
  await interruptedCdp.opened
  await waitForText(interruptedCdp, 'Chief', Date.now() + 120_000, 'the restart')
  interrupted.child.kill('SIGKILL')
  await interrupted.exited
  if (!await waitForDown(origin)) fail('the Host outlived the killed app')
  if (!await waitForDebugDown()) fail('the killed app still holds the debugging port')
  const restarted = await start()
  const restartedPage = await target(Date.now() + 120_000, 'the restart after the interruption')
  const restartedCdp = devtools(restartedPage.webSocketDebuggerUrl)
  await restartedCdp.opened
  await waitForText(restartedCdp, 'Chief', Date.now() + 120_000, 'the restart after the interruption')
  if (`http://127.0.0.1:${String(hostPort())}/` !== origin) fail('the restart moved the Host to another port')
  await quitGracefully(restarted)
  console.log('check-resident: a hard stop comes back on the same data and port')
  console.log('check-resident: passed')
} catch (error) {
  console.error(`check-resident: FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  const failures = []
  for (const socket of sockets) {
    try { socket.close() } catch (error) { failures.push(error) }
  }
  for (const child of children) {
    try { await stop(child) } catch (error) { failures.push(error) }
  }
  for (const directory of [home, shellData]) {
    if (!directory.startsWith(join(tmpdir(), 'ds-bot-resident-'))) {
      failures.push(new Error('Unexpected resident-check cleanup directory.'))
    } else try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    } catch (error) { failures.push(error) }
  }
  if (failures.length) {
    console.error(`check-resident: cleanup FAILED: ${failures.map(error => error instanceof Error ? error.message : String(error)).join('; ')}`)
    process.exitCode = 1
  }
  process.exit(process.exitCode ?? 0)
}
