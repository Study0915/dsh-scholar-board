/**
 * 领域记录的共享存储（D36）：身份、修订冲突、生命周期、容量与读盘。
 *
 * 记录落在 `.debug/` 下的临时文件里，读写走真的磁盘：这里判定的是重启之后还剩下什么。
 */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActionRecord, DomainRecord, LiteratureRecord, ManuscriptRecord, MeetingRecord, ProjectRecord, ResearchRecord, ThesisRecord } from '@dsh-scholar-board/contracts'
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

/** 一条文献的输入。 */
function literature(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'literature',
    title: '低轨星座干扰下的多用户检测',
    authors: 'A. Author, B. Author',
    venue: 'IEEE TWC',
    year: 2025,
    url: 'https://arxiv.org/abs/2611.08850v1',
    stage: 'queued',
    understanding: '把干扰建模成非平稳过程',
    questions: '信道状态更新频率对误码率的影响还没算清',
    ...overrides,
  }
}

/** 一条研究记录的输入。 */
function research(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'research',
    title: '不同种子下的干扰对齐仿真',
    method: 'simulation',
    question: '种子变化会不会让误码率曲线翻转',
    environment: 'Ubuntu 24.04 / Node 22 / numpy 2.1',
    seed: '11, 42, 97',
    parameters: [
      { name: 'snr', value: '0–20', unit: 'dB' },
      { name: 'users', value: '8' },
    ],
    metrics: [
      { name: 'ber', value: '3.2e-4' },
      { name: 'runtime', value: '820', unit: 's' },
    ],
    conclusion: '种子只影响小样本段的抖动，趋势一致',
    ...overrides,
  }
}

/** 一条毕业论文的输入。 */
function thesis(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'thesis',
    title: '低轨星座干扰下的多用户检测',
    question: '把干扰对齐用到低轨星座时，闭式解还成立吗',
    chapters: [
      { id: 'c1', title: '绪论', status: 'done' },
      { id: 'c2', title: '干扰对齐推导', status: 'revising' },
    ],
    results: [
      { id: 'x1', kind: 'manuscript', recordId: 'manuscript-1', note: '第二、三章的主体' },
      { id: 'x2', kind: 'research', recordId: 'research-1' },
    ],
    experiments: [
      { id: 'e1', title: '补一个基线对比', status: 'doing' },
      { id: 'e2', title: '扩展到多小区场景', status: 'todo' },
    ],
    milestones: [
      { id: 'm1', label: '预答辩', status: 'todo', due: { kind: 'date', date: '2027-03-15', timeZone: 'Asia/Shanghai' } },
      { id: 'm2', label: '送审', status: 'todo' },
    ],
    related: [{ kind: 'action', id: 'action-1' }],
    materials: [{ id: 'tm1', url: 'https://example.com/outline.pdf', title: '论文提纲' }],
    ...overrides,
  }
}

