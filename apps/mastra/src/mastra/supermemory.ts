import { Supermemory } from 'supermemory'
import type { InputProcessor, OutputProcessor, Processor, ProcessInputArgs, ProcessOutputResultArgs } from '@mastra/core/processors'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { researchRoot } from './env.js'

// Local, minimal type contracts matching the official Supermemory Mastra
// integration surface used by Research OS. Keeping these inline avoids pulling
// the heavy `@supermemory/tools` dependency tree (and its vulnerable AI SDK
// transitives) into the runtime just for two type-only imports.
interface SupermemoryMastraOptions {
  apiKey: string
  baseUrl: string
  containerTag: string
  customId: string
  mode: string
  addMemory: string
}

interface MemoryPromptData {
  userMemories?: string
  generalSearchMemories?: string
  searchResults?: Array<{ memory?: string; chunk?: string; metadata?: unknown }>
}

const PROJECT_TAG_PREFIX = 'research-os-project-'
const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:6767'
const DEFAULT_EMBEDDING_PROVIDER = 'local'
const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-m3'
// Local ONNX default (Xenova/bge-m3, multilingual, 1024 dims). Remote
// embedding default is also 1024 (verified working up to the server's ~1024d
// pgvector HNSW upsert ceiling; see TODO 053-C).
const DEFAULT_EMBEDDING_DIMENSIONS = 1024
const DEFAULT_REMOTE_EMBEDDING_DIMENSIONS = 1024
// Remote embedding (OpenAI / OpenAI-compatible / Gemini) is implemented by the
// official server-v0.0.5 build only. server-v0.0.6 and 0.0.7-rc.2 regressed it
// to the local ONNX worker, so scripts/start-supermemory.ts refuses to start a
// non-v0.0.5 binary when SUPERMEMORY_EMBEDDING_PROVIDER is remote; the API
// guard below also fails closed instead of silently using local vectors.
const REMOTE_EMBEDDING_SUPPORTED = true

interface MastraProjectEmbeddingSettings {
  provider: 'local' | 'openai' | 'gemini'
  model: string
  dimensions: number
  base_url: string
  key: string
  pool_key: string
}

interface MastraEmbeddingPool {
  provider: 'local' | 'openai' | 'gemini'
  model: string
  dimensions: number
  base_url: string
  key: string
  port: number
}

function mastraProjectEmbeddingSettings(): Record<string, MastraProjectEmbeddingSettings> {
  const settingsPath = resolve(researchRoot, 'runtime', 'project-embedding-settings.json')
  if (!existsSync(settingsPath)) return {}
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, MastraProjectEmbeddingSettings>
  } catch {
    return {}
  }
}

function mastraEmbeddingPools(): Record<string, MastraEmbeddingPool> {
  const poolsPath = resolve(researchRoot, 'runtime', 'embedding-pools.json')
  if (!existsSync(poolsPath)) return {}
  try {
    return JSON.parse(readFileSync(poolsPath, 'utf8')) as Record<string, MastraEmbeddingPool>
  } catch {
    return {}
  }
}

export class SupermemoryConfigurationError extends Error {
  readonly code = 'supermemory_not_configured'
  constructor(message = 'Supermemory 已启用但 API key 未配置。') {
    super(message)
    this.name = 'SupermemoryConfigurationError'
  }
}

export class SupermemoryEmbeddingUnsupportedError extends Error {
  readonly code = 'supermemory_embedding_unsupported'
  constructor(message = '当前 Supermemory Local 版本不支持远程 embedding，且禁止静默降级。') {
    super(message)
    this.name = 'SupermemoryEmbeddingUnsupportedError'
  }
}

function enabled(): boolean {
  return process.env.SUPERMEMORY_ENABLED === 'true' || Boolean(process.env.SUPERMEMORY_API_KEY?.trim())
}

