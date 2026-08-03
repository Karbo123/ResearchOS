import { useEffect, useRef, type RefObject } from 'react'

export const COMPOSER_TEXTAREA_MAX_HEIGHT = 130

export function useComposerTextarea(input: string) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const resize = () => {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`
    }
    resize()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(resize)
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [input])

  return textareaRef
}

export function useVoiceInsertion(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  setInput: (value: string) => void,
) {
  const anchorRef = useRef<number | null>(null)
  const tailRef = useRef<number | null>(null)
  const lastSelectionRef = useRef<{ start: number; end: number } | null>(null)
  const valueRef = useRef('')

  const trackSelection = () => {
    const textarea = textareaRef.current
    if (textarea) lastSelectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd }
  }

  const handleText = (text: string) => {
    const textarea = textareaRef.current
    const value = valueRef.current || textarea?.value || ''
    const activeSelection =
      document.activeElement === textarea
        ? { start: textarea?.selectionStart ?? value.length, end: textarea?.selectionEnd ?? value.length }
        : lastSelectionRef.current ?? { start: value.length, end: value.length }
    const start = anchorRef.current ?? Math.min(activeSelection.start, value.length)
    const end = anchorRef.current === null
      ? Math.max(start, Math.min(activeSelection.end, value.length))
      : tailRef.current ?? start
    anchorRef.current = start
    tailRef.current = end
    const next = `${value.slice(0, start)}${text}${value.slice(end)}`
    valueRef.current = next
    setInput(next)
    const cursor = start + text.length
    tailRef.current = cursor
    window.requestAnimationFrame(() => {
      const element = textareaRef.current
      if (element) {
        element.setSelectionRange(cursor, cursor)
        lastSelectionRef.current = { start: cursor, end: cursor }
      }
    })
  }

  const reset = () => {
    anchorRef.current = null
    tailRef.current = null
    const textarea = textareaRef.current
    if (textarea) valueRef.current = textarea.value
  }

  const setValue = (value: string) => {
    valueRef.current = value
    setInput(value)
  }

  return { handleText, reset, setValue, trackSelection }
}
