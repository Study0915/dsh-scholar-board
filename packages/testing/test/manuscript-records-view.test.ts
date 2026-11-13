/**
 * 小论文卡的判定：阶段、阶段历史、期限、视图与筛选、材料地址。
 *
 * `manuscript-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/manuscript-records/manuscript-model.js'
import '../../widgets/manuscript-records/copy.js'

interface ManuscriptModel {
  STAGES: string[]
  ACTIVE_STAGES: string[]
  FIGURE_KINDS: string[]
  DECISIONS: string[]
  REVISION_STATUSES: string[]
  MAX_FIGURES: number
  MAX_ROUNDS: number
  MAX_REVISIONS: number
  FIGURE_LABEL_LENGTH: number
  REVISION_TEXT: number
  stageKey(stage: unknown): string
  isStage(value: unknown): boolean
  figureKey(kind: unknown): string
  decisionKey(decision: unknown): string
  revisionKey(status: unknown): string
  isFigureKind(value: unknown): boolean
  isDecision(value: unknown): boolean
  isRevisionStatus(value: unknown): boolean
  dateOf(at: unknown): string
  dueText(record: unknown): string
  dueTone(record: unknown, now?: number): string
  historyOf(record: unknown): Array<Record<string, unknown>>
  viewRows(records: unknown, view: string, stage: string, now?: number): Array<Record<string, unknown>>
  materialValid(url: unknown, title: unknown): boolean
  cleanFigures(rows: unknown): Array<Record<string, unknown>>
  cleanRounds(rows: unknown): Array<Record<string, unknown>>
  cleanRevisions(rows: unknown, rounds: unknown): Array<Record<string, unknown>>
  openRevisionCount(record: unknown): number
  roundLabel(round: unknown, text: { t: (key: string) => string }): string
  dateValue(text: unknown, timeZone?: string): unknown
}

const model = (globalThis as unknown as { Manuscripts: ManuscriptModel }).Manuscripts
const copy = (globalThis as unknown as { ManuscriptsCopy: Record<string, unknown> }).ManuscriptsCopy

/** 一篇稿件。 */
function manuscript(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    kind: 'manuscript',
    title: '低轨星座干扰分析',
    stage: 'experiment',
    stageHistory: [{ stage: 'idea', at: '2026-10-01T00:00:00.000Z' }, { stage: 'experiment', at: '2026-11-01T00:00:00.000Z' }],
    updatedAt: '2026-11-10T08:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

describe('阶段与历史', () => {
  it('八个阶段都有文案键，只认这八个', () => {
    expect(model.STAGES).toHaveLength(8)
    expect(model.ACTIVE_STAGES).toHaveLength(6)
    expect(model.stageKey('idea')).toBe('stageIdea')
    expect(model.stageKey('internal-review')).toBe('stageInternalReview')
    expect(model.stageKey('accepted')).toBe('stageAccepted')
    expect(model.stageKey('archived')).toBe('stageArchived')
    expect(model.isStage('writing')).toBe(true)
    expect(model.isStage('rejected')).toBe(false)
  })

  it('阶段历史最近的在前，读不出来时是空列表', () => {
    const history = model.historyOf(manuscript())
    expect(history.map((entry) => entry.stage)).toEqual(['experiment', 'idea'])
    expect(model.historyOf(manuscript({ stageHistory: undefined }))).toEqual([])
    expect(model.dateOf('2026-11-01T00:00:00.000Z')).toBe('2026-11-01')
    expect(model.dateOf('不是时间')).toBe('')
  })
})

describe('视图与筛选', () => {
  const now = Date.parse('2026-11-11T04:00:00.000Z')
  const rows = [
    manuscript({ id: 'due-soon', due: { kind: 'date', date: '2026-11-13', timeZone: 'Asia/Shanghai' } }),
    manuscript({ id: 'overdue', due: { kind: 'date', date: '2026-11-09', timeZone: 'Asia/Shanghai' } }),
    manuscript({ id: 'writing', stage: 'writing' }),
    manuscript({ id: 'accepted', stage: 'accepted' }),
    manuscript({ id: 'stage-archived', stage: 'archived' }),
    manuscript({ id: 'lifecycle-archived', archived: true }),
    manuscript({ id: 'trashed', deletedAt: '2026-11-01T00:00:00.000Z' }),
  ]

  it('活跃只含六个阶段，按期限从早到晚，没期限的按更新排', () => {
    expect(model.viewRows(rows, 'active', '', now).map((row) => row.id)).toEqual(['overdue', 'due-soon', 'writing'])
  })

  it('活跃里按阶段筛', () => {
    expect(model.viewRows(rows, 'active', 'writing', now).map((row) => row.id)).toEqual(['writing'])
  })

  it('完成含已接收与阶段归档，归档与回收站各自分开', () => {
    expect(model.viewRows(rows, 'finished', '', now).map((row) => row.id)).toEqual(['accepted', 'stage-archived'])
    expect(model.viewRows(rows, 'archived', '', now).map((row) => row.id)).toEqual(['lifecycle-archived'])
    expect(model.viewRows(rows, 'trash', '', now).map((row) => row.id)).toEqual(['trashed'])
  })

  it('不是数组时不抛错', () => {
    expect(model.viewRows(null, 'active', '', now)).toEqual([])
  })
})

describe('期限与材料', () => {
  it('日期与时刻都读得出来，逾期按记录时区判', () => {
    expect(model.dueText(manuscript({ due: { kind: 'date', date: '2026-12-15', timeZone: 'Asia/Shanghai' } }))).toBe('2026-12-15')
    const now = Date.parse('2026-11-11T04:00:00.000Z')
    expect(model.dueTone(manuscript({ due: { kind: 'date', date: '2026-11-10', timeZone: 'Asia/Shanghai' } }), now)).toBe('overdue')
    expect(model.dueTone(manuscript({ due: { kind: 'date', date: '2026-11-11', timeZone: 'Asia/Shanghai' } }), now)).toBe('today')
  })

  it('材料只收 http/https 的完整地址，说明不能为空', () => {
    expect(model.materialValid('https://example.com/paper.pdf', '正文')).toBe(true)
    expect(model.materialValid('file:///tmp/paper.pdf', '正文')).toBe(false)
    expect(model.materialValid('https://example.com', '')).toBe(false)
    expect(model.dateValue('2026-12-15', 'Asia/Shanghai')).toEqual({ kind: 'date', date: '2026-12-15', timeZone: 'Asia/Shanghai' })
  })
})

describe('图表、投稿与修回', () => {
  it('图表只认图与表，缺编号或标题的条目不留下', () => {
    expect(model.FIGURE_KINDS).toEqual(['figure', 'table'])
    expect(model.figureKey('table')).toBe('figureTable')
    expect(model.figureKey('figure')).toBe('figureFigure')
    expect(model.figureKey('照片')).toBe('figureFigure')
    expect(model.cleanFigures([
      { id: 'f1', kind: 'figure', label: ' 图 1 ', title: ' 系统模型 ' },
      { id: 'f1', kind: 'table', label: '表 1', title: '重复 id' },
      { id: 'f2', kind: 'photo', label: '图 2', title: '不认识的类型' },
      { id: 'f3', kind: 'table', label: '  ', title: '缺编号' },
      { id: 'f4', kind: 'table', label: '表 2', title: '仿真参数', note: ' 补充说明 ' },
    ])).toEqual([
      { id: 'f1', kind: 'figure', label: '图 1', title: '系统模型' },
      { id: 'f4', kind: 'table', label: '表 2', title: '仿真参数', note: '补充说明' },
    ])
    expect(model.cleanFigures(null)).toEqual([])
  })

  it('图表编号超过上限时整条丢掉，不偷偷截断', () => {
    const long = 'x'.repeat(model.FIGURE_LABEL_LENGTH + 1)
    expect(model.cleanFigures([{ id: 'f1', kind: 'figure', label: long, title: '标题' }])).toEqual([])
  })

  it('投稿轮次要有刊会与决定，日期原样保留', () => {
    expect(model.DECISIONS).toEqual(['pending', 'minor', 'major', 'accepted', 'rejected', 'withdrawn', 'transferred'])
    expect(model.decisionKey('major')).toBe('decisionMajor')
    expect(model.decisionKey('transferred')).toBe('decisionTransferred')
    expect(model.decisionKey('later')).toBe('decisionPending')
    expect(model.cleanRounds([
      { id: 'r1', venue: ' IEEE TWC ', decision: 'major', submittedAt: { kind: 'date', date: '2026-10-01', timeZone: 'Asia/Shanghai' }, note: ' 一轮 ' },
      { id: 'r2', venue: '  ', decision: 'pending' },
      { id: 'r3', venue: 'IEEE COMST', decision: 'maybe' },
    ])).toEqual([
      { id: 'r1', venue: 'IEEE TWC', decision: 'major', submittedAt: { kind: 'date', date: '2026-10-01', timeZone: 'Asia/Shanghai' }, note: '一轮' },
    ])
  })

  it('修回要指向存在的一轮投稿，反馈必填、状态只认四种', () => {
    expect(model.REVISION_STATUSES).toEqual(['todo', 'doing', 'done', 'declined'])
    expect(model.revisionKey('doing')).toBe('revisionDoing')
    expect(model.revisionKey('done')).toBe('revisionDone')
    expect(model.revisionKey('declined')).toBe('revisionDeclined')
    expect(model.revisionKey('later')).toBe('revisionTodo')
    expect(model.isRevisionStatus('doing')).toBe(true)
    expect(model.isRevisionStatus('later')).toBe(false)
    const rounds = [{ id: 'r1', venue: 'IEEE TWC', decision: 'major' }]
    expect(model.cleanRevisions([
      { id: 'v1', roundId: 'r1', feedback: ' 补基线 ', change: ' 新增一节 ', status: 'done', materials: [{ id: 'm1', url: 'https://example.com/a', title: ' 图 3 ' }] },
      { id: 'v2', roundId: 'r9', feedback: '轮次不存在', status: 'todo' },
      { id: 'v3', roundId: 'r1', feedback: '  ', status: 'todo' },
      { id: 'v4', roundId: 'r1', feedback: '状态不认识', status: 'later' },
    ], rounds)).toEqual([
      { id: 'v1', roundId: 'r1', feedback: '补基线', change: '新增一节', status: 'done', materials: [{ id: 'm1', url: 'https://example.com/a', title: '图 3' }] },
    ])
    expect(model.cleanRevisions([{ id: 'v1', roundId: 'r1', feedback: 'ok', status: 'todo' }], [])).toEqual([])
  })

  it('待改条数只算未完成与处理中，不把已完成当进展', () => {
    const record = manuscript({
      revisions: [
        { id: 'v1', status: 'todo' },
        { id: 'v2', status: 'doing' },
        { id: 'v3', status: 'done' },
        { id: 'v4', status: 'declined' },
      ],
    })
    expect(model.openRevisionCount(record)).toBe(2)
    expect(model.openRevisionCount(manuscript({ revisions: undefined }))).toBe(0)
    expect(model.openRevisionCount(null)).toBe(0)
  })

  it('一轮投稿写成决定与刊会；读不出来时留空', () => {
    const text = { t: (key: string) => key === 'decisionMajor' ? '大修' : key }
    expect(model.roundLabel({ venue: 'IEEE TWC', decision: 'major' }, text)).toBe('大修 · IEEE TWC')
    expect(model.roundLabel(null, text)).toBe('')
  })
})

describe('样例与清单', () => {
  it('m 与 l 两个尺寸族都有样例', () => {
    const samples = JSON.parse(readFileSync(new URL('../../widgets/manuscript-records/samples.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(Object.keys(samples).sort()).toEqual(['l', 'm'])
  })

  it('清单声明记录能力与三个脚本，文案键与 copy.js 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/manuscript-records/widget.json', import.meta.url), 'utf8')) as {
      id: string
      source: string
      capabilities: string[]
      scripts: string[]
      text: Record<string, unknown>
    }
    expect(manifest.id).toBe('manuscript-records')
    expect(manifest.source).toBe('widget-board:records')
    expect(manifest.capabilities).toEqual([
      'widget-board:records.read',
      'widget-board:records.write',
      'widget-board:records.draft',
    ])
    expect(manifest.scripts).toEqual(['manuscript-model.js', 'copy.js', 'view.js', 'editor-deep.js', 'editor.js'])
    expect(Object.keys(manifest.text).sort()).toEqual(Object.keys(copy).sort())
  })
})
