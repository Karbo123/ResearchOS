const apiBase = (process.env.RESEARCH_API_INTERNAL_URL || 'http://127.0.0.1:8080').replace(/\/$/, '')

export async function apiJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(90_000),
  })
  if (!response.ok) throw new Error(`research_api_http_${response.status}`)
  return response.json()
}
