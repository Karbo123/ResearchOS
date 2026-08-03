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
    const ready = await evaluate(`document.readyState === 'complete' && (!!document.querySelector('.app-shell') || !!document.querySelector('.not-found-card'))`)
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

async function wait(ms) {
  await new Promise(resolveTimeout => setTimeout(resolveTimeout, ms))
}

async function elementCenter(selector) {
  return evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  })()`)
}

async function computedStyles(selector) {
  return evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    const style = getComputedStyle(element)
    return {
      transform: style.transform,
      left: style.left,
      width: style.width,
      paddingRight: style.paddingRight,
      transitionProperty: style.transitionProperty,
      transitionDuration: style.transitionDuration,
      transitionTimingFunction: style.transitionTimingFunction,
      backgroundColor: style.backgroundColor,
      color: style.color,
      zIndex: style.zIndex,
      backdropFilter: style.backdropFilter,
      webkitBackdropFilter: style.webkitBackdropFilter,
    }
  })()`)
}

async function pressKey(key, code, keyCode) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
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

const notFound = []
for (const locale of ['zh-CN', 'zh-TW', 'en', 'es']) {
  await navigate(`${appBase}/definitely-not-a-page`, locale, 'light')
  const state = await evaluate(`(() => {
    const card = document.querySelector('.not-found-card')
    return {
      visible: !!card,
      title: document.querySelector('.not-found-card h1')?.textContent || null,
      code: document.querySelector('.not-found-code')?.textContent || null,
      countdown: document.querySelector('.not-found-countdown')?.textContent || null,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      lang: document.documentElement.lang || null,
    }
  })()`)
  await capture(`108h-404-${locale}.png`)
  notFound.push({ locale, state })
}
await navigate(`${appBase}/definitely-not-a-page`, 'en', 'dark')
const notFoundDark = await evaluate(`!!document.querySelector('.not-found-card') && document.documentElement.dataset.theme === 'dark'`)
await capture('108h-404-dark.png')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await navigate(`${appBase}/definitely-not-a-page`, 'zh-CN', 'light')
const notFoundMobile = await evaluate(`({
  visible: !!document.querySelector('.not-found-card'),
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
})`)
await capture('108h-404-mobile.png')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

const settings = []
for (const locale of ['zh-CN', 'zh-TW', 'en', 'es']) {
  await navigate(homeUrl, locale, 'light')
  await evaluate(`document.querySelector('.side-settings')?.click()`)
  await wait(700)
  const state = await evaluate(`(() => {
    const dialog = document.querySelector('.modal-panel[role="dialog"]')
    return {
      visible: !!dialog,
      ariaLabel: dialog?.getAttribute('aria-label') || null,
      tabs: document.querySelectorAll('.settings-tabs button').length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    }
  })()`)
  await capture(`108h-settings-${locale}.png`)
  settings.push({ locale, state })
}
await navigate(homeUrl, 'en', 'dark')
await evaluate(`document.querySelector('.side-settings')?.click()`)
await wait(700)
const settingsDark = await evaluate(`!!document.querySelector('.modal-panel[role="dialog"]') && document.documentElement.dataset.theme === 'dark'`)
await capture('108h-settings-dark.png')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await navigate(homeUrl, 'zh-CN', 'light')
await evaluate(`document.querySelector('.side-settings')?.click()`)
await wait(700)
const settingsMobile = await evaluate(`({
  visible: !!document.querySelector('.modal-panel[role="dialog"]'),
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
})`)
await capture('108h-settings-mobile.png')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

