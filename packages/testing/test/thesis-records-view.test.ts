/**
 * 毕业论文卡的判定：章节、成果来源、待补实验、学位节点、缺失内容的说法、视图过滤与材料地址。
 *
 * `thesis-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片
 * 真正在用的实现。学位节点与实验进度都由用户维护，这里不判断毕业资格。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/thesis-records/thesis-model.js'
import '../../widgets/thesis-records/copy.js'

interface ThesisModel {
  KIND: string
  CHAPTER_STATUSES: string[]
  ITEM_STATUSES: string[]
  RESULT_KINDS: string[]
  MAX_ITEMS: number
  MAX_MILESTONES: number
  LABEL_LENGTH: number
  TITLE_LENGTH: number
  chapterKey(status: unknown): string
  itemKey(status: unknown): string
  resultKey(kind: unknown): string
  isChapterStatus(status: unknown): boolean
  isItemStatus(status: unknown): boolean
  isResultKind(kind: unknown): boolean
  textOf(value: unknown): string
  dateValue(text: unknown, timeZone?: string): unknown
  dateInputOf(due: unknown): string
  chaptersOf(record: unknown): Array<Record<string, unknown>>
  resultsOf(record: unknown): Array<Record<string, unknown>>
  experimentsOf(record: unknown): Array<Record<string, unknown>>
  milestonesOf(record: unknown): Array<Record<string, unknown>>
  openExperiments(record: unknown): number
  nextMilestone(record: unknown): Record<string, unknown> | null
  milestoneLine(milestone: unknown, text: { t: (key: string) => string }): string
  summaryLine(record: unknown, text: { t: (key: string) => string }): string
  resultLine(result: unknown, title: unknown, text: { t: (key: string) => string }): string
  daysLeft(record: unknown, now?: number): number | null
  viewRows(records: unknown, view: string): Array<Record<string, unknown>>
  cleanChapters(rows: unknown): Array<Record<string, unknown>> | null
  cleanResults(rows: unknown): Array<Record<string, unknown>> | null
  cleanExperiments(rows: unknown): Array<Record<string, unknown>> | null
  cleanMilestones(rows: unknown): Array<Record<string, unknown>> | null
  materialValid(url: unknown, title: unknown): boolean
  openableUrl(url: unknown): boolean
  fill(text: string, values: Record<string, unknown>): string
}

const model = (globalThis as unknown as { ThesisRecords: ThesisModel }).ThesisRecords
const copy = (globalThis as unknown as { ThesisRecordsCopy: Record<string, unknown> }).ThesisRecordsCopy
const text = { t: (key: string) => key }

/** 一条毕业论文记录。 */
function thesis(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
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
      { id: 'e3', title: '已完成的复现', status: 'done' },
    ],
    milestones: [
      { id: 'm1', label: '预答辩', status: 'todo', due: { kind: 'date', date: '2027-03-15', timeZone: 'Asia/Shanghai' } },
      { id: 'm2', label: '开题', status: 'done', due: { kind: 'date', date: '2026-09-01', timeZone: 'Asia/Shanghai' } },
      { id: 'm3', label: '送审', status: 'todo' },
    ],
    materials: [{ id: 'tm1', url: 'https://example.com/outline.pdf', title: '论文提纲' }],
    updatedAt: '2026-11-12T08:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

