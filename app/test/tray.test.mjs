// The system tray: the icon, its menu and the way it goes away.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, test } from 'node:test'
import { createTray } from '../src/tray.mjs'

function harness({ platform = 'win32', status = 'Running in the background' } = {}) {
  const trays = []
  const menus = []
  const Menu = { buildFromTemplate: template => template }
  const Tray = class extends EventEmitter {
    constructor(image) { super(); this.image = image; trays.push(this) }
    setToolTip(value) { this.tooltip = value }
    setContextMenu(menu) { this.menu = menu; menus.push(menu) }
    destroy() { this.destroyed = true }
  }
  const calls = { open: 0, quit: 0 }
  const tray = createTray({
    Tray, Menu, platform, image: { empty: false }, tooltip: 'DS Bot',
    status: () => status,
    open: { label: 'Open', run: () => { calls.open += 1 } },
    quit: { label: 'Quit', run: () => { calls.quit += 1 } },
    log: { warn: () => {} },
  })
  return { tray, trays, menus, calls }
}

describe('the tray', () => {
  test('the icon carries the tooltip, the status and a menu with Open and Quit', () => {
    const app = harness()
    assert.equal(app.trays.length, 1)
    assert.equal(app.trays[0].tooltip, 'DS Bot — Running in the background')
    assert.deepEqual(app.menus[0].map(item => item.label ?? 'separator'), ['Running in the background', 'separator', 'Open', 'separator', 'Quit'])
    assert.equal(app.menus[0][0].enabled, false, 'the status is not a command')
  })

  test('a click opens the window, and the menu opens and quits it', () => {
    const app = harness()
    app.trays[0].emit('click')
    assert.equal(app.calls.open, 1)
    app.menus[0].find(item => item.label === 'Open').click()
    assert.equal(app.calls.open, 2)
    app.menus[0].at(-1).click()
    assert.equal(app.calls.quit, 1)
  })

  test('on macOS the menu of the icon is the way back, not a click', () => {
    const app = harness({ platform: 'darwin' })
    assert.equal(app.trays[0].listenerCount('click'), 0, 'the icon has no click of its own')
    app.menus[0].find(item => item.label === 'Open').click()
    assert.equal(app.calls.open, 1)
  })

  test('a relabel reads the status again', () => {
    let status = 'Starting the Host…'
    const trays = []
    const menus = []
    const tray = createTray({
      Tray: class { constructor() { trays.push(this) } on() {} setToolTip(value) { this.tooltip = value } setContextMenu(menu) { this.menu = menu; menus.push(menu) } destroy() {} },
      Menu: { buildFromTemplate: template => template }, platform: 'win32', image: {}, tooltip: 'DS Bot',
      status: () => status,
      open: { label: 'Open', run: () => {} }, quit: { label: 'Quit', run: () => {} }, log: { warn: () => {} },
    })
    assert.equal(trays[0].tooltip, 'DS Bot — Starting the Host…')
    status = 'Host not running'
    tray.relabel()
    assert.equal(trays[0].tooltip, 'DS Bot — Host not running')
    assert.equal(menus.at(-1)[0].label, 'Host not running')
  })

  test('the icon goes away once', () => {
    const app = harness()
    app.tray.dispose()
    app.tray.dispose()
    assert.equal(app.trays[0].destroyed, true)
  })
})
