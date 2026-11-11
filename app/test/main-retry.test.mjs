// A Host that does not start is not the end of the app: the error box offers another try on
// the same data, so that a directory or an account can be fixed and checked again.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { state } from './helpers/fake-electron.mjs'
import { state as hostState } from './helpers/fake-host-process.mjs'
import { startApp, startEmptyUpdateFeed, waitFor, window } from './helpers/app-harness.mjs'
import { installHooks } from './helpers/register.mjs'

await installHooks()

let updateFeed
before(async () => {
  updateFeed = await startEmptyUpdateFeed()
  hostState.fail = true
  let asked = 0
  state.dialogAnswer = () => {
    asked += 1
    // The first failure is fixed before the user says "Try again".
    if (asked === 1) { hostState.fail = false; return { response: 0 } }
    return { response: 1 }
  }
  await startApp()
  if (process.platform !== 'win32') await waitFor(() => updateFeed.requests() > 0, 'check the update feed')
})
after(async () => { await updateFeed.close() })

test('a failed start offers another try on the same data, and the app goes on', async () => {
  hostState.release()
  await waitFor(() => state.dialogs.some(dialog => dialog.buttons?.includes('Try again')), 'ask for another try')
  await waitFor(() => hostState.starts === 2, 'start the Host again')
  const win = window()
  await waitFor(() => win.loaded.some(url => url.includes('token=')), 'reach the retried Host')
  assert.equal(state.quits, 0, 'the app goes on')
})

test('the app ends when the user says so', async () => {
  state.tray.menu.template.at(-1).click()
  await waitFor(() => state.quits > 0, 'end the app')
})
