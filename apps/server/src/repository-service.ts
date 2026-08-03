import { createHash } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { extract } from 'tar'
import { ApiError } from './http.js'
import { pathInside } from './paths.js'

export const repositoryHosts = new Set(['github.com', 'gitlab.com'])
const archiveHosts = new Set(['github.com', 'codeload.github.com', 'gitlab.com'])
export const repositoryArchiveLimits = {
  max_archive_bytes: 500 * 1024 * 1024,
  max_extracted_bytes: 1_000 * 1024 * 1024,
  max_entries: 20_000,
} as const
const maxCitationBytes = 1_000_000

export const knownSpdx = new Set([
  '0BSD', 'AFL-3.0', 'AGPL-3.0', 'AGPL-3.0-only', 'Apache-2.0', 'BSD-2-Clause',
  'BSD-3-Clause', 'BSL-1.0', 'CC0-1.0', 'EPL-2.0', 'GPL-2.0-only', 'GPL-3.0-only',
  'ISC', 'LGPL-2.1-only', 'LGPL-3.0-only', 'MIT', 'MPL-2.0', 'Unlicense',
])

export class RepositoryServiceError extends ApiError {
  constructor(code: string, message: string, status: 422 | 502 = ['repository_provider_failed', 'repository_provider_invalid', 'repository_archive_failed', 'repository_archive_empty'].includes(code) ? 502 : 422) { super(status, code, message) }
}

export type RepositoryIdentity = { host: string; namespace: string; name: string; path: string }

export type RepositoryDiscovery = {
  canonical_url: string
  source_type: 'paper_metadata' | 'paper_source_url'
  locator: string
}

export function parseRepositoryUrl(value: string): RepositoryIdentity {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new RepositoryServiceError('repository_url_invalid', '仓库地址不是有效 URL。') }
  if (url.protocol !== 'https:' || !repositoryHosts.has(url.hostname.toLowerCase()) || url.port) throw new RepositoryServiceError('repository_host_not_allowed', '只允许 GitHub 或 GitLab 的 HTTPS 仓库地址。')
  if (url.search || url.hash || url.username || url.password) throw new RepositoryServiceError('repository_url_invalid', '仓库地址不能包含查询参数、片段或认证信息。')
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2 || parts.some(part => part === '.' || part === '..' || !/^[A-Za-z0-9_.-]+$/.test(part))) throw new RepositoryServiceError('repository_url_invalid', '仓库命名空间包含不支持的字符。')
  const name = parts.at(-1)!.replace(/\.git$/i, '')
  const namespace = parts.slice(0, -1).join('/')
  if (!name || !namespace) throw new RepositoryServiceError('repository_url_invalid', '仓库地址必须包含命名空间和仓库名。')
  return { host: url.hostname.toLowerCase(), namespace, name, path: `${namespace}/${name}` }
}

export function canonicalRepositoryUrl(identity: RepositoryIdentity): string { return `https://${identity.host}/${identity.path}` }

function repositoryUrlFromText(value: string): string | null {
  const matches = value.match(/https:\/\/(?:www\.)?(?:github\.com|gitlab\.com)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?/gi) || []
  for (const candidate of matches) {
    try { return canonicalRepositoryUrl(parseRepositoryUrl(candidate)) } catch { /* Ignore non-repository links. */ }
  }
  return null
}

