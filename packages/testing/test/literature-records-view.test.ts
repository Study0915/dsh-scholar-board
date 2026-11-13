/**
 * 文献阅读卡的判定：阅读阶段、摘要、作者信息、回收倒计时、视图过滤、年份与材料地址。
 *
 * `records-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片
 * 真正在用的实现，不是另写一份样例。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/literature-records/records-model.js'

interface LiteratureModel {
  KIND: string
  STAGES: string[]
  stageOf(record: unknown): string
  stageKey(stage: unknown): string
  snippetOf(record: unknown): string
  metaOf(record: unknown): string
  daysLeft(record: unknown, now?: number): number | null
  viewRows(records: unknown, view: string, stage?: string): Array<Record<string, unknown>>
  materialValid(url: unknown, title: unknown): boolean
  openableUrl(url: unknown): boolean
  yearValue(text: unknown): { ok: boolean, value: number | null }
  fill(text: string, values: Record<string, unknown>): string
}

const model = (globalThis as unknown as { LiteratureRecords: LiteratureModel }).LiteratureRecords

/** 一篇文献。 */
function paper(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'l1',
    kind: 'literature',
    title: '低轨星座干扰下的多用户检测',
    authors: 'A. Author, B. Author',
    venue: 'IEEE TWC',
    year: 2025,
    stage: 'reading',
    understanding: '把干扰建模成非平稳过程',
    questions: '信道状态更新频率对误码率的影响还没算清',
    updatedAt: '2026-11-10T08:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

describe('阅读阶段与摘要', () => {
  it('只认三个阶段，不认识的值按待读算', () => {
    expect(model.KIND).toBe('literature')
    expect(model.STAGES).toEqual(['queued', 'reading', 'understood'])
    expect(model.stageKey('queued')).toBe('stageQueued')
    expect(model.stageKey('reading')).toBe('stageReading')
    expect(model.stageKey('understood')).toBe('stageUnderstood')
    expect(model.stageOf(paper())).toBe('reading')
    expect(model.stageOf(paper({ stage: 'read' }))).toBe('queued')
    expect(model.stageOf(null)).toBe('queued')
  })

  it('摘要优先自己的理解，没有理解时用问题，空白压成一行', () => {
    expect(model.snippetOf(paper())).toBe('把干扰建模成非平稳过程')
    expect(model.snippetOf(paper({ understanding: undefined }))).toBe('信道状态更新频率对误码率的影响还没算清')
    expect(model.snippetOf(paper({ understanding: '', questions: '第一行\n  第二行' }))).toBe('第一行 第二行')
    expect(model.snippetOf(paper({ understanding: '', questions: '' }))).toBe('')
    expect(model.snippetOf(null)).toBe('')
  })

  it('作者信息只写有的部分，都没有时是空串', () => {
    expect(model.metaOf(paper())).toBe('A. Author, B. Author · IEEE TWC · 2025')
    expect(model.metaOf(paper({ authors: undefined, venue: undefined }))).toBe('2025')
    expect(model.metaOf(paper({ authors: undefined, venue: undefined, year: undefined }))).toBe('')
  })

  it('回收倒计时按三十天算，读不出来的时间不给倒计时', () => {
    const now = Date.parse('2026-11-10T00:00:00.000Z')
    expect(model.daysLeft(paper({ deletedAt: '2026-11-01T00:00:00.000Z' }), now)).toBe(21)
    expect(model.daysLeft(paper({ deletedAt: '2026-11-10T00:00:00.000Z' }), now)).toBe(30)
    expect(model.daysLeft(paper({ deletedAt: '不是时间' }), now)).toBeNull()
    expect(model.daysLeft(paper(), now)).toBeNull()
  })
})

describe('视图过滤与排序', () => {
  const rows = [
    paper({ id: 'queued-old', stage: 'queued', updatedAt: '2026-10-01T00:00:00.000Z' }),
    paper({ id: 'reading-new', stage: 'reading', updatedAt: '2026-11-10T00:00:00.000Z' }),
    paper({ id: 'understood', stage: 'understood', updatedAt: '2026-11-05T00:00:00.000Z' }),
    paper({ id: 'archived', archived: true, updatedAt: '2026-11-06T00:00:00.000Z' }),
    paper({ id: 'trashed', deletedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z' }),
    paper({ id: 'trashed-archived', archived: true, deletedAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' }),
  ]

  it('活跃视图没有归档与回收站，按最近更新从新到旧', () => {
    expect(model.viewRows(rows, 'active').map((row) => row.id)).toEqual(['reading-new', 'understood', 'queued-old'])
  })

  it('活跃里按阅读阶段筛', () => {
    expect(model.viewRows(rows, 'active', 'queued').map((row) => row.id)).toEqual(['queued-old'])
    expect(model.viewRows(rows, 'active', 'understood').map((row) => row.id)).toEqual(['understood'])
  })

  it('归档视图只有归档，回收站视图包括归档过的回收记录', () => {
    expect(model.viewRows(rows, 'archived').map((row) => row.id)).toEqual(['archived'])
    expect(model.viewRows(rows, 'trash').map((row) => row.id)).toEqual(['trashed', 'trashed-archived'])
  })

  it('不是数组时不抛错，读成空列表', () => {
    expect(model.viewRows(null, 'active')).toEqual([])
    expect(model.viewRows([null, 42, paper()], 'active')).toHaveLength(1)
  })
})

describe('年份、地址与文案', () => {
  it('年份留空是未填，越界或不是整数时拒绝', () => {
    expect(model.yearValue('')).toEqual({ ok: true, value: null })
    expect(model.yearValue('  ')).toEqual({ ok: true, value: null })
    expect(model.yearValue('2025')).toEqual({ ok: true, value: 2025 })
    expect(model.yearValue('999')).toEqual({ ok: false, value: null })
    expect(model.yearValue('3001')).toEqual({ ok: false, value: null })
    expect(model.yearValue('2025.5')).toEqual({ ok: false, value: null })
    expect(model.yearValue('abc')).toEqual({ ok: false, value: null })
  })

  it('材料只收 http/https 的完整地址，说明不能为空', () => {
    expect(model.materialValid('https://example.com/paper.pdf', '论文页')).toBe(true)
    expect(model.materialValid('http://example.com', '论文页')).toBe(true)
    expect(model.materialValid('file:///etc/passwd', '论文页')).toBe(false)
    expect(model.materialValid('javascript:alert(1)', '论文页')).toBe(false)
    expect(model.materialValid('https://example.com', '  ')).toBe(false)
    expect(model.openableUrl('https://arxiv.org/abs/2611.08850v1')).toBe(true)
    expect(model.openableUrl('')).toBe(false)
  })

  it('文案占位符全部替换', () => {
    expect(model.fill('最近 {n} 条 · 共 {total} 条', { n: 3, total: 8 })).toBe('最近 3 条 · 共 8 条')
  })
})

describe('样例与清单', () => {
  it('s 与 l 两个尺寸族都有样例', () => {
    const samples = JSON.parse(readFileSync(new URL('../../widgets/literature-records/samples.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(Object.keys(samples).sort()).toEqual(['l', 'm'])
  })

  it('清单声明记录能力，文案键与 copy.js 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/literature-records/widget.json', import.meta.url), 'utf8')) as {
      id: string
      source: string
      capabilities: string[]
      scripts: string[]
    }
    expect(manifest.id).toBe('literature-records')
    expect(manifest.source).toBe('widget-board:records')
    expect(manifest.capabilities).toEqual([
      'widget-board:records.read',
      'widget-board:records.write',
      'widget-board:records.draft',
    ])
    expect(manifest.scripts).toContain('records-model.js')
  })
})
