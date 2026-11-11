/**
 * 组会记录卡的判定：日期、摘要、回收倒计时、视图过滤与材料地址。
 *
 * `records-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片
 * 真正在用的判定，不是另写一份样例。
 */
import { describe, expect, it } from 'vitest'
import '../../widgets/meeting-records/records-model.js'

interface RecordModel {
  dateText(record: unknown): string
  snippetOf(record: unknown): string
  daysLeft(record: unknown, now?: number): number | null
  viewRows(records: unknown, view: string): Array<Record<string, unknown>>
  materialValid(url: unknown, title: unknown): boolean
  dateValue(text: unknown, timeZone?: string): unknown
  fill(text: string, values: Record<string, unknown>): string
}

const model = (globalThis as unknown as { MeetingRecords: RecordModel }).MeetingRecords

/** 一条组会。 */
function meeting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    kind: 'meeting',
    title: '第 3 次组会',
    date: { kind: 'date', date: '2026-11-10', timeZone: 'Asia/Shanghai' },
    feedback: '补充一个基线对比',
    updatedAt: '2026-11-10T08:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

describe('日期与摘要', () => {
  it('日期与时刻都读成同一天的 YYYY-MM-DD，缺日期时是空串', () => {
    expect(model.dateText(meeting())).toBe('2026-11-10')
    expect(model.dateText(meeting({ date: { kind: 'instant', at: '2026-11-10T12:00:00.000Z', timeZone: 'UTC' } }))).toBe('2026-11-10')
    expect(model.dateText(meeting({ date: undefined }))).toBe('')
    expect(model.dateText(null)).toBe('')
  })

  it('摘要优先反馈，没有反馈时用汇报要点，空白压成一行', () => {
    expect(model.snippetOf(meeting())).toBe('补充一个基线对比')
    expect(model.snippetOf(meeting({ feedback: undefined, topics: '第一行\n  第二行' }))).toBe('第一行 第二行')
    expect(model.snippetOf(meeting({ feedback: '', topics: undefined }))).toBe('')
  })

  it('回收倒计时按三十天算，读不出来的时间不给倒计时', () => {
    const now = Date.parse('2026-11-10T00:00:00.000Z')
    expect(model.daysLeft(meeting({ deletedAt: '2026-11-01T00:00:00.000Z' }), now)).toBe(21)
    expect(model.daysLeft(meeting({ deletedAt: '2026-11-10T00:00:00.000Z' }), now)).toBe(30)
    expect(model.daysLeft(meeting({ deletedAt: '不是时间' }), now)).toBeNull()
    expect(model.daysLeft(meeting(), now)).toBeNull()
  })
})

describe('视图过滤与排序', () => {
  const rows = [
    meeting({ id: 'active-old', date: { kind: 'date', date: '2026-10-01', timeZone: 'Asia/Shanghai' } }),
    meeting({ id: 'active-new', date: { kind: 'date', date: '2026-11-10', timeZone: 'Asia/Shanghai' } }),
    meeting({ id: 'no-date', date: undefined, updatedAt: '2026-11-11T00:00:00.000Z' }),
    meeting({ id: 'archived', archived: true, date: { kind: 'date', date: '2026-11-05', timeZone: 'Asia/Shanghai' } }),
    meeting({ id: 'trashed', deletedAt: '2026-11-01T00:00:00.000Z', date: { kind: 'date', date: '2026-11-09', timeZone: 'Asia/Shanghai' } }),
    meeting({ id: 'trashed-archived', archived: true, deletedAt: '2026-11-02T00:00:00.000Z', date: { kind: 'date', date: '2026-11-08', timeZone: 'Asia/Shanghai' } }),
  ]

  it('活跃视图没有归档与回收站，按日期从新到旧，没日期的排最后', () => {
    expect(model.viewRows(rows, 'active').map((row) => row.id)).toEqual(['active-new', 'active-old', 'no-date'])
  })

  it('归档视图只有归档，回收站视图包括归档过的回收记录', () => {
    expect(model.viewRows(rows, 'archived').map((row) => row.id)).toEqual(['archived'])
    expect(model.viewRows(rows, 'trash').map((row) => row.id)).toEqual(['trashed', 'trashed-archived'])
  })

  it('不是数组时不抛错，读成空列表', () => {
    expect(model.viewRows(null, 'active')).toEqual([])
    expect(model.viewRows([null, 42, meeting()], 'active')).toHaveLength(1)
  })
})

describe('材料地址与日期输入', () => {
  it('材料只收 http/https 的完整地址，说明不能为空', () => {
    expect(model.materialValid('https://example.com/a.pdf', '材料')).toBe(true)
    expect(model.materialValid('http://example.com', '材料')).toBe(true)
    expect(model.materialValid('file:///etc/passwd', '材料')).toBe(false)
    expect(model.materialValid('javascript:alert(1)', '材料')).toBe(false)
    expect(model.materialValid('https://example.com', '  ')).toBe(false)
  })

  it('日期输入读成带时区的 date，形状不对时是 null', () => {
    expect(model.dateValue('2026-11-10', 'Asia/Shanghai')).toEqual({ kind: 'date', date: '2026-11-10', timeZone: 'Asia/Shanghai' })
    expect(model.dateValue('2026-11-10', '')).toEqual({ kind: 'date', date: '2026-11-10', timeZone: 'UTC' })
    expect(model.dateValue('2026/11/10', 'Asia/Shanghai')).toBeNull()
    expect(model.dateValue('', 'Asia/Shanghai')).toBeNull()
  })

  it('文案占位符全部替换', () => {
    expect(model.fill('最近 {n} 条 · 共 {total} 条', { n: 3, total: 8 })).toBe('最近 3 条 · 共 8 条')
  })
})
