// The Super-agent profile must not fall back to the old ds-bot execution path.
// This overlay sits beside the profile, like the Office and search overlays, and
// is read only through runProfile's patchFiles.
import { rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'

export const SUPERAGENT_PATCH_NAME = 'superagent.patch.yml'

/**
 * @param {{ dir: string }} profile - the loaded profile
 * @param {boolean} enabled - whether this launch uses the Super-agent profile
 * @returns {string[]} the patchFiles addition for this launch
 */
export function reconcileSuperagentProfile(profile, enabled) {
  const file = join(dirname(profile.dir), SUPERAGENT_PATCH_NAME)
  if (!enabled) {
    rmSync(file, { force: true })
    return []
  }
  writeFileSync(file, stringify([{ id: 'superagent-ui-host', name: 'ds-superagent-host' }]), 'utf8')
  return [file]
}
