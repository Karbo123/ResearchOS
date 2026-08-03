import { ApiError } from './http.js'

const mastraBase = () => (process.env.MASTRA_BASE_URL || 'http://127.0.0.1:4111').replace(/\/$/, '')

export async function mastraJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${mastraBase()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.MODEL_REQUEST_TIMEOUT_SECONDS || 240) * 1000),
    })
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'TimeoutError' ? 'llm_timeout' : 'llm_request_failed'
    throw new ApiError(502, code, code === 'llm_timeout' ? '模型请求超时。' : 'Mastra 模型请求失败。')
  }
  const raw = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ApiError(502, 'llm_invalid_response', 'Mastra 返回了无效的 JSON 响应。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(502, 'llm_invalid_response', 'Mastra 返回了无效的结构化响应。')
  }
  const result = parsed as Record<string, unknown>
  if (!response.ok) throw new ApiError(response.status === 503 ? 503 : 502, String(result.code || 'llm_request_failed'), String(result.message || '模型请求失败。'))
  return result as T
}
