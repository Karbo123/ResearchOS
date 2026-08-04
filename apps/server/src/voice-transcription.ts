import { ApiError } from './http.js'
import { proxyFetch } from './proxy-fetch.js'
import { privateProjectVoiceSettings } from './project-settings.js'
import { privateVoiceSettings } from './voice-settings.js'

const TRANSCRIPTION_TIMEOUT_MS = 60_000

export interface UploadedAudio {
  name: string
  type: string
  arrayBuffer(): Promise<ArrayBuffer>
}

function providerError(status: number): ApiError {
  if (status === 401 || status === 403) return new ApiError(502, 'voice_auth_failed', '语音识别服务拒绝访问，请检查 API key。')
  if (status === 429) return new ApiError(502, 'voice_rate_limited', '语音识别服务暂时限流，请稍后重试。')
  return new ApiError(502, 'voice_provider_error', '语音识别服务返回错误。')
}

function fileExtension(mimeType: string): string {
  if (mimeType === 'audio/mp4' || mimeType === 'audio/m4a' || mimeType === 'audio/aac') return 'm4a'
  if (mimeType === 'audio/ogg') return 'ogg'
  if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') return 'wav'
  if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') return 'mp3'
  if (mimeType === 'audio/flac') return 'flac'
  return 'webm'
}

export async function transcribeVoice(file: UploadedAudio, language?: string, projectId?: string): Promise<string> {
  const settings = projectId ? privateProjectVoiceSettings(projectId) : privateVoiceSettings()
  if (settings.provider !== 'api' && settings.provider !== 'groq') {
    throw new ApiError(409, 'voice_provider_not_configured', '当前未启用 API 语音识别。')
  }
  if (!settings.key) {
    throw new ApiError(503, 'voice_key_missing', '未配置语音识别 API key，无法调用服务。')
  }

  const baseUrl = settings.url.replace(/\/+$/, '')
  const sourceMime = ((file.type || 'audio/webm').split(';')[0] ?? 'audio/webm').trim().toLowerCase() || 'audio/webm'
  const extension = fileExtension(sourceMime)
  const fileName = file.name?.toLowerCase().endsWith(`.${extension}`) ? file.name : `voice.${extension}`
  const form = new FormData()
  form.append('model', settings.model)
  form.append('response_format', 'json')
  form.append('temperature', '0')
  if (language) form.append('language', language)
  form.append('file', new Blob([new Uint8Array(await file.arrayBuffer())], { type: sourceMime }), fileName)

  let response: Response
  try {
    response = await proxyFetch()(`${baseUrl}/audio/transcriptions`, {
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
