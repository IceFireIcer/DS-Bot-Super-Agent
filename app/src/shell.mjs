// The window and the tray share one life: closing the window hides it, the tray is the way
// back to it, and the tray's Quit is the one ordinary way out. The tray also says what the
// Host is doing, so that a hidden window and a stopped service cannot be confused. The app
// itself decides when a close really ends it: an update, a data move, a failed start and the
// end of the operating system's session all close the window for good. A sleeping computer
// pauses the work; waking it says so and lets the app reconnect.
import { BackgroundNotice } from './background-notice.mjs'
import { createTray } from './tray.mjs'

export const SHELL_TEXT = {
  en: {
    tooltip: 'DS Bot',
    open: 'Open DS Bot',
    quit: 'Quit DS Bot',
    running: 'Host running',
    starting: 'Starting the Host…',
    stopped: 'Host not running',
    failed: 'Host could not start',
    suspended: 'Paused while this computer sleeps',
    notice: 'DS Bot keeps running in the system tray. Its Bots go on working while the window is closed, as long as this computer is awake.',
    noticeConfirm: 'OK',
    fallback: 'The system tray is not available, so DS Bot cannot stay in the background. Do you want to end it?',
    cancel: 'Cancel',
  },
  zh: {
    tooltip: 'DS Bot',
    open: '打开 DS Bot',
    quit: '退出 DS Bot',
    running: 'Host 正在运行',
    starting: 'Host 正在启动…',
    stopped: 'Host 未运行',
    failed: 'Host 未能启动',
    suspended: '电脑休眠时暂停',
    notice: 'DS Bot 会留在系统托盘里继续运行。只要电脑没有休眠，关掉窗口时 Bot 们照常工作。',
    noticeConfirm: '好',
    fallback: '系统托盘不可用，DS Bot 不能留在后台。要结束它吗？',
    cancel: '取消',
  },
}

/**
 * The window and the tray of the desktop app.
 *
 * @param {{
 *   electron: { app: any, Menu: any, Tray: any, powerMonitor: any },
 *   platform: string,
 *   messages: () => { tooltip: string, open: string, quit: string, running: string, starting: string, stopped: string, failed: string, suspended: string, notice: string, noticeConfirm: string, fallback: string, cancel: string },
 *   trayImage: () => any,
 *   window: () => any,
 *   build: () => any,
 *   reveal: (window: any) => void,
 *   quit: () => void,
 *   status: () => 'running' | 'starting' | 'stopped' | 'failed',
 *   onSuspend?: () => void,
 *   onResume?: () => void | Promise<void>,
 *   busy: () => boolean,
 *   ready: () => boolean,
 *   notice: { marker: () => string, show: (options: object) => Promise<{ response: number }> },
 *   fallback?: { show: (options: object) => Promise<{ response: number }> },
 *   log?: Pick<Console, 'warn'>,
 * }} options the pieces of the app the shell drives
 */
