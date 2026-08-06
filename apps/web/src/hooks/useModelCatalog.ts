import { useEffect, useState } from 'react'
import { api, errorMessage } from '../api'
import type { ModelCatalogKind, ModelCatalogResponse } from '../types'

export type ModelCatalogStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ModelCatalogState {
  models: string[]
  reasoning_efforts: string[]
  status: ModelCatalogStatus
  error: string
}

const DEFAULT_REASONING_EFFORTS = ['low', 'medium', 'high']

export function useModelCatalog(
  projectId: string,
  url: string,
  key: string,
  kind: ModelCatalogKind,
  useProxy?: boolean,
  delayMs = 400,
): ModelCatalogState {
  const [models, setModels] = useState<string[]>([])
  const [reasoningEfforts, setReasoningEfforts] = useState<string[]>(DEFAULT_REASONING_EFFORTS)
  const [status, setStatus] = useState<ModelCatalogStatus>('idle')
  const [error, setError] = useState('')
  const normalizedUrl = url.trim()
  const normalizedKey = key.trim()

  useEffect(() => {
    if (!normalizedUrl) {
      setModels([])
      setReasoningEfforts(DEFAULT_REASONING_EFFORTS)
      setStatus('idle')
      setError('')
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setStatus('loading')
      setError('')
      api<ModelCatalogResponse>(`/api/projects/${projectId}/settings/model-catalog`, {
        method: 'POST',
        body: JSON.stringify({ kind, url: normalizedUrl, key: normalizedKey, use_proxy: useProxy }),
      })
        .then(result => {
          if (cancelled) return
          setModels(result.models || [])
          setReasoningEfforts(result.reasoning_efforts?.length ? result.reasoning_efforts : DEFAULT_REASONING_EFFORTS)
          setStatus('ready')
          setError('')
        })
        .catch(err => {
          if (cancelled) return
          setModels([])
          setReasoningEfforts(DEFAULT_REASONING_EFFORTS)
          setStatus('error')
          setError(errorMessage(err))
        })
    }, delayMs)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [projectId, normalizedUrl, normalizedKey, kind, useProxy, delayMs])

  return { models, reasoning_efforts: reasoningEfforts, status, error }
}
