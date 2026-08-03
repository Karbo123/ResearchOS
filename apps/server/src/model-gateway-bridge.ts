import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { isAllowedModelUrl, isResponsesBaseUrl } from './model-url.js'
import { repositoryRoot, runtimeRoot } from './paths.js'
import { proxyFetch } from './proxy-fetch.js'
import { supermemoryChildEnv } from './supermemory-env.js'

const DEFAULT_PORT = 3010
const DEFAULT_TIMEOUT_MS = 120_000
const MAX_REQUEST_BYTES = 12 * 1024 * 1024
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024
const JSON_INSTRUCTION = 'Return a JSON object that conforms to the requested JSON Schema.'

const contentPartSchema = z.record(z.string(), z.unknown())
const chatMessageSchema = z.object({
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool', 'function']),
  content: z.union([z.string(), z.array(contentPartSchema), z.null()]).optional(),
  name: z.string().max(200).optional(),
  tool_calls: z.array(z.object({
    id: z.string().min(1).max(500),
    type: z.literal('function'),
    function: z.object({
      name: z.string().min(1).max(200),
      arguments: z.union([z.string(), z.record(z.string(), z.unknown())]),
    }).strict(),
  }).strict()).max(100).optional(),
  tool_call_id: z.string().min(1).max(500).optional(),
}).strict()

const responseFormatSchema = z.union([
  z.object({ type: z.literal('text') }).strict(),
  z.object({ type: z.literal('json_object') }).strict(),
  z.object({
    type: z.literal('json_schema'),
    json_schema: z.object({
      name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      description: z.string().max(10_000).optional(),
      strict: z.boolean().optional(),
      schema: z.record(z.string(), z.unknown()),
    }).strict(),
  }).strict(),
])

const chatToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(10_000).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().optional(),
  }).strict(),
}).strict()

const chatRequestSchema = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(chatMessageSchema).min(1).max(2_000),
  response_format: responseFormatSchema.optional(),
  tools: z.array(chatToolSchema).max(128).optional(),
  tool_choice: z.union([
    z.enum(['none', 'auto', 'required']),
    z.object({ type: z.literal('function'), function: z.object({ name: z.string().min(1).max(200) }).strict() }).strict(),
  ]).optional(),
  stream: z.boolean().optional(),
  max_tokens: z.number().int().positive().max(1_000_000).optional(),
  max_completion_tokens: z.number().int().positive().max(1_000_000).optional(),
  temperature: z.number().finite().min(0).max(2).optional(),
  top_p: z.number().finite().min(0).max(1).optional(),
  reasoning_effort: z.enum(['low', 'medium', 'high', 'minimal', 'none']).optional(),
  parallel_tool_calls: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  stop: z.union([z.string(), z.array(z.string()).max(16)]).optional(),
  seed: z.number().int().optional(),
  user: z.string().max(500).optional(),
  frequency_penalty: z.number().finite().optional(),
  presence_penalty: z.number().finite().optional(),
  verbosity: z.enum(['low', 'medium', 'high']).optional(),
  n: z.number().int().positive().max(16).optional(),
  store: z.boolean().optional(),
  service_tier: z.string().max(100).optional(),
}).strict()

type ChatRequest = z.infer<typeof chatRequestSchema>
type JsonRecord = Record<string, unknown>

export class ModelBridgeError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ModelBridgeError'
  }
}

export type ModelBridgeConfig = {
  targetBaseUrl: string
  targetKey: string
  model: string
  timeoutMs: number
}

export type ResponsesRequest = {
  model: string
  input: Array<JsonRecord>
  text?: JsonRecord
  tools?: Array<JsonRecord>
  tool_choice?: unknown
  parallel_tool_calls?: boolean
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  reasoning?: JsonRecord
  metadata?: JsonRecord
  stream?: boolean
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonBody(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    throw new ModelBridgeError(422, 'model_bridge_invalid_json', '模型请求中包含不可序列化的 JSON 值。')
  }
}

function textFromPart(part: JsonRecord): string {
  const text = part.text
  if (typeof text !== 'string') throw new ModelBridgeError(422, 'model_bridge_invalid_message', '模型消息文本部分缺少字符串 text。')
  return text
}

