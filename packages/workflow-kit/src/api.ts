import type { ProjectWorkflowContext } from './contracts.js'

const defaultApiBase = (process.env.RESEARCH_API_INTERNAL_URL || 'http://127.0.0.1:8080').replace(/\/$/, '')

export class ResearchApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ResearchApiError'
    this.status = status
    this.code = code
  }
}

export async function callResearchApi(path: string, init: RequestInit, ctx?: ProjectWorkflowContext): Promise<unknown> {
  if (ctx?.dryRun) return { dry_run: true }
  const response = await fetch(`${ctx?.apiBase || defaultApiBase}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(90_000),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof (body as { code: unknown }).code === 'string'
      ? (body as { code: string }).code
      : `research_api_http_${response.status}`
    throw new ResearchApiError(response.status, code, `Research API ${path} failed: ${code}`)
  }
  return body
}