function isLoopbackBaseUrl(baseURL: string): boolean {
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

function localAutoAuthAllowed(baseURL: string): boolean {
  return process.env.SUPERMEMORY_ENABLED !== 'false' && isLoopbackBaseUrl(baseURL) && process.env.SUPERMEMORY_LOCAL_AUTO_AUTH !== 'false'
}

function embeddingProfile(projectId?: string) {
  const override = projectId ? mastraProjectEmbeddingSettings()[projectId] : null
  const provider = override?.provider ?? (process.env.SUPERMEMORY_EMBEDDING_PROVIDER?.trim().toLowerCase() || DEFAULT_EMBEDDING_PROVIDER)
  const model = override ? override.model : (process.env.SUPERMEMORY_EMBEDDING_MODEL?.trim() || (provider === 'local' ? DEFAULT_EMBEDDING_MODEL : ''))
  const parsedDimensions = Number(process.env.SUPERMEMORY_EMBEDDING_DIMENSIONS)
  const defaultDimensions = provider === 'local' ? DEFAULT_EMBEDDING_DIMENSIONS : DEFAULT_REMOTE_EMBEDDING_DIMENSIONS
  const dimensions = override ? override.dimensions : (Number.isInteger(parsedDimensions) && parsedDimensions > 0 ? parsedDimensions : defaultDimensions)
  const baseUrl = override ? (override.base_url || null) : (process.env.SUPERMEMORY_EMBEDDING_BASE_URL?.trim() || null)
  const keyConfigured = provider !== 'local' && Boolean((override?.key || process.env.SUPERMEMORY_EMBEDDING_API_KEY)?.trim())
  return {
    provider,
    model,
    dimensions,
    base_url: baseUrl,
    key_configured: keyConfigured,
    remote_embedding_supported: REMOTE_EMBEDDING_SUPPORTED,
    current_build_behavior: provider === 'local' ? 'local_onnx' : 'remote_openai_compatible',
  }
}

function requireSupportedEmbedding(projectId?: string) {
  const profile = embeddingProfile(projectId)
  if (profile.provider !== 'local' && !profile.remote_embedding_supported) {
    throw new SupermemoryEmbeddingUnsupportedError(
      `已配置 ${profile.provider} embedding，但当前服务端 build 未实现远程 embedding；不会静默降级。请安装 server-v0.0.5（唯一实现 SUPERMEMORY_EMBEDDING_* 的官方 build），或改用 SUPERMEMORY_EMBEDDING_PROVIDER=local。`,
    )
  }
  return profile
}

function unauthenticatedLocalFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.delete('authorization')
  return fetch(input, { ...init, headers })
}

function options(projectId: string, conversationId: string): SupermemoryMastraOptions {
  requireSupportedEmbedding(projectId)
  const override = mastraProjectEmbeddingSettings()[projectId]
  const poolPort = override?.pool_key ? mastraEmbeddingPools()[override.pool_key]?.port : null
  const baseUrl = poolPort != null
    ? `http://127.0.0.1:${poolPort}`
    : (process.env.SUPERMEMORY_BASE_URL?.trim() || DEFAULT_LOCAL_BASE_URL)
  const apiKey = override?.key?.trim() || process.env.SUPERMEMORY_API_KEY?.trim() || (localAutoAuthAllowed(baseUrl) ? 'local-auto-auth' : undefined)
  if (!apiKey) throw new SupermemoryConfigurationError()
  return {
    apiKey,
    baseUrl,
    containerTag: `${PROJECT_TAG_PREFIX}${projectId}`,
    customId: `research-os-session-${conversationId}`,
    mode: 'full',
    addMemory: 'always',
  }
}

function client(config: SupermemoryMastraOptions): Supermemory {
  return new Supermemory({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: Number(process.env.SUPERMEMORY_TIMEOUT_SECONDS || 30000),
    maxRetries: 0,
    fetch: !process.env.SUPERMEMORY_API_KEY?.trim() && localAutoAuthAllowed(config.baseUrl || DEFAULT_LOCAL_BASE_URL) ? unauthenticatedLocalFetch : undefined,
  })
}

