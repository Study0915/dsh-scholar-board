/**
 * 领域记录的共享存储（D36）：身份、修订冲突、生命周期、容量与读盘。
 *
 * 记录落在 `.debug/` 下的临时文件里，读写走真的磁盘：这里判定的是重启之后还剩下什么。
 */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActionRecord, DomainRecord, ManuscriptRecord, MeetingRecord } from '@dsh-scholar-board/contracts'
import { openDrafts } from '../src/drafts/store'
import { exportRecords, importRecords, previewRecords, readRecordsPackage } from '../src/records/exchange'
import { registerRecords } from '../src/records/access'
import { Refusal } from '../src/refusal'
import { openRecords } from '../src/records/store'
import type { RecordsStore } from '../src/records/store'
import { createRegistries } from '../src/sources'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ACTOR = { widget: 'meeting-records', instance: 'card-1' }

const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/** 一个临时 home 里的记录文件。 */
async function tempFile(): Promise<string> {
  await mkdir(join(ROOT, '.debug'), { recursive: true })
  const home = await mkdtemp(join(ROOT, '.debug', 'records-test-'))
  homes.push(home)
  return join(home, 'records.json')
}

/** 打开一份临时存储。 */
async function open(options: { now?: () => number, limits?: { records: number, bytes: number } } = {}): Promise<{ store: RecordsStore, file: string }> {
  const file = await tempFile()
  return { store: await openRecords(file, options), file }
}

/** 一条会议的输入。 */
function meeting(title = '第 3 次组会'): Record<string, unknown> {
  return {
    kind: 'meeting',
    title,
    date: { kind: 'date', date: '2026-11-10', timeZone: 'Asia/Shanghai' },
    topics: '汇报本周进展',
    feedback: '补充一个基线对比',
    openQuestions: '信道模型还算不算静态的',
    related: [{ kind: 'manuscript', id: 'manuscript-1' }],
    materials: [{ id: 'm1', url: 'https://example.com/slides', title: '组会幻灯片' }],
  }
}

/** 拒绝里的状态码与原因码。 */
function refusalOf(error: unknown): { status: number, code: unknown } {
  if (!(error instanceof Refusal)) throw error
  return { status: error.status, code: error.extra.code }
}

