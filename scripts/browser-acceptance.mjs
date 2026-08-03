import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const debugBase = process.env.CHROME_DEBUG_BASE || 'http://127.0.0.1:9222'
const appBase = process.env.RESEARCH_APP_URL || 'http://127.0.0.1:8080'
const projectSlug = process.env.RESEARCH_PROJECT_SLUG || 'uncertainty-based-d9a5'
const outputDir = resolve(process.env.PREVIEW_DIR || 'runtime/preview')
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed')
  return result.result.value
}

async function waitForApp() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await evaluate(`document.readyState === 'complete' && !!document.querySelector('.app-shell')`)
    if (ready) return
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 250))
  }
  throw new Error('Research OS app did not finish loading')
}

async function navigate(url, locale, theme, reduced = false) {
  await evaluate(`localStorage.setItem('researchos.locale', ${JSON.stringify(locale)})`)
  await evaluate(`localStorage.setItem('researchos.theme', ${JSON.stringify(theme)})`)
  await send('Emulation.setEmulatedMedia', {
    media: '',
    features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
  })
  await send('Page.navigate', { url })
  await new Promise(resolveTimeout => setTimeout(resolveTimeout, reduced ? 1200 : 1800))
  await waitForApp()
  await new Promise(resolveTimeout => setTimeout(resolveTimeout, reduced ? 150 : 500))
}

async function capture(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(resolve(outputDir, name), Buffer.from(result.data, 'base64'))
}

async function checkOverflow() {
  return evaluate(`({
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    theme: document.documentElement.dataset.theme || null,
    lang: document.documentElement.lang || null
  })`)
}

async function overflowOffenders() {
  return evaluate(`Array.from(document.querySelectorAll('*')).map(element => {
    const rect = element.getBoundingClientRect()
    return { tag: element.tagName, className: String(element.className || '').slice(0, 90), id: element.id || '', left: Math.round(rect.left * 10) / 10, right: Math.round(rect.right * 10) / 10, width: Math.round(rect.width * 10) / 10 }
  }).filter(item => item.right > window.innerWidth + 0.5 || item.left < -0.5).slice(0, 30)`)
}

const homeUrl = `${appBase}/`
const projectUrl = `${appBase}/project/${projectSlug}/overview/overview`

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

const results = []
for (const locale of ['zh-CN', 'zh-TW', 'en', 'es']) {
  await navigate(homeUrl, locale, 'light')
  const homeState = await checkOverflow()
  await capture(`108h-home-${locale}.png`)
  await navigate(projectUrl, locale, 'light')
  const projectState = await checkOverflow()
  await capture(`108h-project-${locale}.png`)
  results.push({ locale, homeState, projectState })
}

await navigate(homeUrl, 'en', 'dark')
const darkHome = await checkOverflow()
await capture('108h-home-dark.png')
await navigate(projectUrl, 'en', 'dark')
const darkProject = await checkOverflow()
await capture('108h-project-dark.png')

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await navigate(homeUrl, 'zh-CN', 'light')
const mobileHome = await checkOverflow()
const mobileHomeOffenders = await overflowOffenders()
await capture('108h-home-mobile-zh-CN.png')
await navigate(projectUrl, 'zh-CN', 'light')
const mobileProject = await checkOverflow()
await capture('108h-project-mobile-zh-CN.png')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

await navigate(projectUrl, 'en', 'light')
const drawer = await evaluate(`(() => {
  const toggle = document.querySelector('.project-drawer-toggle')
  toggle?.focus()
  const shell = document.querySelector('.project-drawer-shell')
  const button = document.querySelector('.project-drawer-toggle')
  return {
    hasToggle: !!toggle,
    activeLabel: document.activeElement?.getAttribute('aria-label') || null,
    ariaExpanded: button?.getAttribute('aria-expanded') || null,
    ariaControls: button?.getAttribute('aria-controls') || null,
    panelExists: !!document.getElementById('project-drawer-panel'),
    shellTransition: shell ? getComputedStyle(shell).transitionDuration : null,
  }
})()`)
await capture('108h-project-focus-light.png')

await navigate(projectUrl, 'en', 'light', true)
await evaluate(`document.querySelector('.project-drawer-toggle')?.click()`)
await new Promise(resolveTimeout => setTimeout(resolveTimeout, 200))
const reducedMotion = await evaluate(`(() => {
  const shell = document.querySelector('.project-drawer-shell')
  return {
    open: document.querySelector('.project-drawer-region')?.classList.contains('open') || false,
    transitionDuration: shell ? getComputedStyle(shell).transitionDuration : null,
    transitionProperty: shell ? getComputedStyle(shell).transitionProperty : null,
    transform: shell ? getComputedStyle(shell).transform : null,
  }
})()`)
await capture('108h-project-reduced-open.png')

console.log(JSON.stringify({ status: 'passed', drawer, reducedMotion, darkHome, darkProject, mobileHome, mobileHomeOffenders, mobileProject, results }, null, 2))
socket.close()
