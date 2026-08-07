// Memory v2 browser acceptance check.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const debugBase = process.env.CHROME_DEBUG_BASE || 'http://127.0.0.1:9222'
const appBase = process.env.RESEARCH_APP_URL || 'http://127.0.0.1:8080'
const projectSlug = process.env.RESEARCH_PROJECT_SLUG || 'memory-visual-u7x1'
const outputDir = resolve(process.env.PREVIEW_DIR || 'runtime/memory-v2-browser')
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
const runtimeIssues = []

socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data))
  if (message.id) {
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message))
    else waiter.resolve(message.result)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const detail = message.params.exceptionDetails
    runtimeIssues.push(detail.exception?.description || detail.text || 'Runtime exception')
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    runtimeIssues.push(message.params.args.map(argument => argument.value ?? argument.description ?? '').join(' '))
  }
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    if (!/Failed to load resource|net::ERR_|net::ABORTED/.test(message.params.entry.text)) {
      runtimeIssues.push(message.params.entry.text)
    }
  }
})

function send(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolvePromise, rejectPromise) => pending.set(id, { resolve: resolvePromise, reject: rejectPromise }))
}

async function runChecks() {
await navigate(overviewUrl, 'en', 'light', 1440, 900, false)
await waitForSelector('.knowledge-preview', 5_000)
const workspace = await evaluate(`(() => {
  const meta = document.querySelector('.knowledge-document-meta')
  const detail = document.querySelector('.knowledge-document-pane .knowledge-document-head')
  const buttons = Array.from(document.querySelectorAll('.knowledge-document-list button'))
  return {
    documentCount: buttons.length,
    firstTitle: buttons[0]?.querySelector('.knowledge-document-list-copy strong')?.textContent?.trim() || null,
    hasSha: meta?.textContent?.includes('SHA-256') || false,
    hasGit: meta?.textContent?.includes('Git') || false,
    hasGeneration: meta?.textContent?.toLowerCase().includes('generation') || meta?.textContent?.includes('代次') || false,
    hasDependencies: !!meta?.querySelector('details'),
    previewTab: !!document.querySelector('.knowledge-document-pane .knowledge-document-tabs button[aria-selected="true"]'),
    sourceTab: Array.from(document.querySelectorAll('.knowledge-document-pane .knowledge-document-tabs button')).some(button => button.getAttribute('aria-selected') === 'false'),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  }
})()`)
await capture('memory-v2-workspace-detail.png')

await navigate(ideaUrl, 'en', 'light', 1440, 900, false)
await waitForSelector('.knowledge-draft-controls', 15_000)
const ideaDraftControls = await evaluate(`({
  visible: !!document.querySelector('.knowledge-draft-controls'),
  summary: document.querySelector('.knowledge-draft-controls summary')?.textContent?.trim() || null,
  kindButtons: document.querySelectorAll('.knowledge-segmented button').length,
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
})`)
await capture('memory-v2-idea-draft-controls.png')

await navigate(overviewUrl, 'en', 'light', 1440, 900, false)
await evaluate(`document.querySelector('.knowledge-workspace-tools .icon-btn')?.click()`)
await waitForSelector('.knowledge-lineage-canvas', 15_000)
const graph = await evaluate(`(() => {
  const groups = Array.from(document.querySelectorAll('.knowledge-graph-node-group'))
  const summary = document.querySelector('.knowledge-graph-summary')?.textContent?.trim() || null
  const detail = document.querySelector('.knowledge-graph-detail')
  return {
    canvas: !!document.querySelector('.knowledge-lineage-canvas'),
    groups: groups.length,
    summary,
    detail: !!detail,
    detailLabel: detail?.querySelector('h3')?.textContent?.trim() || null,
    firstNodeLabel: groups[0]?.getAttribute('aria-label') || null,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  }
})()`)
await capture('memory-v2-graph-initial.png')

const keyboardGraph = await evaluate(`(() => {
  const groups = Array.from(document.querySelectorAll('.knowledge-graph-node-group'))
  const before = groups.find(node => node.getAttribute('aria-pressed') === 'true')
  const target = groups[1] || groups[0]
  target?.focus()
  return {
    beforeLabel: before?.getAttribute('aria-label') || null,
    targetLabel: target?.getAttribute('aria-label') || null,
    focused: document.activeElement === target,
  }
})()`)
await pressKey('Enter', 'Enter', 13)
await wait(300)
const keyboardResult = {
  ...keyboardGraph,
  ...await evaluate(`(() => {
    const selected = document.querySelector('.knowledge-graph-node-group.is-selected')
    const detail = document.querySelector('.knowledge-graph-detail')
    return {
      selectedLabel: selected?.getAttribute('aria-label') || null,
      selectedPressed: selected?.getAttribute('aria-pressed') || null,
      detailLabel: detail?.querySelector('h3')?.textContent?.trim() || null,
    }
  })()`),
}
await capture('memory-v2-graph-keyboard.png')

await navigate(approvalsUrl, 'en', 'light', 1440, 900, false)
await waitForSelector('.knowledge-impact-sheet', 15_000)
const impact = await evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll('.knowledge-impact-row'))
  return {
    visible: !!document.querySelector('.knowledge-impact-sheet'),
    rowCount: rows.length,
    firstTitle: rows[0]?.querySelector('h3')?.textContent?.trim() || null,
    hasPolicy: !!rows[0]?.querySelector('.knowledge-impact-copy .muted'),
    graphButton: !!document.querySelector('.knowledge-impact-tools .icon-btn'),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  }
})()`)
await capture('memory-v2-impact-sheet.png')

await evaluate(`document.querySelector('.knowledge-impact-tools .icon-btn')?.click()`)
await waitForSelector('.knowledge-lineage-canvas', 15_000)
const graphFromImpact = await evaluate(`({
  canvas: !!document.querySelector('.knowledge-lineage-canvas'),
  groups: document.querySelectorAll('.knowledge-graph-node-group').length,
  detail: !!document.querySelector('.knowledge-graph-detail'),
})`)
await capture('memory-v2-graph-from-impact.png')

const sourceChecks = []
for (const locale of locales) {
  await navigate(overviewUrl, locale, 'light', 1440, 900, false)
  await waitForSelector('.context-sources-trigger', 15_000)
  const trigger = await evaluate(`(() => {
    const button = document.querySelector('.context-sources-trigger')
    button?.focus()
    return {
      exists: !!button,
      focused: document.activeElement === button,
      expandedBefore: button?.getAttribute('aria-expanded') || null,
    }
  })()`)
  await pressKey('Enter', 'Enter', 13)
  await wait(1_200)
  const opened = await evaluate(`(() => {
    const container = document.querySelector('.context-sources')
    const summary = document.querySelector('.context-sources-summary')?.textContent?.trim() || null
    const sources = document.querySelectorAll('.context-source-list li').length
    const note = document.querySelector('.context-sources-note')?.textContent?.trim() || null
    return {
      dataOpen: container?.dataset.open || null,
      expanded: document.querySelector('.context-sources-trigger')?.getAttribute('aria-expanded') || null,
      panel: !!document.querySelector('.context-sources-panel'),
      summary,
      sources,
      note,
      excluded: !!document.querySelector('.context-sources-excluded'),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    }
  })()`)
  sourceChecks.push({ locale, trigger, opened })
  await capture(`memory-v2-sources-${locale}.png`)
}

const failures = []
for (const state of matrix) {
  const { workspace, detail, previewTab, graphButton, chat, sourceTrigger, overflowX, lang, theme } = state
  if (!workspace || !detail || !previewTab || !graphButton || !chat || !sourceTrigger || overflowX || lang !== state.locale || theme !== state.theme) {
    failures.push(state)
  }
}
if (!workspace.documentCount || !workspace.firstTitle || !workspace.hasSha || !workspace.hasGit || !workspace.hasGeneration || !workspace.hasDependencies || !workspace.previewTab || !workspace.sourceTab || workspace.overflowX) {
  failures.push({ workspace })
}
if (!ideaDraftControls.visible || !ideaDraftControls.summary || ideaDraftControls.kindButtons < 1 || ideaDraftControls.overflowX) {
  failures.push({ ideaDraftControls })
}
if (!graph.canvas || graph.groups < 3 || !graph.summary || !graph.detail || !graph.firstNodeLabel || graph.overflowX) {
  failures.push({ graph })
}
if (!keyboardResult.focused || keyboardResult.selectedPressed !== 'true' || keyboardResult.selectedLabel !== keyboardResult.targetLabel || !keyboardResult.detailLabel) {
  failures.push({ keyboardResult })
}
if (!impact.visible || impact.rowCount < 1 || !impact.firstTitle || !impact.hasPolicy || !impact.graphButton || impact.overflowX) {
  failures.push({ impact })
}
if (!graphFromImpact.canvas || graphFromImpact.groups < 3 || !graphFromImpact.detail) {
  failures.push({ graphFromImpact })
}
for (const source of sourceChecks) {
  if (!source.trigger.focused || source.trigger.expandedBefore !== 'false' || !source.opened.panel || source.opened.dataOpen !== 'true' || source.opened.expanded !== 'true' || source.opened.sources < 1 || !source.opened.summary || !source.opened.note || source.opened.overflowX) {
    failures.push({ source })
  }
}
if (runtimeIssues.length) {
  failures.push({ runtimeIssues: runtimeIssues.slice(0, 20) })
}

const result = {
  status: failures.length ? 'failed' : 'passed',
  project: projectSlug,
  matrix: matrix.length,
  workspace,
  ideaDraftControls,
  graph,
  keyboardResult,
  impact,
  graphFromImpact,
  sourceChecks,
  runtimeIssues: runtimeIssues.slice(0, 20),
  screenshots: outputDir,
  failures,
}
console.log(JSON.stringify(result, null, 2))
socket.close()
if (failures.length) process.exit(1)
process.exit(0)
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed'
    throw new Error(detail)
  }
  return result.result.value
}

async function waitForApp() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await evaluate(`document.readyState === 'complete' && (!!document.querySelector('.app-shell') || !!document.querySelector('.project-view') || !!document.querySelector('.not-found-card'))`)
    if (ready) return
    await wait(250)
  }
  throw new Error('Research OS app did not finish loading')
}

async function waitForSelector(selector, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return true
    await wait(250)
  }
  return false
}

async function capture(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(resolve(outputDir, name), Buffer.from(result.data, 'base64'))
}

let localeThemeScript = null
async function setLocaleTheme(locale, theme) {
  if (localeThemeScript) {
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: localeThemeScript.identifier })
  }
  localeThemeScript = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {
      localStorage.setItem('researchos.locale', ${JSON.stringify(locale)})
      localStorage.setItem('researchos.theme', ${JSON.stringify(theme)})
    } catch (error) {}`,
  })
}

