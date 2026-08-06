import { ApiError } from './http.js'
import { isAllowedModelUrl, isPrivateModelUrl, isResponsesBaseUrl } from './model-url.js'
import { privateModelSettings } from './model-settings.js'
import { modelUsesProxy } from './model-proxy.js'
import { createProxyFetch } from './proxy-fetch.js'
import { privateProjectModelSettings, privateProjectVoiceSettings } from './project-settings.js'

const TEST_TIMEOUT_MS = 25_000
const TEST_IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

interface TestTarget {
  url: string
  key: string
  model: string
}

function targetFor(
  kind: 'simple' | 'medium' | 'complex' | 'document' | 'vision' | 'image' | 'voice',
  input: { model: string; url: string; key: string },
  projectId?: string,
): TestTarget {
  const settings = projectId ? privateProjectModelSettings(projectId) : undefined
  if (kind === 'voice') {
    const voice = projectId ? privateProjectVoiceSettings(projectId) : undefined
    return {
      model: input.model || voice?.model || '',
      url: input.url || voice?.url || '',
      key: input.key || voice?.key || '',
    }
  }
  const source = settings
    ? kind === 'image' ? settings.image_generation : kind === 'vision' ? settings.vision : kind === 'document' ? settings.document : settings[kind]
    : null
  return {
    model: input.model || source?.model || '',
    url: input.url || source?.url || '',
    key: input.key || source?.key || '',
  }
}

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

async function fetchTarget(target: TestTarget, url: string, init: RequestInit, useProxy: boolean): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  headers.set('authorization', `Bearer ${target.key}`)
  headers.set('user-agent', 'research-os-model-test/1')
  if (!(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  try {
    return await createProxyFetch({ useProxy })(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    })
  } catch (error) {
    const proxyUrl = privateModelSettings().proxy.url
    const privateAddress = isPrivateModelUrl(target.url)
    const networkHint = privateAddress
      ? '该回环或私有地址始终直连，请确认目标服务正在监听。'
      : useProxy && proxyUrl
        ? '当前模型已启用代理，请检查代理地址和代理服务。'
        : '当前模型未启用代理，正在直连；如需代理请打开该模型的代理开关。'
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ApiError(504, 'model_test_timeout', `连接测试超时。${networkHint}`)
    }
    throw new ApiError(502, 'model_test_unreachable', `无法连接模型服务。${networkHint}`)
  }
}

function assertConfigured(target: TestTarget): void {
  if (!target.model) throw new ApiError(422, 'model_test_missing_model', '请先填写模型名称。')
  if (!target.key) throw new ApiError(422, 'model_test_missing_key', '请先配置 API key。')
  if (!target.url) throw new ApiError(422, 'model_test_missing_url', '请先填写 API 地址。')
}

async function testResponsesModel(kind: 'simple' | 'medium' | 'complex' | 'document' | 'vision', input: { model: string; url: string; key: string }, projectId?: string, useProxy?: boolean) {
  const target = targetFor(kind, input, projectId)
  assertConfigured(target)
  if (!isAllowedModelUrl(target.url) || !isResponsesBaseUrl(target.url)) {
    throw new ApiError(422, 'model_test_invalid_url', '该模型地址必须是 Responses API base URL，不能包含 /responses 或 /chat/completions。')
  }
  const started = Date.now()
  const response = await fetchTarget(target, `${target.url.replace(/\/+$/, '')}/responses`, {
    method: 'POST',
    body: JSON.stringify({
      model: target.model,
      input: [{
        role: 'user',
        content: kind === 'vision'
          ? [
              { type: 'input_text', text: 'Reply with OK.' },
              { type: 'input_image', image_url: TEST_IMAGE_DATA_URL, detail: 'low' },
            ]
          : [{ type: 'input_text', text: 'ping' }],
      }],
      max_output_tokens: 8,
      stream: false,
    }),
  }, useProxy ?? modelUsesProxy(kind, projectId))
  const body = await response.json().catch(() => null)
  const elapsed = Math.round((Date.now() - started) / 100) / 10
  if (response.ok) {
    const content = typeof body?.output_text === 'string' ? body.output_text.trim() : ''
    if (!content && !Array.isArray(body?.output)) throw new ApiError(502, 'model_test_invalid_response', '模型服务返回了无效响应。')
    return { ok: true, elapsed, message: `连接正常，模型已返回内容（${content.slice(0, 40) || '空文本'}）。` }
  }
  throw new ApiError(502, 'model_test_upstream_error', `模型服务已响应但返回错误（HTTP ${response.status}）：${upstreamMessage(body)}`)
}

