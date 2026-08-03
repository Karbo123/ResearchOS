import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadIdeaCase, repositoryRoot } from './idea-case-loader.js'

const apiBase = process.env.RESEARCH_API_URL || 'http://127.0.0.1:8080'
const settingsPath = resolve(repositoryRoot, 'runtime', 'model-settings.json')
const temporaryPath = `${settingsPath}.failure-check.tmp`
const previous = existsSync(settingsPath) ? readFileSync(settingsPath) : null

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${apiBase}${path}`, { ...init, signal: AbortSignal.timeout(300_000) })
  const raw = await response.text()
  let payload: unknown
  try { payload = JSON.parse(raw) }
  catch { throw new Error(`non-JSON API response (${response.status})`) }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`invalid API response shape (${response.status})`)
  return { response, payload: payload as Record<string, unknown> }
}

function roleCount(messages: unknown[], role: string): number {
  return messages.filter(item => typeof item === 'object' && item !== null && (item as Record<string, unknown>).role === role).length
}

const testCase = loadIdeaCase('insufficient-ai')
const initial = await jsonRequest('/api/chat', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: testCase.initial_message, clarification_mode: testCase.clarification_mode, attachments: [] }),
})
if (!initial.response.ok) throw new Error(`initial model call failed: ${initial.response.status}`)
const sessionId = String(initial.payload.session_id || '')
if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('initial chat did not return a session id')

const beforeResult = await jsonRequest(`/api/sessions/${sessionId}/messages`)
if (!beforeResult.response.ok) throw new Error('unable to inspect messages before failure')
const before = beforeResult.payload.messages as unknown[]

try {
  writeFileSync(temporaryPath, `${JSON.stringify({
    simple: { model: 'gpt-5.6-luna', url: 'http://127.0.0.1:9/v1', key: 'intentional-invalid-test-key', reasoning_effort: 'low' },
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, settingsPath)

  const failure = await jsonRequest('/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, message: testCase.initial_message, clarification_mode: testCase.clarification_mode, attachments: [] }),
  })
  if (failure.response.ok) throw new Error('invalid model endpoint unexpectedly succeeded')
  if (!['llm_request_failed', 'llm_timeout'].includes(String(failure.payload.code || ''))) {
    throw new Error(`unexpected failure contract: ${failure.response.status} ${String(failure.payload.code || '')}`)
  }

  const afterResult = await jsonRequest(`/api/sessions/${sessionId}/messages`)
  if (!afterResult.response.ok) throw new Error('unable to inspect messages after failure')
  const after = afterResult.payload.messages as unknown[]
  if (roleCount(after, 'assistant') !== roleCount(before, 'assistant')) throw new Error('assistant message was persisted after model failure')
  if (roleCount(after, 'user') !== roleCount(before, 'user') + 1) throw new Error('failed turn user-message audit record is missing')
  console.log(JSON.stringify({
    status: 'passed', structured_error: String(failure.payload.code), assistant_message_persisted: false,
    runtime_override_restored: true,
  }, null, 2))
} finally {
  if (existsSync(temporaryPath)) rmSync(temporaryPath)
  if (previous === null) rmSync(settingsPath, { force: true })
  else writeFileSync(settingsPath, previous, { mode: 0o600 })
}