describe('状态与缺失内容的说法', () => {
  it('只认章节、条目与成果来源的固定集合', () => {
    expect(model.KIND).toBe('thesis')
    expect(model.CHAPTER_STATUSES).toEqual(['planned', 'drafting', 'revising', 'done'])
    expect(model.ITEM_STATUSES).toEqual(['todo', 'doing', 'done'])
    expect(model.RESULT_KINDS).toEqual(['manuscript', 'research'])
    expect(model.chapterKey('drafting')).toBe('chapterDrafting')
    expect(model.chapterKey('revising')).toBe('chapterRevising')
    expect(model.chapterKey('done')).toBe('chapterDone')
    expect(model.chapterKey('other')).toBe('chapterPlanned')
    expect(model.itemKey('doing')).toBe('itemDoing')
    expect(model.itemKey('done')).toBe('itemDone')
    expect(model.itemKey('other')).toBe('itemTodo')
    expect(model.resultKey('research')).toBe('resultResearch')
    expect(model.resultKey('manuscript')).toBe('resultManuscript')
    expect(model.isChapterStatus('revising')).toBe(true)
    expect(model.isChapterStatus('blocked')).toBe(false)
    expect(model.isItemStatus('done')).toBe(true)
    expect(model.isResultKind('meeting')).toBe(false)
  })

  it('空白文字读成空串，日期输入与记录里的日期互转', () => {
    expect(model.textOf('  绪论  ')).toBe('绪论')
    expect(model.textOf(null)).toBe('')
    expect(model.dateValue('2027-03-15', 'Asia/Shanghai')).toEqual({ kind: 'date', date: '2027-03-15', timeZone: 'Asia/Shanghai' })
    expect(model.dateValue('2027-3-5')).toBeNull()
    expect(model.dateValue('')).toBeNull()
    expect(model.dateInputOf({ kind: 'date', date: '2027-03-15', timeZone: 'UTC' })).toBe('2027-03-15')
    expect(model.dateInputOf({ kind: 'instant', at: '2027-03-15T09:00:00.000Z' })).toBe('2027-03-15')
    expect(model.dateInputOf(null)).toBe('')
  })
})

describe('章节、成果、实验与节点', () => {
  it('只挑有 id 与必要字段的条目', () => {
    expect(model.chaptersOf(thesis())).toHaveLength(2)
    expect(model.chaptersOf(thesis({ chapters: [{ id: 'c1', title: '  ', status: 'done' }, { title: '没有 id' }, null, { id: 'c2', title: '系统模型', status: 'planned' }] }))).toHaveLength(1)
    expect(model.resultsOf(thesis())).toHaveLength(2)
    expect(model.resultsOf(thesis({ results: [{ id: 'x1', kind: 'meeting', recordId: 'm1' }, { id: 'x2', kind: 'research', recordId: '' }, { id: 'x3', kind: 'research', recordId: 'r1' }] }))).toHaveLength(1)
    expect(model.experimentsOf(thesis())).toHaveLength(3)
    expect(model.experimentsOf(thesis({ experiments: [{ id: 'e1', title: '' }, { id: 'e2', title: '补实验' }] }))).toHaveLength(1)
    expect(model.milestonesOf(thesis())).toHaveLength(3)
    expect(model.milestonesOf(thesis({ milestones: [{ id: 'm1', label: ' ' }, { id: 'm2', label: '答辩' }] }))).toHaveLength(1)
    expect(model.chaptersOf(null)).toEqual([])
  })

  it('待补实验只数没完成的，缺字段时当空', () => {
    expect(model.openExperiments(thesis())).toBe(2)
    expect(model.openExperiments(thesis({ experiments: [] }))).toBe(0)
    expect(model.openExperiments(null)).toBe(0)
  })

  it('最近的学位节点跳过已完成项，有日期的排在没日期的前面', () => {
    expect(model.nextMilestone(thesis())).toMatchObject({ id: 'm1', label: '预答辩' })
    const undated = thesis({ milestones: [{ id: 'm1', label: '送审', status: 'todo' }, { id: 'm2', label: '答辩', status: 'todo', due: { kind: 'date', date: '2027-05-20' } }] })
    expect(model.nextMilestone(undated)).toMatchObject({ id: 'm2' })
    const done = thesis({ milestones: [{ id: 'm1', label: '开题', status: 'done' }] })
    expect(model.nextMilestone(done)).toBeNull()
    expect(model.summaryLine(done, text)).toBe('noMilestone')
  })

  it('节点一行写名称与日期，未填日期只写名称；成果来源缺失时直接说明', () => {
    expect(model.milestoneLine({ label: '预答辩', due: { kind: 'date', date: '2027-03-15' } }, text)).toBe('预答辩 · 2027-03-15')
    expect(model.milestoneLine({ label: '送审' }, text)).toBe('送审')
    expect(model.milestoneLine(null, text)).toBe('')
    expect(model.summaryLine(thesis(), text)).toBe('预答辩 · 2027-03-15')
    expect(model.resultLine({ kind: 'manuscript' }, '低轨星座干扰分析', text)).toBe('resultManuscript · 低轨星座干扰分析')
    expect(model.resultLine({ kind: 'research' }, '', text)).toBe('resultResearch · missingSource')
    expect(model.resultLine({ kind: 'research' }, null, text)).toBe('resultResearch · missingSource')
  })
})

