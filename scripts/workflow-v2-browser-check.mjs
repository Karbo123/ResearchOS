import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const debugBase = process.env.CHROME_DEBUG_BASE || 'http://127.0.0.1:9222'
const appBase = process.env.RESEARCH_APP_URL || 'http://127.0.0.1:8080'
const projectSlug = process.env.RESEARCH_PROJECT_SLUG || 'pointcloud-classification-0000'
const outputDir = resolve(process.env.PREVIEW_DIR || 'runtime/workflow-v2-browser')
mkdirSync(outputDir, { recursive: true })

const targets = await fetch(`${debugBase}/json/list`).then(response => response.json())
const target = targets.find(candidate => candidate.type === 'page' && candidate.url.startsWith(appBase))
if (!target) throw new Error(`No Research OS page found under ${appBase}`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', rejectOpen, { once: true })
})

let nextId = 0
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data))
  if (!message.id) return
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(message.error.message))
  else waiter.resolve(message.result)
})

function send(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolvePromise, rejectPromise) => pending.set(id, { resolve: resolvePromise, reject: rejectPromise }))
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed')
  }
  return result.result.value
}

async function navigate(locale, theme, width, height, mobile = false) {
  await evaluate(`localStorage.setItem('researchos.locale', ${JSON.stringify(locale)})`)
  await evaluate(`localStorage.setItem('researchos.theme', ${JSON.stringify(theme)})`)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: `${appBase}/project/${projectSlug}/overview/overview` })
  await send('Page.bringToFront')
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await evaluate(`document.readyState === 'complete' && !!document.querySelector('.workflow-graph-section')`)
    if (ready) break
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 250))
  }
  await new Promise(resolveTimeout => setTimeout(resolveTimeout, 1200))
}

async function capture(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(resolve(outputDir, name), Buffer.from(result.data, 'base64'))
}

