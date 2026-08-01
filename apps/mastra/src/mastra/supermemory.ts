import { Supermemory } from 'supermemory'
import type { MemoryPromptData, SupermemoryMastraOptions } from '@supermemory/tools/mastra'
import type { InputProcessor, OutputProcessor, Processor, ProcessInputArgs, ProcessOutputResultArgs } from '@mastra/core/processors'

const PROJECT_TAG_PREFIX = 'research-os-project-'
const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:6767'
const DEFAULT_EMBEDDING_PROVIDER = 'local'
const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-base-en-v1.5'
const DEFAULT_EMBEDDING_DIMENSIONS = 768
// Supermemory Local 0.0.7-rc.2 ships only the local ONNX embedding worker. The
// official docs list SUPERMEMORY_EMBEDDING_PROVIDER/MODEL/DIMENSIONS/BASE_URL,
// but neither the installed binary nor the server-v0.0.7-rc.2 source reads them.
// Remote embedding must fail closed instead of silently using local vectors.
const REMOTE_EMBEDDING_SUPPORTED = false

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

function embeddingProfile() {
  const provider = process.env.SUPERMEMORY_EMBEDDING_PROVIDER?.trim().toLowerCase() || DEFAULT_EMBEDDING_PROVIDER
  const model = process.env.SUPERMEMORY_EMBEDDING_MODEL?.trim() || (provider === 'local' ? DEFAULT_EMBEDDING_MODEL : '')
  const parsedDimensions = Number(process.env.SUPERMEMORY_EMBEDDING_DIMENSIONS)
  const dimensions = Number.isInteger(parsedDimensions) && parsedDimensions > 0 ? parsedDimensions : DEFAULT_EMBEDDING_DIMENSIONS
  const baseUrl = process.env.SUPERMEMORY_EMBEDDING_BASE_URL?.trim() || null
  return {
    provider,
    model,
    dimensions,
    base_url: baseUrl,
    key_configured: provider !== 'local' && Boolean(process.env.SUPERMEMORY_EMBEDDING_API_KEY?.trim()),
    remote_embedding_supported: REMOTE_EMBEDDING_SUPPORTED,
    current_build_behavior: 'local_onnx',
  }
}

function requireSupportedEmbedding() {
  const profile = embeddingProfile()
  if (profile.provider !== 'local' && !profile.remote_embedding_supported) {
    throw new SupermemoryEmbeddingUnsupportedError(
      `已配置 ${profile.provider} embedding，但当前 Supermemory Local 0.0.7-rc.2 仅实现本地 embedding；不会静默降级。请使用 SUPERMEMORY_EMBEDDING_PROVIDER=local，或安装支持远程 embedding 的服务端 build。`,
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
  requireSupportedEmbedding()
  const baseUrl = process.env.SUPERMEMORY_BASE_URL?.trim() || DEFAULT_LOCAL_BASE_URL
  const apiKey = process.env.SUPERMEMORY_API_KEY?.trim() || (localAutoAuthAllowed(baseUrl) ? 'local-auto-auth' : undefined)
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
    const query = args.messages.map(messageText).filter(Boolean).join('\n').slice(-12000)
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
