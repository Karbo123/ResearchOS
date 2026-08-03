import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { fingerprintReproductionSource, validateDependencyManifestPath, validateReproductionRelativePath } from '../src/reproduction-service.js'

describe('controlled reproduction paths', () => {
  it('accepts only safe POSIX paths and requirements manifests', () => {
    expect(validateReproductionRelativePath('scripts/evaluate.py')).toBe('scripts/evaluate.py')
    expect(validateDependencyManifestPath('requirements.txt')).toBe('requirements.txt')
    expect(validateDependencyManifestPath('requirements/torch.txt')).toBe('requirements/torch.txt')
    expect(() => validateReproductionRelativePath('../outside.py')).toThrow('POSIX 相对路径')
    expect(() => validateReproductionRelativePath('scripts\\evaluate.py')).toThrow('POSIX 相对路径')
    expect(() => validateDependencyManifestPath('pyproject.toml')).toThrow('requirements')
  })

  it('fingerprints a regular source tree deterministically and detects links', async () => {
    const root = join(tmpdir(), `research-os-reproduction-tree-${crypto.randomUUID()}`)
    const nested = join(root, 'nested')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'main.py'), 'print("ok")\n')
    const first = await fingerprintReproductionSource(root)
    const second = await fingerprintReproductionSource(root)
    expect(first).toBe(second)
    if (process.platform === 'linux') {
      const link = join(nested, 'link.py')
      await import('node:fs').then(module => module.symlinkSync('main.py', link))
      await expect(fingerprintReproductionSource(root)).rejects.toMatchObject({ code: 'reproduction_symlink_forbidden' })
    }
    rmSync(root, { recursive: true, force: true })
  })
})
