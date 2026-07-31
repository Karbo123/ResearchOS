import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { create } from 'tar'
import { repositoryRoot } from './idea-case-loader.js'

const command = process.argv[2] || 'status'
const runtime = resolve(repositoryRoot, 'runtime')
const backupRoot = resolve(repositoryRoot, 'artifacts', 'backups')
const backupIdPattern = /^(?:\d{14}|\d{8}T\d{6}Z)$/
async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
function backupFile(directory: string, name: string): string {
  const candidate = resolve(directory, name)
  const child = relative(resolve(directory), candidate)
  if (!child || child.startsWith('..') || child.includes(':') || child.startsWith('\\') || child.startsWith('/')) throw new Error(`unsafe backup file: ${name}`)
  return candidate
}
async function health() {
  const endpoints = ['http://127.0.0.1:8080/api/health', 'http://127.0.0.1:4111/health']
  const checks = await Promise.all(endpoints.map(async url => {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(3_000) }); return { url, ok: response.ok, status: response.status } }
    catch { return { url, ok: false, status: null } }
  }))
  return { runtime: 'native-typescript', checks, ok: checks.every(item => item.ok) }
}
async function backup() {
  const running = await health()
  if (running.checks[0]?.ok) throw new Error('Stop Research OS before backup so the embedded PostgreSQL snapshot is consistent.')
  const id = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const directory = resolve(backupRoot, id)
  mkdirSync(directory, { recursive: true })
  const archive = resolve(directory, 'research-os-data.tgz')
  const entries = ['runtime', 'projects', 'artifacts'].filter(name => existsSync(resolve(repositoryRoot, name)))
  await create({ gzip: true, cwd: repositoryRoot, file: archive, portable: true, filter: path => !path.startsWith('artifacts/backups') }, entries)
  const manifest = { version: 1, created_at: new Date().toISOString(), archive: basename(archive), sha256: await sha256(archive), entries }
  writeFileSync(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { backup_id: id, directory, ...manifest }
}
async function restoreCheck(id: string) {
  if (!backupIdPattern.test(id)) throw new Error('backup id must be a 14-digit or ISO compact timestamp')
  const directory = resolve(backupRoot, id)
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')) as { archive?: string; sha256?: string; files?: Array<{ name: string; sha256: string; size_bytes?: number; bytes?: number }> }
  if (manifest.archive && manifest.sha256) {
    const archive = backupFile(directory, manifest.archive)
    if (await sha256(archive) !== manifest.sha256) throw new Error('backup checksum mismatch')
    return { backup_id: id, valid: true, format: 'native', bytes: statSync(archive).size }
  }
  if (Array.isArray(manifest.files)) {
    const files = []
    for (const item of manifest.files) {
      const file = backupFile(directory, item.name)
      if (!existsSync(file) || await sha256(file) !== item.sha256) throw new Error(`backup checksum mismatch: ${item.name}`)
      const expectedSize = item.size_bytes ?? item.bytes
      if (expectedSize !== undefined && statSync(file).size !== expectedSize) throw new Error(`backup size mismatch: ${item.name}`)
      files.push({ name: item.name, bytes: statSync(file).size })
    }
    return { backup_id: id, valid: true, format: 'file-manifest', files }
  }
  throw new Error('unsupported backup manifest')
}

let result: unknown
if (command === 'status') result = await health()
else if (command === 'capacity') result = { runtime_bytes: existsSync(runtime) ? readdirSync(runtime).reduce((sum, name) => sum + statSync(resolve(runtime, name)).size, 0) : 0, free_space_check: 'Use Windows Storage settings for volume-wide capacity.' }
else if (command === 'backup') result = await backup()
else if (command === 'restore-check') result = await restoreCheck(process.argv[3] || '')
else throw new Error('usage: ops-guard.ts status|capacity|backup|restore-check <backup-id>')
console.log(JSON.stringify(result, null, 2))
