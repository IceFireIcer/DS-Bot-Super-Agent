export function protectedPath(path: string): boolean {
  return path.split(/[\\/]/u).some(part =>
    part.startsWith('.') && part !== '.' || /^(?:credentials?(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519)$/iu.test(part) || /\.(?:pem|key|p12|pfx)$/iu.test(part))
}
