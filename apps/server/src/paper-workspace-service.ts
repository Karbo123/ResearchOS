import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { database } from './database.js'
import { ApiError } from './http.js'
import { gitBinary, pathInside, projectsRoot } from './paths.js'
import { ensureProjectGit, requireProject } from './project-service.js'

const PAPER_SECTION_IDS = ['introduction', 'paper_related_work', 'paper_method', 'paper_experiments', 'conclusion'] as const
type PaperSectionId = typeof PAPER_SECTION_IDS[number]

export type PaperSentence = { en: string; zh: string | null }

export type PaperSectionWorkspace = {
  id: PaperSectionId
  heading: string
  source: string
  english: string
  citations: string[]
  figure_refs: string[]
  sentences: PaperSentence[]
  status: 'missing' | 'draft' | 'ready'
}

export type PaperBibEntry = {
  key: string
  title: string
  authors: string
  year: string
  venue: string
}

export type PaperWorkspaceDetail = {
  project_id: string
  source_path: string
  has_source: boolean
  has_references: boolean
  source_commit: string | null
  source_dirty: boolean
  sections: PaperSectionWorkspace[]
  references: PaperBibEntry[]
  compile_runs: number
  compile_succeeded: number
  compile_latest_status: string | null
  compile_latest_error: string | null
}

function runGit(root: string, args: string[]): string | null {
  try {
    return execFileSync(gitBinary(), args, { cwd: root, encoding: 'utf8', timeout: 8_000 }).trim()
  } catch {
    return null
  }
}

function collectCiteKeys(source: string): string[] {
  const keys: string[] = []
  for (const match of source.matchAll(/\\cite(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    for (const key of (match[1] || '').split(',').map(item => item.trim())) {
      if (key && !keys.includes(key)) keys.push(key)
    }
  }
  return keys
}

function collectFigureRefs(source: string): string[] {
  const refs: string[] = []
  for (const match of source.matchAll(/\\(?:includegraphics|ref|autoref|cref)\{([^}]+)\}/g)) {
    const value = match[1]?.trim()
    if (value && !refs.includes(value)) refs.push(value)
  }
  return refs
}

function latexToText(source: string): string {
  const withoutComments = source.replace(/(^|[^\\])%.*$/gm, '$1')
  return withoutComments
    .replace(/\\cite(?:\[[^\]]*\])?\{[^}]+\}/g, '')
    .replace(/\\label\{[^}]+\}/g, '')
    .replace(/\\includegraphics(?:\[[^\]]*\])?\{[^}]+\}/g, '[figure]')
    .replace(/\\ref\{[^}]+\}/g, '[ref]')
    .replace(/\\autoref\{[^}]+\}/g, '[ref]')
    .replace(/\\cref\{[^}]+\}/g, '[ref]')
    .replace(/\\(?:textbf|emph|textit|textrm|textsf|textsc|texttt|textsl|textnormal)\{([^}]*)\}/g, '$1')
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\item/g, '\n- ')
    .replace(/\\(?:begin|end)\{[^}]+\}/g, '')
    .replace(/\\maketitle/g, '')
    .replace(/\\title\{[^}]*\}/g, '')
    .replace(/\\author\{[^}]*\}/g, '')
    .replace(/\\bibliographystyle\{[^}]*\}/g, '')
    .replace(/\\bibliography\{[^}]*\}/g, '')
    .replace(/\\(?:section|subsection|paragraph)\*?\{[^}]*\}/g, '')
    .replace(/\\(?:textit|textbf|texttt)\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z@]+/g, ' ')
    .replace(/[{}\\]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(\[])/)
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 200)
}

function sectionIdFor(heading: string): PaperSectionId | null {
  const value = heading.toLowerCase()
  if (value.includes('introduction') || value.includes('引言')) return 'introduction'
  if (value.includes('related') || value.includes('相关工作') || value.includes('related work')) return 'paper_related_work'
  if (value.includes('method') || value.includes('方法')) return 'paper_method'
  if (value.includes('experiment') || value.includes('实验')) return 'paper_experiments'
  if (value.includes('conclusion') || value.includes('结论')) return 'conclusion'
  return null
}

function parseSections(source: string): Array<{ id: PaperSectionId; heading: string; body: string }> {
  const matches = [...source.matchAll(/\\section\*?\{([^}]+)\}/g)]
  const result = new Map<PaperSectionId, { heading: string; body: string }>()
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!
    const heading = match[1]!.trim()
    const id = sectionIdFor(heading)
    if (!id) continue
    const start = match.index! + match[0].length
    const end = matches[index + 1]?.index ?? source.length
    const body = source.slice(start, end)
    result.set(id, { heading, body })
  }
  const abstract = source.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/)
  if (abstract) {
    const introduction = result.get('introduction')
    const abstractText = abstract[1]?.trim() || ''
    if (introduction) {
      introduction.body = `${abstractText}\n\n${introduction.body}`
    } else {
      result.set('introduction', { heading: 'Introduction', body: abstractText })
    }
  }
  return [...result.entries()].map(([id, value]) => ({ id, ...value }))
}

