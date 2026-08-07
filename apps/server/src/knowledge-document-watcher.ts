import { audit, rows } from './database.js'
import { knowledgeFilesystemChanged, listKnowledgeDocuments, reconcileKnowledgeDocuments } from './knowledge-document-service.js'

let timer: NodeJS.Timeout | null = null
let running = false
let tick = 0

async function scan(forceHash: boolean): Promise<void> {
  if (running) return
  running = true
  try {
    const projects = await rows<{ id: string }>("SELECT id FROM projects WHERE status <> 'cancelled' ORDER BY id")
    for (const project of projects) {
      try {
        const documents = await listKnowledgeDocuments(project.id, true)
        if (forceHash || knowledgeFilesystemChanged(project.id, documents)) await reconcileKnowledgeDocuments(project.id, 'poller')
      } catch (error) {
        await audit('knowledge.documents_poll_failed', project.id, { error: error instanceof Error ? error.message.slice(0, 240) : 'knowledge_poll_failed' })
      }
    }
  } finally {
    running = false
  }
}

export function startKnowledgeDocumentWatcher(intervalMs = Number(process.env.RESEARCH_KNOWLEDGE_POLL_MS || 5000)): void {
  if (timer) return
  const interval = Number.isFinite(intervalMs) && intervalMs >= 1000 ? intervalMs : 5000
  const fullHashEvery = Math.max(1, Math.ceil(60_000 / interval))
  tick = 0
  void scan(true)
  timer = setInterval(() => {
    tick += 1
    void scan(tick % fullHashEvery === 0)
  }, interval)
  timer.unref()
}

export function stopKnowledgeDocumentWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
  running = false
}

