// The main process of the app: the window hides instead of closing, the tray is the way
// back to it, and a window that is gone for good is built anew and talks to the Host that
// runs. The Electron parts are test doubles: no display, no DSH, no data of the user.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { before, test } from 'node:test'
import { hostLockPath } from '../src/host-lock.mjs'
import { app, powerMonitor, state } from './helpers/fake-electron.mjs'
import { state as hostState } from './helpers/fake-host-process.mjs'
import { startApp, trayOpen, trayQuit, waitFor, window } from './helpers/app-harness.mjs'
import { installHooks } from './helpers/register.mjs'

await installHooks()

let home
before(async () => { ({ home } = await startApp()) })

test('the app starts with a window and a tray', async () => {
  await waitFor(() => state.windows.length > 0, 'open the window')
  await waitFor(() => state.tray !== undefined, 'build the tray')
  assert.match(state.tray.tooltip, /^DS Bot — /u, 'the tray says what the Host is doing')
  assert.equal(state.quits, 0, 'the app goes on')
})

test('the first window trades the launch URL for the Host\'s cookie', async () => {
  const win = window()
  hostState.release()
  await waitFor(() => win.loaded.some(url => url.includes('token=')), 'reach the Host')
  assert.equal(win.loaded.filter(url => url.includes('token=')).length, 1, 'the token is used once')
  assert.equal(state.cookies.length, 1, 'the Host left a cookie for its address')
})

test('a window that is gone for good is built anew and talks to the same Host', async () => {
  const first = window()
  first.destroy()
  trayOpen().click()
  await waitFor(() => state.windows.length === 2, 'build a new window')
  const second = window()
  await waitFor(() => second.loaded.some(url => url.startsWith('http://127.0.0.1:')), 'reach the Host')
  assert.equal(second.loaded.filter(url => url.includes('token=')).length, 0, 'the token is not used again')
  assert.equal(hostState.starts, 1, 'no second Host was started')
})

test('closing the window hides it; the app goes on', async () => {
  const win = window()
  win.close()
  await waitFor(() => win.visible === false, 'hide the window')
  assert.equal(win.isDestroyed(), false, 'the window is there')
  assert.equal(state.quits, 0, 'the app goes on')
  assert.equal(hostState.stops, 0, 'the Host goes on')
  assert.equal(state.dialogs.length, 0, 'the notice was answered already')
})

test('the tray opens the window again', async () => {
  const win = window()
  trayOpen().click()
  await waitFor(() => win.visible === true, 'show the window')
  assert.equal(win.focused > 0, true, 'the window has the focus')
})

test('a second launch brings the running window back and starts no second Host', async () => {
  const win = window()
  win.close()
  await waitFor(() => win.visible === false, 'hide the window')
  // The second copy hands itself to the one that runs.
  app.emit('second-instance')
  await waitFor(() => win.visible === true, 'open the running window')
  assert.equal(hostState.starts, 1, 'no second Host was started')
  assert.equal(state.quits, 0, 'the app goes on')
})

test('a sleep pauses the status, and a wake reads the same Host again', async () => {
  const win = window()
  const loads = win.loaded.length
  powerMonitor.emit('suspend')
  assert.equal(state.tray.menu.template[0].label, 'Paused while this computer sleeps')
  win.close()
  await waitFor(() => win.visible === false, 'hide the window during the sleep')
  assert.equal(state.quits, 0, 'the sleep does not end the app')
  powerMonitor.emit('resume')
  await waitFor(() => win.loaded.length > loads, 'read the Host again after the wake')
  assert.equal(state.tray.menu.template[0].label, 'Host running')
  assert.equal(hostState.starts, 1, 'the same Host runs')
  assert.equal(hostState.stops, 0, 'the Host was not stopped for the sleep')
})

test('a Host that dies during the sleep is replaced when the computer wakes', async () => {
  const win = window()
  powerMonitor.emit('suspend')
  hostState.die(new Error('the power was lost'))
  await new Promise(resolve => { setTimeout(resolve, 20) })
  assert.equal(state.quits, 0, 'the app waits for the wake')
  assert.equal(state.dialogs.length, 0, 'no error box during the sleep')
  powerMonitor.emit('resume')
  await waitFor(() => hostState.starts === 2, 'start another Host after the wake')
  await waitFor(() => win.loaded.some(url => url.startsWith('http://127.0.0.1:')), 'reach the new Host')
  assert.equal(state.quits, 0, 'the app goes on')
})

test('Host stop and tray refresh failures do not strand quit or leave the Host lock behind', async () => {
  assert.equal(existsSync(hostLockPath(home)), true, 'the running Host owns its lock')
  hostState.stopFails = true
  state.trayUpdatesFail = true
  trayQuit().click()
  await waitFor(() => state.quits > 1, 'end the app after stopping the Host')
  await waitFor(() => hostState.stops > 0, 'stop the Host')
  await waitFor(() => !existsSync(hostLockPath(home)), 'release the Host lock')
  await waitFor(() => state.tray.destroyed === true, 'take the tray away')
})
