import '../apps/server/src/env.js'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { repositoryRoot } from './idea-case-loader.js'

type HealthCheck = { name: string; url: string; ok: boolean; status: number | null; error?: string }

const runtimeRoot = resolve(repositoryRoot, process.env.RESEARCH_RUNTIME_DIR || 'runtime')
const eventLog = resolve(runtimeRoot, 'ops', 'health-events.jsonl')
const maxLogBytes = 5 * 1024 * 1024

function portFrom(value: string | undefined, fallback: number): number {
  const port = Number(value || fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('invalid_monitor_port')
  return port
}

function loopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]'
}

function privateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some(item => !Number.isInteger(item) || item < 0 || item > 255)) return false
  const [first, second] = octets
  if (first === undefined || second === undefined) return false
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
}

function localMastraHealthUrl(): string {
  const configured = process.env.MASTRA_BASE_URL || 'http://127.0.0.1:4111'
  const url = new URL(configured)
  if (url.protocol !== 'http:' || (!loopbackHost(url.hostname) && !privateIpv4(url.hostname))) throw new Error('mastra_monitor_url_must_be_local')
  url.pathname = '/health'
  url.search = ''
  url.hash = ''
  return url.toString()
}

function alertUrl(): URL | null {
  const configured = (process.env.RESEARCH_ALERT_WEBHOOK_URL || '').trim()
  if (!configured) return null
  const url = new URL(configured)
  if (url.protocol === 'http:' && !loopbackHost(url.hostname) && !privateIpv4(url.hostname)) throw new Error('alert_webhook_http_url_must_be_private')
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('alert_webhook_protocol_unsupported')
  return url
}

async function check(name: string, url: string): Promise<HealthCheck> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) })
    return { name, url, ok: response.ok, status: response.status }
  } catch (error) {
    return { name, url, ok: false, status: null, error: error instanceof Error ? error.message : 'health_request_failed' }
  }
}

async function snapshot() {
  const apiPort = portFrom(process.env.RESEARCH_API_PORT, 8080)
  const checks = await Promise.all([
    check('api', `http://127.0.0.1:${apiPort}/api/health`),
    check('mastra', localMastraHealthUrl()),
  ])
  return { timestamp: new Date().toISOString(), ok: checks.every(item => item.ok), checks }
}

function record(event: Record<string, unknown>) {
  mkdirSync(resolve(runtimeRoot, 'ops'), { recursive: true })
  if (existsSync(eventLog) && statSync(eventLog).size >= maxLogBytes) renameSync(eventLog, `${eventLog}.1`)
  appendFileSync(eventLog, `${JSON.stringify(event)}\n`, 'utf8')
}

async function notify(url: URL | null, event: Record<string, unknown>) {
  if (!url) return { configured: false, ok: true }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'ResearchOS-ops-monitor/1.0' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3_000),
    })
    return { configured: true, ok: response.ok, status: response.status }
  } catch (error) {
    return { configured: true, ok: false, error: error instanceof Error ? error.message : 'alert_request_failed' }
  }
}

function sleep(milliseconds: number) {
  return new Promise<void>(resolvePromise => setTimeout(resolvePromise, milliseconds))
}

const mode = process.argv[2] || 'once'
const intervalSeconds = Math.min(3_600, Math.max(5, Number(process.env.RESEARCH_MONITOR_INTERVAL_SECONDS || 30)))
const durationSeconds = mode === 'watch' ? Number(process.argv[3] || 300) : 0
if (mode !== 'once' && mode !== 'watch') throw new Error('usage: ops-monitor.ts once|watch [duration-seconds]')
if (mode === 'watch' && (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 604_800)) throw new Error('monitor_duration_must_be_between_1_and_604800_seconds')

const webhook = alertUrl()
let previousHealthy: boolean | null = null
const startedAt = Date.now()
let finalEvent: Record<string, unknown> | null = null
do {
  const health = await snapshot()
  const transition = previousHealthy === null || previousHealthy !== health.ok
  const event: Record<string, unknown> = {
    ...health,
    transition,
    alert: transition || !health.ok ? await notify(webhook, health) : { configured: Boolean(webhook), ok: true, skipped: true },
  }
  record(event)
  finalEvent = event
  previousHealthy = health.ok
  if (mode === 'once' || Date.now() - startedAt >= durationSeconds * 1_000) break
  await sleep(intervalSeconds * 1_000)
} while (true)

console.log(JSON.stringify(finalEvent, null, 2))
if (finalEvent && (!(finalEvent.ok) || !(finalEvent.alert as { ok?: boolean }).ok)) process.exitCode = 2
