import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'

export class ApiError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 500 | 501 | 502 | 503, public readonly code: string, message: string) {
    super(message)
  }
}

export async function jsonBody<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
  let body: unknown
  try { body = await context.req.json() } catch { throw new ApiError(400, 'invalid_json', '请求正文必须是有效 JSON。') }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new ApiError(422, 'validation_error', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  return parsed.data
}

export function errorResponse(error: unknown, context: Context): Response {
  if (error instanceof ApiError) return context.json({ code: error.code, message: error.message }, error.status)
  if (error instanceof HTTPException) return context.json({ code: 'http_error', message: error.message }, error.status)
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'unknown_server_error')
  return context.json({ code: 'internal_error', message: '服务器处理请求失败。' }, 500)
}
