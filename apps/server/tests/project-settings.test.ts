import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const savedEnvironment = new Map<string, string | undefined>()
const testProjectsDir = mkdtempSync(join(tmpdir(), 'research-os-project-settings-'))
function setEnvironment(name: string, value: string) {
  if (!savedEnvironment.has(name)) savedEnvironment.set(name, process.env[name])
  process.env[name] = value
}

afterEach(() => {
  for (const [name, value] of savedEnvironment) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  savedEnvironment.clear()
  rmSync(testProjectsDir, { recursive: true, force: true })
  vi.resetModules()
})

describe('project-scoped model settings', () => {
  it('starts from environment defaults and never returns keys', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-project-settings-${process.pid}`)
    setEnvironment('RESEARCH_PROJECTS_DIR', testProjectsDir)
    setEnvironment('RESEARCH_MODEL_URL_SIMPLE', 'http://127.0.0.1:3000/v1')
    setEnvironment('RESEARCH_MODEL_KEY_SIMPLE', 'env-secret')
    setEnvironment('RESEARCH_MODEL_KEY_MEDIUM', 'env-medium-secret')
    setEnvironment('RESEARCH_MODEL_KEY_COMPLEX', 'env-complex-secret')
    vi.resetModules()
    const { publicProjectModelSettings, privateProjectModelSettings } = await import('../src/project-settings.js')
    const publicSettings = publicProjectModelSettings('project-a')
    expect(publicSettings.source).toBe('env_default')
    expect(publicSettings.tiers.simple).toMatchObject({ url: 'http://127.0.0.1:3000/v1', key_configured: true })
    expect(publicSettings.tiers.simple).not.toHaveProperty('key')
    expect(privateProjectModelSettings('project-a').simple.key).toBe('env-secret')
  })

  it('inherits global runtime model settings before project overrides', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-project-settings-runtime-${process.pid}`)
    setEnvironment('RESEARCH_PROJECTS_DIR', testProjectsDir)
    vi.resetModules()
    const { saveDocumentSettings, saveModelSettings } = await import('../src/model-settings.js')
    saveModelSettings({
      simple: { model: 'grok-4.5', url: 'http://127.0.0.1:3000/v1', key: 'runtime-secret', reasoning_effort: 'low' },
      medium: { model: 'grok-4.5', url: 'http://127.0.0.1:3000/v1', key: 'runtime-secret', reasoning_effort: 'medium' },
      complex: { model: 'grok-4.5', url: 'http://127.0.0.1:3000/v1', key: 'runtime-secret', reasoning_effort: 'high' },
    })
    saveDocumentSettings({ model: 'grok-4.5-doc', url: 'http://127.0.0.1:3000/v1', key: 'runtime-doc-secret' })
    const { privateProjectModelSettings, publicProjectModelSettings } = await import('../src/project-settings.js')
    expect(privateProjectModelSettings('project-a').simple).toMatchObject({ model: 'grok-4.5', url: 'http://127.0.0.1:3000/v1', key: 'runtime-secret' })
    expect(privateProjectModelSettings('project-a').document).toMatchObject({ model: 'grok-4.5-doc', key: 'runtime-doc-secret' })
    expect(publicProjectModelSettings('project-a').tiers.simple).toMatchObject({ model: 'grok-4.5', key_configured: true })
    expect(publicProjectModelSettings('project-a').document).toMatchObject({ model: 'grok-4.5-doc', key_configured: true })
  })

  it('persists a project override without leaking to other projects', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-project-settings-${process.pid}`)
    setEnvironment('RESEARCH_PROJECTS_DIR', testProjectsDir)
    setEnvironment('RESEARCH_MODEL_URL_SIMPLE', 'http://127.0.0.1:3000/v1')
    setEnvironment('RESEARCH_MODEL_KEY_SIMPLE', 'env-secret')
    setEnvironment('RESEARCH_MODEL_KEY_MEDIUM', 'env-medium-secret')
    setEnvironment('RESEARCH_MODEL_KEY_COMPLEX', 'env-complex-secret')
    vi.resetModules()
    const { privateProjectModelSettings, publicProjectModelSettings, saveProjectModelSettings } = await import('../src/project-settings.js')
    saveProjectModelSettings('project-a', {
      simple: { model: 'luna', url: 'http://127.0.0.1:4000/v1', key: 'project-secret', reasoning_effort: 'low' },
      medium: { model: 'terra', url: 'http://127.0.0.1:4000/v1', key: '', reasoning_effort: 'medium' },
      complex: { model: 'sol', url: 'http://127.0.0.1:4000/v1', key: '', reasoning_effort: 'high' },
    })
    expect(existsSync(resolve(testProjectsDir, 'project-a', '.researchos', 'model-settings.json'))).toBe(true)
    expect(privateProjectModelSettings('project-a').simple).toMatchObject({ model: 'luna', url: 'http://127.0.0.1:4000/v1', key: 'project-secret' })
    expect(privateProjectModelSettings('project-a').medium.key).toBe('env-medium-secret')
    expect(privateProjectModelSettings('project-a').complex.key).toBe('env-complex-secret')
    expect(privateProjectModelSettings('project-b').simple.key).toBe('env-secret')
    expect(publicProjectModelSettings('project-a').source).toBe('project_override')
    expect(publicProjectModelSettings('project-a').tiers.simple).not.toHaveProperty('key')
  })

  it('keeps a blank key unchanged and preserves sibling sections', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-project-settings-${process.pid}`)
    setEnvironment('RESEARCH_PROJECTS_DIR', testProjectsDir)
    vi.resetModules()
    const { privateProjectModelSettings, saveProjectModelSettings, saveProjectDocumentSettings } = await import('../src/project-settings.js')
    saveProjectModelSettings('project-a', {
      simple: { model: 'luna', url: 'http://127.0.0.1:4000/v1', key: 'first-key', reasoning_effort: 'low' },
      medium: { model: 'terra', url: 'http://127.0.0.1:4000/v1', key: '', reasoning_effort: 'medium' },
      complex: { model: 'sol', url: 'http://127.0.0.1:4000/v1', key: '', reasoning_effort: 'high' },
    })
    saveProjectDocumentSettings('project-a', { model: 'deepseek-v4-flash', url: 'http://127.0.0.1:5000/v1', key: 'doc-key' })
    saveProjectModelSettings('project-a', {
      simple: { model: 'luna', url: 'http://127.0.0.1:4000/v1', key: '', reasoning_effort: 'low' },
      medium: { model: 'terra', url: 'http://127.0.0.1:4000/v1', key: '', reasoning_effort: 'medium' },
      complex: { model: 'sol', url: 'http://127.0.0.1:4000/v1', key: '', reasoning_effort: 'high' },
    })
    expect(privateProjectModelSettings('project-a').simple.key).toBe('first-key')
    expect(privateProjectModelSettings('project-a').document).toMatchObject({ model: 'deepseek-v4-flash', key: 'doc-key' })
  })
})

