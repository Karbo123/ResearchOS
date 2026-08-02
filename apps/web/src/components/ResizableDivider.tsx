import { useEffect, useRef, useState } from 'react'

type IncreaseDirection = 'left' | 'right'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function ResizableDivider({
  value,
  min,
  max,
  ariaLabel,
  increaseDirection,
  disabledMediaQuery,
  className = '',
  onPreview,
  onCommit,
}: {
  value: number
  min: number
  max: number
  ariaLabel: string
  increaseDirection: IncreaseDirection
  disabledMediaQuery?: string
  className?: string
  onPreview: (value: number) => void
  onCommit: (value: number) => void
}) {
  const [resizing, setResizing] = useState(false)
  const pendingValue = useRef(value)
  const frame = useRef<number | null>(null)
  const cleanup = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!resizing) pendingValue.current = value
  }, [resizing, value])

  useEffect(() => () => cleanup.current?.(), [])

  const isDisabled = () => disabledMediaQuery ? window.matchMedia(disabledMediaQuery).matches : false

  const commitPreview = (next: number) => {
    const clamped = clamp(next, min, max)
    pendingValue.current = clamped
    onPreview(clamped)
    onCommit(clamped)
  }

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isDisabled()) return
    event.preventDefault()
    const handle = event.currentTarget
    const startPosition = event.clientX
    const startValue = value
    pendingValue.current = startValue
    setResizing(true)
    handle.setPointerCapture?.(event.pointerId)

    const update = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault()
      const delta = moveEvent.clientX - startPosition
      const signedDelta = increaseDirection === 'left' ? -delta : delta
      pendingValue.current = clamp(startValue + signedDelta, min, max)
      if (frame.current !== null) return
      frame.current = window.requestAnimationFrame(() => {
        onPreview(pendingValue.current)
        frame.current = null
      })
    }

    const stop = () => {
      if (frame.current !== null) {
        window.cancelAnimationFrame(frame.current)
        frame.current = null
      }
      onPreview(pendingValue.current)
      onCommit(pendingValue.current)
      setResizing(false)
      handle.releasePointerCapture?.(event.pointerId)
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      cleanup.current = null
    }

    cleanup.current = stop
    window.addEventListener('pointermove', update, { passive: false })
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isDisabled()) return
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = value + (increaseDirection === 'left' ? 10 : -10)
    if (event.key === 'ArrowRight') next = value + (increaseDirection === 'right' ? 10 : -10)
    if (event.key === 'Home') next = min
    if (event.key === 'End') next = max
    if (next === null) return
    event.preventDefault()
    commitPreview(next)
  }

  return (
    <div
      className={`resizable-divider${resizing ? ' is-resizing' : ''}${className ? ` ${className}` : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={startResize}
      onKeyDown={resizeByKeyboard}
    />
  )
}