function convertContentPart(part: JsonRecord, role: ChatRequest['messages'][number]['role']): JsonRecord {
  const type = part.type
  if (type === 'text' || type === 'input_text' || type === 'output_text') {
    return { type: role === 'assistant' ? 'output_text' : 'input_text', text: textFromPart(part) }
  }
  if (type === 'image_url') {
    const image = part.image_url
    const url = typeof image === 'string' ? image : isRecord(image) ? image.url : undefined
    if (typeof url !== 'string' || !url) throw new ModelBridgeError(422, 'model_bridge_invalid_message', 'image_url 缺少有效 URL。')
    return { type: 'input_image', image_url: url, detail: isRecord(image) && typeof image.detail === 'string' ? image.detail : undefined }
  }
  if (type === 'input_image') {
    const url = part.image_url
    if (typeof url !== 'string' || !url) throw new ModelBridgeError(422, 'model_bridge_invalid_message', 'input_image 缺少有效 image_url。')
    return { type, image_url: url, detail: typeof part.detail === 'string' ? part.detail : undefined }
  }
  if (type === 'image') {
    const source = part.source
    if (!isRecord(source) || typeof source.data !== 'string') throw new ModelBridgeError(422, 'model_bridge_invalid_message', 'image 部分缺少有效 source。')
    return { type: 'input_image', image_url: `data:${typeof source.media_type === 'string' ? source.media_type : 'image/png'};base64,${source.data}` }
  }
  if (type === 'file') {
    const file = part.file
    if (!isRecord(file)) throw new ModelBridgeError(422, 'model_bridge_invalid_message', 'file 部分缺少有效 file。')
    return { type: 'input_file', file_id: typeof file.file_id === 'string' ? file.file_id : undefined, file_data: typeof file.file_data === 'string' ? file.file_data : undefined, filename: typeof file.filename === 'string' ? file.filename : undefined }
  }
  throw new ModelBridgeError(422, 'model_bridge_unsupported_message', `不支持的 Chat 消息内容类型: ${String(type)}`)
}

function convertMessage(message: ChatRequest['messages'][number]): Array<JsonRecord> {
  if (message.role === 'tool' || message.role === 'function') {
    if (!message.tool_call_id) throw new ModelBridgeError(422, 'model_bridge_invalid_tool_message', '工具消息缺少 tool_call_id。')
    return [{ type: 'function_call_output', call_id: message.tool_call_id, output: typeof message.content === 'string' ? message.content : jsonBody(message.content ?? '') }]
  }

  const result: Array<JsonRecord> = []
  if (message.content !== null && message.content !== undefined) {
    const content = typeof message.content === 'string'
      ? [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }]
      : message.content.map(part => convertContentPart(part, message.role))
    if (content.length > 0) result.push({ role: message.role, content })
  }
  for (const toolCall of message.tool_calls ?? []) {
    const args = typeof toolCall.function.arguments === 'string' ? toolCall.function.arguments : jsonBody(toolCall.function.arguments)
    result.push({ type: 'function_call', call_id: toolCall.id, name: toolCall.function.name, arguments: args })
  }
  if (result.length === 0 && message.role !== 'assistant') {
    throw new ModelBridgeError(422, 'model_bridge_invalid_message', '模型消息必须包含 content 或 tool_calls。')
  }
  return result
}

function responseTextFormat(format: ChatRequest['response_format']): JsonRecord | undefined {
  if (!format || format.type === 'text') return undefined
  if (format.type === 'json_schema') {
    return {
      format: {
        type: 'json_schema',
        name: format.json_schema.name,
        description: format.json_schema.description,
        strict: format.json_schema.strict ?? true,
        schema: format.json_schema.schema,
      },
    }
  }
  return {
    format: {
      type: 'json_schema',
      name: 'generic_json_response',
      strict: false,
      schema: { type: 'object' },
    },
  }
}