await navigate(homeUrl, 'en', 'light')
const deleteHover = await elementCenter('.home-delete-action')
if (deleteHover) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: deleteHover.x, y: deleteHover.y, button: 'none' })
  await wait(240)
  deleteHover.style = await computedStyles('.home-delete-action')
}
await evaluate(`document.querySelector('.home-delete-action')?.click()`)
await wait(600)
const deleteLight = await evaluate(`(() => {
  const input = document.getElementById('delete-project-confirmation')
  const dialog = input?.closest('.modal-panel') || null
  const modal = document.querySelector('.modal')
  const topbar = document.querySelector('.topbar')
  const modalRect = modal?.getBoundingClientRect()
  const topbarRect = topbar?.getBoundingClientRect()
  return {
    visible: !!dialog,
    ariaLabel: dialog?.getAttribute('aria-label') || null,
    hasConfirmationInput: !!document.getElementById('delete-project-confirmation'),
    warning: document.querySelector('.delete-project-warning')?.textContent || null,
    maskCoversTopbar: modalRect && topbarRect
      ? modalRect.top <= topbarRect.top && modalRect.bottom >= topbarRect.bottom && modalRect.left <= topbarRect.left && modalRect.right >= topbarRect.right
      : false,
  }
})()`)
deleteLight.mask = await computedStyles('.modal')
deleteLight.panel = await computedStyles('.modal-panel')
await capture('108h-delete-light.png')
await navigate(homeUrl, 'en', 'dark')
await evaluate(`document.querySelector('.home-delete-action')?.click()`)
await wait(600)
const deleteDark = await evaluate(`(() => {
  const input = document.getElementById('delete-project-confirmation')
  const modal = document.querySelector('.modal')
  const topbar = document.querySelector('.topbar')
  const modalRect = modal?.getBoundingClientRect()
  const topbarRect = topbar?.getBoundingClientRect()
  return {
    visible: !!input?.closest('.modal-panel'),
    theme: document.documentElement.dataset.theme,
    maskCoversTopbar: modalRect && topbarRect
      ? modalRect.top <= topbarRect.top && modalRect.bottom >= topbarRect.bottom && modalRect.left <= topbarRect.left && modalRect.right >= topbarRect.right
      : false,
  }
})()`)
deleteDark.mask = await computedStyles('.modal')
await capture('108h-delete-dark.png')

await navigate(projectUrl, 'en', 'light')
await evaluate(`document.querySelector('.project-drawer-toggle')?.click()`)
await wait(700)
const brand = await evaluate(`(() => {
  const button = document.querySelector('.brand')
  const mark = document.querySelector('.brand-mark')
  const rect = button?.getBoundingClientRect()
  const markRect = mark?.getBoundingClientRect()
  button?.click()
  return {
    exists: !!button,
    ariaLabel: button?.getAttribute('aria-label') || null,
    heightCoversMark: rect && markRect ? rect.height >= markRect.height : false,
    borderRadius: button ? getComputedStyle(button).borderRadius : null,
  }
})()`)
await wait(900)
brand.homePath = await evaluate(`window.location.pathname`)
await capture('108h-brand-home.png')

await navigate(homeUrl, 'en', 'light')
const brandHover = await evaluate(`(() => {
  const button = document.querySelector('.brand')
  const rect = button?.getBoundingClientRect()
  return rect ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } : null
})()`)
if (brandHover) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: brandHover.x, y: brandHover.y })
  await wait(350)
  brand.hoverBackground = await evaluate(`(() => {
    const button = document.querySelector('.brand')
    return button ? getComputedStyle(button).backgroundColor : null
  })()`)
  await capture('108h-brand-hover.png')
}

await navigate(projectUrl, 'en', 'light')
await evaluate(`localStorage.setItem('researchos.theme', 'dark'); location.reload()`)
await wait(2200)
const themePersist = await evaluate(`({
  path: window.location.pathname,
  lang: document.documentElement.lang,
  theme: document.documentElement.dataset.theme,
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
})`)
await capture('108h-theme-persist.png')

const paperUrl = `${appBase}/project/${projectSlug}/paper/introduction`
await navigate(paperUrl, 'en', 'light')
const longContent = await evaluate(`(() => {
  const content = document.querySelector('.tab-content')
  const scrollables = Array.from(document.querySelectorAll('*'))
    .filter(element => element.scrollHeight > element.clientHeight + 4 && ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
    .slice(0, 6)
    .map(element => ({ tag: element.tagName, className: String(element.className || '').slice(0, 70) }))
  return {
    exists: !!content,
    scrollable: scrollables.length > 0,
    scrollables,
    overflowY: content ? getComputedStyle(content).overflowY : null,
    scrollbarWidth: content ? getComputedStyle(content).scrollbarWidth : null,
  }
})()`)
await capture('108h-long-content.png')

await navigate(homeUrl, 'en', 'light')
const actionRow = await elementCenter('.project-row')
const actionMotion = {
  rowFound: !!actionRow,
  initial: await computedStyles('.project-actions-track'),
  samples: [],
}
if (actionRow) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: actionRow.x, y: actionRow.y, button: 'none' })
  for (const delay of [0, 80, 220, 520]) {
    if (delay) await wait(delay)
    actionMotion.samples.push({ delay, ...(await computedStyles('.project-actions-track')) })
  }
  await capture('108h-action-hover.png')
  actionMotion.mainButton = await computedStyles('.project-main-button')
  actionMotion.pin = await computedStyles('.project-pin')
  actionMotion.deleteAction = await computedStyles('.project-delete')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1400, y: 50 })
  await wait(620)
  actionMotion.afterLeave = await computedStyles('.project-actions-track')
}

