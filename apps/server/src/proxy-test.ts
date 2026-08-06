import { ApiError } from './http.js'
import { createProxyFetch } from './proxy-fetch.js'

const PROXY_TEST_TIMEOUT_MS = 15_000
const PROXY_TEST_TARGET = 'https://example.com'

export async function testProxyConnection(url: string): Promise<{ ok: true; elapsed: number; message: string }> {
  const trimmed = url.trim()
  if (!trimmed) throw new ApiError(422, 'proxy_test_missing_url', '请先填写代理 URL。')
  try {
    new URL(trimmed)
  } catch {
    throw new ApiError(422, 'proxy_test_invalid_url', '代理 URL 格式不正确。')
  }
  const started = Date.now()
  let response: Response
  try {
    response = await createProxyFetch({ useProxy: true })(PROXY_TEST_TARGET, {
      signal: AbortSignal.timeout(PROXY_TEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ApiError(504, 'proxy_test_timeout', '代理连接超时，请检查代理地址和代理服务。')
    }
    throw new ApiError(502, 'proxy_test_unreachable', `无法通过该代理访问目标：${error instanceof Error ? error.message : String(error)}`)
  }
  const elapsed = Math.round((Date.now() - started) / 100) / 10
  if (!response.ok) {
    throw new ApiError(502, 'proxy_test_upstream_error', `代理已连通但目标返回 HTTP ${response.status}。`)
  }
  return { ok: true, elapsed, message: `代理连接正常，已通过代理访问目标（${elapsed} 秒）。` }
}