export function createShell(options) {
  const { electron, platform, log = console } = options
  const { app, powerMonitor } = electron
  // The tray is kept here, so that it stays alive as long as the app runs.
  let tray
  let notice
  // The app is on its way out: the window may close for good.
  let quitting = false
  // A quit was asked for; the app may still refuse it (a first-run dialog, a copy).
  let quitAsked = false
  let sessionEnding = false
  // The computer is asleep: the Host cannot run, so the tray says so instead of claiming
  // that the Bots go on working.
  let suspended = false
  // The windows the shell has hidden: they do not show themselves again.
  const hidden = new WeakSet()
  // The hides that wait for a fullscreen window to leave fullscreen.
  const pending = new WeakMap()

  const text = () => options.messages()
  const current = () => options.window()
  const statusText = () => {
    const t = text()
    if (suspended) return t.suspended
    return t[options.status()] ?? t.stopped
  }
  const refresh = () => {
    try { tray?.relabel() } catch (error) {
      log.warn(`DS Bot: the tray status could not be refreshed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const hide = (target = current()) => {
    if (quitting || sessionEnding || target === undefined || target.isDestroyed()) return
    hidden.add(target)
    if (platform === 'darwin' && target.isFullScreen()) {
      // A fullscreen window leaves an empty black space behind when it is hidden.
      const onLeave = () => {
        pending.delete(target)
        if (quitting || sessionEnding || target.isDestroyed()) return
        // The window was opened again while it was leaving fullscreen: it stays.
        if (!hidden.has(target)) return
        target.hide()
      }
      pending.set(target, onLeave)
      target.once('leave-full-screen', onLeave)
      target.setFullScreen(false)
      return
    }
    target.hide()
  }

  /** The window is there: show it. It is gone: build one that talks to the running Host. */
  const open = () => {
    if (quitting) return
    const target = current()
    if (target !== undefined && !target.isDestroyed()) {
      if (target.isMinimized()) target.restore()
      // A hide that waits for the fullscreen to end is called off: the window stays.
      const waiting = pending.get(target)
      if (waiting !== undefined) {
        pending.delete(target)
        target.removeListener?.('leave-full-screen', waiting)
      }
      hidden.delete(target)
      options.reveal(target)
      return
    }
    // There is no window yet, and the app is still starting: nothing to show.
    if (!options.ready()) return
    const built = options.build()
    if (built !== undefined && !built.isDestroyed()) {
      hidden.delete(built)
      options.reveal(built)
    }
  }

  /**
   * The tray's Quit: the one ordinary way out of the app. The app may still refuse it (a
   * first-run dialog is open, a copy is under way); then it says so with {@link cancelQuit}.
   */
  const quit = () => {
    if (quitAsked) return
    quitAsked = true
    options.quit()
  }

  /** The app is on its way out; the window may close for good. */
  function beginQuit() { quitting = true; quitAsked = true }

  /** The app refused the quit: it goes on, and the tray works again. */
  function cancelQuit() { quitting = false; quitAsked = false }

  const buildTray = () => {
    try {
      const image = options.trayImage()
      tray = createTray({
        Tray: electron.Tray, Menu: electron.Menu, platform,
        image, tooltip: text().tooltip, status: statusText,
        open: { label: text().open, run: () => { open() } },
        quit: { label: text().quit, run: () => { quit() } },
        log,
      })
    } catch (error) {
      // Without a tray the window stays where the user can reach it; the app never vanishes.
      tray = undefined
      log.warn(`DS Bot: the system tray is not available: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Without a tray there is no Quit of its own: the close asks whether the app should end.
   * @param {any} target the window that stays reachable
   */
  const askFallback = async (target) => {
    const t = text()
    try {
      const { response } = await options.fallback.show({
        type: 'question', title: 'DS Bot', message: t.fallback,
        buttons: [t.quit, t.cancel], defaultId: 1, cancelId: 1, noLink: true,
      })
      if (response === 0) { quit(); return }
    } catch (error) {
      log.warn(`DS Bot: the fallback quit could not be asked: ${error instanceof Error ? error.message : String(error)}`)
    }
    // The window stays in the task bar, where the user can reach it.
    target.minimize()
  }

  /**
   * The window's close: it hides, unless the app is really leaving.
   * @param {{ preventDefault: () => void }} event the window's close event
   */
  const close = (event) => {
    if (quitting || sessionEnding) return
    event.preventDefault()
    const target = current()
    if (target === undefined) return
    // An import or a data move is under way: the close cancels it, as it did before.
    if (options.busy()) { quit(); return }
    // Without a tray there is no way back to a hidden window, and no Quit of its own: the
    // close asks whether the app should end.
    if (tray === undefined) { void askFallback(target); return }
    if (notice === undefined) { hide(target); return }
    notice.close(() => { hide(target) })
  }

  /** The window's own listeners. */
  const watch = (target) => {
    target.on('close', (event) => { close(event) })
    if (platform === 'win32') {
      // The session ends for good: the window may close.
      target.on('session-end', () => { sessionEnding = true })
    } else {
      // A shutdown that another application called off leaves the app running; the next focus
      // or show of the window says that the session goes on.
      target.on('focus', () => { sessionEnding = false })
      target.on('show', () => { sessionEnding = false })
    }
  }

  const install = () => {
    // The app stays in the tray: a closed window is not a closed app.
    app.on('window-all-closed', () => {})
    // macOS: the Dock icon opens the window again.
    app.on('activate', () => { sessionEnding = false; open() })
    if (platform !== 'win32') {
      // macOS and Linux: the power-off notification comes before the terminate request, and
      // another application can still call the shutdown off.
      powerMonitor.on('shutdown', () => { sessionEnding = true })
    }
    // A computer that sleeps is not a Host that keeps working: say that the work is paused,
    // and when it wakes, let the app look at the Host again before it says it runs.
    powerMonitor?.on?.('suspend', () => { suspend() })
    powerMonitor?.on?.('resume', () => { resume() })
    notice = new BackgroundNotice({
      marker: options.notice.marker(), show: options.notice.show, message: text().notice, confirm: text().noticeConfirm, log,
    })
    buildTray()
  }

  /** The computer goes to sleep: the Host is suspended with it. */
  const suspend = () => {
    if (suspended) return
    suspended = true
    try { options.onSuspend?.() } catch (error) {
      log.warn(`DS Bot: the sleep could not be handled: ${error instanceof Error ? error.message : String(error)}`)
    }
    refresh()
  }

  /** The computer wakes: the session goes on, and the app checks the Host again. */
  const resume = () => {
    // A wake follows a sleep; it also clears a shutdown that was called off meanwhile.
    const waking = suspended || sessionEnding
    suspended = false
    // Windows ends the session for good; macOS and Linux can call a shutdown off.
    if (platform !== 'win32') sessionEnding = false
    if (!waking) return
    try { void Promise.resolve(options.onResume?.()).catch((error) => {
      log.warn(`DS Bot: the wake could not be handled: ${error instanceof Error ? error.message : String(error)}`)
    }) } catch (error) {
      log.warn(`DS Bot: the wake could not be handled: ${error instanceof Error ? error.message : String(error)}`)
    }
    refresh()
  }

  const dispose = () => {
    notice?.dispose()
    notice = undefined
    tray?.dispose()
    tray = undefined
  }

  return {
    install,
    watch,
    close,
    open,
    quit,
    suspend,
    resume,
    refresh,
    beginQuit,
    cancelQuit,
    dispose,
    hasTray: () => tray !== undefined,
    isQuitting: () => quitting,
    isHidden: (target) => hidden.has(target),
    isSessionEnding: () => sessionEnding,
    isSuspended: () => suspended,
    status: statusText,
  }
}
