import { Supermemory } from 'supermemory'
import type { MemoryPromptData, SupermemoryMastraOptions } from '@supermemory/tools/mastra'
import type { InputProcessor, OutputProcessor, Processor, ProcessInputArgs, ProcessOutputResultArgs } from '@mastra/core/processors'

const PROJECT_TAG_PREFIX = 'research-os-project-'

export class SupermemoryConfigurationError extends Error {
  readonly code = 'supermemory_not_configured'
  constructor(message = 'Supermemory 已启用但 API key 未配置。') {
    super(message)
    this.name = 'SupermemoryConfigurationError'
  }
}

function enabled(): boolean {
  return process.env.SUPERMEMORY_ENABLED === 'true' || Boolean(process.env.SUPERMEMORY_API_KEY?.trim())
}

function options(projectId: string, conversationId: string): SupermemoryMastraOptions {
  const apiKey = process.env.SUPERMEMORY_API_KEY?.trim()
  if (!apiKey) throw new SupermemoryConfigurationError()
  return {
    apiKey,
    baseUrl: process.env.SUPERMEMORY_BASE_URL || undefined,
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