export function chatToResponsesRequest(input: unknown, expectedModel?: string): ResponsesRequest {
  const parsed = chatRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new ModelBridgeError(422, 'model_bridge_invalid_request', 'Supermemory 的 Chat 请求不符合受支持的严格请求契约。', parsed.error.flatten())
  }
  const request = parsed.data
  if (expectedModel && request.model !== expectedModel) {
    throw new ModelBridgeError(400, 'model_bridge_model_mismatch', 'Supermemory 请求的模型与 Research OS 配置的 medium 模型不一致。')
  }
  if (request.stream) throw new ModelBridgeError(422, 'model_bridge_stream_unsupported', '该受限桥接层不接受流式模型请求。')

  const inputItems: Array<JsonRecord> = request.messages.flatMap(convertMessage)
  const text = responseTextFormat(request.response_format)
  if (text) inputItems.unshift({ role: 'system', content: [{ type: 'input_text', text: JSON_INSTRUCTION }] })

  const output: ResponsesRequest = { model: request.model, input: inputItems }
  if (text) output.text = text
  if (request.tools) output.tools = request.tools.map(tool => ({ type: 'function', name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters ?? { type: 'object', properties: {} }, strict: tool.function.strict ?? true }))
  if (request.tool_choice) output.tool_choice = typeof request.tool_choice === 'string'
    ? request.tool_choice
    : { type: 'function', name: request.tool_choice.function.name }
  if (request.parallel_tool_calls !== undefined) output.parallel_tool_calls = request.parallel_tool_calls
  const maxTokens = request.max_completion_tokens ?? request.max_tokens
  if (maxTokens !== undefined) output.max_output_tokens = maxTokens
  if (request.temperature !== undefined) output.temperature = request.temperature
  if (request.top_p !== undefined) output.top_p = request.top_p
  if (request.reasoning_effort) output.reasoning = { effort: request.reasoning_effort }
  if (request.metadata) output.metadata = request.metadata
  output.stream = false
  return output
}

function responseOutputText(item: JsonRecord): string {
  const content = item.content
  if (!Array.isArray(content)) return ''
  return content.filter(isRecord).filter(part => part.type === 'output_text').map(part => typeof part.text === 'string' ? part.text : '').join('')
}

