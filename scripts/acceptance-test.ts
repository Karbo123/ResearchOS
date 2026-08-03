import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadIdeaCase, repositoryRoot } from './idea-case-loader.js'

const apiBase = process.env.RESEARCH_API_URL || 'http://127.0.0.1:8080'
const envPath = resolve(repositoryRoot, '.env')
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(300_000) })
  const payload = await response.json().catch(() => ({})) as T & { code?: string; message?: string }
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${payload.code || ''} ${payload.message || ''}`)
  return payload
}

const testCase = loadIdeaCase(process.env.RESEARCH_IDEA_CASE || 'active-learning-3d')
const health = await request<Record<string, unknown>>('GET', '/api/health')
if (health.runtime !== 'native-typescript' || health.container_runtime_required !== false) throw new Error('native runtime health contract failed')
const settings = await request<{ tiers: Record<string, Record<string, unknown>> }>('GET', '/api/settings/models')
if (Object.values(settings.tiers).some(tier => 'key' in tier)) throw new Error('model settings exposed a key')
if (Object.values(settings.tiers).some(tier => tier.key_configured !== true)) throw new Error('one or more model tiers have no configured key')
for (const [tier, suffix] of [['simple', 'SIMPLE'], ['medium', 'MEDIUM'], ['complex', 'COMPLEX']] as const) {
  const expectedUrl = process.env[`RESEARCH_MODEL_URL_${suffix}`]
  if (!expectedUrl || settings.tiers[tier]?.url !== expectedUrl) throw new Error(`${tier} model URL does not match project .env`)
}
let chat = await request<Record<string, any>>('POST', '/api/chat', { message: testCase.initial_message, clarification_mode: testCase.clarification_mode })
const routes = [{ tier: chat.model_tier, model: chat.model, reasoning_effort: chat.reasoning_effort }]
const facts = `${Object.entries(testCase.confirmed_facts).map(([key, value]) => `${key}: ${value}`).join('\n')}\nThese are explicit user-confirmed facts.`
for (let index = 0; index < 4 && chat.phase !== 'ready_for_confirmation'; index += 1) {
  chat = await request('POST', '/api/chat', { session_id: chat.session_id, message: facts, clarification_mode: testCase.clarification_mode })
  routes.push({ tier: chat.model_tier, model: chat.model, reasoning_effort: chat.reasoning_effort })
}
if (chat.phase !== 'ready_for_confirmation') throw new Error('Idea clarification did not reach confirmation')
const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 4)
const project = await request<{ project_id: string }>('POST', '/api/projects', {
  slug: `native-acceptance-${suffix}`,
  title: testCase.description,
})
const paused = await request<{ status: string }>('POST', `/api/projects/${project.project_id}/state`, { action: 'pause', reason: 'Native acceptance state gate' })
const resumed = await request<{ status: string }>('POST', `/api/projects/${project.project_id}/state`, { action: 'resume', reason: 'Native acceptance state gate complete' })
if (paused.status !== 'paused' || resumed.status !== 'active') throw new Error('project state gate failed')
const result = { status: 'passed', runtime: 'native-typescript', project_id: project.project_id, idea_case: testCase.id, completed_at: new Date().toISOString(), checks: { model_keys_hidden: true, model_urls_match_env: true, real_model_calls: routes.length, project_state_gate: true }, routes }
const output = resolve(repositoryRoot, 'artifacts', 'acceptance')
mkdirSync(output, { recursive: true })
const target = resolve(output, `acceptance-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}.json`)
writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ ...result, result_file: target }, null, 2))
