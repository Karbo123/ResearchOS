import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { useLocale, useTranslation, type TranslationKey } from '../i18n'

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

export function VoiceInputButton({
  disabled = false,
  onText,
  onError,
}: {
  disabled?: boolean
  onText: (text: string) => void
  onError?: (key: TranslationKey) => void
}) {
  const { t } = useTranslation()
  const locale = useLocale()
  const [listening, setListening] = useState(false)
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onTextRef = useRef(onText)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onTextRef.current = onText
    onErrorRef.current = onError
  })

  useEffect(() => {
    const recognition = createRecognition()
    if (!recognition) return
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.lang = recognitionLanguage(locale)
    recognition.onstart = () => {
      setListening(true)
      setErrorKey(null)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = event => {
      setListening(false)
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
        if (item.isFinal) final += transcript
        else interim += transcript
      }
      const text = `${final}${interim}`.trim()
      if (text) onTextRef.current(text)
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

  const supported = recognitionRef.current !== null
  const label = !supported ? t('voice.unsupported') : listening ? t('voice.stop') : t('voice.start')
  const title = errorKey ? t(errorKey) : label

  const toggle = () => {
    const recognition = recognitionRef.current
    if (!recognition || disabled) return
    if (listening) {
      recognition.stop()
      return
    }
    setErrorKey(null)
    recognition.lang = recognitionLanguage(locale)
    try {
      recognition.start()
    } catch {
      setErrorKey('voice.error')
      onErrorRef.current?.('voice.error')
    }
  }

  return (
    <button
      type="button"
      className="voice-btn"
      data-state={listening ? 'listening' : 'idle'}
      disabled={disabled || !supported}
      title={title}
      aria-label={label}
      aria-pressed={listening}
      onClick={toggle}
    >
      {listening ? <Square size={17} fill="currentColor" /> : <Mic size={17} />}
      <span className="sr-only" role="status" aria-live="polite">
        {listening ? t('voice.listening') : errorKey ? t(errorKey) : ''}
      </span>
    </button>
  )
}