export function responsesToChatCompletion(payload: unknown): JsonRecord {
  if (!isRecord(payload)) throw new ModelBridgeError(502, 'model_bridge_invalid_response', 'Responses 网关返回的正文不是 JSON 对象。')
  const output = Array.isArray(payload.output) ? payload.output.filter(isRecord) : []
  const textParts: string[] = []
  const toolCalls: Array<JsonRecord> = []
  for (const item of output) {
    if (item.type === 'message') textParts.push(responseOutputText(item))
    if (item.type === 'function_call') {
      if (typeof item.call_id !== 'string' || typeof item.name !== 'string' || typeof item.arguments !== 'string') {
        throw new ModelBridgeError(502, 'model_bridge_invalid_response', 'Responses 网关返回了不完整的 function_call。')
      }
      toolCalls.push({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } })
    }
  }
  if (textParts.length === 0 && typeof payload.output_text === 'string') textParts.push(payload.output_text)
  const content = textParts.join('') || null
  if (content === null && toolCalls.length === 0) throw new ModelBridgeError(502, 'model_bridge_invalid_response', 'Responses 网关没有返回可用的文本或工具调用。')
  const usage = isRecord(payload.usage) ? payload.usage : undefined
  const result: JsonRecord = {
    id: typeof payload.id === 'string' ? payload.id : undefined,
    object: 'chat.completion',
    created: typeof payload.created_at === 'number' ? payload.created_at : Math.floor(Date.now() / 1000),
    model: typeof payload.model === 'string' ? payload.model : undefined,
    choices: [{ index: 0, message: { role: 'assistant', content, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop' }],
  }
  if (usage) result.usage = {
    prompt_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
    completion_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    total_tokens: (typeof usage.input_tokens === 'number' ? usage.input_tokens : 0) + (typeof usage.output_tokens === 'number' ? usage.output_tokens : 0),
  }
  return result
}

function targetResponsesUrl(baseUrl: string): string {
  if (!isAllowedModelUrl(baseUrl) || !isResponsesBaseUrl(baseUrl)) throw new ModelBridgeError(500, 'model_bridge_invalid_target', '模型桥接目标必须是允许的 Responses API base URL。')
  return `${baseUrl.replace(/\/+$/, '')}/responses`
}

function timeoutMs(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 600_000 ? parsed : DEFAULT_TIMEOUT_MS
}

function configFromEnvironment(): ModelBridgeConfig {
  const targetBaseUrl = (process.env.MODEL_BRIDGE_TARGET_URL || process.env.RESEARCH_MODEL_URL_MEDIUM || '').trim()
  const targetKey = (process.env.MODEL_BRIDGE_TARGET_KEY || process.env.RESEARCH_MODEL_KEY_MEDIUM || '').trim()
  const model = (process.env.MODEL_BRIDGE_ALLOWED_MODEL || process.env.RESEARCH_MODEL_MEDIUM || '').trim()
  if (!targetKey || !model) throw new ModelBridgeError(500, 'model_bridge_not_configured', '模型桥接层缺少固定网关 key 或模型配置。')
  targetResponsesUrl(targetBaseUrl)
  return { targetBaseUrl, targetKey, model, timeoutMs: timeoutMs(process.env.MODEL_BRIDGE_TIMEOUT_MS) }
}

export async function forwardChatCompletion(input: unknown, config: ModelBridgeConfig, fetcher: typeof fetch = proxyFetch()): Promise<JsonRecord> {
  const request = chatToResponsesRequest(input, config.model)
  let response: Response
  try {
    response = await fetcher(targetResponsesUrl(config.targetBaseUrl), {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${config.targetKey}`, 'content-type': 'application/json', 'user-agent': 'research-os-supermemory-responses-bridge/1' },
      body: jsonBody(request),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    throw new ModelBridgeError(502, 'model_bridge_upstream_unreachable', '固定 Responses 网关请求失败。', error instanceof Error ? error.message : String(error))
  }
  const bodyText = await response.text()
  if (bodyText.length > MAX_RESPONSE_BYTES) throw new ModelBridgeError(502, 'model_bridge_response_too_large', '固定 Responses 网关返回内容超过桥接层限制。')
  let body: unknown
  try { body = JSON.parse(bodyText) } catch { throw new ModelBridgeError(502, 'model_bridge_invalid_response', '固定 Responses 网关返回了非 JSON 响应。') }
  if (!response.ok) throw new ModelBridgeError(response.status >= 400 && response.status <= 599 ? response.status : 502, 'model_bridge_upstream_error', '固定 Responses 网关拒绝了模型请求。', body)
  return responsesToChatCompletion(body)
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const contentLength = Number(request.headers['content-length'] || 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) throw new ModelBridgeError(413, 'model_bridge_request_too_large', '模型请求超过桥接层大小限制。')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new ModelBridgeError(413, 'model_bridge_request_too_large', '模型请求超过桥接层大小限制。')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  try { return JSON.parse(raw) } catch { throw new ModelBridgeError(400, 'model_bridge_invalid_json', '模型请求正文必须是有效 JSON。') }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const data = jsonBody(body)
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('content-length', Buffer.byteLength(data))
  response.end(data)
}

function bridgeBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`
}

function bridgePort(): number {
  const parsed = Number(process.env.SUPERMEMORY_MODEL_BRIDGE_PORT || DEFAULT_PORT)
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) throw new Error('SUPERMEMORY_MODEL_BRIDGE_PORT must be between 1024 and 65535')
  return parsed
}

export function createModelGatewayBridgeServer(config: ModelBridgeConfig = configFromEnvironment()) {
  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { status: 'ok', protocol: 'responses-bridge', model: config.model, target_base_url: config.targetBaseUrl })
        return
      }
      if (request.method !== 'POST' || !/^\/(?:v1\/)?chat\/completions\/?$/.test(request.url || '')) {
        sendJson(response, 404, { error: { type: 'not_found', message: '只支持受限的 Chat Completions 兼容入口。' } })
        return
      }
      const body = await readRequestBody(request)
      const result = await forwardChatCompletion(body, config)
      sendJson(response, 200, result)
    } catch (error) {
      const bridgeError = error instanceof ModelBridgeError ? error : new ModelBridgeError(500, 'model_bridge_internal_error', '模型桥接层处理失败。')
      sendJson(response, bridgeError.status, { error: { type: bridgeError.code, message: bridgeError.message, ...(bridgeError.details === undefined ? {} : { details: bridgeError.details }) } })
    }
  })
}

