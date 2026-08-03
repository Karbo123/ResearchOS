import { ApiError } from './http.js'
import { privateVoiceSettings } from './voice-settings.js'

const TRANSCRIPTION_TIMEOUT_MS = 60_000

export interface UploadedAudio {
  name: string
  type: string
  arrayBuffer(): Promise<ArrayBuffer>
}

function providerError(status: number): ApiError {
  if (status === 401 || status === 403) return new ApiError(502, 'voice_auth_failed', '语音识别服务拒绝访问，请检查 GROQ_API_KEY。')
  if (status === 429) return new ApiError(502, 'voice_rate_limited', '语音识别服务暂时限流，请稍后重试。')
  return new ApiError(502, 'voice_provider_error', '语音识别服务返回错误。')
}

export async function transcribeWithGroq(file: UploadedAudio, language?: string): Promise<string> {
  const settings = privateVoiceSettings()
  if (settings.provider !== 'groq') {
    throw new ApiError(409, 'voice_provider_not_configured', '当前未启用 Groq 语音识别。')
  }
  if (!settings.key) {
    throw new ApiError(503, 'voice_key_missing', '未配置 GROQ_API_KEY，无法调用语音识别服务。')
  }

  const baseUrl = settings.url.replace(/\/+$/, '')
  const form = new FormData()
  form.append('model', settings.model)
  form.append('response_format', 'json')
  form.append('temperature', '0')
  if (language) form.append('language', language)
  form.append('file', new Blob([new Uint8Array(await file.arrayBuffer())], { type: file.type || 'audio/webm' }), file.name || 'voice.webm')

  let response: Response
  try {
    response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.key}` },
      body: form,
      signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ApiError(504, 'voice_provider_timeout', '语音识别服务响应超时。')
    }
    throw new ApiError(502, 'voice_provider_unreachable', '无法连接语音识别服务。')
  }

  if (!response.ok) throw providerError(response.status)
  const body = await response.json().catch(() => null)
  if (!body || typeof body !== 'object' || typeof (body as { text?: unknown }).text !== 'string') {
    throw new ApiError(502, 'voice_provider_invalid', '语音识别服务返回了无效结果。')
  }
  const text = (body as { text: string }).text.trim()
  if (!text) throw new ApiError(502, 'voice_provider_empty', '语音识别服务没有识别到内容。')
  return text
}
