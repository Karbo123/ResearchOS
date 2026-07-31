import { createHash } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { extract, list } from 'tar'
import { repositoryRoot } from './idea-case-loader.js'

type NativeManifest = { archive: string; sha256: string }
type ListedFile = { name: string; sha256: string; size_bytes?: number; bytes?: number }
type FileManifest = { files: ListedFile[] }
const backupRoot = resolve(repositoryRoot, 'artifacts', 'backups')
const backupIdPattern = /^(?:\d{14}|\d{8}T\d{6}Z)$/

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function newestBackupId(): string {
  const candidates = readdirSync(backupRoot, { withFileTypes: true })
    .filter(item => item.isDirectory() && backupIdPattern.test(item.name))
    .map(item => item.name)
    .sort()
  const id = candidates.at(-1)
  if (!id) throw new Error('no_backup_found')
  return id
}

function assertSafeEntry(path: string, type: string, linkpath?: string) {
  const normalized = path.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) throw new Error(`unsafe_backup_entry:${path}`)
  if (type === 'SymbolicLink' || type === 'Link') throw new Error(`linked_backup_entry:${path}`)
  if (linkpath) throw new Error(`linked_backup_target:${path}`)
}

function assertNoLinks(root: string) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`extracted_symlink:${path}`)
    if (stat.isDirectory()) assertNoLinks(path)
  }
}

function fileInside(root: string, child: string): string {
  const candidate = resolve(root, child)
  const rootPath = resolve(root)
  const childPath = relative(rootPath, candidate)
  if (!childPath || childPath.startsWith('..') || childPath.includes(':') || childPath.startsWith('\\') || childPath.startsWith('/')) throw new Error(`unsafe_backup_file:${child}`)
  return candidate
}

async function inspectArchive(archive: string, destination: string) {
  const entries: string[] = []
  await list({ file: archive, gzip: true, strict: true, onReadEntry: entry => {
    assertSafeEntry(String(entry.path), String(entry.type), entry.linkpath ? String(entry.linkpath) : undefined)
    entries.push(String(entry.path).replaceAll('\\', '/'))
  } })
  await extract({ file: archive, gzip: true, cwd: destination, strict: true, preservePaths: false, keep: true })
  assertNoLinks(destination)
  return entries
}

const requestedId = process.argv[2]
const backupId = requestedId || newestBackupId()
if (!backupIdPattern.test(backupId)) throw new Error('backup id must be a 14-digit or ISO compact timestamp')
const directory = resolve(backupRoot, backupId)
const manifestPath = resolve(directory, 'manifest.json')
if (!existsSync(manifestPath)) throw new Error('backup_manifest_missing')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')) as NativeManifest | FileManifest
const temporaryRoot = resolve(tmpdir(), `research-os-recovery-drill-${process.pid}-${Date.now()}`)
mkdirSync(temporaryRoot, { recursive: true })

try {
  if ('archive' in manifest && typeof manifest.archive === 'string' && typeof manifest.sha256 === 'string') {
    const archive = fileInside(directory, manifest.archive)
    if (!existsSync(archive)) throw new Error('backup_archive_missing')
    if (await sha256(archive) !== manifest.sha256) throw new Error('backup_checksum_mismatch')
    if (statSync(archive).size > 10 * 1024 * 1024 * 1024) throw new Error('backup_archive_too_large')
    const archiveEntries = await inspectArchive(archive, temporaryRoot)
    const requiredRoots = ['runtime', 'projects', 'artifacts']
    const extractedRoots = requiredRoots.map(name => ({ name, exists: existsSync(join(temporaryRoot, name)) }))
    if (extractedRoots.some(item => !item.exists)) throw new Error('backup_required_root_missing')
    console.log(JSON.stringify({ status: 'passed', format: 'native', backup_id: backupId, archive: basename(archive), archive_sha256: manifest.sha256, archive_entries: archiveEntries.length, extracted_roots: extractedRoots, temporary_root_removed: true }, null, 2))
  } else if ('files' in manifest && Array.isArray(manifest.files)) {
    const checkedFiles: Array<Record<string, unknown>> = []
    for (const item of manifest.files) {
      const file = fileInside(directory, item.name)
      if (!existsSync(file)) throw new Error(`backup_file_missing:${item.name}`)
      const expectedSize = item.size_bytes ?? item.bytes
      if (expectedSize !== undefined && statSync(file).size !== expectedSize) throw new Error(`backup_size_mismatch:${item.name}`)
      if (await sha256(file) !== item.sha256) throw new Error(`backup_checksum_mismatch:${item.name}`)
      const archiveEntries: string[] = []
      if (item.name.toLowerCase().endsWith('.tgz')) {
        const destination = join(temporaryRoot, basename(item.name, '.tgz'))
        mkdirSync(destination, { recursive: true })
        archiveEntries.push(...await inspectArchive(file, destination))
      }
      checkedFiles.push({ name: item.name, sha256: item.sha256, bytes: statSync(file).size, archive_entries: archiveEntries.length })
    }
    console.log(JSON.stringify({ status: 'passed', format: 'file-manifest', backup_id: backupId, files: checkedFiles, temporary_root_removed: true }, null, 2))
  } else {
    throw new Error('backup_manifest_format_unsupported')
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