function silentWav(): Blob {
  const sampleRate = 8_000
  const samples = sampleRate / 4
  const dataLength = samples * 2
  const buffer = Buffer.alloc(44 + dataLength)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataLength, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataLength, 40)
  return new Blob([buffer], { type: 'audio/wav' })
}

async function testVoiceModel(input: { model: string; url: string; key: string }, projectId?: string, useProxy?: boolean) {
  const target = targetFor('voice', input, projectId)
  assertConfigured(target)
  if (!isAllowedModelUrl(target.url)) {
    throw new ApiError(422, 'model_test_invalid_url', '语音识别地址必须是 HTTPS 或回环/私有 HTTP。')
  }
  const form = new FormData()
  form.append('model', target.model)
  form.append('response_format', 'json')
  form.append('temperature', '0')
  form.append('file', silentWav(), 'connectivity-test.wav')
  const started = Date.now()
  const response = await fetchTarget(target, `${target.url.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST',
    body: form,
  }, useProxy ?? modelUsesProxy('voice', projectId))
  const body = await response.json().catch(() => null)
  const elapsed = Math.round((Date.now() - started) / 100) / 10
  if (response.ok && body && typeof body === 'object' && typeof body.text === 'string') {
    return { ok: true, elapsed, message: '语音识别接口连接正常。' }
  }
  if (response.ok) throw new ApiError(502, 'model_test_invalid_response', '语音识别服务返回了无效响应。')
  throw new ApiError(502, 'model_test_upstream_error', `语音识别服务已响应（HTTP ${response.status}）：${upstreamMessage(body)}`)
}

async function testImageGenerationModel(input: { model: string; url: string; key: string }, projectId?: string, useProxy?: boolean) {
  const target = targetFor('image', input, projectId)
  assertConfigured(target)
  if (!isAllowedModelUrl(target.url)) {
    throw new ApiError(422, 'model_test_invalid_url', '图片生成地址必须是 HTTPS 或回环/私有 HTTP。')
  }
  const started = Date.now()
  const response = await fetchTarget(target, `${target.url.replace(/\/+$/, '')}/images/generations`, {
    method: 'POST',
    body: JSON.stringify({
      model: target.model,
      prompt: 'ping',
      size: '1:1',
      resolution: '1k',
      quality: 'low',
      n: 1,
    }),
  }, useProxy ?? modelUsesProxy('image', projectId))
  const body = await response.json().catch(() => null)
  const elapsed = Math.round((Date.now() - started) / 100) / 10
  const data = body?.data
  const taskId = Array.isArray(data) && typeof data[0]?.task_id === 'string' ? data[0].task_id : null
  const hasGeneratedResult = Array.isArray(data) && data[0] && (typeof data[0].url === 'string' || typeof data[0].b64_json === 'string')
  if (response.ok && (taskId || hasGeneratedResult)) {
    return { ok: true, elapsed, message: taskId ? `图片生成接口已接受任务（task ${taskId.slice(0, 18)}…）。` : '图片生成接口已返回生成结果。' }
  }
  const message = taskId
    ? '图片生成接口已响应任务，但返回格式与文档不一致。'
    : `图片生成服务已响应（HTTP ${response.status}）：${upstreamMessage(body)}`
  throw new ApiError(502, 'model_test_upstream_error', message)
}

export async function testModelConnection(
  kind: 'simple' | 'medium' | 'complex' | 'document' | 'vision' | 'image' | 'voice',
  input: { model: string; url: string; key: string; use_proxy?: boolean; project_id?: string },
) {
  const projectId = input.project_id
  if (kind === 'image') return testImageGenerationModel(input, projectId, input.use_proxy)
  if (kind === 'voice') return testVoiceModel(input, projectId, input.use_proxy)
  return testResponsesModel(kind, input, projectId, input.use_proxy)
}