/** 一条横向项目的输入。 */
function project(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'project',
    title: '低轨星座干扰抑制模块合作',
    summary: '为合作方整理干扰抑制模块的可复现实验与阶段交付。',
    tasks: [
      { id: 'p1', title: '搭建链路级仿真', status: 'doing', due: { kind: 'date', date: '2026-11-20', timeZone: 'Asia/Shanghai' } },
      { id: 'p2', title: '整理月度进展', status: 'todo' },
    ],
    deliverables: [
      { id: 'd1', name: '仿真代码包', version: 'v0.3', status: 'delivered', materials: [{ id: 'dm1', url: 'https://example.com/pkg', title: '代码包' }] },
      { id: 'd2', name: '阶段报告', version: '草案 1', status: 'draft' },
    ],
    communications: [
      { id: 'n1', summary: '确认本月只做单小区场景', at: { kind: 'date', date: '2026-11-05', timeZone: 'Asia/Shanghai' } },
    ],
    milestones: [
      { id: 'm1', label: '第一次阶段评审', status: 'todo', due: { kind: 'date', date: '2026-12-01', timeZone: 'Asia/Shanghai' } },
    ],
    issues: [
      { id: 'i1', title: '测试数据的使用范围待确认', status: 'open' },
    ],
    related: [{ kind: 'meeting', id: 'meeting-1' }, { kind: 'action', id: 'action-1' }],
    materials: [{ id: 'pm1', url: 'https://example.com/brief', title: '需求摘要' }],
    ...overrides,
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

  it('文献带阅读阶段与自己的理解，年份与来源地址要合法', async () => {
    const { store } = await open()
    const created = await store.create(literature(), ACTOR)
    const record = created.record as LiteratureRecord
    expect(record).toMatchObject({
      kind: 'literature',
      stage: 'queued',
      authors: 'A. Author, B. Author',
      venue: 'IEEE TWC',
      year: 2025,
    })
    expect(store.view({ kind: 'literature' }).records).toHaveLength(1)
    expect(store.view({ search: '非平稳' }).records.map((entry) => entry.id)).toEqual([record.id])

    const moved = await store.update(record.id, 1, { stage: 'reading', understanding: '读完第二节' }, ACTOR)
    expect((moved.record as LiteratureRecord).stage).toBe('reading')
    expect((moved.record as LiteratureRecord).understanding).toBe('读完第二节')

    await expect(store.create(literature({ stage: 'read' }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(literature({ year: 999 }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(literature({ url: 'javascript:alert(1)' }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(literature({ related: [{ kind: 'meeting', id: 'meeting-1' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
  })

  it('研究记录带做法、环境、种子与带单位的参数指标，搜索也看参数与结论', async () => {
    const { store } = await open()
    const created = await store.create(research(), ACTOR)
    const record = created.record as ResearchRecord
    expect(record).toMatchObject({
      kind: 'research',
      method: 'simulation',
      environment: 'Ubuntu 24.04 / Node 22 / numpy 2.1',
      seed: '11, 42, 97',
    })
    expect(record.parameters).toEqual([
      { name: 'snr', value: '0–20', unit: 'dB' },
      { name: 'users', value: '8' },
    ])
    expect(record.metrics?.[1]).toEqual({ name: 'runtime', value: '820', unit: 's' })
    expect(store.view({ kind: 'research' }).records).toHaveLength(1)
    expect(store.view({ search: 'runtime' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '种子只影响' }).records.map((entry) => entry.id)).toEqual([record.id])

    const moved = await store.update(record.id, 1, { method: 'experiment', conclusion: '复现一致' }, ACTOR)
    expect((moved.record as ResearchRecord).method).toBe('experiment')
    expect((moved.record as ResearchRecord).conclusion).toBe('复现一致')

    await expect(store.create(research({ method: 'field' }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(research({ parameters: [{ name: 'snr' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(research({ metrics: [{ name: 'ber', value: '1e-3', unit: 'x'.repeat(33) }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(research({ related: [{ kind: 'meeting', id: 'meeting-1' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
  })

  it('毕业论文带章节、成果来源、待补实验与可配置的学位节点，搜索也看章节与节点', async () => {
    const { store } = await open()
    const created = await store.create(thesis(), ACTOR)
    const record = created.record as ThesisRecord
    expect(record).toMatchObject({
      kind: 'thesis',
      title: '低轨星座干扰下的多用户检测',
      question: '把干扰对齐用到低轨星座时，闭式解还成立吗',
    })
    expect(record.chapters).toEqual([
      { id: 'c1', title: '绪论', status: 'done' },
      { id: 'c2', title: '干扰对齐推导', status: 'revising' },
    ])
    expect(record.results).toEqual([
      { id: 'x1', kind: 'manuscript', recordId: 'manuscript-1', note: '第二、三章的主体' },
      { id: 'x2', kind: 'research', recordId: 'research-1' },
    ])
    expect(record.experiments?.[0]).toMatchObject({ title: '补一个基线对比', status: 'doing' })
    expect(record.milestones?.[0]).toMatchObject({ label: '预答辩', status: 'todo' })
    expect(record.milestones?.[0].due).toMatchObject({ kind: 'date', date: '2027-03-15' })
    expect(record.related).toEqual([{ kind: 'action', id: 'action-1' }])
    expect(store.view({ kind: 'thesis' }).records).toHaveLength(1)
    expect(store.view({ search: '第二、三章' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '干扰对齐推导' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '基线对比' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '预答辩' }).records.map((entry) => entry.id)).toEqual([record.id])

    const moved = await store.update(record.id, 1, {
      milestones: [
        { id: 'm1', label: '预答辩', status: 'done' },
        { id: 'm2', label: '送审', status: 'doing' },
      ],
    }, ACTOR)
    expect((moved.record as ThesisRecord).milestones?.[0].status).toBe('done')

    // 成果只存来源记录的 id；来源还没建好时也允许保存，读的时候显示来源缺失。
    const forward = await store.create(thesis({ title: '来源未建好', results: [{ id: 'x1', kind: 'research', recordId: 'research-later' }] }), ACTOR)
    expect((forward.record as ThesisRecord).results?.[0]).toMatchObject({ kind: 'research', recordId: 'research-later' })

    await expect(store.create(thesis({ chapters: [{ id: 'c1', title: '绪论', status: 'blocked' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(thesis({ results: [{ id: 'x1', kind: 'meeting', recordId: 'meeting-1' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(thesis({ experiments: [{ id: 'e1', title: '补基线', status: 'blocked' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(thesis({ milestones: [{ id: 'm1', label: 'x'.repeat(61), status: 'todo' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(thesis({ related: [{ kind: 'meeting', id: 'meeting-1' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
  })

  it('横向项目带需求摘要、负责事项、交付物版本、沟通结论、验收节点与问题，搜索也看这些内容', async () => {
    const { store } = await open()
    const created = await store.create(project(), ACTOR)
    const record = created.record as ProjectRecord
    expect(record).toMatchObject({
      kind: 'project',
      title: '低轨星座干扰抑制模块合作',
      summary: '为合作方整理干扰抑制模块的可复现实验与阶段交付。',
    })
    expect(record.tasks?.[0]).toMatchObject({ title: '搭建链路级仿真', status: 'doing' })
    expect(record.deliverables?.[0]).toMatchObject({ name: '仿真代码包', version: 'v0.3', status: 'delivered' })
    expect(record.communications?.[0]).toMatchObject({ summary: '确认本月只做单小区场景' })
    expect(record.milestones?.[0]).toMatchObject({ label: '第一次阶段评审', status: 'todo' })
    expect(record.issues?.[0]).toMatchObject({ title: '测试数据的使用范围待确认', status: 'open' })
    expect(record.related).toEqual([{ kind: 'meeting', id: 'meeting-1' }, { kind: 'action', id: 'action-1' }])
    expect(store.view({ kind: 'project' }).records).toHaveLength(1)
    expect(store.view({ search: '单小区' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '阶段评审' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '仿真代码包' }).records.map((entry) => entry.id)).toEqual([record.id])

    const moved = await store.update(record.id, 1, {
      tasks: [{ id: 'p1', title: '搭建链路级仿真', status: 'done' }],
      issues: [{ id: 'i1', title: '测试数据的使用范围待确认', status: 'resolved' }],
    }, ACTOR)
    expect((moved.record as ProjectRecord).tasks?.[0].status).toBe('done')
    expect((moved.record as ProjectRecord).issues?.[0].status).toBe('resolved')

    // 引用只存 id；来源还没建好时也允许保存，读的时候显示来源缺失。
    const forward = await store.create(project({ title: '来源未建好', related: [{ kind: 'meeting', id: 'meeting-later' }] }), ACTOR)
    expect((forward.record as ProjectRecord).related).toEqual([{ kind: 'meeting', id: 'meeting-later' }])

    await expect(store.create(project({ tasks: [{ id: 'p1', title: '搭建仿真', status: 'cancelled' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(project({ deliverables: [{ id: 'd1', name: '代码包', version: 'v1'.padEnd(33, '0'), status: 'draft' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(project({ deliverables: [{ id: 'd1', name: '代码包', status: 'draft' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(project({ issues: [{ id: 'i1', title: '范围待确认', status: 'closed' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(project({ milestones: [{ id: 'm1', label: 'x'.repeat(61), status: 'todo' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(project({ related: [{ kind: 'research', id: 'research-1' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(project({ amount: '100000' }), ACTOR)).rejects.toMatchObject({ status: 400 })
  })

  it('稿件带图表、投稿轮次与修回，修回要指向存在的一轮', async () => {
    const { store } = await open()
    const created = await store.create({
      kind: 'manuscript',
      title: '低轨星座干扰分析',
      stage: 'revision',
      figures: [
        { id: 'f1', kind: 'figure', label: '图 1', title: '系统模型', note: '画了三种轨道' },
        { id: 'f2', kind: 'table', label: '表 1', title: '仿真参数', materials: [{ id: 'fm1', url: 'https://example.com/tab', title: '参数表' }] },
      ],
      submissions: [
        {
          id: 'r1',
          venue: 'IEEE TWC',
          decision: 'major',
          submittedAt: { kind: 'date', date: '2026-09-01', timeZone: 'Asia/Shanghai' },
          decidedAt: { kind: 'date', date: '2026-10-20', timeZone: 'Asia/Shanghai' },
          note: '一审',
        },
      ],
      revisions: [
        {
          id: 'v1',
          roundId: 'r1',
          feedback: '补一个基线对比',
          change: '新增 4.2 节',
          status: 'doing',
          materials: [{ id: 'vm1', url: 'https://example.com/reply.pdf', title: '回复信' }],
        },
      ],
    }, ACTOR)
    const record = created.record as ManuscriptRecord
    expect(record.figures).toHaveLength(2)
    expect(record.figures?.[1]).toMatchObject({ kind: 'table', label: '表 1', title: '仿真参数' })
    expect(record.submissions?.[0]).toMatchObject({ venue: 'IEEE TWC', decision: 'major', note: '一审' })
    expect(record.revisions?.[0]).toMatchObject({ roundId: 'r1', feedback: '补一个基线对比', change: '新增 4.2 节', status: 'doing' })
    expect(store.view({ kind: 'manuscript' }).records).toHaveLength(1)
    expect(store.view({ search: '基线对比' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '系统模型' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '回复信' }).records.map((entry) => entry.id)).toEqual([record.id])

    const second = await store.update(record.id, 1, {
      submissions: [...(record.submissions ?? []), { id: 'r2', venue: 'IEEE TWC', decision: 'minor' }],
    }, ACTOR)
    expect((second.record as ManuscriptRecord).submissions).toHaveLength(2)
    expect((second.record as ManuscriptRecord).revisions?.[0].roundId).toBe('r1')

    await expect(store.create({ kind: 'manuscript', title: '坏图表', stage: 'idea', figures: [{ id: 'f1', kind: 'photo', label: '图 1', title: '类型不对' }] }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({ kind: 'manuscript', title: '坏轮次', stage: 'idea', submissions: [{ id: 'r1', venue: 'IEEE TWC', decision: 'later' }] }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({
      kind: 'manuscript',
      title: '坏修回',
      stage: 'idea',
      submissions: [{ id: 'r1', venue: 'IEEE TWC', decision: 'major' }],
      revisions: [{ id: 'v1', roundId: 'r9', feedback: '没有这一轮', status: 'todo' }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({
      kind: 'manuscript',
      title: '空反馈',
      stage: 'idea',
      submissions: [{ id: 'r1', venue: 'IEEE TWC', decision: 'major' }],
      revisions: [{ id: 'v1', roundId: 'r1', feedback: '  ', status: 'todo' }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
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

  it('按来源读行动项：反向引用由查询现算，不双写', async () => {
    const { store } = await open()
    const created = await store.create(meeting(), ACTOR)
    const other = await store.create(meeting('另一场组会'), ACTOR)
    const first = await store.create({ kind: 'action', title: '甲', status: 'todo', source: { kind: 'meeting', id: created.record.id } }, ACTOR)
    await store.create({ kind: 'action', title: '乙', status: 'todo', source: { kind: 'meeting', id: other.record.id } }, ACTOR)
    await store.create({ kind: 'action', title: '丙', status: 'todo' }, ACTOR)
    const view = store.view({ source: { kind: 'meeting', id: created.record.id } })
    expect(view.records.map((record) => record.id)).toEqual([first.record.id])
    expect(store.view().records.filter((record) => record.kind === 'action')).toHaveLength(3)
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

  it('导出可以只勾文献或研究记录，预览按五种记录计数', async () => {
    const { store } = await open()
    await store.create(meeting(), ACTOR)
    await store.create(literature(), ACTOR)
    await store.create(research(), ACTOR)
    const bytes = exportRecords(store, { includeArchived: false, includeTrashed: false, kinds: ['literature'] }, Date.now())
    expect(readRecordsPackage(bytes).records.map((record) => record.kind)).toEqual(['literature'])
    expect(previewRecords(bytes).byKind).toMatchObject({ meeting: 0, action: 0, manuscript: 0, literature: 1, research: 0 })

    const notes = exportRecords(store, { includeArchived: false, includeTrashed: false, kinds: ['research'] }, Date.now())
    expect(readRecordsPackage(notes).records.map((record) => record.kind)).toEqual(['research'])
    expect(previewRecords(notes).byKind).toMatchObject({ meeting: 0, action: 0, manuscript: 0, literature: 0, research: 1 })
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
