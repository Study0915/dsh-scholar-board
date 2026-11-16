/**
 * 领域记录的共享存储（D36）：身份、修订冲突、生命周期、容量与读盘。
 *
 * 记录落在 `.debug/` 下的临时文件里，读写走真的磁盘：这里判定的是重启之后还剩下什么。
 */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActionRecord, ChoreRecord, CourseRecord, DomainRecord, LiteratureRecord, ManuscriptRecord, MeetingRecord, ProjectRecord, ResearchRecord, RunRecord, TemplateRecord, ThesisRecord, TopicRecord } from '@dsh-scholar-board/contracts'
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

/** 一条运行的输入。 */
function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'run',
    title: '种子 11 的干扰对齐仿真',
    plan: { kind: 'research', id: 'research-1' },
    status: 'running',
    code: { repository: 'https://example.com/sim', commit: 'abc1234' },
    datasets: [
      { id: 'ds1', name: '合成信道', split: 'train', version: 'v1' },
      { id: 'ds2', name: '真实信道', split: 'test' },
    ],
    checkpoints: [
      { id: 'c1', name: 'epoch-120', value: '820', unit: 's', definition: '第 120 轮检查点' },
      { id: 'c2', name: 'epoch-240', value: '1530', unit: 's' },
    ],
    config: [
      { name: 'batch', value: '64' },
      { name: 'lr', value: '1e-4', definition: '学习率' },
    ],
    environment: 'Ubuntu 24.04 / PyTorch 2.5 / CUDA 12.4',
    seed: '11',
    evaluation: '误码率与吞吐',
    startedAt: '2026-11-15T08:00:00+08:00',
    endedAt: '2026-11-15T10:00:00+08:00',
    metrics: [
      { name: 'ber', value: '3.1e-4', definition: '误码率' },
      { name: 'throughput', value: '18.4', unit: 'Mbps' },
    ],
    artifacts: [{ id: 'a1', url: 'https://example.com/log', title: '训练日志' }],
    failure: '第 240 轮出现 nan',
    note: '重跑前先检查学习率',
    results: [
      { id: 'r1', kind: 'single', text: '种子 11 收敛到 3.1e-4', method: '固定 64 用户', dispersion: '三次均值' },
      { id: 'r2', kind: 'aggregate', text: '三个种子的中位数', sources: ['run-1', 'run-2'], sampleSize: 3, method: '中位数' },
      { id: 'r3', kind: 'aggregate', text: '与文献对比后手工汇总', manual: true },
    ],
    related: [{ kind: 'literature', id: 'literature-1' }],
    materials: [{ id: 'rm1', url: 'https://example.com/report', title: '运行报告' }],
    ...overrides,
  }
}

/** 一条课题的输入。 */
function topic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'topic',
    title: '非平稳干扰下的多用户检测',
    question: '干扰功率未知时还能不能写出闭式检测器',
    goal: '给出可复现的推导与仿真口径',
    hypothesis: '先把干扰建模成慢变过程，闭式解仍然存在',
    judgment: '已知功率时有闭式解，未知功率时要迭代',
    nextStep: '补一组 8 用户、64 天线的仿真',
    questions: [
      { id: 'q1', text: '慢变假设能覆盖多普勒范围吗', status: 'investigating' },
      { id: 'q2', text: '迭代收敛次数能否给出上界', status: 'open' },
    ],
    related: [{ kind: 'research', id: 'research-1' }],
    materials: [{ id: 'tm1', url: 'https://example.com/notes.pdf', title: '推导笔记' }],
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

/** 一门课程的输入。 */
function course(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'course',
    title: '低轨星座干扰抑制',
    term: {
      label: '2026 秋',
      start: { kind: 'date', date: '2026-09-01', timeZone: 'Asia/Shanghai' },
      end: { kind: 'date', date: '2027-01-15', timeZone: 'Asia/Shanghai' },
    },
    code: 'EE 501',
    teacher: '王老师',
    schedule: '周三 3-4 节',
    notes: '重点在第 4 章',
    work: [
      { id: 'w1', kind: 'assignment', title: '第一次作业', status: 'todo', due: { kind: 'date', date: '2026-11-20', timeZone: 'Asia/Shanghai' }, note: '第 1–3 章' },
      { id: 'w2', kind: 'exam', title: '期中考试', status: 'doing', late: true },
    ],
    related: [{ kind: 'meeting', id: 'meeting-1' }],
    materials: [{ id: 'cm1', url: 'https://example.com/slides', title: '课件' }],
    ...overrides,
  }
}

