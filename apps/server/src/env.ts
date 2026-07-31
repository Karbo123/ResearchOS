import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const envPath = resolve(process.cwd(), process.cwd().endsWith('apps\\server') || process.cwd().endsWith('apps/server') ? '../../.env' : '.env')
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)
