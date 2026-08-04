import { resolve } from 'node:path'

const debugBase = process.env.CHROME_DEBUG_BASE || 'http://127.0.0.1:9222'
const appBase = process.env.RESEARCH_APP_URL || 'http://127.0.0.1:8080'

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

await evaluate(`localStorage.setItem('researchos.theme', 'light')`)
await evaluate(`localStorage.setItem('researchos.locale', 'zh-CN')`)
await send('Page.navigate', { url: `${appBase}/` })
await new Promise(resolveTimeout => setTimeout(resolveTimeout, 1800))

const result = await evaluate(`(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const theme = () => document.documentElement.dataset.theme
  const before = theme()
  document.querySelector('.side-settings')?.click()
  await wait(700)
  const darkButton = Array.from(document.querySelectorAll('.settings-theme-segmented button')).find(button => (button.textContent || '').includes('暗色'))
  darkButton?.click()
  await wait(250)
  const afterClick = theme()
  const saveEnabled = !document.querySelector('.modal-actions .primary')?.disabled
  document.querySelector('.modal-actions .primary')?.click()
  await wait(900)
  const afterSave = theme()
  localStorage.setItem('researchos.theme', 'light')
  document.documentElement.dataset.theme = 'light'
  return { before, afterClick, saveEnabled, afterSave }
})()`)

console.log(JSON.stringify({ status: 'passed', ...result }, null, 2))
process.exit(0)
