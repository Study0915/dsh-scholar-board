/**
 * 小论文卡的判定：阶段、阶段历史、期限、视图与筛选、材料地址。
 *
 * `manuscript-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件。
 */
import { describe, expect, it } from 'vitest'
import '../../widgets/manuscript-records/manuscript-model.js'

interface ManuscriptModel {
  STAGES: string[]
  ACTIVE_STAGES: string[]
  stageKey(stage: unknown): string
  isStage(value: unknown): boolean
  dateOf(at: unknown): string
  dueText(record: unknown): string
  dueTone(record: unknown, now?: number): string
  historyOf(record: unknown): Array<Record<string, unknown>>
  viewRows(records: unknown, view: string, stage: string, now?: number): Array<Record<string, unknown>>
  materialValid(url: unknown, title: unknown): boolean
  dateValue(text: unknown, timeZone?: string): unknown
}

const model = (globalThis as unknown as { Manuscripts: ManuscriptModel }).Manuscripts

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
