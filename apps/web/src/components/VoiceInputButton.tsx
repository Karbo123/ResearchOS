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
  onSessionStart,
  onSessionEnd,
}: {
  disabled?: boolean
  onText: (text: string) => void
  onError?: (key: TranslationKey) => void
  onSessionStart?: () => void
  onSessionEnd?: () => void
}) {
  const { t } = useTranslation()
  const locale = useLocale()
  const [listening, setListening] = useState(false)
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onTextRef = useRef(onText)
  const onErrorRef = useRef(onError)
  const onSessionStartRef = useRef(onSessionStart)
  const onSessionEndRef = useRef(onSessionEnd)
  const localeRef = useRef(locale)
  const disabledRef = useRef(disabled)
  const activeRef = useRef(false)

  useEffect(() => {
    onTextRef.current = onText
    onErrorRef.current = onError
    onSessionStartRef.current = onSessionStart
    onSessionEndRef.current = onSessionEnd
    localeRef.current = locale
    disabledRef.current = disabled
  })

  useEffect(() => {
    const recognition = createRecognition()
    if (!recognition) return
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.lang = recognitionLanguage(locale)
    recognition.onstart = () => {
      activeRef.current = true
      setListening(true)
      setErrorKey(null)
    }
    recognition.onend = () => {
      activeRef.current = false
      setListening(false)
      onSessionEndRef.current?.()
    }
    recognition.onerror = event => {
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

  useEffect(() => {
    const shortcutActive = () => {
      if (!buttonRef.current || disabledRef.current || !recognitionRef.current) return false
      return buttonRef.current.getClientRects().length > 0
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.key !== ' ' || !shortcutActive()) return
      event.preventDefault()
      if (event.repeat || activeRef.current) return
      const recognition = recognitionRef.current
      activeRef.current = true
      setErrorKey(null)
      onSessionStartRef.current?.()
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

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ' || !activeRef.current) return
      const recognition = recognitionRef.current
      if (!recognition) return
      try {
        recognition.stop()
      } catch {
        activeRef.current = false
        setListening(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [])

  const supported = recognitionRef.current !== null
  const label = !supported ? t('voice.unsupported') : listening ? t('voice.stop') : t('voice.start')
  const title = errorKey ? t(errorKey) : label

  const toggle = () => {
    const recognition = recognitionRef.current
    if (!recognition || disabled) return
    if (listening) {
      activeRef.current = false
      try {
        recognition.stop()
      } catch {
        setListening(false)
      }
      return
    }
    setErrorKey(null)
    activeRef.current = true
    onSessionStartRef.current?.()
    recognition.lang = recognitionLanguage(locale)
    try {
      recognition.start()
    } catch {
      activeRef.current = false
      setErrorKey('voice.error')
      onErrorRef.current?.('voice.error')
      onSessionEndRef.current?.()
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
      aria-keyshortcuts="Control+Space"
      ref={buttonRef}
      onClick={toggle}
    >
      {listening ? <Square size={17} fill="currentColor" /> : <Mic size={17} />}
      <span className="sr-only" role="status" aria-live="polite">
        {listening ? t('voice.listening') : errorKey ? t(errorKey) : ''}
      </span>
    </button>
  )
}