function messageText(message: { content?: unknown }): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (!content || typeof content !== 'object') return ''
  const value = content as { content?: unknown; parts?: Array<{ type?: string; text?: unknown }> }
  if (typeof value.content === 'string') return value.content
  return (value.parts || []).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n')
}

function formatMemoryPrompt(data: MemoryPromptData): string {
  return [
    '<research-os-project-memory>',
    data.userMemories ? `<profile>\n${data.userMemories}\n</profile>` : '',
    data.generalSearchMemories ? `<related>\n${data.generalSearchMemories}\n</related>` : '',
    '</research-os-project-memory>',
  ].filter(Boolean).join('\n')
}

function semanticQuery(messages: ProcessInputArgs['messages']): string {
  const userMessages = messages
    .filter(message => message.role === 'user')
    .map(messageText)
    .filter(Boolean)
  for (const text of [...userMessages].reverse()) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const field = parsed.latest_user_message ?? parsed.user_message
      if (typeof field === 'string' && field.trim()) return field.trim().slice(0, 2000)
    } catch {
      // Plain user text is analyzed below.
    }
  }
  return userMessages.join('\n').slice(-2000)
}

class StrictSupermemoryInputProcessor implements Processor {
  readonly id = 'research-os-supermemory-input'
  readonly name = 'Research OS Supermemory Input'
  private readonly config: SupermemoryMastraOptions
  private readonly api: Supermemory

  constructor(projectId: string, conversationId: string) {
    this.config = options(projectId, conversationId)
    this.api = client(this.config)
  }

  async processInput(args: ProcessInputArgs) {
    const query = semanticQuery(args.messages)
    if (!query) return args.messageList
    const response = await this.api.search({
      q: query,
      containerTag: this.config.containerTag,
      searchMode: 'hybrid',
      include: { relatedMemories: true, documents: true, summaries: true },
      limit: 8,
    })
    const data: MemoryPromptData = {
      userMemories: '',
      generalSearchMemories: response.results.map(item => `${item.memory || item.chunk || ''} (similarity=${item.similarity})`).filter(Boolean).join('\n'),
      searchResults: response.results.map(item => ({ memory: item.memory || item.chunk || '', metadata: item.metadata || {} })),
    }
    const prompt = formatMemoryPrompt(data)
    if (prompt !== '<research-os-project-memory>\n</research-os-project-memory>') args.messageList.addSystem(prompt, this.id)
    return args.messageList
  }
}

class StrictSupermemoryOutputProcessor implements Processor {
  readonly id = 'research-os-supermemory-output'
  readonly name = 'Research OS Supermemory Output'
  private readonly config: SupermemoryMastraOptions
  private readonly api: Supermemory

  constructor(projectId: string, conversationId: string) {
    this.config = options(projectId, conversationId)
    this.api = client(this.config)
  }

  async processOutputResult(args: ProcessOutputResultArgs) {
    const messages = args.messages.map(message => ({ role: message.role, content: messageText(message) })).filter(message => message.content)
    if (!messages.length) return args.messageList
    await this.api.post('/v4/conversations', {
      body: {
        conversationId: this.config.customId,
        messages,
        containerTags: [this.config.containerTag],
        metadata: { source: 'research-os', project_id: this.config.containerTag.slice(PROJECT_TAG_PREFIX.length) },
      },
    })
    return args.messageList
  }
}

export function strictSupermemoryProcessors(projectId: string, conversationId: string): { inputProcessors?: InputProcessor[]; outputProcessors?: OutputProcessor[] } {
  if (!enabled()) return {}
  return {
    inputProcessors: [new StrictSupermemoryInputProcessor(projectId, conversationId)],
    outputProcessors: [new StrictSupermemoryOutputProcessor(projectId, conversationId)],
  }
}
