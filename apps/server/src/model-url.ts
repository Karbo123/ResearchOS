/**
 * Research OS passes base URLs to the Responses provider, which appends
 * `/responses` itself. Operation URLs would produce an invalid double path or
 * silently select an older API, so reject them at every configuration boundary.
 */
export function isResponsesBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const pathname = url.pathname.replace(/\/+$/, '').toLowerCase()
    return !/(?:^|\/)chat\/completions$/.test(pathname)
      && !/(?:^|\/)completions$/.test(pathname)
      && !/(?:^|\/)responses$/.test(pathname)
  } catch {
    return false
  }
}

export function isAllowedModelUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true
  const match = /^172\.(\d+)\./.exec(host)
  return match !== null && Number(match[1]) >= 16 && Number(match[1]) <= 31
}
