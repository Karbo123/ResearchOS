import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Mic, Square } from 'lucide-react'
import { ApiError, fetchWithTimeout } from '../api'
import { useLocale, useTranslation, type TranslationKey } from '../i18n'
import { localizeTranscriptPunctuation, punctuateTranscript } from '../voicePunctuation'
import type { VoiceProvider, VoiceSettingsResponse } from '../types'

interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionErrorLike {
  error?: string
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function recognitionLanguage(locale: string): string {
  if (locale === 'zh-TW') return 'zh-TW'
  if (locale === 'en') return 'en-US'
  if (locale === 'es') return 'es-ES'
  return 'zh-CN'
}

function apiLanguage(locale: string): string {
  if (locale === 'en') return 'en'
  if (locale === 'es') return 'es'
  return 'zh'
}

function audioFileFor(mimeType: string): { type: string; name: string } {
  const type = (mimeType || 'audio/webm').split(';')[0].trim().toLowerCase() || 'audio/webm'
  if (type === 'audio/mp4' || type === 'audio/m4a' || type === 'audio/aac') return { type, name: 'voice.m4a' }
  if (type === 'audio/ogg') return { type, name: 'voice.ogg' }
  if (type === 'audio/wav' || type === 'audio/x-wav') return { type, name: 'voice.wav' }
  if (type === 'audio/mpeg' || type === 'audio/mp3') return { type, name: 'voice.mp3' }
  if (type === 'audio/flac') return { type, name: 'voice.flac' }
  return { type, name: 'voice.webm' }
}

function createRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null
  const browserWindow = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  const Constructor = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition
  return Constructor ? new Constructor() : null
}

function errorTranslation(event: SpeechRecognitionErrorLike): TranslationKey {
  if (event.error === 'not-allowed' || event.error === 'service-not-allowed') return 'voice.permissionDenied'
  if (event.error === 'no-speech') return 'voice.noSpeech'
  if (event.error === 'audio-capture') return 'voice.audioError'
  return 'voice.error'
}

function recorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  return candidates.find(candidate => MediaRecorder.isTypeSupported(candidate)) || ''
}

function microphoneErrorKey(error: unknown): TranslationKey {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') return 'voice.permissionDenied'
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return 'voice.audioError'
  }
  return 'voice.error'
}

function voiceApiErrorKey(error: unknown): TranslationKey {
  if (error instanceof ApiError) {
    if (error.code === 'voice_key_missing') return 'voice.keyPending'
    if (error.code === 'voice_provider_empty') return 'voice.noSpeech'
  }
  return 'voice.error'
}

