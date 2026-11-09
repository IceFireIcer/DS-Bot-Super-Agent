export function sanitizeSecrets(text: string) {
  return text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gu, '[redacted]')
    .replace(/\bBearer\s+[^\s]+/giu, 'Bearer [redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu, '[redacted]')
    .replace(/((?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*)[^\s]+/giu, '$1[redacted]')
}
