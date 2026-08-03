import { privateModelSettings } from './model-settings.js'

const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'] as const

/**
 * Builds the environment passed to spawned Supermemory server processes.
 *
 * Supermemory's runtime (Bun) honors HTTP(S)_PROXY variables. A stale WSL NAT
 * proxy address (for example an old `/etc/resolv.conf` host IP captured by a
 * `set_proxy.sh` script) makes every outbound embedding or model-download
 * request fail with `Unable to connect`. Proxy variables are therefore never
 * inherited blindly: when `SUPERMEMORY_PROXY_URL` is explicitly configured it is
 * forwarded to the child; when the model settings proxy is enabled it takes
 * precedence, otherwise the child runs without any proxy variables.
 */
export function supermemoryChildEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const modelProxy = privateModelSettings().proxy
  const configuredProxy = process.env.SUPERMEMORY_PROXY_URL?.trim()
  const effectiveProxy = modelProxy.enabled && modelProxy.url ? modelProxy.url : configuredProxy
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if ((PROXY_KEYS as readonly string[]).includes(key)) continue
    env[key] = value
  }
  if (effectiveProxy) {
    for (const key of PROXY_KEYS) env[key] = effectiveProxy
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue
    env[key] = value
  }
  return env
}