async function navigate(url, locale, theme, width, height, mobile) {
  await setLocaleTheme(locale, theme)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url })
  await send('Page.bringToFront')
  await waitForApp()
  await wait(900)
}

async function checkState(extra) {
  return evaluate(`(() => {
    const root = document.documentElement
    return {
      overflowX: root.scrollWidth > window.innerWidth,
      scrollWidth: root.scrollWidth,
      innerWidth: window.innerWidth,
      lang: root.lang || null,
      theme: root.dataset.theme || null,
      ${extra}
    }
  })()`)
}

async function pressKey(key, code, keyCode) {
  const text = key === 'Enter' ? '\r' : key
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, text, unmodifiedText: text })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
}

function wait(milliseconds) {
  return new Promise(resolveTimeout => setTimeout(resolveTimeout, milliseconds))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Emulation.setFocusEmulationEnabled', { enabled: true })

const overviewUrl = `${appBase}/project/${projectSlug}/overview/overview`
const ideaUrl = `${appBase}/project/${projectSlug}/overview/idea`
const approvalsUrl = `${appBase}/project/${projectSlug}/overview/approvals`
const dimensions = [
  { width: 320, height: 568, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: false },
  { width: 1024, height: 768, mobile: false },
  { width: 1365, height: 900, mobile: false },
  { width: 1440, height: 900, mobile: false },
]
const locales = ['zh-CN', 'zh-TW', 'en', 'es']
const themes = ['light', 'dark']

const matrix = []
for (const locale of locales) {
  for (const theme of themes) {
    for (const dimension of dimensions) {
      await navigate(overviewUrl, locale, theme, dimension.width, dimension.height, dimension.mobile)
      await waitForSelector('.knowledge-document-pane .knowledge-document-head', 5_000)
      await waitForSelector('.context-sources-trigger', 5_000)
      const state = await checkState(`
        workspace: !!document.querySelector('.knowledge-workspace'),
        documentCount: document.querySelectorAll('.knowledge-document-list button').length,
        detail: !!document.querySelector('.knowledge-document-pane .knowledge-document-head'),
        previewTab: !!document.querySelector('.knowledge-document-tabs button[aria-selected="true"]'),
        graphButton: !!document.querySelector('.knowledge-workspace-tools .icon-btn'),
        chat: !!document.querySelector('.project-chat'),
        sourceTrigger: !!document.querySelector('.context-sources-trigger')
      `)
      matrix.push({ locale, theme, dimension, ...state })
      await capture(`memory-v2-${locale}-${theme}-${dimension.width}px.png`)
    }
  }
}

await runChecks()
