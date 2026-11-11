// The system tray: what the Host is doing, the way back to a hidden window and the one
// ordinary way out.

/**
 * @param {{
 *   Tray: new (image: object) => object,
 *   Menu: { buildFromTemplate: (template: object[]) => object },
 *   platform: string,
 *   image: object,
 *   tooltip: string,
 *   status: () => string,
 *   open: { label: string, run: () => void },
 *   quit: { label: string, run: () => void },
 *   log?: Pick<Console, 'warn'>,
 * }} options the mark, the tooltip and the two entries of the menu
 * @returns {{ tray: object, relabel: () => void, dispose: () => void }}
 */
export function createTray({ Tray, Menu, platform, image, tooltip, status, open, quit, log = console }) {
  const tray = new Tray(image)
  let disposed = false
  const relabel = () => {
    // The status is a fact, not a command: it is the first row, and it cannot be clicked.
    const current = status()
    tray.setToolTip(`${tooltip} — ${current}`)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: current, enabled: false },
      { type: 'separator' },
      { label: open.label, click: () => { open.run() } },
      { type: 'separator' },
      { label: quit.label, click: () => { quit.run() } },
    ]))
  }
  // macOS opens the menu of the icon instead of a click of its own; there the menu is the
  // way back to the window.
  if (platform !== 'darwin') tray.on('click', () => { open.run() })
  relabel()
  return {
    tray,
    relabel,
    /** Take the icon away; the app leaves no dead icon behind. */
    dispose() {
      if (disposed) return
      disposed = true
      try { tray.destroy() } catch (error) { log.warn(`DS Bot: the tray icon did not go away: ${error instanceof Error ? error.message : String(error)}`) }
    },
  }
}