function parseReferences(content: string): PaperBibEntry[] {
  const entries: PaperBibEntry[] = []
  for (const match of content.matchAll(/@(\w+)\{([^,]+),([\s\S]*?)\n\}/g)) {
    const type = match[1] || ''
    const key = (match[2] || '').trim()
    const body = match[3] || ''
    const field = (name: string) => {
      const fieldMatch = body.match(new RegExp(`${name}\\s*=\\s*\\{([^}]*)\\}`, 'i'))
      return fieldMatch?.[1]?.trim() || ''
    }
    entries.push({
      key,
      title: field('title'),
      authors: field('author').replace(/ and /g, ', '),
      year: field('year'),
      venue: field('journal') || field('booktitle') || type,
    })
  }
  return entries
}

export async function paperWorkspaceDetail(projectId: string): Promise<PaperWorkspaceDetail> {
  await requireProject(projectId)
  const root = pathInside(projectsRoot, projectId)
  if (!existsSync(root)) throw new ApiError(404, 'project_workspace_not_found', '项目代码工作区不存在。')
  ensureProjectGit(projectId)
  const paperRoot = pathInside(root, 'paper')
  const mainPath = pathInside(paperRoot, 'main.tex')
  const source = existsSync(mainPath) ? readFileSync(mainPath, 'utf8') : null
  const referencesPath = pathInside(paperRoot, 'references.bib')
  const referencesContent = existsSync(referencesPath) ? readFileSync(referencesPath, 'utf8') : null
  const translationsPath = pathInside(paperRoot, 'translations.json')
  const translations = existsSync(translationsPath) ? readTranslations(readFileSync(translationsPath, 'utf8')) : new Map<PaperSectionId, PaperSentence[]>()
  const parsed = source ? parseSections(source) : []
  const sections: PaperSectionWorkspace[] = PAPER_SECTION_IDS.map(id => {
    const found = parsed.find(item => item.id === id)
    const english = found ? latexToText(found.body) : ''
    const sentences = found ? sentenceTranslations(found.body, translations.get(id) || []) : []
    const status = !found ? 'missing' : sentences.some(item => item.zh) ? 'ready' : 'draft'
    return {
      id,
      heading: found?.heading || sectionTitle(id),
      source: found?.body.trim() || '',
      english,
      citations: found ? collectCiteKeys(found.body) : [],
      figure_refs: found ? collectFigureRefs(found.body) : [],
      sentences,
      status,
    }
  })
  const status = runGit(root, ['status', '--short', '--', 'paper']) || ''
  const compileRows = await database.query<{ status: string; error: string | null }>(
    "SELECT status,error FROM experiments WHERE project_id=$1 AND experiment_type='compile_latex' ORDER BY created_at DESC",
    [projectId],
  )
  return {
    project_id: projectId,
    source_path: `projects/${projectId}/paper/main.tex`,
    has_source: Boolean(source),
    has_references: Boolean(referencesContent),
    source_commit: runGit(root, ['rev-parse', 'HEAD']),
    source_dirty: status.split('\n').some(line => line && !line.startsWith('##')),
    sections,
    references: referencesContent ? parseReferences(referencesContent) : [],
    compile_runs: compileRows.rows.length,
    compile_succeeded: compileRows.rows.filter(row => row.status === 'succeeded').length,
    compile_latest_status: compileRows.rows[0]?.status ?? null,
    compile_latest_error: compileRows.rows[0]?.error ?? null,
  }
}

function sectionTitle(id: PaperSectionId): string {
  const titles: Record<PaperSectionId, string> = {
    introduction: 'Introduction',
    paper_related_work: 'Related Work',
    paper_method: 'Method',
    paper_experiments: 'Experiments',
    conclusion: 'Conclusion',
  }
  return titles[id]
}

function readTranslations(content: string): Map<PaperSectionId, PaperSentence[]> {
  const result = new Map<PaperSectionId, PaperSentence[]>()
  try {
    const parsed = JSON.parse(content) as { sections?: Record<string, Array<{ en?: unknown; zh?: unknown }>> }
    const sections = parsed.sections || {}
    for (const [key, sentences] of Object.entries(sections)) {
      const id = key as PaperSectionId
      if (!PAPER_SECTION_IDS.includes(id)) continue
      const mapped = Array.isArray(sentences)
        ? sentences.map(item => ({ en: String(item.en ?? ''), zh: typeof item.zh === 'string' ? item.zh : null })).filter(item => item.en)
        : []
      result.set(id, mapped)
    }
  } catch {
    return result
  }
  return result
}

function sentenceTranslations(body: string, translations: PaperSentence[]): PaperSentence[] {
  const sentences = splitSentences(latexToText(body))
  const byEnglish = new Map<string, string | null>()
  for (const item of translations) byEnglish.set(item.en.trim(), item.zh)
  return sentences.map(en => {
    const zh = byEnglish.get(en.trim()) ?? null
    return { en, zh }
  })
}
