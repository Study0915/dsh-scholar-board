import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DomainRecord } from '@dsh-scholar-board/contracts'
import { recordReferences } from '@dsh-scholar-board/contracts'
import { openRecords } from '../src/records/store'
import { exportRecords, importRecords } from '../src/records/exchange'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const homes: string[] = []
const actor = { widget: 'research-records', instance: 'synthetic-card' }

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/** 在隔离目录使用真实记录存储与磁盘。 */
async function setup() {
  await mkdir(join(root, '.debug'), { recursive: true })
  const home = await mkdtemp(join(root, '.debug', 'relations-test-'))
  homes.push(home)
  return await openRecords(join(home, 'records.json'), { now: () => Date.UTC(2026, 0, 1) })
}

describe('跨类型关联与反向引用', () => {
  it('文献、研究和事务互相关联，生命周期与备份不丢引用', async () => {
    const store = await setup()
    const literature = (await store.create({ kind: 'literature', title: 'Synthetic reference', stage: 'queued' }, actor)).record
    const research = (await store.create({ kind: 'research', title: 'Synthetic analysis', method: 'simulation', related: [{ kind: literature.kind, id: literature.id }] }, actor)).record
    const chore = (await store.create({ kind: 'chore', title: 'Synthetic follow-up', category: 'Research', status: 'todo', related: [{ kind: literature.kind, id: literature.id }] }, actor)).record
    const query = { references: { kind: literature.kind, id: literature.id } }
    expect(new Set(store.view(query).records.map(row => row.id))).toEqual(new Set([research.id, chore.id]))
    const archived = await store.archive(chore.id, chore.revision, actor)
    expect(store.view(query).records.map(row => row.id)).toEqual([research.id])
    expect(store.view({ ...query, includeArchived: true }).records).toHaveLength(2)
    await store.trash(chore.id, archived.revision, actor)
    expect(store.view({ ...query, includeArchived: true }).records).toHaveLength(1)
    expect(store.view({ ...query, includeArchived: true, includeTrashed: true }).records).toHaveLength(2)
    const target = await setup()
    await importRecords(target, exportRecords(store, { includeArchived: true, includeTrashed: true }, Date.now()), Date.now())
    const restoredLiterature = target.snapshot().find(row => row.kind === 'literature') as DomainRecord
    expect(target.snapshot({ references: { kind: 'literature', id: restoredLiterature.id }, includeArchived: true, includeTrashed: true })).toHaveLength(2)
  })

  it('来源、派生会议与毕业论文成果进入同一反向查询，重复关系只计一次', async () => {
    const store = await setup()
    const original = (await store.create({ kind: 'meeting', title: 'Original' }, actor)).record
    const derived = (await store.create({ kind: 'meeting', title: 'Derived', derivedFrom: original.id, related: [{ kind: 'meeting', id: original.id }] }, actor)).record
    const action = (await store.create({ kind: 'action', title: 'Follow-up', status: 'todo', source: { kind: 'meeting', id: original.id } }, actor)).record
    expect(recordReferences(derived)).toEqual([{ kind: 'meeting', id: original.id }])
    expect(new Set(store.view({ references: { kind: 'meeting', id: original.id } }).records.map(row => row.id))).toEqual(new Set([derived.id, action.id]))
    const research = (await store.create({ kind: 'research', title: 'Result', method: 'derivation' }, actor)).record
    const thesis = (await store.create({ kind: 'thesis', title: 'Thesis', results: [{ id: 'result-1', kind: 'research', recordId: research.id }] }, actor)).record
    expect(store.view({ references: { kind: 'research', id: research.id } }).records.map(row => row.id)).toEqual([thesis.id])
  })

  it('自关联和重复引用被拒绝，失败不改动磁盘，来源缺失仍保留引用', async () => {
    const store = await setup()
    const record = (await store.create({ kind: 'research', title: 'Analysis', method: 'simulation' }, actor)).record
    const before = await readFile(store.file, 'utf8')
    await expect(store.update(record.id, record.revision, { related: [{ kind: record.kind, id: record.id }] }, actor)).rejects.toMatchObject({ status: 400 })
    expect(await readFile(store.file, 'utf8')).toBe(before)
    const ref = { kind: 'literature', id: 'missing-reference' }
    await expect(store.update(record.id, record.revision, { related: [{ kind: 'unknown', id: 'not-a-type' }] }, actor)).rejects.toMatchObject({ status: 400 })
    await expect(store.update(record.id, record.revision, { related: [ref, ref] }, actor)).rejects.toMatchObject({ status: 400 })
    const updated = await store.update(record.id, record.revision, { related: [ref] }, actor)
    expect(recordReferences(updated.record)).toEqual([ref])
    await expect(store.update(record.id, record.revision, { related: [] }, actor)).rejects.toMatchObject({ status: 409 })
  })

  it('分页可读完超过单页上限的记录，排序稳定且不静默遗漏', async () => {
    const store = await setup()
    for (let index = 0; index < 205; index += 1) await store.create({ kind: 'meeting', title: `Synthetic ${index}` }, actor)
    const first = store.view()
    expect(first.records).toHaveLength(200)
    expect(first.nextOffset).toBe(200)
    const last = store.view({ offset: first.nextOffset })
    expect(last.records).toHaveLength(5)
    expect(last.truncated).toBe(false)
    expect(last.nextOffset).toBeUndefined()
    expect(new Set([...first.records, ...last.records].map(row => row.id)).size).toBe(205)
    expect(store.view().records.map(row => row.id)).toEqual(first.records.map(row => row.id))
    expect(() => store.view({ offset: -1 })).toThrow('offset')
  })
})