function collectRepositoryLinks(value: unknown, locator: string, output: RepositoryDiscovery[], seen: Set<string>, depth = 0): void {
  if (depth > 6 || output.length >= 100) return
  if (typeof value === 'string') {
    const direct = value.trim()
    const candidates = [direct, ...(direct.match(/https:\/\/[^\s"'<>]+/gi) || [])]
    for (const candidate of candidates) {
      const canonical = repositoryUrlFromText(candidate)
      if (!canonical || seen.has(canonical)) continue
      seen.add(canonical)
      output.push({ canonical_url: canonical, source_type: locator === 'source_url' ? 'paper_source_url' : 'paper_metadata', locator })
    }
    return
  }
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((item, index) => collectRepositoryLinks(item, `${locator}[${index}]`, output, seen, depth + 1))
    return
  }
  if (!value || typeof value !== 'object') return
  Object.entries(value as Record<string, unknown>).slice(0, 200).forEach(([key, item]) => collectRepositoryLinks(item, locator ? `${locator}.${key}` : key, output, seen, depth + 1))
}

export function discoverRepositoryCandidates(paper: { source_url: string; metadata?: unknown }): RepositoryDiscovery[] {
  const output: RepositoryDiscovery[] = []
  const seen = new Set<string>()
  collectRepositoryLinks(paper.metadata, 'metadata', output, seen)
  collectRepositoryLinks(paper.source_url, 'source_url', output, seen)
  return output
}

function normalizedText(value: string): string { return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '') }

export function citationMatch(paperTitle: string, paperDoi: string | null, citationText: string): { matched: boolean; method: string; value: string | null } {
  const text = citationText.toLowerCase()
  const doi = (paperDoi || '').toLowerCase().replace(/^https?:\/\/doi\.org\//, '').trim()
  if (doi && text.includes(doi)) return { matched: true, method: 'doi_in_repository_citation', value: doi }
  const title = normalizedText(paperTitle)
  if (title.length >= 12 && normalizedText(citationText).includes(title)) return { matched: true, method: 'exact_title_in_repository_citation', value: paperTitle }
  return { matched: false, method: 'no_explicit_paper_reference', value: null }
}

function userAgent(): string { return process.env.RESEARCH_USER_AGENT || 'ResearchOS/0.3 (repository verifier)' }
function tokenFor(host: string): string | undefined { return host === 'github.com' ? process.env.GITHUB_TOKEN || undefined : process.env.GITLAB_TOKEN || undefined }
function providerApi(identity: RepositoryIdentity): string { return identity.host === 'github.com' ? `https://api.github.com/repos/${identity.path}` : `https://gitlab.com/api/v4/projects/${encodeURIComponent(identity.path)}` }
function requestHeaders(token?: string): Record<string, string> { return { accept: 'application/json', 'user-agent': userAgent(), ...(token ? { authorization: `Bearer ${token}` } : {}) } }

async function providerJson(url: string, token?: string): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(url, { headers: requestHeaders(token), signal: AbortSignal.timeout(25_000) })
  } catch {
    throw new RepositoryServiceError('repository_provider_failed', '仓库提供方请求失败，未修改项目状态。')
  }
  if (!response.ok) throw new RepositoryServiceError('repository_provider_failed', '仓库提供方请求失败，未修改项目状态。')
  const value: unknown = await response.json().catch(() => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RepositoryServiceError('repository_provider_invalid', '仓库提供方返回了无效的结构化响应。')
  return value as Record<string, unknown>
}

async function repositoryFile(identity: RepositoryIdentity, branch: string, path: string, token?: string): Promise<string | null> {
  const url = identity.host === 'github.com'
    ? `${providerApi(identity)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`
    : `${providerApi(identity)}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`
  const payload = await providerJson(url, token)
  if (typeof payload.content !== 'string') return null
  try {
    const content = Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8')
    return content.slice(0, maxCitationBytes)
  } catch { return null }
}

export type RepositoryReadiness = {
  entrypoint_status: 'declared' | 'unknown'
  dependency_status: 'declared' | 'unknown'
  data_requirements_status: 'declared' | 'unknown'
  system_requirements_status: 'declared' | 'unknown'
  writable_directory_status: 'project_contained'
  evidence_files: string[]
}

export function repositoryReadinessFromFiles(files: Map<string, string>): RepositoryReadiness {
  const names = new Set(files.keys())
  const allText = [...files.values()].join('\n').slice(0, 6_000_000)
  const dependencyFiles = ['requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'environment.yml', 'environment.yaml', 'package.json', 'poetry.lock', 'Pipfile', 'Cargo.toml'].filter(name => names.has(name))
  const entrypointDeclared = dependencyFiles.length > 0 || /(^|\n)\s*(usage|quick start|getting started|running|train|evaluation|inference)\b|python\s+[^\n]{1,160}\.(?:py|sh)|npm\s+(?:run|start)|make\s+(?:run|train|test)/i.test(allText)
  const dataDeclared = /\b(?:dataset|data\s+(?:download|preparation|preprocessing)|download(?:ing)?\s+(?:the\s+)?data|preprocess(?:ing)?|benchmark|evaluation protocol)\b/i.test(allText)
  const systemDeclared = /\b(?:cuda|gpu|cpu|python\s*>=?|node(?:\.js)?\s*>=?|linux|windows|macos|system requirements?)\b/i.test(allText)
  return {
    entrypoint_status: entrypointDeclared ? 'declared' : 'unknown',
    dependency_status: dependencyFiles.length || /\b(?:install|dependencies|requirements)\b/i.test(allText) ? 'declared' : 'unknown',
    data_requirements_status: dataDeclared ? 'declared' : 'unknown',
    system_requirements_status: systemDeclared ? 'declared' : 'unknown',
    writable_directory_status: 'project_contained',
    evidence_files: [...files.keys()],
  }
}

export async function verifyRepositoryCandidate(repositoryUrl: string, paperTitle: string, paperDoi: string | null): Promise<Record<string, unknown>> {
  const identity = parseRepositoryUrl(repositoryUrl)
  const token = tokenFor(identity.host)
  const base = providerApi(identity)
  const metadata = await providerJson(base, token)
  const branch = String(metadata.default_branch || '').trim()
  if (!branch) throw new RepositoryServiceError('repository_default_branch_missing', '仓库没有可固定的默认分支。')
  const commitPayload = identity.host === 'github.com'
    ? await providerJson(`${base}/commits/${encodeURIComponent(branch)}`, token)
    : await providerJson(`${base}/repository/commits/${encodeURIComponent(branch)}`, token)
  const commit = String(commitPayload.sha || commitPayload.id || '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new RepositoryServiceError('repository_commit_unpinned', '提供方没有返回可验证的 40 位 commit。')
  let licenseSpdx: string | null = null
  if (identity.host === 'github.com') {
    const license = metadata.license
    licenseSpdx = license && typeof license === 'object' ? String((license as Record<string, unknown>).spdx_id || '') || null : null
  } else {
    const license = await providerJson(`${base}/license`, token).catch(() => ({})) as Record<string, unknown>
    const licenseValue = license.license && typeof license.license === 'object' ? (license.license as Record<string, unknown>).key : license.key
    licenseSpdx = licenseValue ? String(licenseValue) : null
  }
  const files = new Map<string, string>()
  for (const path of ['CITATION.cff', 'citation.cff', 'README.md', 'README.rst', 'requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'environment.yml', 'environment.yaml', 'package.json', 'Makefile', 'Cargo.toml']) {
    const content = await repositoryFile(identity, branch, path, token).catch(() => null)
    if (content !== null) files.set(path, content)
  }
  const citationFiles = [...files.keys()].filter(path => ['CITATION.cff', 'citation.cff', 'README.md', 'README.rst'].includes(path))
  const citationContents = citationFiles.map(path => files.get(path) || '')
  const match = citationMatch(paperTitle, paperDoi, citationContents.join('\n'))
  const licenseStatus = licenseSpdx && knownSpdx.has(licenseSpdx) ? 'known_spdx' : 'unknown'
  const readiness = repositoryReadinessFromFiles(files)
  return {
    canonical_url: canonicalRepositoryUrl(identity), host: identity.host, namespace: identity.namespace, name: identity.name,
    default_branch: branch, commit, license_spdx: licenseSpdx, license_status: licenseStatus, readiness,
    official_match: match.matched, match, citation_files: citationFiles,
    verification_sources: [
      { source: 'paper_record', paper_title: paperTitle, paper_doi: paperDoi },
      { source: `${identity.host}_repository_api`, repository: canonicalRepositoryUrl(identity), default_branch: branch, commit },
      { source: 'repository_citation_files', files: citationFiles },
    ],
    retrieved_at: new Date().toISOString(),
  }
}

export function validateDownloadGate(repository: { verified_official: boolean; license_spdx: string | null; commit_or_tag: string | null; metadata: Record<string, unknown> }, requestedCommit?: string): string {
  if (!repository.verified_official) throw new RepositoryServiceError('repository_official_verification_required', '请先完成论文与仓库的双源官方匹配。')
  const verification = (repository.metadata.verification || {}) as Record<string, unknown>
  if (verification.license_status !== 'known_spdx' || !repository.license_spdx || !knownSpdx.has(repository.license_spdx)) throw new RepositoryServiceError('repository_license_unknown', '仓库许可证不是已知 SPDX，不能下载。')
  const commit = String(repository.commit_or_tag || '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new RepositoryServiceError('repository_commit_unpinned', '仓库没有固定的 40 位 commit，不能下载。')
  if (commit !== String(verification.commit || '').toLowerCase() || (requestedCommit && commit !== requestedCommit.toLowerCase())) throw new RepositoryServiceError('repository_verification_stale', '仓库验证结果或固定 commit 已变化，请重新验证。')
  const readiness = (verification.readiness || {}) as Record<string, unknown>
  for (const [field, message] of [
    ['entrypoint_status', '仓库没有声明可复现入口，不能下载。'],
    ['dependency_status', '仓库没有声明依赖清单或安装方式，不能下载。'],
    ['data_requirements_status', '仓库没有声明数据获取或预处理要求，不能下载。'],
    ['system_requirements_status', '仓库没有声明系统或资源要求，不能下载。'],
  ] as const) {
    if (readiness[field] !== 'declared') throw new RepositoryServiceError(`repository_${field}_unknown`, message)
  }
  if (readiness.writable_directory_status !== 'project_contained') throw new RepositoryServiceError('repository_write_directory_invalid', '仓库写入目录不在当前项目受控范围内。')
  return commit
}

export function archiveUrl(repositoryUrl: string, commit: string): string {
  const identity = parseRepositoryUrl(repositoryUrl)
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new RepositoryServiceError('repository_commit_unpinned', '下载必须使用固定的 40 位 commit。')
  return identity.host === 'github.com'
    ? `https://api.github.com/repos/${identity.path}/tarball/${commit.toLowerCase()}`
    : `https://gitlab.com/${identity.path}/-/archive/${commit.toLowerCase()}/${identity.name}-${commit.toLowerCase()}.tar.gz`
}

export function validateArchiveByteSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > repositoryArchiveLimits.max_archive_bytes) throw new RepositoryServiceError('archive_size_limit', '仓库归档超过安全大小上限。')
}

export function validateArchiveEntryBudget(entries: number, uncompressedBytes: number): void {
  if (entries > repositoryArchiveLimits.max_entries) throw new RepositoryServiceError('archive_entry_limit', '仓库归档条目数量超过安全上限。')
  if (uncompressedBytes > repositoryArchiveLimits.max_extracted_bytes) throw new RepositoryServiceError('archive_uncompressed_limit', '仓库归档解压大小超过安全上限。')
}

export async function downloadArchive(repositoryUrl: string, commit: string): Promise<{ bytes: Buffer; resolvedUrl: string }> {
  let response: Response
  try {
    response = await fetch(archiveUrl(repositoryUrl, commit), { headers: requestHeaders(tokenFor(parseRepositoryUrl(repositoryUrl).host)), signal: AbortSignal.timeout(120_000), redirect: 'follow' })
  } catch {
    throw new RepositoryServiceError('repository_archive_failed', '仓库归档下载失败。')
  }
  const finalHost = new URL(response.url).hostname.toLowerCase()
  if (!response.ok) throw new RepositoryServiceError('repository_archive_failed', '仓库归档下载失败。')
  if (!archiveHosts.has(finalHost)) throw new RepositoryServiceError('archive_host_not_allowed', '仓库归档重定向到了不允许的主机。')
  if (!response.body) throw new RepositoryServiceError('repository_archive_empty', '仓库归档没有响应内容。')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    const chunk = Buffer.from(part.value)
    size += chunk.length
    try { validateArchiveByteSize(size) } catch (error) { await reader.cancel(); throw error }
    chunks.push(chunk)
  }
  return { bytes: Buffer.concat(chunks), resolvedUrl: response.url }
}

export async function safeExtractArchive(data: Buffer, destination: string): Promise<{ extracted_files: number; uncompressed_bytes: number }> {
  validateArchiveByteSize(data.length)
  mkdirSync(destination, { recursive: true })
  let entries = 0
  let extractedFiles = 0
  let uncompressed = 0
  let policyError: RepositoryServiceError | null = null
  try {
    const stream = extract({
      cwd: destination, strip: 1, strict: true, preservePaths: false, unlink: false, win32: true,
      filter: (rawPath: string, entry: any) => {
        if (policyError) return false
        const path = rawPath.replaceAll('\\', '/')
        const parts = path.split('/')
        const type = String(entry.type || '').toLowerCase()
        if (path.startsWith('/') || path.includes('\0') || parts.includes('..')) {
          policyError = new RepositoryServiceError('archive_path_traversal', '仓库归档包含不安全路径。')
          return false
        }
        if (type.includes('symbolic') || type.includes('hard') || type === 'link' || entry.typeKey === '1' || entry.typeKey === '2') {
          policyError = new RepositoryServiceError('archive_special_file', '仓库归档包含不允许的链接文件。')
          return false
        }
        entries += 1
        uncompressed += Number(entry.size || 0)
        try { validateArchiveEntryBudget(entries, uncompressed) } catch (error) { policyError = error as RepositoryServiceError; return false }
        if (type !== 'directory') extractedFiles += 1
        return true
      },
    })
    await pipeline(Readable.from(data), stream)
    if (policyError) throw policyError
  } catch (error) {
    rmSync(destination, { recursive: true, force: true })
    if (policyError) throw policyError
    if (error instanceof RepositoryServiceError) throw error
    throw new RepositoryServiceError('archive_extract_failed', '仓库归档解压失败。')
  }
  return { extracted_files: extractedFiles, uncompressed_bytes: uncompressed }
}

export function archiveSha256(data: Buffer): string { return createHash('sha256').update(data).digest('hex') }

export function repositoryDirectoryName(repositoryUrl: string, commit: string): string {
  const identity = parseRepositoryUrl(repositoryUrl)
  return `${identity.host.split('.')[0]}-${identity.namespace.replaceAll('/', '-')}-${identity.name}-${commit.slice(0, 12)}`.replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 180)
}
