import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

const servers: Server[] = []
const savedEnvironment = new Map<string, string | undefined>()

function setEnvironment(name: string, value: string): void {
  if (!savedEnvironment.has(name)) savedEnvironment.set(name, process.env[name])
  process.env[name] = value
}

async function listen(handler: Parameters<typeof createServer>[0]): Promise<{ server: Server; url: string }> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not expose a TCP port')
  return { server, url: `http://127.0.0.1:${address.port}` }
}

function configureProxy(url: string): void {
  setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-proxy-fetch-${process.pid}-${Date.now()}`)
  setEnvironment('HTTPS_PROXY', url)
  setEnvironment('https_proxy', '')
  setEnvironment('HTTP_PROXY', '')
  setEnvironment('http_proxy', '')
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  for (const [name, value] of savedEnvironment) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  savedEnvironment.clear()
  vi.resetModules()
})

describe('global model proxy routing', () => {
  it('routes a public model URL through the enabled proxy', async () => {
    let receivedUrl = ''
    const proxy = await listen((request, response) => {
      receivedUrl = request.url || ''
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"proxied":true}')
    })
    configureProxy(proxy.url)
    const { createProxyFetch } = await import('../src/proxy-fetch.js')

    const response = await createProxyFetch({ useProxy: true })('http://model.example/v1/models')

    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ proxied: true })
    expect(receivedUrl).toBe('http://model.example/v1/models')
  })

  it('bypasses the proxy for loopback and private model URLs', async () => {
    let proxyRequests = 0
    const proxy = await listen((_request, response) => {
      proxyRequests += 1
      response.writeHead(502)
      response.end()
    })
    const target = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"direct":true}')
    })
    configureProxy(proxy.url)
    const { createProxyFetch } = await import('../src/proxy-fetch.js')

    const response = await createProxyFetch()(`${target.url}/v1/models`)

    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ direct: true })
    expect(proxyRequests).toBe(0)
  })

  it('bypasses the proxy for a public URL when useProxy is false', async () => {
    let proxyRequests = 0
    const proxy = await listen((_request, response) => {
      proxyRequests += 1
      response.writeHead(502)
      response.end()
    })
    const target = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"direct":true}')
    })
    configureProxy(proxy.url)
    const { createProxyFetch } = await import('../src/proxy-fetch.js')

    const response = await createProxyFetch({ useProxy: false })(`${target.url}/v1/models`)

    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ direct: true })
    expect(proxyRequests).toBe(0)
  })

  it('does not route through the proxy by default', async () => {
    let proxyRequests = 0
    const proxy = await listen((_request, response) => {
      proxyRequests += 1
      response.writeHead(502)
      response.end()
    })
    const target = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"direct":true}')
    })
    configureProxy(proxy.url)
    const { createProxyFetch } = await import('../src/proxy-fetch.js')

    const response = await createProxyFetch()(`${target.url}/v1/models`)

    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ direct: true })
    expect(proxyRequests).toBe(0)
  })
})