export function VoiceInputButton({
  disabled = false,
  projectId,
  onText,
  onError,
  onSessionStart,
  onSessionEnd,
}: {
  disabled?: boolean
  projectId?: string
  onText: (text: string) => void
  onError?: (key: TranslationKey) => void
  onSessionStart?: () => void
  onSessionEnd?: () => void
}) {
  const { t } = useTranslation()
  const locale = useLocale()
  const [provider, setProvider] = useState<VoiceProvider>('browser')
  const [apiReady, setApiReady] = useState(false)
  const [listening, setListening] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const onTextRef = useRef(onText)
  const onErrorRef = useRef(onError)
  const onSessionStartRef = useRef(onSessionStart)
  const onSessionEndRef = useRef(onSessionEnd)
  const localeRef = useRef(locale)
  const disabledRef = useRef(disabled)
  const projectIdRef = useRef(projectId)
  const providerRef = useRef<VoiceProvider>(provider)
  const apiReadyRef = useRef(apiReady)
  const activeRef = useRef(false)
  const processingRef = useRef(false)
  const browserFinalRef = useRef('')
  const browserInterimRef = useRef('')
  const browserCommitRef = useRef(false)

  useEffect(() => {
    onTextRef.current = onText
    onErrorRef.current = onError
    onSessionStartRef.current = onSessionStart
    onSessionEndRef.current = onSessionEnd
    localeRef.current = locale
    disabledRef.current = disabled
    projectIdRef.current = projectId
    providerRef.current = provider
    apiReadyRef.current = apiReady
  })

  useEffect(() => {
    const loadSettings = () => {
      const settingsUrl = projectIdRef.current
        ? `/api/projects/${projectIdRef.current}/settings/voice`
        : '/api/settings/voice'
      void fetchWithTimeout(window.fetch.bind(window), settingsUrl, {}, 30_000)
        .then(async response => {
          if (!response.ok) throw new Error(`voice_settings_${response.status}`)
          const result = (await response.json()) as VoiceSettingsResponse
          setProvider(result.provider === 'groq' ? 'api' : result.provider)
          setApiReady((result.provider === 'api' || result.provider === 'groq') && result.key_configured)
        })
        .catch(() => {
          setProvider('browser')
          setApiReady(false)
        })
    }
    loadSettings()
    window.addEventListener('researchos:voice-settings-changed', loadSettings)
    return () => window.removeEventListener('researchos:voice-settings-changed', loadSettings)
  }, [projectId])

  useEffect(() => {
    const recognition = createRecognition()
    if (!recognition) return
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.lang = recognitionLanguage(locale)
    recognition.onstart = () => {
      browserFinalRef.current = ''
      browserInterimRef.current = ''
      browserCommitRef.current = false
      activeRef.current = true
      setListening(true)
      setErrorKey(null)
    }
    recognition.onend = () => {
      const text = `${browserFinalRef.current}${browserInterimRef.current}`.trim()
      if (text && browserCommitRef.current) {
        onTextRef.current(punctuateTranscript(text, localeRef.current))
      }
      browserFinalRef.current = ''
      browserInterimRef.current = ''
      browserCommitRef.current = false
      activeRef.current = false
      setListening(false)
      onSessionEndRef.current?.()
    }
    recognition.onerror = event => {
      browserCommitRef.current = false
      browserFinalRef.current = ''
      browserInterimRef.current = ''
      activeRef.current = false
      setListening(false)
      onSessionEndRef.current?.()
      const key = errorTranslation(event)
      setErrorKey(key)
      onErrorRef.current?.(key)
    }
    recognition.onresult = event => {
      let final = ''
      let interim = ''
      for (let index = 0; index < event.results.length; index += 1) {
        const item = event.results[index]
        const transcript = item[0]?.transcript ?? ''
        if (item.isFinal) {
          final += transcript
        } else {
          interim += transcript
        }
      }
      browserFinalRef.current = final
      browserInterimRef.current = interim
    }
    recognitionRef.current = recognition
    return () => {
      recognition.onstart = null
      recognition.onend = null
      recognition.onerror = null
      recognition.onresult = null
      recognition.abort()
      recognitionRef.current = null
    }
  }, [])

  useEffect(() => {
    if (recognitionRef.current) recognitionRef.current.lang = recognitionLanguage(locale)
  }, [locale])

  useEffect(() => () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop() } catch { /* already stopped */ }
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) track.stop()
      mediaStreamRef.current = null
    }
  }, [])

  const finishApiRecording = async () => {
    if (processingRef.current) return
    const recorder = recorderRef.current
    const chunks = chunksRef.current
    const stream = mediaStreamRef.current
    recorderRef.current = null
    mediaStreamRef.current = null
    chunksRef.current = []
    if (stream) for (const track of stream.getTracks()) track.stop()

    const { type, name } = audioFileFor(recorder?.mimeType || 'audio/webm')
    const blob = new Blob(chunks, { type })
    if (blob.size < 1024) {
      activeRef.current = false
      setListening(false)
      setErrorKey('voice.noSpeech')
      onErrorRef.current?.('voice.noSpeech')
      onSessionEndRef.current?.()
      return
    }

    processingRef.current = true
    setProcessing(true)
    try {
      const form = new FormData()
      form.append('file', blob, name)
      form.append('language', apiLanguage(localeRef.current))
      if (projectIdRef.current) form.append('projectId', projectIdRef.current)
      const response = await fetchWithTimeout(window.fetch.bind(window), '/api/voice/transcribe', {
        method: 'POST',
        body: form,
      }, 120_000)
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: string; message?: string } | null
        throw new ApiError(body?.code || 'voice_provider_error', body?.message || 'Voice recognition failed.', undefined, response.status)
      }
      const body = await response.json() as { text?: unknown }
      if (typeof body.text !== 'string' || !body.text.trim()) throw new ApiError('voice_provider_empty', 'Voice recognition returned no content.')
      onTextRef.current(localizeTranscriptPunctuation(body.text.trim(), localeRef.current))
      setErrorKey(null)
    } catch (error) {
      const key = voiceApiErrorKey(error)
      setErrorKey(key)
      onErrorRef.current?.(key)
    } finally {
      processingRef.current = false
      setProcessing(false)
      activeRef.current = false
      setListening(false)
      onSessionEndRef.current?.()
    }
  }

  const startApiRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('media_devices_unavailable')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaStreamRef.current = stream
    const mimeType = recorderMimeType()
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    chunksRef.current = []
    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => void finishApiRecording()
    recorderRef.current = recorder
    recorder.start(250)
  }

  const startVoice = async () => {
    if (disabledRef.current || activeRef.current || processingRef.current) return
    activeRef.current = true
    setErrorKey(null)
    onSessionStartRef.current?.()
    if (providerRef.current === 'api' || providerRef.current === 'groq') {
      setListening(true)
      try {
        await startApiRecording()
      } catch (error) {
        activeRef.current = false
        setListening(false)
        const key = microphoneErrorKey(error)
        setErrorKey(key)
        onErrorRef.current?.(key)
        onSessionEndRef.current?.()
      }
      return
    }
    const recognition = recognitionRef.current
    if (!recognition) {
      activeRef.current = false
      setErrorKey('voice.unsupported')
      onErrorRef.current?.('voice.unsupported')
      onSessionEndRef.current?.()
      return
    }
    recognition.lang = recognitionLanguage(localeRef.current)
    try {
      recognition.start()
    } catch {
      activeRef.current = false
      setErrorKey('voice.error')
      onErrorRef.current?.('voice.error')
      onSessionEndRef.current?.()
    }
  }

  const stopVoice = () => {
    if (providerRef.current === 'api' || providerRef.current === 'groq') {
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop() } catch { void finishApiRecording() }
      }
      return
    }
    const recognition = recognitionRef.current
    if (!recognition) return
    browserCommitRef.current = true
    activeRef.current = false
    try {
      recognition.stop()
    } catch {
      setListening(false)
      onSessionEndRef.current?.()
    }
  }

  useEffect(() => {
    const shortcutActive = () => {
      if (!buttonRef.current || disabledRef.current || processingRef.current) return false
      return buttonRef.current.getClientRects().length > 0
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.key !== ' ' || !shortcutActive()) return
      event.preventDefault()
      if (event.repeat || activeRef.current) return
      void startVoice()
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ' || !activeRef.current) return
      stopVoice()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [])

  const mediaSupported = typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
  const supported = provider === 'browser'
    ? recognitionRef.current !== null
    : Boolean(mediaSupported && apiReady)
  const label = !supported
    ? ((provider === 'api' || provider === 'groq') && !apiReady ? t('voice.keyPending') : t('voice.unsupported'))
    : processing
      ? t('voice.processing')
      : listening
        ? t('voice.stop')
        : t('voice.start')
  const title = errorKey ? t(errorKey) : label

  const toggle = () => {
    if (!supported || disabled || processing) return
    if (listening || activeRef.current) {
      stopVoice()
      return
    }
    void startVoice()
  }

  return (
    <button
      type="button"
      className="voice-btn"
      data-state={processing ? 'processing' : listening ? 'listening' : 'idle'}
      disabled={disabled || !supported || processing}
      title={title}
      aria-label={label}
      aria-pressed={listening}
      aria-keyshortcuts="Control+Space"
      ref={buttonRef}
      onClick={toggle}
    >
      {processing ? <LoaderCircle size={17} className="spin" /> : listening ? <Square size={17} fill="currentColor" /> : <Mic size={17} />}
      <span className="sr-only" role="status" aria-live="polite">
        {processing ? t('voice.processing') : listening ? t('voice.listening') : errorKey ? t(errorKey) : ''}
      </span>
    </button>
  )
}
