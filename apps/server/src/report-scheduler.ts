import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { audit, database, rows } from './database.js'
import { runtimeRoot } from './paths.js'

type ScheduleState = Record<string, string>

const stateFile = resolve(runtimeRoot, 'report-scheduler-state.json')
const mastraBase = () => (process.env.MASTRA_BASE_URL || 'http://127.0.0.1:4111').replace(/\/$/, '')
const timezone = process.env.REPORT_TIMEZONE || 'Asia/Shanghai'
const dailyTime = process.env.RESEARCH_REPORT_DAILY_TIME || '09:00'
const weeklyTime = process.env.RESEARCH_REPORT_WEEKLY_TIME || '09:30'
const weeklyWeekday = Number(process.env.RESEARCH_REPORT_WEEKDAY || 1)

let working = false

function readState(): ScheduleState {
  if (!existsSync(stateFile)) return {}
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ScheduleState : {}
  } catch {
    return {}
  }
}

function writeState(state: ScheduleState): void {
  mkdirSync(runtimeRoot, { recursive: true })
  const temporaryPath = `${stateFile}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, stateFile)
}

function localParts(now: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now)
  const value = (type: string) => parts.find(part => part.type === type)?.value || ''
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    weekday: Math.max(0, weekdayNames.indexOf(value('weekday'))),
  }
}

function dailyKey(now: Date): string {
  const local = localParts(now)
  return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`
}

function weeklyKey(now: Date): string {
  const local = localParts(now)
  const current = Date.UTC(local.year, local.month - 1, local.day)
  const mondayOffset = (local.weekday + 6) % 7
  return new Date(current - mondayOffset * 86_400_000).toISOString().slice(0, 10)
}

function atOrAfter(now: Date, schedule: string): boolean {
  const [hour = 0, minute = 0] = schedule.split(':').map(Number)
  const local = localParts(now)
  return local.hour > hour || (local.hour === hour && local.minute >= minute)
}

async function dispatchReport(projectId: string, period: 'daily' | 'weekly', stateKey: string): Promise<void> {
  const response = await fetch(`${mastraBase()}/internal/workflows/project/${encodeURIComponent(projectId)}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'reports', project_id: projectId, period }),
    signal: AbortSignal.timeout(Number(process.env.RESEARCH_REPORT_TIMEOUT_SECONDS || 180) * 1000),
  })
  const body = await response.json().catch(() => ({})) as { status?: unknown; run_id?: unknown }
  if (!response.ok) throw new Error(`workflow_reports_http_${response.status}`)
  if (body.status !== 'success' && body.status !== 'failed') throw new Error(`workflow_reports_unexpected_${String(body.status || 'unknown')}`)
  const state = readState()
  state[`${projectId}:${period}`] = stateKey
  writeState(state)
  await audit('workflow.reports_scheduled', projectId, {
    period,
    run_id: body.run_id ?? null,
    status: body.status,
  })
}

async function tick(now = new Date()): Promise<void> {
  if (working) return
  working = true
  try {
    const local = localParts(now)
    const due: Array<'daily' | 'weekly'> = []
    if (atOrAfter(now, dailyTime)) due.push('daily')
    if (local.weekday === weeklyWeekday && atOrAfter(now, weeklyTime)) due.push('weekly')
    if (!due.length) return
    const projects = await rows<{ id: string }>("SELECT id FROM projects WHERE status='active'")
    const state = readState()
    for (const project of projects) {
      for (const period of due) {
        const stateKey = period === 'daily' ? dailyKey(now) : weeklyKey(now)
        if (state[`${project.id}:${period}`] === stateKey) continue
        try {
          await dispatchReport(project.id, period, stateKey)
        } catch (error) {
          await audit('workflow.reports_schedule_failed', project.id, {
            period,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  } finally {
    working = false
  }
}

export function startReportScheduler(): NodeJS.Timeout {
  void tick()
  return setInterval(() => void tick(), Number(process.env.RESEARCH_REPORT_POLL_SECONDS || 30) * 1000)
}
