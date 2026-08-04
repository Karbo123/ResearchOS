import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const debugBase = process.env.CHROME_DEBUG_BASE || 'http://127.0.0.1:9222'
const appBase = process.env.RESEARCH_APP_URL || 'http://127.0.0.1:8080'
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
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.description || result.exceptionDetails.text)
  }
  return result.result.value
}

async function capture(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(resolve(outputDir, name), Buffer.from(result.data, 'base64'))
}

await send('Page.navigate', { url: `${appBase}/` })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await new Promise(resolveTimeout => setTimeout(resolveTimeout, 1800))

const state = await evaluate(`(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  document.querySelector('.side-settings')?.click()
  await wait(700)
  const tabs = Array.from(document.querySelectorAll('.settings-tabs button')).map(button => button.textContent.trim())
  const modelsTab = Array.from(document.querySelectorAll('.settings-tabs button')).find(button => /模型|Models|Modelos/.test(button.textContent || ''))
  modelsTab?.click()
  await wait(500)
  const sections = Array.from(document.querySelectorAll('.settings-model-sections button')).map(button => button.textContent.trim())
  const testButtons = document.querySelectorAll('.model-test-button').length
  const clickByText = async (patterns) => {
    const button = Array.from(document.querySelectorAll('.settings-model-sections button')).find(candidate => patterns.some(pattern => (candidate.textContent || '').includes(pattern)))
    button?.click()
    await wait(500)
  }
  await clickByText(['图片识别', 'Image recognition', 'Reconocimiento de imágenes'])
  const vision = {
    heading: document.querySelector('.model-tier h3')?.textContent?.trim() || null,
    hasTest: !!document.querySelector('.model-test-button'),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  }
  await clickByText(['图片生成', 'Image generation', 'Generación de imágenes'])
  const image = {
    heading: document.querySelector('.model-tier h3')?.textContent?.trim() || null,
    hasResolution: !!document.querySelector('.model-tier select'),
    hasTest: !!document.querySelector('.model-test-button'),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  }
  const layout = await (async () => {
    const panel = document.querySelector('.modal-panel')
    const nav = document.querySelector('.settings-model-sections')
    const actions = document.querySelector('.modal-actions')
    const testButton = document.querySelector('.model-test-button')
    const box = element => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), right: Math.round(rect.right) }
    }
    return {
      panel: box(panel),
      nav: box(nav),
      navScrollable: nav ? nav.scrollWidth > nav.clientWidth : false,
      actions: box(actions),
      testButton: box(testButton),
      actionButtonCount: document.querySelectorAll('.modal-actions > button, .modal-actions .model-test-control').length,
    }
  })()
  return { tabs, sections, testButtons, vision, image, layout }
})()`)

await capture('settings-vision.png')
await new Promise(resolveTimeout => setTimeout(resolveTimeout, 350))
await capture('settings-image.png')
console.log(JSON.stringify({ status: 'passed', ...state }, null, 2))
process.exit(0)
