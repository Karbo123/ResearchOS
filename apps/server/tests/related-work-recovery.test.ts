import { testProjectSlug } from './test-project.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { database, migrate, rows } from '../src/database.js'
import { recoverInterruptedWork } from '../src/task-worker.js'

const projectId = testProjectSlug()
const proposalIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]

describe('related-work restart recovery', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, `recovery-${projectId.slice(0, 8)}`, 'Related Work Recovery'])
    await database.query(`INSERT INTO proposals(id,project_id,kind,reason,summary,payload)
      VALUES ($1,$4,'related_work_recursive','fixture recovery','fixture recovery',$5),
             ($2,$4,'related_work_recursive','fixture recovery','fixture recovery',$5),
             ($3,$4,'related_work_recursive','fixture recovery','fixture recovery',$5)`, [
      ...proposalIds, projectId, { seed_ids: [], depth: 1, width: 1, max_total: 1, providers: ['crossref'] },
    ])
    await database.query(`INSERT INTO related_work_recursive_runs
      (id,project_id,proposal_id,seed_ids,providers,depth,width,max_total,status)
      VALUES ($1,$2,$3,$4,$5,1,1,1,'queued'),($6,$2,$7,$4,$5,1,1,1,'running'),($8,$2,$9,$4,$5,1,1,1,'partial')`, [
      crypto.randomUUID(), projectId, proposalIds[0], [], ['crossref'], crypto.randomUUID(), proposalIds[1], crypto.randomUUID(), proposalIds[2],
    ])
  }, 30_000)

  afterAll(async () => {
    await database.query('DELETE FROM related_work_recursive_runs WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM proposals WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
  }, 30_000)

  it('requeues interrupted running runs, preserves queued and partial states, and records the recovery marker', async () => {
    await recoverInterruptedWork()
    const runs = await rows<{ status: string; error: string | null }>('SELECT status,error FROM related_work_recursive_runs WHERE project_id=$1 ORDER BY created_at,id', [projectId])
    expect(runs.map(run => run.status).sort()).toEqual(['partial', 'queued', 'queued'])
    expect(runs.filter(run => run.error === 'native_process_restarted')).toHaveLength(1)
    expect(runs.filter(run => run.error === null)).toHaveLength(2)
  })
})
