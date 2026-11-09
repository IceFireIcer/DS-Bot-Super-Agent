import { once } from 'node:events'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { RemoteDevice } from '../dist/remote-device.js'

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (!value) throw new Error(`Use --${name} <path>.`)
  return value
}

const configPath = argument('config')
const pairingCodePath = argument('pairing-code-file')
if (!isAbsolute(configPath) || !isAbsolute(pairingCodePath)) throw new Error('Both paths must be absolute.')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const device = await RemoteDevice.open(config)
try {
  const endpoint = await device.start()
  await writeFile(pairingCodePath, `${device.pairingCode}\n`, { mode: 0o600 })
  await chmod(pairingCodePath, 0o600)
  console.log(JSON.stringify({ endpoint, deviceId: device.deviceId, deviceKeyFingerprint: device.deviceKeyFingerprint,
    pairingCodeFile: pairingCodePath, pairingExpiresAt: device.pairingExpiresAt }))
  await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')])
} finally {
  await device.close()
}