async function startStandalone(): Promise<void> {
  const port = bridgePort()
  const server = createModelGatewayBridgeServer()
  await new Promise<void>((resolveStart, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolveStart)
  })
  process.stdout.write(`model gateway bridge listening on ${bridgeBaseUrl(port)}\n`)
  const close = () => server.close(() => process.exit(0))
  process.once('SIGTERM', close)
  process.once('SIGINT', close)
}

function bridgePidPath(): string {
  return resolve(runtimeRoot, 'supermemory-model-bridge.pid')
}

async function bridgeHealthMatches(baseUrl: string, config: ModelBridgeConfig): Promise<boolean> {
  try {
    const response = await proxyFetch()(new URL('/health', baseUrl).href, { signal: AbortSignal.timeout(2_000) })
    if (!response.ok) return false
    const body = await response.json() as JsonRecord
    return body.protocol === 'responses-bridge' && body.model === config.model && body.target_base_url === config.targetBaseUrl
  } catch {
    return false
  }
}

function killPidFile(path: string): void {
  if (!existsSync(path)) return
  const pidText = readFileSync(path, 'utf8').trim()
  if (pidText) {
    try { process.kill(Number(pidText)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  rmSync(path, { force: true })
}

export function stopModelGatewayBridge(): void {
  killPidFile(bridgePidPath())
}

export async function ensureModelGatewayBridge(): Promise<string> {
  const targetConfig = configFromEnvironment()
  if (process.env.SUPERMEMORY_MODEL_BRIDGE_ENABLED === 'false') return targetConfig.targetBaseUrl
  const port = bridgePort()
  const baseUrl = bridgeBaseUrl(port)
  if (await bridgeHealthMatches(baseUrl, targetConfig)) return baseUrl
  stopModelGatewayBridge()
  mkdirSync(runtimeRoot, { recursive: true })
  const sourceEntry = resolve(repositoryRoot, 'apps/server/src/model-gateway-bridge.ts')
  const compiledEntry = resolve(repositoryRoot, 'apps/server/dist/model-gateway-bridge.js')
  const tsxEntry = resolve(repositoryRoot, 'node_modules/tsx/dist/cli.mjs')
  const args = existsSync(compiledEntry) ? [compiledEntry] : existsSync(tsxEntry) ? [tsxEntry, sourceEntry] : ['--experimental-strip-types', sourceEntry]
  const outFd = openSync(resolve(runtimeRoot, 'supermemory-model-bridge.out.log'), 'a')
  const errFd = openSync(resolve(runtimeRoot, 'supermemory-model-bridge.err.log'), 'a')
  const child = spawn(process.execPath, args, {
    cwd: repositoryRoot,
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env: supermemoryChildEnv({
      MODEL_BRIDGE_TARGET_URL: targetConfig.targetBaseUrl,
      MODEL_BRIDGE_TARGET_KEY: targetConfig.targetKey,
      MODEL_BRIDGE_ALLOWED_MODEL: targetConfig.model,
      MODEL_BRIDGE_TIMEOUT_MS: String(targetConfig.timeoutMs),
      SUPERMEMORY_MODEL_BRIDGE_PORT: String(port),
      TMPDIR: '/tmp',
    }),
  })
  writeFileSync(bridgePidPath(), String(child.pid ?? ''))
  child.unref()
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (await bridgeHealthMatches(baseUrl, targetConfig)) return baseUrl
    await new Promise(resolveSleep => setTimeout(resolveSleep, 250))
  }
  killPidFile(bridgePidPath())
  throw new Error(`model gateway bridge did not become healthy on ${baseUrl}; see runtime/supermemory-model-bridge.err.log`)
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === entrypoint) void startStandalone()
