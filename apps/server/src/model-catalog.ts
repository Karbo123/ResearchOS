import { ApiError } from './http.js'
import { isAllowedModelUrl } from './model-url.js'
import { proxyFetch } from './proxy-fetch.js'

const CATALOG_TIMEOUT_MS = 12_000

export interface ModelCatalog {
  models: string[]
  reasoning_efforts: string[]
}

export type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function upstreamMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return '上游返回了无法解析的响应。'
  const record = body as Record<string, unknown>
  const nested = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : null
  const message = typeof nested?.message === 'string'
    ? nested.message
    : typeof record.message === 'string'
      ? record.message
      : typeof record.error === 'string'
        ? record.error
        : ''
  return message || '上游服务返回了错误。'
}

function reasoningEffortsFromModels(value: unknown): string[] {
  const seen = new Set<string>()
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      for (const field of ['reasoning_effort', 'reasoning_efforts', 'supported_reasoning_efforts']) {
        const raw = record[field]
        if (typeof raw === 'string' && raw) seen.add(raw)
        else if (Array.isArray(raw)) for (const candidate of raw) if (typeof candidate === 'string' && candidate) seen.add(candidate)
      }
    }
  }
  if (seen.size === 0) return ['low', 'medium', 'high']
  const standard = ['low', 'medium', 'high'].filter(effort => seen.has(effort))
  const extra = [...seen].filter(effort => !['low', 'medium', 'high'].includes(effort)).sort()
  return [...standard, ...extra]
}

export async function fetchModelCatalog(
  input: { url: string; key: string },
  fallbackKey = '',
  fetcher: FetchFunction = proxyFetch(),
): Promise<ModelCatalog> {
  const url = input.url.trim()
  const key = input.key.trim() || fallbackKey.trim()
  if (!isAllowedModelUrl(url)) {
    throw new ApiError(422, 'model_catalog_invalid_url', '模型地址必须是 HTTPS 或回环/私有 HTTP。')
  }
  if (!key) {
    throw new ApiError(422, 'model_catalog_missing_key', '请先配置 API key 以获取模型列表。')
  }

  let response: Response
  try {
    response = await fetcher(`${url.replace(/\/+$/, '')}/models`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${key}`,
        'user-agent': 'research-os-model-catalog/1',
      },
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ApiError(504, 'model_catalog_timeout', '获取模型列表超时，请检查网络与代理设置。')
    }
    throw new ApiError(502, 'model_catalog_unreachable', '无法连接模型服务，请检查 URL、网络与代理设置。')
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(502, 'model_catalog_upstream_error', `模型服务已响应但返回错误（HTTP ${response.status}）：${upstreamMessage(body)}`)
  }
  const data = body && typeof body === 'object' ? (body as Record<string, unknown>).data : null
  if (!Array.isArray(data)) {
    throw new ApiError(502, 'model_catalog_invalid_response', '模型服务未返回可用的模型列表。')
  }
  const models = [...new Set(
    data
      .map(item => item && typeof item === 'object' ? String((item as Record<string, unknown>).id || '') : '')
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right))
  if (models.length === 0) {
    throw new ApiError(502, 'model_catalog_invalid_response', '模型服务未返回可用的模型列表。')
  }
  return { models, reasoning_efforts: reasoningEffortsFromModels(data) }
}
