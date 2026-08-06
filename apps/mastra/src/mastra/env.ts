import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
export const researchRoot = process.env.RESEARCH_ROOT
  ? resolve(process.env.RESEARCH_ROOT)
  : basename(process.cwd()).toLowerCase() === 'mastra' ? resolve(process.cwd(), '../..') : moduleRoot
export const modelSettingsPath = process.env.MODEL_SETTINGS_PATH
  ? resolve(process.env.MODEL_SETTINGS_PATH)
  : process.env.RESEARCH_RUNTIME_DIR
    ? resolve(researchRoot, process.env.RESEARCH_RUNTIME_DIR, 'model-settings.json')
    : resolve(researchRoot, 'runtime', 'model-settings.json')
export const legacyProjectSettingsPath = process.env.RESEARCH_RUNTIME_DIR
  ? resolve(researchRoot, process.env.RESEARCH_RUNTIME_DIR, 'project-settings.json')
  : resolve(researchRoot, 'runtime', 'project-settings.json')
export function projectSettingsPath(projectId: string): string {
  return resolve(researchRoot, 'projects', projectId, '.researchos', 'model-settings.json')
}
const envPath = resolve(researchRoot, '.env')
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)