describe('记录存储', () => {
  it('新建写入系统字段并落盘，重开之后还在', async () => {
    const { store, file } = await open()
    const created = await store.create(meeting(), ACTOR)
    expect(created.revision).toBe(1)
    expect(created.record).toMatchObject({
      kind: 'meeting',
      schemaVersion: 1,
      revision: 1,
      archived: false,
      lastEditedBy: ACTOR,
    })
    expect(created.record.createdAt).toBe(created.record.updatedAt)
    expect(created.record.id).toMatch(/^[0-9a-f-]{36}$/)

    const view = store.view()
    expect(view.records).toHaveLength(1)
    expect(view.quota).toMatchObject({ count: 1, warning: false })
    expect(view.truncated).toBe(false)

    const onDisk = JSON.parse(await readFile(file, 'utf8')) as { version: number, records: DomainRecord[] }
    expect(onDisk.version).toBe(1)
    expect(onDisk.records).toHaveLength(1)

    const reopened = await openRecords(file)
    expect(reopened.view().records[0]?.id).toBe(created.record.id)
  })

  it('更新核对修订号，过期回 409 与当前记录', async () => {
    const { store } = await open()
    const { record } = await store.create(meeting(), ACTOR)
    const updated = await store.update(record.id, 1, { title: '第 4 次组会' }, ACTOR)
    expect(updated.revision).toBe(2)
    expect(updated.record.title).toBe('第 4 次组会')

    const stale = await store.update(record.id, 1, { title: '迟到的修改' }, ACTOR).catch((error: unknown) => error)
    expect(refusalOf(stale)).toEqual({ status: 409, code: 'stale-revision' })
    expect((stale as Refusal).extra.revision).toBe(2)
    expect(((stale as Refusal).extra.record as MeetingRecord).title).toBe('第 4 次组会')
  })

  it('同一修订号的两个更新只有一个成功', async () => {
    const { store } = await open()
    const { record } = await store.create(meeting(), ACTOR)
    const results = await Promise.allSettled([
      store.update(record.id, 1, { title: '甲' }, ACTOR),
      store.update(record.id, 1, { title: '乙' }, ACTOR),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected?.status === 'rejected' ? refusalOf(rejected.reason).code : undefined).toBe('stale-revision')
    expect(store.get(record.id)?.revision).toBe(2)
  })

  it('稿件换阶段追加历史，同一阶段与改标题不追加', async () => {
    const { store } = await open()
    const created = await store.create({ kind: 'manuscript', title: '低轨星座干扰分析', stage: 'idea' }, ACTOR)
    const manuscript = created.record as ManuscriptRecord
    expect(manuscript.stageHistory).toHaveLength(1)
    expect(manuscript.stageHistory[0]).toMatchObject({ stage: 'idea' })

    const next = await store.update(manuscript.id, 1, { stage: 'experiment', stageNote: '开始搭仿真' }, ACTOR)
    const after = next.record as ManuscriptRecord
    expect(after.stage).toBe('experiment')
    expect(after.stageHistory).toHaveLength(2)
    expect(after.stageHistory[1]).toMatchObject({ stage: 'experiment', note: '开始搭仿真' })

    const renamed = await store.update(manuscript.id, 2, { title: '低轨星座干扰分析（新）' }, ACTOR)
    expect((renamed.record as ManuscriptRecord).stageHistory).toHaveLength(2)

    const again = await store.update(manuscript.id, 3, { stage: 'experiment' }, ACTOR)
    expect((again.record as ManuscriptRecord).stageHistory).toHaveLength(2)
  })

  it('归档收起、恢复回到活跃', async () => {
    const { store } = await open()
    const { record } = await store.create(meeting(), ACTOR)
    const archived = await store.archive(record.id, 1, ACTOR)
    expect(archived.record.archived).toBe(true)
    expect(store.view().records).toHaveLength(0)
    expect(store.view({ includeArchived: true }).records).toHaveLength(1)

    const restored = await store.restore(record.id, archived.revision, ACTOR)
    expect(restored.record.archived).toBe(false)
    expect(store.view().records).toHaveLength(1)
  })

  it('回收站保留归档标记，恢复先清回收标记', async () => {
    const { store } = await open()
    const { record } = await store.create(meeting(), ACTOR)
    const archived = await store.archive(record.id, 1, ACTOR)
    const trashed = await store.trash(record.id, archived.revision, ACTOR)
    expect((trashed.record as MeetingRecord).deletedAt).toEqual(expect.any(String))
    expect(trashed.record.archived).toBe(true)
    expect(store.view().records).toHaveLength(0)
    expect(store.view({ includeTrashed: true }).records).toHaveLength(1)

    const back = await store.restore(record.id, trashed.revision, ACTOR)
    expect((back.record as MeetingRecord).deletedAt).toBeUndefined()
    expect(back.record.archived).toBe(true)
    expect(store.view().records).toHaveLength(0)

    const active = await store.restore(record.id, back.revision, ACTOR)
    expect(active.record.archived).toBe(false)
    expect(store.view().records).toHaveLength(1)
  })

  it('回收站满三十天在读盘时清除', async () => {
    const start = Date.parse('2026-10-01T00:00:00.000Z')
    const first = await open({ now: () => start })
    const { record: old } = await first.store.create(meeting('旧会议'), ACTOR)
    await first.store.trash(old.id, 1, ACTOR)
    const { record: fresh } = await first.store.create(meeting('新会议'), ACTOR)
    await first.store.trash(fresh.id, 1, ACTOR)

    const later = start + 31 * 24 * 60 * 60 * 1000
    const reopened = await openRecords(first.file, { now: () => later })
    expect(reopened.view({ includeTrashed: true }).records).toHaveLength(0)
    const onDisk = JSON.parse(await readFile(first.file, 'utf8')) as { records: DomainRecord[] }
    expect(onDisk.records).toHaveLength(0)
  })

  it('拒绝空标题、超长标题、非法材料地址与未知字段', async () => {
    const { store } = await open()
    await expect(store.create({ kind: 'meeting', title: '  ' }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({ kind: 'meeting', title: '长'.repeat(201) }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({
      kind: 'meeting',
      title: '材料地址',
      materials: [{ id: 'm1', url: 'file:///etc/passwd', title: '本地文件' }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({ kind: 'meeting', title: '未知字段', owner: '张三' }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({ kind: 'meeting', title: '坏日期', date: { kind: 'date', date: '2026-02-30', timeZone: 'Asia/Shanghai' } }, ACTOR)).rejects.toMatchObject({ status: 400 })
  })

  it('单条记录超过 64 KiB 拒写', async () => {
    const { store } = await open()
    const result = await store.create({ kind: 'meeting', title: '长记录', feedback: '字'.repeat(30 * 1024) }, ACTOR).catch((error: unknown) => error)
    expect(refusalOf(result)).toEqual({ status: 413, code: 'record-too-large' })
    expect(store.view().records).toHaveLength(0)
  })

  it('九成时提醒，到顶阻止新建，回收站计入配额', async () => {
    const { store } = await open({ limits: { records: 3, bytes: 16 * 1024 * 1024 } })
    await store.create(meeting('一'), ACTOR)
    await store.create(meeting('二'), ACTOR)
    expect(store.view().quota.warning).toBe(false)
    await store.create(meeting('三'), ACTOR)
    expect(store.view().quota.warning).toBe(true)
    const third = store.view().records.find((record) => record.title === '三')
    if (third === undefined) throw new Error('没找到第三条记录')
    await store.trash(third.id, 1, ACTOR)
    expect(store.view().quota.count).toBe(3)
    const blocked = await store.create(meeting('四'), ACTOR).catch((error: unknown) => error)
    expect(refusalOf(blocked)).toEqual({ status: 409, code: 'records-limit' })
  })

  it('按类型与搜索筛选，行动项保留悬空来源', async () => {
    const { store } = await open()
    await store.create(meeting(), ACTOR)
    const action = await store.create({
      kind: 'action',
      title: '补一个基线对比',
      status: 'todo',
      source: { kind: 'meeting', id: 'meeting-removed' },
    }, ACTOR)
    expect((action.record as ActionRecord).source).toEqual({ kind: 'meeting', id: 'meeting-removed' })
    expect(store.view({ kind: 'meeting' }).records).toHaveLength(1)
    expect(store.view({ kind: 'action' }).records).toHaveLength(1)
    expect(store.view({ search: '补一个基线' }).records.map((record) => record.id)).toEqual([action.record.id])
    expect(store.view({ ids: [action.record.id] }).records).toHaveLength(1)
  })

  it('回收站里的记录不能直接编辑', async () => {
    const { store } = await open()
    const { record } = await store.create(meeting(), ACTOR)
    const trashed = await store.trash(record.id, 1, ACTOR)
    const result = await store.update(record.id, trashed.revision, { title: '改不了' }, ACTOR).catch((error: unknown) => error)
    expect(refusalOf(result)).toEqual({ status: 409, code: 'record-trashed' })
  })

  it('草稿可以存成记录目标并读回', async () => {
    const file = await tempFile()
    const drafts = openDrafts(join(file, '..', 'drafts'))
    const saved = await drafts.save({
      target: { kind: 'record', recordId: 'record-1' },
      base: {},
      form: { record: { title: '没写完的组会' } },
    })
    expect(saved.target).toEqual({ kind: 'record', recordId: 'record-1' })
    const loaded = await drafts.get(saved.draftId)
    expect(loaded?.form).toEqual({ record: { title: '没写完的组会' } })
    expect(await drafts.remove(saved.draftId)).toBe(true)
  })

  it('注册后的能力与数据源按卡片身份读写，订阅随写入推送', async () => {
    const file = await tempFile()
    const store = await openRecords(file)
    const drafts = openDrafts(join(file, '..', 'drafts'))
    const sources = createRegistries()
    const dispose = registerRecords(sources, store, drafts)
    try {
      const face = { id: 'card-1', widget: 'meeting-records', props: { kind: 'meeting' } }
      const empty = await sources.callCapability('records.read', face, {}) as { records: unknown[] }
      expect(empty.records).toHaveLength(0)

      const created = await sources.callCapability('records.write', face, { op: 'create', record: meeting() }) as { record: DomainRecord, revision: number }
      expect(created.record.lastEditedBy).toEqual({ widget: 'meeting-records', instance: 'card-1' })

      const registration = sources.resolveDataSource('records')?.registration
      if (registration?.subscribe === undefined) throw new Error('records 数据源没有订阅')
      const pushed: unknown[] = []
      const unsubscribe = registration.subscribe(face, (data) => pushed.push(data))
      expect(pushed).toHaveLength(1)
      expect((pushed[0] as { records: DomainRecord[] }).records).toHaveLength(1)

      await sources.callCapability('records.write', face, { op: 'update', id: created.record.id, expectedRevision: 1, patch: { title: '改过的组会' } })
      expect(pushed).toHaveLength(2)
      expect((pushed[1] as { records: MeetingRecord[] }).records[0]?.title).toBe('改过的组会')

      const stale = await sources.callCapability('records.write', face, { op: 'update', id: created.record.id, expectedRevision: 1, patch: { title: '迟到' } }).catch((error: unknown) => error)
      expect(refusalOf(stale)).toEqual({ status: 409, code: 'stale-revision' })

      const saved = await sources.callCapability('records.draft', face, { op: 'save', recordId: created.record.id, form: { title: '草稿' } }) as { draftId: string }
      const loaded = await sources.callCapability('records.draft', face, { op: 'load', draftId: saved.draftId }) as { draft: { form: unknown } }
      expect(loaded.draft.form).toEqual({ title: '草稿' })

      unsubscribe()
      await sources.callCapability('records.write', face, { op: 'archive', id: created.record.id, expectedRevision: 2 })
      expect(pushed).toHaveLength(2)
    } finally {
      dispose()
    }
  })

  it('导出默认只含活跃记录，勾选后带上归档与回收站，预览给出分布', async () => {
    const { store } = await open()
    const active = await store.create(meeting('活跃'), ACTOR)
    const archived = await store.create(meeting('归档'), ACTOR)
    await store.archive(archived.record.id, 1, ACTOR)
    const trashed = await store.create(meeting('回收'), ACTOR)
    await store.trash(trashed.record.id, 1, ACTOR)

    const now = Date.now()
    const activeOnly = readRecordsPackage(exportRecords(store, { includeArchived: false, includeTrashed: false }, now))
    expect(activeOnly.records.map((record) => record.title)).toEqual(['活跃'])
    expect(activeOnly.format).toBe(1)

    const everything = readRecordsPackage(exportRecords(store, { includeArchived: true, includeTrashed: true }, now))
    expect(everything.records).toHaveLength(3)

    const preview = previewRecords(exportRecords(store, { includeArchived: true, includeTrashed: true }, now))
    expect(preview).toMatchObject({ total: 3, active: 1, archived: 1, trashed: 1 })
    expect(preview.byKind.meeting).toBe(3)
  })

  it('导出再导入重映射 id、保留关联，不覆盖已有记录', async () => {
    const source = await open()
    const meetingCreated = await source.store.create(meeting(), ACTOR)
    const actionCreated = await source.store.create({
      kind: 'action',
      title: '补一个基线对比',
      status: 'todo',
      source: { kind: 'meeting', id: meetingCreated.record.id },
      related: [{ kind: 'meeting', id: meetingCreated.record.id }],
    }, ACTOR)
    const bytes = exportRecords(source.store, { includeArchived: false, includeTrashed: false }, Date.now())

    const target = await open()
    const existing = await target.store.create(meeting('目标里已有的记录'), ACTOR)
    const imported = await importRecords(target.store, bytes, Date.now())
    expect(imported).toBe(2)
    const view = target.store.view({ includeArchived: true, includeTrashed: true })
    expect(view.records).toHaveLength(3)
    expect(target.store.get(existing.record.id)?.title).toBe('目标里已有的记录')

    const importedMeeting = view.records.find((record): record is MeetingRecord => record.kind === 'meeting' && record.id !== existing.record.id)
    const importedAction = view.records.find((record): record is ActionRecord => record.kind === 'action')
    if (importedMeeting === undefined || importedAction === undefined) throw new Error('导入后找不到两条记录')
    expect(importedMeeting.id).not.toBe(meetingCreated.record.id)
    expect(importedMeeting.createdAt).toBe(meetingCreated.record.createdAt)
    expect(importedMeeting.revision).toBe(1)
    expect(importedAction.id).not.toBe(actionCreated.record.id)
    expect(importedAction.source).toEqual({ kind: 'meeting', id: importedMeeting.id })
    expect(importedAction.related).toEqual([{ kind: 'meeting', id: importedMeeting.id }])
  })

  it('只导出行动项时，指向包外会议的来源保持悬空原值', async () => {
    const source = await open()
    const meetingCreated = await source.store.create(meeting(), ACTOR)
    await source.store.create({
      kind: 'action',
      title: '悬空来源',
      status: 'todo',
      source: { kind: 'meeting', id: meetingCreated.record.id },
    }, ACTOR)
    const bytes = exportRecords(source.store, { includeArchived: false, includeTrashed: false, kinds: ['action'] }, Date.now())
    const target = await open()
    await importRecords(target.store, bytes, Date.now())
    const action = target.store.view().records[0] as ActionRecord
    expect(action.source).toEqual({ kind: 'meeting', id: meetingCreated.record.id })
  })

  it('导入整批校验：坏文件、坏版本与容量不够都拒绝，不留半份', async () => {
    const { store } = await open()
    await store.create(meeting('一'), ACTOR)
    await store.create(meeting('二'), ACTOR)
    const bytes = exportRecords(store, { includeArchived: false, includeTrashed: false }, Date.now())

    expect(() => readRecordsPackage(Buffer.from('不是 gzip'))).toThrow()
    const wrongFormat = Buffer.from(JSON.stringify({ format: 2, records: [] }))
    const gzip = (await import('node:zlib')).gzipSync(wrongFormat)
    expect(() => readRecordsPackage(gzip)).toThrow()

    const small = await open({ limits: { records: 1, bytes: 16 * 1024 * 1024 } })
    const rejected = await importRecords(small.store, bytes, Date.now()).catch((error: unknown) => error)
    expect(refusalOf(rejected)).toEqual({ status: 409, code: 'records-limit' })
    expect(small.store.view().records).toHaveLength(0)
  })
})