function wait(milliseconds) {
  return new Promise(resolveTimeout => setTimeout(resolveTimeout, milliseconds))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setFocusEmulationEnabled', { enabled: true })

const states = []
for (const [locale, theme] of [['zh-CN', 'light'], ['en', 'light'], ['zh-CN', 'dark'], ['en', 'dark']]) {
  await navigate(locale, theme, 1440, 900, false)
  const state = await evaluate(`(() => {
    const section = document.querySelector('.workflow-graph-section')
    return {
      visible: !!section,
      groups: document.querySelectorAll('.workflow-graph-group').length,
      nodes: document.querySelectorAll('.workflow-graph-node').length,
      filters: document.querySelectorAll('.workflow-graph-filter').length,
      status: document.querySelector('.workflow-graph-status')?.textContent?.trim() || null,
      version: section?.textContent?.includes('Version') || section?.textContent?.includes('版本') || false,
      sourceHash: section?.textContent?.includes('Source') || section?.textContent?.includes('哈希') || false,
      events: !!document.querySelector('.workflow-graph-list'),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      lang: document.documentElement.lang || null,
      theme: document.documentElement.dataset.theme || null,
    }
  })()`)
  states.push({ locale, theme, ...state })
  await capture(`workflow-v2-${locale}-${theme}-desktop.png`)
}

await navigate('zh-CN', 'light', 390, 844, true)
const mobile = await evaluate(`(() => {
  const section = document.querySelector('.workflow-graph-section')
  return {
    visible: !!section,
    groups: document.querySelectorAll('.workflow-graph-group').length,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  }
})()`)
await capture('workflow-v2-zh-CN-mobile.png')

await navigate('en', 'light', 1440, 900, false)
const firstGroupBefore = await evaluate(`(() => {
  const head = document.querySelector('.workflow-graph-group-head')
  head?.focus()
  const before = head?.getAttribute('aria-expanded')
  head?.click()
  return { hasFocus: document.activeElement?.classList.contains('workflow-graph-group-head'), expandedBefore: before }
})()`)
await wait(350)
const firstGroup = {
  ...firstGroupBefore,
  ...await evaluate(`(() => {
  const after = document.querySelector('.workflow-graph-group-head')?.getAttribute('aria-expanded')
  const collapsedBody = document.querySelector('.workflow-graph-group')?.querySelector('.workflow-graph-group-body')
  return {
    expandedAfter: after,
    collapsed: !collapsedBody,
    ariaLabel: document.querySelector('.workflow-graph-group-head')?.getAttribute('aria-label') || null,
  }
  })()`),
}
await capture('workflow-v2-collapse.png')

const nodeDetailBefore = await evaluate(`(() => {
  const node = document.querySelector('.workflow-graph-node')
  node?.click()
  return { clicked: !!node }
})()`)
await wait(350)
const nodeDetail = {
  ...nodeDetailBefore,
  ...await evaluate(`(() => {
  const detail = document.querySelector('.workflow-graph-node-detail')
  return {
    opened: !!detail,
    hasMeta: /capability|能力|Capacidad/i.test(detail?.textContent || ''),
    hasInput: !!detail?.querySelector('.workflow-graph-json'),
  }
  })()`),
}
await capture('workflow-v2-node-detail.png')

await navigate('en', 'light', 1440, 900, false)
const totalNodesBeforeFilter = await evaluate(`document.querySelectorAll('.workflow-graph-node').length`)
const failedFilterBefore = await evaluate(`(() => {
  const button = Array.from(document.querySelectorAll('.workflow-graph-filter')).find(candidate => /failed|失败|失败/i.test(candidate.textContent || ''))
  button?.click()
  return { clicked: !!button, totalBefore: document.querySelectorAll('.workflow-graph-node').length }
})()`)
await wait(350)
const failedFilter = {
  ...failedFilterBefore,
  ...await evaluate(`(() => {
  const visibleNodes = Array.from(document.querySelectorAll('.workflow-graph-node')).filter(node => node.offsetParent !== null).length
  const empty = document.querySelector('.workflow-graph-filter-empty')?.textContent?.trim() || null
  const button = Array.from(document.querySelectorAll('.workflow-graph-filter')).find(candidate => /failed|失败|失败/i.test(candidate.textContent || ''))
  return {
    visibleNodes,
    empty,
    active: button?.getAttribute('aria-pressed'),
  }
  })()`),
}

const governanceRunsBefore = await evaluate(`Array.from(document.querySelectorAll('.workflow-graph-list .data-row')).filter(row => row.textContent.includes('governance.approval')).length`)
const event = await fetch(`${appBase}/api/projects/${projectSlug}/workflow/events`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    event_type: 'approval.decided',
    payload: { actor: 'workflow-v2-browser-check', decision: 'rejected', reason: 'Browser acceptance event' },
    source: 'workflow-v2-browser-check',
    correlation_id: `browser-check:${Date.now()}`,
    idempotency_key: `browser-check:${Date.now()}`,
  }),
}).then(response => response.json()).catch(() => null)

const liveUpdate = await new Promise(resolveLive => {
  const deadline = Date.now() + 20_000
  const poll = async () => {
    const found = await evaluate(`Array.from(document.querySelectorAll('.workflow-graph-list .data-row')).filter(row => row.textContent.includes('governance.approval')).length > ${governanceRunsBefore}`)
    if (found || Date.now() > deadline) resolveLive(found)
    else setTimeout(poll, 500)
  }
  void poll()
})
await wait(800)
await capture('workflow-v2-live-update.png')

const failures = []
for (const state of states) {
  if (!state.visible || state.groups < 8 || state.nodes < 18 || state.filters !== 5 || state.overflowX || !state.status) {
    failures.push(state)
  }
}
if (!mobile.visible || mobile.groups < 8 || mobile.overflowX) failures.push({ mobile })
if (!firstGroup.hasFocus || firstGroup.expandedBefore !== 'true' || firstGroup.expandedAfter !== 'false' || !firstGroup.collapsed) failures.push({ firstGroup })
if (!nodeDetail.opened || !nodeDetail.hasMeta) failures.push({ nodeDetail })
if (!failedFilter.clicked || failedFilter.active !== 'true' || failedFilter.visibleNodes >= totalNodesBeforeFilter) failures.push({ failedFilter, totalNodesBeforeFilter })
if (!event?.id || !liveUpdate) failures.push({ event, liveUpdate })

console.log(JSON.stringify({
  status: failures.length ? 'failed' : 'passed',
  states,
  mobile,
  firstGroup,
  nodeDetail,
  failedFilter,
  event: event?.id || null,
  liveUpdate,
  screenshots: outputDir,
  failures,
}, null, 2))
if (failures.length) process.exit(1)
