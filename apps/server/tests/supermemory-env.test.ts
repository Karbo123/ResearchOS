import { afterEach, describe, expect, it, vi } from 'vitest'

const savedEnvironment = new Map<string, string | undefined>()

function setEnvironment(name: string, value: string): void {
  if (!savedEnvironment.has(name)) savedEnvironment.set(name, process.env[name])
  process.env[name] = value
}

afterEach(() => {
  for (const [name, value] of savedEnvironment) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  savedEnvironment.clear()
  vi.resetModules()
})

function isolateProxyEnvironment(): void {
  setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-supermemory-env-${process.pid}-${Date.now()}`)
  setEnvironment('HTTPS_PROXY', 'http://system-proxy:7890')
  setEnvironment('https_proxy', '')
  setEnvironment('HTTP_PROXY', '')
  setEnvironment('http_proxy', '')
  setEnvironment('ALL_PROXY', '')
  setEnvironment('all_proxy', '')
}

describe('supermemory child proxy environment', () => {
  it('keeps the global system proxy out of the global Supermemory child by default', async () => {
    isolateProxyEnvironment()
    const { supermemoryChildEnv } = await import('../src/supermemory-env.js')

    const env = supermemoryChildEnv()

    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.HTTPS_PROXY).toBeUndefined()
  })

  it('applies an explicit SUPERMEMORY_PROXY_URL for the global child', async () => {
    isolateProxyEnvironment()
    setEnvironment('SUPERMEMORY_PROXY_URL', 'http://explicit-proxy:3128')
    const { supermemoryChildEnv } = await import('../src/supermemory-env.js')

    const env = supermemoryChildEnv()

    expect(env.HTTP_PROXY).toBe('http://explicit-proxy:3128')
    expect(env.HTTPS_PROXY).toBe('http://explicit-proxy:3128')
  })

  it('applies the system proxy only when the Embedding proxy switch is enabled', async () => {
    isolateProxyEnvironment()
    const { supermemoryChildEnv } = await import('../src/supermemory-env.js')

    const env = supermemoryChildEnv({}, true)

    expect(env.HTTP_PROXY).toBe('http://system-proxy:7890')
    expect(env.HTTPS_PROXY).toBe('http://system-proxy:7890')
  })

  it('clears proxy variables when the Embedding proxy switch is disabled', async () => {
    isolateProxyEnvironment()
    setEnvironment('SUPERMEMORY_PROXY_URL', 'http://explicit-proxy:3128')
    const { supermemoryChildEnv } = await import('../src/supermemory-env.js')

    const env = supermemoryChildEnv({}, false)

    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.HTTPS_PROXY).toBeUndefined()
  })
})
