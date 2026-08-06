import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targets = [
  resolve(repoRoot, 'node_modules/hono/dist/utils/stream.js'),
  resolve(repoRoot, 'node_modules/hono/dist/cjs/utils/stream.js'),
]
const before = 'await reader.cancel();'
const after = 'await reader.cancel().catch(() => {});'

for (const file of targets) {
  if (!existsSync(file)) throw new Error(`Hono stream file is missing: ${file}`)
  const source = readFileSync(file, 'utf8')
  if (source.includes(after)) continue
  if (!source.includes(before)) {
    throw new Error(`Hono stream source changed; re-check ${file} before patching.`)
  }
  writeFileSync(file, source.replace(before, after), 'utf8')
  console.log(`Patched Hono stream cancellation: ${file}`)
}