/** 一条其他事务的输入。 */
function chore(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'chore',
    title: '报销差旅',
    category: '行政',
    status: 'todo',
    due: { kind: 'date', date: '2026-11-12', timeZone: 'Asia/Shanghai' },
    note: '把发票交给财务',
    materials: [{ id: 'hm1', url: 'https://example.com/receipt', title: '发票' }],
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
    await expect(store.create(literature({ related: [{ kind: 'meeting', id: 'meeting-1' }] }), ACTOR)).resolves.toMatchObject({ record: { related: [{ kind: 'meeting', id: 'meeting-1' }] } })
  })

  it('研究记录带目的、假设、步骤、环境、种子与带单位的参数指标，搜索也看这些内容', async () => {
    const { store } = await open()
    const created = await store.create(research({
      purpose: '验证种子变化对曲线的影响',
      hypothesis: '种子只影响小样本段',
      steps: '先跑基线，再换三个种子',
    }), ACTOR)
    const record = created.record as ResearchRecord
    expect(record).toMatchObject({
      kind: 'research',
      method: 'simulation',
      purpose: '验证种子变化对曲线的影响',
      hypothesis: '种子只影响小样本段',
      steps: '先跑基线，再换三个种子',
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
    expect(store.view({ search: '先跑基线' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '验证种子变化' }).records.map((entry) => entry.id)).toEqual([record.id])

    const moved = await store.update(record.id, 1, { method: 'experiment', conclusion: '复现一致', purpose: '换一组种子复验' }, ACTOR)
    expect((moved.record as ResearchRecord).method).toBe('experiment')
    expect((moved.record as ResearchRecord).conclusion).toBe('复现一致')
    expect((moved.record as ResearchRecord).purpose).toBe('换一组种子复验')

    await expect(store.create(research({ method: 'field' }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(research({ parameters: [{ name: 'snr' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(research({ metrics: [{ name: 'ber', value: '1e-3', unit: 'x'.repeat(33) }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(research({ related: [{ kind: 'meeting', id: 'meeting-1' }] }), ACTOR)).resolves.toMatchObject({ record: { related: [{ kind: 'meeting', id: 'meeting-1' }] } })
  })

  it('运行记录带方案来源、状态、代码、数据集、检查点、配置与结果，搜索也看这些内容', async () => {
    const { store } = await open()
    const created = await store.create(run(), ACTOR)
    const record = created.record as RunRecord
    expect(record).toMatchObject({
      kind: 'run',
      status: 'running',
      plan: { kind: 'research', id: 'research-1' },
      code: { repository: 'https://example.com/sim', commit: 'abc1234' },
      environment: 'Ubuntu 24.04 / PyTorch 2.5 / CUDA 12.4',
      seed: '11',
      evaluation: '误码率与吞吐',
      failure: '第 240 轮出现 nan',
      note: '重跑前先检查学习率',
    })
    expect(record.datasets).toEqual([
      { id: 'ds1', name: '合成信道', split: 'train', version: 'v1' },
      { id: 'ds2', name: '真实信道', split: 'test' },
    ])
    expect(record.checkpoints?.[0]).toEqual({ name: 'epoch-120', value: '820', unit: 's', definition: '第 120 轮检查点' })
    expect(record.config?.[1]).toEqual({ name: 'lr', value: '1e-4', definition: '学习率' })
    expect(record.metrics?.[0]).toEqual({ name: 'ber', value: '3.1e-4', definition: '误码率' })
    expect(record.startedAt).toBe('2026-11-15T00:00:00.000Z')
    expect(record.endedAt).toBe('2026-11-15T02:00:00.000Z')
    expect(record.results).toEqual([
      { id: 'r1', kind: 'single', text: '种子 11 收敛到 3.1e-4', method: '固定 64 用户', dispersion: '三次均值' },
      { id: 'r2', kind: 'aggregate', text: '三个种子的中位数', sources: ['run-1', 'run-2'], sampleSize: 3, method: '中位数' },
      { id: 'r3', kind: 'aggregate', text: '与文献对比后手工汇总', manual: true },
    ])
    expect(record.related).toEqual([{ kind: 'literature', id: 'literature-1' }])
    expect(record.artifacts?.[0]).toMatchObject({ title: '训练日志' })

    expect(store.view({ kind: 'run' }).records).toHaveLength(1)
    expect(store.view({ search: '合成信道' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '检查点' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: 'abc1234' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '学习率' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '训练日志' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: 'nan' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '收敛到' }).records.map((entry) => entry.id)).toEqual([record.id])
    // 方案来源就是一条普通引用：从研究记录这一侧能查到引用它的运行。
    expect(store.view({ references: { kind: 'research', id: 'research-1' } }).records.map((entry) => entry.id)).toEqual([record.id])

    const moved = await store.update(record.id, 1, { status: 'failed', failure: '第 240 轮 nan 未收敛' }, ACTOR)
    expect((moved.record as RunRecord).status).toBe('failed')
    expect((moved.record as RunRecord).failure).toBe('第 240 轮 nan 未收敛')

    // 状态是运行记录的必填项：没有状态的历史运行不允许写进来。
    await expect(store.create(run({ title: '没有状态的运行', status: undefined }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(run({ status: 'done' }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(run({ plan: { kind: 'run', id: 'run-1' } }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(run({ code: ['repo'] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(run({ datasets: [{ id: 'ds1', name: '' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(run({
      datasets: [{ id: 'ds1', name: '合成信道' }, { id: 'ds1', name: '真实信道' }],
    }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(run({ metrics: [{ name: 'ber' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(run({ endedAt: '昨天' }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(run({ results: [{ id: 'r1', kind: 'aggregate', text: '缺来源的汇总' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(run({
      results: [{ id: 'r1', kind: 'aggregate', text: '既写来源又标手工', sources: ['run-1'], manual: true }],
    }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(run({
      results: [{ id: 'r1', kind: 'single', text: '第一条' }, { id: 'r1', kind: 'single', text: '重复' }],
    }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(run({
      results: [{ id: 'r-long', kind: 'single', text: '字'.repeat(2000) }],
    }), ACTOR)).resolves.toMatchObject({ record: { results: [{ id: 'r-long', text: '字'.repeat(2000) }] } })
    await expect(store.create(run({
      results: [{ id: 'r1', kind: 'single', text: '字'.repeat(2001) }],
    }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(run({ related: [{ kind: 'unknown', id: 'x-1' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
  })

  it('模板也是记录：方向与字段定义落盘，方案与运行保存快照，模板改动不影响旧记录', async () => {
    const { store } = await open()
    const created = await store.create({
      kind: 'template',
      title: '自己改过的信号处理',
      direction: '信号处理',
      fields: [
        { key: 'sampleRate', label: '采样率', type: 'number', group: 'input', unit: 'Hz' },
        { key: 'ber', label: 'BER', type: 'number', group: 'metric', note: '按评估集合统计' },
      ],
    }, ACTOR)
    const record = created.record as TemplateRecord
    expect(record).toMatchObject({ kind: 'template', direction: '信号处理' })
    expect(record.fields.map((field) => field.key)).toEqual(['sampleRate', 'ber'])
    expect(store.view({ kind: 'template' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '评估集合' }).records.map((entry) => entry.id)).toEqual([record.id])

    const snapshot = {
      id: record.id,
      version: 1,
      values: [
        { key: 'sampleRate', label: '采样率', value: '2000' },
        { key: 'ber', label: 'BER', value: '' },
      ],
    }
    const plan = await store.create(research({ template: snapshot }), ACTOR)
    expect((plan.record as ResearchRecord).template).toEqual(snapshot)
    const runCreated = await store.create(run({ template: snapshot }), ACTOR)
    expect((runCreated.record as RunRecord).template).toEqual(snapshot)
    expect(store.view({ search: '采样率' }).records).toHaveLength(3)

    const edited = await store.update(record.id, 1, {
      fields: [{ key: 'sampleRate', label: '采样率', type: 'number', group: 'input', unit: 'kHz' }],
    }, ACTOR)
    expect((edited.record as TemplateRecord).fields).toEqual([{ key: 'sampleRate', label: '采样率', type: 'number', group: 'input', unit: 'kHz' }])
    const kept = store.view({ ids: [plan.record.id], includeArchived: true, includeTrashed: true }).records[0] as ResearchRecord
    expect(kept.template).toEqual(snapshot)

    await expect(store.create({ kind: 'template', title: '缺方向', fields: [{ key: 'a', label: '甲', type: 'text', group: 'input' }] }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({ kind: 'template', title: '缺字段', direction: '信号处理' }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({
      kind: 'template', title: '重复键', direction: '信号处理',
      fields: [{ key: 'a', label: '甲', type: 'text', group: 'input' }, { key: 'a', label: '乙', type: 'text', group: 'input' }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({
      kind: 'template', title: '坏类型', direction: '信号处理',
      fields: [{ key: 'a', label: '甲', type: 'formula', group: 'input' }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(research({ template: { id: 't1', version: 0, values: [] } }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(research({ template: { id: 't1', version: 1, values: [{ key: 'a', label: '甲' }] } }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(meeting('模板不能当关联目标'), ACTOR).then(() => store.create(research({ related: [{ kind: 'template', id: record.id }] }), ACTOR))).rejects.toMatchObject({ status: 400 })
  })

  it('课题带目标、假设、判断与问题条目，行动项按来源条目幂等创建，搜索也看问题与判断', async () => {
    const { store } = await open()
    const created = await store.create(topic(), ACTOR)
    const record = created.record as TopicRecord
    expect(record).toMatchObject({
      kind: 'topic',
      goal: '给出可复现的推导与仿真口径',
      hypothesis: '先把干扰建模成慢变过程，闭式解仍然存在',
      judgment: '已知功率时有闭式解，未知功率时要迭代',
    })
    expect(record.questions).toEqual([
      { id: 'q1', text: '慢变假设能覆盖多普勒范围吗', status: 'investigating' },
      { id: 'q2', text: '迭代收敛次数能否给出上界', status: 'open' },
    ])
    expect(store.view({ kind: 'topic' }).records).toHaveLength(1)
    expect(store.view({ search: '多普勒' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '闭式解' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '给出可复现' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '慢变过程' }).records.map((entry) => entry.id)).toEqual([record.id])

    const action = await store.create({
      kind: 'action',
      title: '慢变假设能覆盖多普勒范围吗',
      status: 'todo',
      source: { kind: 'topic', id: record.id },
      sourceEntry: 'q1',
    }, ACTOR)
    // 同一来源与条目再点一次不会多出一条行动项。
    const again = await store.create({
      kind: 'action',
      title: '慢变假设能覆盖多普勒范围吗',
      status: 'todo',
      source: { kind: 'topic', id: record.id },
      sourceEntry: 'q1',
    }, ACTOR)
    expect(again.record.id).toBe(action.record.id)
    expect(again.record.revision).toBe(action.record.revision)
    expect(store.view({ kind: 'action' }).records).toHaveLength(1)
    expect(store.view({ references: { kind: 'topic', id: record.id } }).records.map((entry) => entry.id)).toEqual([action.record.id])

    const linked = await store.update(record.id, 1, {
      questions: [
        { id: 'q1', text: '慢变假设能覆盖多普勒范围吗', status: 'investigating', actionId: action.record.id },
        { id: 'q2', text: '迭代收敛次数能否给出上界', status: 'resolved' },
      ],
    }, ACTOR)
    expect((linked.record as TopicRecord).questions?.[0]).toEqual({
      id: 'q1',
      text: '慢变假设能覆盖多普勒范围吗',
      status: 'investigating',
      actionId: action.record.id,
    })

    await expect(store.create(topic({ questions: [{ id: 'q1', text: '  ', status: 'open' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(topic({ questions: [{ id: 'q1', text: '第一条', status: 'open' }, { id: 'q1', text: '重复', status: 'open' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(topic({ questions: [{ id: 'q1', text: '第一条', status: 'closed' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(topic({ questions: [{ id: 'q1', text: '第一条', status: 'open', actionId: 'a1' }, { id: 'q2', text: '第二条', status: 'open', actionId: 'a1' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(topic({ questions: [{ id: 'q1', text: '字'.repeat(2001), status: 'open' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(topic({
      questions: Array.from({ length: 101 }, (_, index) => ({ id: `q${String(index)}`, text: '问题', status: 'open' })),
    }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({
      kind: 'action',
      title: '缺少问题条目',
      status: 'todo',
      source: { kind: 'topic', id: record.id },
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
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
    await expect(store.create(thesis({ related: [{ kind: 'meeting', id: 'meeting-1' }] }), ACTOR)).resolves.toMatchObject({ record: { related: [{ kind: 'meeting', id: 'meeting-1' }] } })
  })

  it('毕业论文的章节能关联课题与成果，实验能写方案并指向行动项', async () => {
    const { store } = await open()
    const created = await store.create(thesis({
      chapters: [
        { id: 'c1', title: '绪论', status: 'done', links: [{ kind: 'topic', id: 'topic-1' }, { kind: 'manuscript', id: 'manuscript-1' }] },
        { id: 'c2', title: '仿真与实验', status: 'drafting' },
      ],
      experiments: [
        { id: 'e1', title: '补一个基线对比', status: 'doing', plan: '先跑两小区，再扩到七小区', actionId: 'action-1' },
      ],
    }), ACTOR)
    const record = created.record as ThesisRecord
    expect(record.chapters?.[0].links).toEqual([{ kind: 'topic', id: 'topic-1' }, { kind: 'manuscript', id: 'manuscript-1' }])
    expect(record.chapters?.[1].links).toBeUndefined()
    expect(record.experiments?.[0]).toMatchObject({ plan: '先跑两小区，再扩到七小区', actionId: 'action-1' })
    expect(store.view({ search: '七小区' }).records.map((entry) => entry.id)).toEqual([record.id])

    await expect(store.create(thesis({
      chapters: [{ id: 'c1', title: '绪论', status: 'done', links: [{ kind: 'topic', id: 'topic-1' }, { kind: 'topic', id: 'topic-1' }] }],
    }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(thesis({
      chapters: [{ id: 'c1', title: '绪论', status: 'done', links: [{ kind: 'wrong', id: 'topic-1' }] }],
    }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(thesis({
      experiments: [{ id: 'e1', title: '补基线', status: 'todo', plan: 'x'.repeat(2001) }],
    }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(thesis({
      experiments: [{ id: 'e1', title: '补基线', status: 'todo', actionId: 'x'.repeat(65) }],
    }), ACTOR)).rejects.toMatchObject({ status: 400 })
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
    await expect(store.create(project({ related: [{ kind: 'research', id: 'research-1' }] }), ACTOR)).resolves.toMatchObject({ record: { related: [{ kind: 'research', id: 'research-1' }] } })
    await expect(store.create(project({ amount: '100000' }), ACTOR)).rejects.toMatchObject({ status: 400 })
  })

  it('课程带学期、课程信息、作业考试与补交标记，搜索也看笔记、作业与材料', async () => {
    const { store } = await open()
    const created = await store.create(course(), ACTOR)
    const record = created.record as CourseRecord
    expect(record).toMatchObject({
      kind: 'course',
      title: '低轨星座干扰抑制',
      code: 'EE 501',
      teacher: '王老师',
      schedule: '周三 3-4 节',
    })
    expect(record.term).toMatchObject({ label: '2026 秋' })
    expect(record.term.start).toMatchObject({ kind: 'date', date: '2026-09-01' })
    expect(record.work?.[0]).toMatchObject({ kind: 'assignment', title: '第一次作业', status: 'todo' })
    expect(record.work?.[1]).toMatchObject({ kind: 'exam', title: '期中考试', status: 'doing', late: true })
    expect(record.related).toEqual([{ kind: 'meeting', id: 'meeting-1' }])
    expect(store.view({ kind: 'course' }).records).toHaveLength(1)
    expect(store.view({ search: '期中考试' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '第 4 章' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '课件' }).records.map((entry) => entry.id)).toEqual([record.id])

    const moved = await store.update(record.id, 1, {
      work: [{ id: 'w1', kind: 'assignment', title: '第一次作业', status: 'done' }],
    }, ACTOR)
    expect((moved.record as CourseRecord).work?.[0].status).toBe('done')

    // 引用只存 id；来源还没建好时也允许保存，读的时候显示来源缺失。
    const forward = await store.create(course({ title: '关联未建好', related: [{ kind: 'meeting', id: 'meeting-later' }] }), ACTOR)
    expect((forward.record as CourseRecord).related).toEqual([{ kind: 'meeting', id: 'meeting-later' }])

    // 不同学期的课程各存各的，修改一门不会动到另一门的学期。
    const spring = await store.create(course({
      title: '检测与估计',
      term: { label: '2026 春', start: { kind: 'date', date: '2026-02-20', timeZone: 'Asia/Shanghai' } },
    }), ACTOR)
    expect((moved.record as CourseRecord).term).toMatchObject({ label: '2026 秋' })
    expect((spring.record as CourseRecord).term).toMatchObject({ label: '2026 春' })
    expect(store.view({ kind: 'course' }).records.map((entry) => (entry as CourseRecord).term.label).sort()).toEqual(['2026 春', '2026 秋', '2026 秋'])

    await expect(store.create(course({ term: undefined }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(course({ term: { label: ' ' } }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(course({ term: { label: '2026 秋', start: { kind: 'instant', at: '2026-09-01T00:00:00.000Z', timeZone: 'UTC' } } }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(course({ work: [{ id: 'w1', kind: 'quiz', title: '小测', status: 'todo' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(course({ work: [{ id: 'w1', kind: 'exam', title: '期末', status: 'blocked' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(course({ work: [{ id: 'w1', kind: 'exam', title: ' ', status: 'todo' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(course({ work: [{ id: 'w1', kind: 'exam', title: '期末', status: 'todo', due: { kind: 'date', date: '2026-11-31', timeZone: 'Asia/Shanghai' } }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(course({ related: [{ kind: 'research', id: 'research-1' }] }), ACTOR)).resolves.toMatchObject({ record: { related: [{ kind: 'research', id: 'research-1' }] } })
    await expect(store.create(course({ credits: 3 }), ACTOR)).rejects.toMatchObject({ status: 400 })
  })

  it('其他事务带自定义类别、状态与期限，完成后可以归档，搜索也看说明与材料', async () => {
    const { store } = await open()
    const created = await store.create(chore(), ACTOR)
    const record = created.record as ChoreRecord
    expect(record).toMatchObject({
      kind: 'chore',
      title: '报销差旅',
      category: '行政',
      status: 'todo',
    })
    expect(record.due).toMatchObject({ kind: 'date', date: '2026-11-12' })
    expect(store.view({ kind: 'chore' }).records).toHaveLength(1)
    expect(store.view({ search: '差旅' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '财务' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '发票' }).records.map((entry) => entry.id)).toEqual([record.id])

    // 完成与取消是两种状态；状态变化不影响自定义类别。
    const done = await store.update(record.id, 1, { status: 'done' }, ACTOR)
    expect((done.record as ChoreRecord)).toMatchObject({ status: 'done', category: '行政' })
    const archived = await store.archive(record.id, 2, ACTOR)
    expect(archived.record.archived).toBe(true)
    expect(store.view({ kind: 'chore' }).records).toHaveLength(0)
    expect(store.view({ kind: 'chore', includeArchived: true }).records).toHaveLength(1)

    const cancelled = await store.create(chore({ title: '更新借书证', category: '生活', status: 'cancelled' }), ACTOR)
    expect((cancelled.record as ChoreRecord)).toMatchObject({ status: 'cancelled', category: '生活' })
    expect(store.view({ search: '行政', includeArchived: true }).records.map((entry) => entry.id)).toEqual([record.id])

    await expect(store.create(chore({ category: undefined }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(chore({ category: ' ' }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(chore({ category: 'x'.repeat(41) }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(chore({ status: undefined }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(chore({ status: 'closed' }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(chore({ due: { kind: 'date', date: '2026-11-31', timeZone: 'Asia/Shanghai' } }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(chore({ note: 42 }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(chore({ materials: [{ id: 'hm1', url: 'file:///etc/passwd', title: '发票' }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
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
          deadline: { kind: 'date', date: '2027-01-05', timeZone: 'Asia/Shanghai' },
          checklist: [
            { id: 'k1', label: '正文', status: 'ready', version: 'v3' },
            { id: 'k2', label: '补充材料', status: 'missing' },
          ],
          frozenAt: { kind: 'date', date: '2026-10-21', timeZone: 'Asia/Shanghai' },
          note: '一审',
        },
      ],
      revisions: [
        {
          id: 'v1',
          roundId: 'r1',
          reviewer: '审稿人 2',
          commentNo: 'R2-3',
          feedback: '补一个基线对比',
          change: '新增 4.2 节',
          location: '4.2 节，图 6',
          reply: '已补充基线对比，见 4.2.',
          status: 'doing',
          actionId: 'action-1',
          materials: [{ id: 'vm1', url: 'https://example.com/reply.pdf', title: '回复信' }],
        },
      ],
    }, ACTOR)
    const record = created.record as ManuscriptRecord
    expect(record.figures).toHaveLength(2)
    expect(record.figures?.[1]).toMatchObject({ kind: 'table', label: '表 1', title: '仿真参数' })
    expect(record.submissions?.[0]).toMatchObject({ venue: 'IEEE TWC', decision: 'major', note: '一审' })
    expect(record.submissions?.[0].checklist).toEqual([
      { id: 'k1', label: '正文', status: 'ready', version: 'v3' },
      { id: 'k2', label: '补充材料', status: 'missing' },
    ])
    expect(record.submissions?.[0].deadline).toMatchObject({ kind: 'date', date: '2027-01-05' })
    expect(record.submissions?.[0].frozenAt).toMatchObject({ kind: 'date', date: '2026-10-21' })
    expect(record.revisions?.[0]).toMatchObject({
      roundId: 'r1',
      reviewer: '审稿人 2',
      commentNo: 'R2-3',
      feedback: '补一个基线对比',
      change: '新增 4.2 节',
      location: '4.2 节，图 6',
      reply: '已补充基线对比，见 4.2.',
      status: 'doing',
      actionId: 'action-1',
    })
    expect(store.view({ kind: 'manuscript' }).records).toHaveLength(1)
    expect(store.view({ search: '基线对比' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '系统模型' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '回复信' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: 'R2-3' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '图 6' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '已补充基线对比' }).records.map((entry) => entry.id)).toEqual([record.id])

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
    await expect(store.create({
      kind: 'manuscript',
      title: '坏检查项',
      stage: 'idea',
      submissions: [{ id: 'r1', venue: 'IEEE TWC', decision: 'major', checklist: [{ id: 'k1', label: '正文', status: 'done' }] }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({
      kind: 'manuscript',
      title: '重复检查项',
      stage: 'idea',
      submissions: [{ id: 'r1', venue: 'IEEE TWC', decision: 'major', checklist: [{ id: 'k1', label: '正文', status: 'ready' }, { id: 'k1', label: '补充', status: 'missing' }] }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({
      kind: 'manuscript',
      title: '不采纳没理由',
      stage: 'idea',
      submissions: [{ id: 'r1', venue: 'IEEE TWC', decision: 'major' }],
      revisions: [{ id: 'v1', roundId: 'r1', feedback: '改标题', status: 'declined' }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({
      kind: 'manuscript',
      title: '审稿人称呼过长',
      stage: 'idea',
      submissions: [{ id: 'r1', venue: 'IEEE TWC', decision: 'major' }],
      revisions: [{ id: 'v1', roundId: 'r1', feedback: '改标题', reviewer: 'x'.repeat(81), status: 'todo' }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
  })

  it('修回意见重复转行动项时回到同一条', async () => {
    const { store } = await open()
    const manuscript = await store.create({
      kind: 'manuscript',
      title: '重复转任务',
      stage: 'revision',
      submissions: [{ id: 'r1', venue: 'IEEE TWC', decision: 'major' }],
      revisions: [{ id: 'v1', roundId: 'r1', feedback: '补基线', status: 'todo' }],
    }, ACTOR)
    const input = {
      kind: 'action',
      title: '补基线对比',
      status: 'todo',
      source: { kind: 'manuscript', id: manuscript.record.id },
      sourceEntry: 'v1',
    }
    const first = await store.create(input, ACTOR)
    const second = await store.create(input, ACTOR)
    expect(second.record.id).toBe(first.record.id)
    expect(store.view({ kind: 'action' }).records).toHaveLength(1)
  })

  it('研究结论带依据、边界与证据引用，重复引用被拒绝', async () => {
    const { store } = await open()
    const created = await store.create(research({
      conclusion: '同样阈值下检测概率更高',
      conclusionBasis: '三次运行与一次消融结论一致',
      conclusionScope: '仅限 8 用户、静态信道',
      conclusionEvidence: [
        { kind: 'run', id: 'run-1', revision: 3, entryId: 'm1', summary: '检测概率 0.92' },
        { kind: 'literature', id: 'lit-1', revision: 0, materialId: 'pdf-1' },
      ],
    }), ACTOR)
    const record = created.record as ResearchRecord
    expect(record.conclusionBasis).toBe('三次运行与一次消融结论一致')
    expect(record.conclusionScope).toBe('仅限 8 用户、静态信道')
    expect(record.conclusionEvidence).toHaveLength(2)
    expect(record.conclusionEvidence?.[0]).toMatchObject({ kind: 'run', id: 'run-1', revision: 3, entryId: 'm1' })
    expect(record.conclusionEvidence?.[1]).toMatchObject({ kind: 'literature', id: 'lit-1', revision: 0, materialId: 'pdf-1' })
    expect(store.view({ search: '静态信道' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '检测概率 0.92' }).records.map((entry) => entry.id)).toEqual([record.id])

    const repeated = { kind: 'run', id: 'run-1', revision: 3 }
    await expect(store.create(research({ conclusionEvidence: [repeated, repeated] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(research({ conclusionEvidence: [{ kind: 'template', id: 't1', revision: 1 }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(research({ conclusionEvidence: [{ kind: 'run', id: 'r1', revision: 1.5 }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(research({ conclusionEvidence: [{ kind: 'run', id: 'r1', revision: 1, summary: 'x'.repeat(2001) }] }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(research({ conclusionEvidence: Array.from({ length: 51 }, (_, index) => ({ kind: 'run', id: `r${index}`, revision: 1 })) }), ACTOR)).rejects.toMatchObject({ status: 400 })
    const blank = await store.create(research({ conclusionBasis: '   ' }), ACTOR)
    expect('conclusionBasis' in blank.record).toBe(false)
  })

  it('图表带运行引用、绘图代码与结论说明，编号保持原样', async () => {
    const { store } = await open()
    const created = await store.create({
      kind: 'manuscript',
      title: '低轨星座干扰分析',
      stage: 'writing',
      figures: [
        {
          id: 'f1',
          kind: 'figure',
          label: '图 3a',
          title: '检测概率随 SNR 变化',
          runs: [{ kind: 'run', id: 'run-1' }, { kind: 'run', id: 'run-2' }],
          plot: { repository: 'https://example.com/plots', commit: 'abc1234' },
          conclusion: '固定虚警率下检测概率随 SNR 单调上升',
          materials: [{ id: 'fm1', url: 'https://example.com/fig.pdf', title: '矢量图' }],
        },
      ],
    }, ACTOR)
    const record = created.record as ManuscriptRecord
    expect(record.figures?.[0].label).toBe('图 3a')
    expect(record.figures?.[0].runs).toHaveLength(2)
    expect(record.figures?.[0].plot).toEqual({ repository: 'https://example.com/plots', commit: 'abc1234' })
    expect(store.view({ search: '固定虚警率' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: 'plots' }).records.map((entry) => entry.id)).toEqual([record.id])
    expect(store.view({ search: '矢量图' }).records.map((entry) => entry.id)).toEqual([record.id])

    await expect(store.create({
      kind: 'manuscript',
      title: '坏运行引用',
      stage: 'idea',
      figures: [{ id: 'f1', kind: 'figure', label: '图 1', title: '来源', runs: [{ kind: 'research', id: 'r1' }] }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({
      kind: 'manuscript',
      title: '重复运行',
      stage: 'idea',
      figures: [{ id: 'f1', kind: 'figure', label: '图 1', title: '来源', runs: [{ kind: 'run', id: 'r1' }, { kind: 'run', id: 'r1' }] }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({
      kind: 'manuscript',
      title: '坏绘图代码',
      stage: 'idea',
      figures: [{ id: 'f1', kind: 'figure', label: '图 1', title: '来源', plot: { repository: 42 } }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create({
      kind: 'manuscript',
      title: '运行太多',
      stage: 'idea',
      figures: [{ id: 'f1', kind: 'figure', label: '图 1', title: '来源', runs: Array.from({ length: 21 }, (_, index) => ({ kind: 'run', id: `r${index}` })) }],
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

  it('运行记录导出再导入时，方案来源与结果来源都跟着重映射', async () => {
    const source = await open()
    const plan = await source.store.create(research(), ACTOR)
    const first = await source.store.create(run({ plan: { kind: 'research', id: plan.record.id }, results: [] }), ACTOR)
    const second = await source.store.create(run({ title: '第二个运行', plan: { kind: 'research', id: plan.record.id }, results: [] }), ACTOR)
    await source.store.create(run({
      title: '汇总运行',
      results: [{ id: 'r1', kind: 'aggregate', text: '两个运行的汇总', sources: [first.record.id, second.record.id] }],
    }), ACTOR)
    const bytes = exportRecords(source.store, { includeArchived: false, includeTrashed: false }, Date.now())
    expect(previewRecords(bytes).byKind.run).toBe(3)

    const target = await open()
    await importRecords(target.store, bytes, Date.now())
    const view = target.store.view()
    const importedPlan = view.records.find((record) => record.kind === 'research')
    const importedRuns = view.records.filter((record): record is RunRecord => record.kind === 'run')
    const importedFirst = importedRuns.find((record) => record.title === '种子 11 的干扰对齐仿真')
    const importedSecond = importedRuns.find((record) => record.title === '第二个运行')
    const importedCombined = importedRuns.find((record) => record.title === '汇总运行')
    if (importedPlan === undefined || importedFirst === undefined || importedSecond === undefined || importedCombined === undefined) throw new Error('导入后找不到方案与三个运行')
    expect(importedFirst.plan).toEqual({ kind: 'research', id: importedPlan.id })
    expect(importedSecond.plan).toEqual({ kind: 'research', id: importedPlan.id })
    expect(importedCombined.results?.[0].sources?.sort()).toEqual([importedFirst.id, importedSecond.id].sort())
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