describe('视图过滤与排序', () => {
  const rows = [
    thesis({ id: 'old', updatedAt: '2026-10-01T00:00:00.000Z' }),
    thesis({ id: 'new', updatedAt: '2026-11-10T00:00:00.000Z' }),
    thesis({ id: 'archived', archived: true, updatedAt: '2026-11-06T00:00:00.000Z' }),
    thesis({ id: 'trashed', deletedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z' }),
    thesis({ id: 'trashed-archived', archived: true, deletedAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' }),
  ]

  it('活跃视图没有归档与回收站，按最近更新从新到旧', () => {
    expect(model.viewRows(rows, 'active').map((row) => row.id)).toEqual(['new', 'old'])
  })

  it('归档视图只有归档，回收站视图包括归档过的回收记录', () => {
    expect(model.viewRows(rows, 'archived').map((row) => row.id)).toEqual(['archived'])
    expect(model.viewRows(rows, 'trash').map((row) => row.id)).toEqual(['trashed', 'trashed-archived'])
  })

  it('不是数组时不抛错，读成空列表', () => {
    expect(model.viewRows(null, 'active')).toEqual([])
    expect(model.viewRows([null, 42, thesis()], 'active')).toHaveLength(1)
  })
})

describe('保存前的整理', () => {
  it('章节去掉首尾空白，保留问题与备注；缺标题或状态不认识时整组拒绝', () => {
    expect(model.cleanChapters([
      { id: 'c1', title: ' 绪论 ', status: 'done', question: ' 为什么研究 ', note: ' 先写背景 ' },
      { id: 'c2', title: '系统模型', status: 'planned' },
    ])).toEqual([
      { id: 'c1', title: '绪论', status: 'done', question: '为什么研究', note: '先写背景' },
      { id: 'c2', title: '系统模型', status: 'planned' },
    ])
    expect(model.cleanChapters([{ id: 'c1', title: '', status: 'done' }])).toBeNull()
    expect(model.cleanChapters([{ id: 'c1', title: '绪论', status: 'blocked' }])).toBeNull()
    expect(model.cleanChapters([{ id: 'c1', title: 'x'.repeat(model.TITLE_LENGTH + 1), status: 'done' }])).toBeNull()
    expect(model.cleanChapters([])).toEqual([])
  })

  it('成果要有来源类型与来源记录，说明可以没有', () => {
    expect(model.cleanResults([
      { id: 'x1', kind: 'manuscript', recordId: ' manuscript-1 ', note: ' 第二、三章 ' },
      { id: 'x2', kind: 'research', recordId: 'research-1' },
    ])).toEqual([
      { id: 'x1', kind: 'manuscript', recordId: 'manuscript-1', note: '第二、三章' },
      { id: 'x2', kind: 'research', recordId: 'research-1' },
    ])
    expect(model.cleanResults([{ id: 'x1', kind: 'manuscript', recordId: '' }])).toBeNull()
    expect(model.cleanResults([{ id: 'x1', kind: 'meeting', recordId: 'm1' }])).toBeNull()
    expect(model.cleanResults([{ id: 'x1', kind: 'research', recordId: 'x'.repeat(65) }])).toBeNull()
    expect(model.cleanResults(null)).toEqual([])
  })

  it('实验要有标题与状态', () => {
    expect(model.cleanExperiments([
      { id: 'e1', title: ' 补基线 ', status: 'doing', note: ' 需要两天 ' },
    ])).toEqual([{ id: 'e1', title: '补基线', status: 'doing', note: '需要两天' }])
    expect(model.cleanExperiments([{ id: 'e1', title: '', status: 'todo' }])).toBeNull()
    expect(model.cleanExperiments([{ id: 'e1', title: '补基线', status: 'blocked' }])).toBeNull()
    expect(model.cleanExperiments([])).toEqual([])
  })

  it('节点名称不超过上限，日期留空就不写，日期不完整时拒绝', () => {
    expect(model.cleanMilestones([
      { id: 'm1', label: ' 预答辩 ', status: 'todo', due: '2027-03-15' },
      { id: 'm2', label: '送审', status: 'todo', due: null, note: '等学院通知' },
    ])).toEqual([
      { id: 'm1', label: '预答辩', status: 'todo', due: expect.objectContaining({ kind: 'date', date: '2027-03-15' }) },
      { id: 'm2', label: '送审', status: 'todo', note: '等学院通知' },
    ])
    expect(model.cleanMilestones([{ id: 'm1', label: '', status: 'todo' }])).toBeNull()
    expect(model.cleanMilestones([{ id: 'm1', label: '预答辩', status: 'todo', due: '2027-3-5' }])).toBeNull()
    expect(model.cleanMilestones([{ id: 'm1', label: 'x'.repeat(model.LABEL_LENGTH + 1), status: 'todo' }])).toBeNull()
    expect(model.cleanMilestones([{ id: 'm1', label: '答辩', status: 'done' }])).toEqual([{ id: 'm1', label: '答辩', status: 'done' }])
  })
})

describe('回收倒计时、地址与文案', () => {
  it('回收倒计时按三十天算，读不出来的时间不给倒计时', () => {
    const now = Date.parse('2026-11-10T00:00:00.000Z')
    expect(model.daysLeft(thesis({ deletedAt: '2026-11-01T00:00:00.000Z' }), now)).toBe(21)
    expect(model.daysLeft(thesis({ deletedAt: '2026-11-10T00:00:00.000Z' }), now)).toBe(30)
    expect(model.daysLeft(thesis({ deletedAt: '不是时间' }), now)).toBeNull()
    expect(model.daysLeft(thesis(), now)).toBeNull()
  })

  it('材料只收 http/https 的完整地址，说明不能为空', () => {
    expect(model.materialValid('https://example.com/outline.pdf', '论文提纲')).toBe(true)
    expect(model.materialValid('http://example.com', '论文提纲')).toBe(true)
    expect(model.materialValid('file:///etc/passwd', '论文提纲')).toBe(false)
    expect(model.materialValid('javascript:alert(1)', '论文提纲')).toBe(false)
    expect(model.materialValid('https://example.com', '  ')).toBe(false)
    expect(model.openableUrl('https://example.com/run/42')).toBe(true)
    expect(model.openableUrl('')).toBe(false)
  })

  it('文案占位符全部替换', () => {
    expect(model.fill('章节 {done}/{total}', { done: 2, total: 5 })).toBe('章节 2/5')
  })
})

describe('样例与清单', () => {
  it('s 与 l 两个尺寸族都有样例', () => {
    const samples = JSON.parse(readFileSync(new URL('../../widgets/thesis-records/samples.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(Object.keys(samples).sort()).toEqual(['l', 'm'])
  })

  it('清单声明记录能力，文案键与 copy.js 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/thesis-records/widget.json', import.meta.url), 'utf8')) as {
      id: string
      source: string
      capabilities: string[]
      scripts: string[]
      text: Record<string, unknown>
    }
    expect(manifest.id).toBe('thesis-records')
    expect(manifest.source).toBe('widget-board:records')
    expect(manifest.capabilities).toEqual([
      'widget-board:records.read',
      'widget-board:records.write',
      'widget-board:records.draft',
    ])
    expect(manifest.scripts).toEqual(['thesis-model.js', 'copy.js', 'view.js', 'rows.js', 'editor.js'])
    expect(Object.keys(manifest.text).sort()).toEqual(Object.keys(copy).sort())
  })
})
