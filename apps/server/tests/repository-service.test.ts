import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  archiveSha256, archiveUrl, citationMatch, parseRepositoryUrl, repositoryArchiveLimits, repositoryDirectoryName,
  safeExtractArchive, validateArchiveByteSize, validateArchiveEntryBudget, validateDownloadGate,
} from '../src/repository-service.js'

function tarEntry(name: string, content = '', type = '0'): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000777\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii')
  header.fill(0x20, 148, 156)
  header.write(type, 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  const checksum = [...header].reduce((sum, value) => sum + value, 0)
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  const body = Buffer.from(content)
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512)
  return Buffer.concat([header, body, padding])
}

function tarArchive(entries: Array<{ name: string; content?: string; type?: string }>): Buffer {
  return Buffer.concat([...entries.map(entry => tarEntry(entry.name, entry.content, entry.type)), Buffer.alloc(1024)])
}

describe('repository verification gates', () => {
  it('accepts only canonical GitHub/GitLab HTTPS URLs', () => {
    expect(parseRepositoryUrl('https://github.com/org/repo.git').path).toBe('org/repo')
    expect(() => parseRepositoryUrl('http://github.com/org/repo')).toThrow()
    expect(() => parseRepositoryUrl('https://github.com/org/repo?ref=main')).toThrow()
    expect(repositoryDirectoryName('https://gitlab.com/org/repo', 'a'.repeat(40))).toBe('gitlab-org-repo-aaaaaaaaaaaa')
  })

  it('requires DOI or exact title evidence in repository citation files', () => {
    expect(citationMatch('A Study of Signals', '10.1000/xyz', 'doi: 10.1000/xyz').matched).toBe(true)
    expect(citationMatch('A Study of Signals', null, 'A Study of Signals').matched).toBe(true)
    expect(citationMatch('A Study of Signals', null, 'unrelated project').matched).toBe(false)
  })

  it('enforces known SPDX and fixed commit gates', () => {
    const commit = 'a'.repeat(40)
    const repository = { verified_official: true, license_spdx: 'MIT', commit_or_tag: commit, metadata: { verification: { license_status: 'known_spdx', commit } } }
    expect(validateDownloadGate(repository, commit)).toBe(commit)
    expect(() => validateDownloadGate({ ...repository, license_spdx: 'Custom-License' }, commit)).toThrow()
    expect(() => validateDownloadGate(repository, 'b'.repeat(40))).toThrow()
    expect(archiveUrl('https://github.com/org/repo', commit)).toContain(`/tarball/${commit}`)
    expect(archiveSha256(Buffer.from('archive'))).toHaveLength(64)
  })
})

describe('repository archive safety', () => {
  it('rejects traversal and symbolic-link entries', async () => {
    const traversal = tarArchive([{ name: 'root/../escape.txt', content: 'x' }])
    const traversalDestination = join(mkdtempSync(join(tmpdir(), 'research-os-repo-')), 'extract')
    await expect(safeExtractArchive(traversal, traversalDestination)).rejects.toMatchObject({ code: 'archive_path_traversal' })
    const link = tarArchive([{ name: 'root/link', type: '2' }])
    const linkDestination = join(mkdtempSync(join(tmpdir(), 'research-os-repo-')), 'extract')
    try {
      await safeExtractArchive(link, linkDestination)
      throw new Error('symbolic link archive was accepted')
    } catch (error) {
      expect(['archive_special_file', 'archive_extract_failed']).toContain((error as { code?: string }).code)
    }
  })

  it('extracts a regular file and enforces byte and entry budgets', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'research-os-repo-'))
    const destination = join(parent, 'extract')
    const archive = tarArchive([{ name: 'root/readme.txt', content: 'verified' }])
    const result = await safeExtractArchive(archive, destination)
    expect(result.extracted_files).toBe(1)
    expect(readFileSync(join(destination, 'readme.txt'), 'utf8')).toBe('verified')
    expect(() => validateArchiveByteSize(repositoryArchiveLimits.max_archive_bytes + 1)).toThrow()
    expect(() => validateArchiveEntryBudget(repositoryArchiveLimits.max_entries + 1, 0)).toThrow()
    rmSync(parent, { recursive: true, force: true })
  })
})
