import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
export const researchRoot = process.env.RESEARCH_ROOT
  ? resolve(process.env.RESEARCH_ROOT)
  : basename(process.cwd()).toLowerCase() === 'mastra' ? resolve(process.cwd(), '../..') : moduleRoot
const envPath = resolve(researchRoot, '.env')
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)
