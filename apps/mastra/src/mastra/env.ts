import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

export const researchRoot = process.env.RESEARCH_ROOT
  ? resolve(process.env.RESEARCH_ROOT)
  : basename(process.cwd()).toLowerCase() === 'mastra' ? resolve(process.cwd(), '../..') : resolve(process.cwd())
const envPath = resolve(researchRoot, '.env')
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)