await navigate(homeUrl, 'en', 'light')
await evaluate(`document.querySelector('.side-settings')?.click()`)
await wait(650)
await pressKey('Escape', 'Escape', 27)
await wait(350)
const programmaticFocus = await evaluate(`(() => {
  const main = document.querySelector('.project-main-button')
  main?.focus({ preventScroll: true })
  const track = document.querySelector('.project-actions-track')
  return {
    activeTag: document.activeElement?.tagName || null,
    activeClass: String(document.activeElement?.className || ''),
    focusVisible: !!document.activeElement?.matches(':focus-visible'),
    transform: track ? getComputedStyle(track).transform : null,
  }
})()`)
programmaticFocus.settled = await computedStyles('.project-actions-track')
await evaluate(`document.activeElement?.blur?.()`)
let keyboardFocus = null
for (let attempt = 0; attempt < 40; attempt += 1) {
  await pressKey('Tab', 'Tab', 9)
  await wait(90)
  keyboardFocus = await evaluate(`(() => {
    const active = document.activeElement
    const row = active?.closest('.project-row')
    const track = document.querySelector('.project-actions-track')
    return {
      activeTag: active?.tagName || null,
      activeClass: String(active?.className || ''),
      isProjectRow: !!row,
      focusVisible: active ? active.matches(':focus-visible') : false,
      transform: track ? getComputedStyle(track).transform : null,
    }
  })()`)
  if (keyboardFocus?.isProjectRow) break
}
if (keyboardFocus?.isProjectRow) {
  await wait(280)
  keyboardFocus.settledTransform = (await computedStyles('.project-actions-track'))?.transform
  keyboardFocus.paddingRight = (await computedStyles('.project-main-button'))?.paddingRight
}
actionMotion.programmaticFocus = programmaticFocus
actionMotion.keyboardFocus = keyboardFocus

await navigate(projectUrl, 'en', 'light')
const tabMotion = await evaluate(`(() => {
  const nav = document.querySelector('.project-areas')
  const indicator = nav?.querySelector('.sliding-tab-indicator')
  return {
    exists: !!indicator,
    ready: indicator?.classList.contains('ready') || false,
    activeLabel: nav?.querySelector('button[data-active="true"]')?.textContent?.trim() || null,
    nextLabel: nav?.querySelector('button[data-active="false"]')?.textContent?.trim() || null,
  }
})()`)
if (tabMotion.exists) {
  tabMotion.before = await computedStyles('.project-areas .sliding-tab-indicator')
  await evaluate(`document.querySelector('.project-areas button[data-active="false"]')?.click()`)
  tabMotion.samples = []
  for (const delay of [0, 80, 220, 560]) {
    if (delay) await wait(delay)
    tabMotion.samples.push({ delay, ...(await computedStyles('.project-areas .sliding-tab-indicator')) })
  }
  tabMotion.after = await computedStyles('.project-areas .sliding-tab-indicator')
}

await navigate(homeUrl, 'en', 'light')
const sidebarResize = await evaluate(`(() => {
  const resizer = document.querySelector('.sidebar-resizer')
  const shell = document.querySelector('.app-shell')
  return {
    exists: !!resizer,
    ariaMin: resizer?.getAttribute('aria-valuemin') || null,
    ariaMax: resizer?.getAttribute('aria-valuemax') || null,
    ariaNow: resizer?.getAttribute('aria-valuenow') || null,
    width: shell?.style.getPropertyValue('--sidebar-width') || null,
  }
})()`)
sidebarResize.originalWidth = sidebarResize.width ? Number.parseFloat(sidebarResize.width) : 276
const resizeKey = sidebarResize.width === '380px' ? 'ArrowLeft' : 'ArrowRight'
sidebarResize.usedKey = resizeKey
await evaluate(`document.querySelector('.sidebar-resizer')?.focus()`)
await pressKey(resizeKey, resizeKey, resizeKey === 'ArrowLeft' ? 37 : 39)
await wait(320)
sidebarResize.afterWidth = await evaluate(`document.querySelector('.app-shell')?.style.getPropertyValue('--sidebar-width') || null`)
sidebarResize.changed = sidebarResize.width !== sidebarResize.afterWidth && sidebarResize.afterWidth !== null
await evaluate(`localStorage.setItem('researchos.sidebarWidth', ${JSON.stringify(String(sidebarResize.originalWidth))})`)

console.log(JSON.stringify({ status: 'passed', drawer, reducedMotion, darkHome, darkProject, mobileHome, mobileHomeOffenders, mobileProject, results, notFound, notFoundDark, notFoundMobile, settings, settingsDark, settingsMobile, deleteLight, deleteDark, brand, themePersist, longContent, actionMotion, tabMotion, sidebarResize }, null, 2))
socket.close()