describe('project-scoped voice and removal', () => {
  it('persists voice settings per project and normalizes legacy providers', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-project-settings-${process.pid}`)
    setEnvironment('RESEARCH_PROJECTS_DIR', testProjectsDir)
    setEnvironment('GROQ_API_KEY', 'gsk-env-key')
    vi.resetModules()
    const { privateProjectVoiceSettings, publicProjectVoiceSettings, saveProjectVoiceSettings } = await import('../src/project-settings.js')
    saveProjectVoiceSettings('project-a', {
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      url: 'https://api.groq.com/openai/v1',
      key: 'gsk-project-key',
    })
    expect(privateProjectVoiceSettings('project-a')).toMatchObject({ provider: 'api', model: 'whisper-large-v3-turbo', key: 'gsk-project-key' })
    expect(privateProjectVoiceSettings('project-b').key).toBe('gsk-env-key')
    expect(publicProjectVoiceSettings('project-a')).not.toHaveProperty('key')
    expect(publicProjectVoiceSettings('project-a').source).toBe('project_override')
  })

  it('removes only the requested project settings', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-project-settings-${process.pid}`)
    setEnvironment('RESEARCH_PROJECTS_DIR', testProjectsDir)
    vi.resetModules()
    const { privateProjectVoiceSettings, removeProjectSettings, saveProjectVoiceSettings } = await import('../src/project-settings.js')
    saveProjectVoiceSettings('project-a', { provider: 'api', model: 'whisper', url: 'https://api.example.com/v1', key: 'key-a' })
    saveProjectVoiceSettings('project-b', { provider: 'api', model: 'whisper', url: 'https://api.example.com/v1', key: 'key-b' })
    removeProjectSettings('project-a')
    expect(existsSync(resolve(testProjectsDir, 'project-a', '.researchos', 'model-settings.json'))).toBe(false)
    expect(privateProjectVoiceSettings('project-a').key).not.toBe('key-a')
    expect(privateProjectVoiceSettings('project-b').key).toBe('key-b')
  })
})
