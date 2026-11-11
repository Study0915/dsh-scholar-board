/**
 * 行动项卡的判定：期限、逾期、视图与筛选、状态、材料地址。
 *
 * `action-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片
 * 真正在用的判定。
 */
import { describe, expect, it } from 'vitest'
import '../../widgets/action-items/action-model.js'

interface ActionModel {
  dueText(record: unknown): string
  dueTone(record: unknown, now?: number): string
  viewRows(records: unknown, view: string, filter: string, now?: number): Array<Record<string, unknown>>
  isStatus(value: unknown): boolean
  materialValid(url: unknown, title: unknown): boolean
  dateValue(text: unknown, timeZone?: string): unknown
}

const model = (globalThis as unknown as { ActionItems: ActionModel }).ActionItems

/** 一条行动项。 */
function action(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1',
    kind: 'action',
    title: '补一个基线对比',
    status: 'todo',
    updatedAt: '2026-11-10T08:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

describe('期限', () => {
  it('日期原样，时刻写到分钟；没有期限时是空串', () => {
    expect(model.dueText(action({ due: { kind: 'date', date: '2026-11-13', timeZone: 'Asia/Shanghai' } }))).toBe('2026-11-13')
    const instant = model.dueText(action({ due: { kind: 'instant', at: '2026-11-13T01:30:00.000Z', timeZone: 'Asia/Shanghai' } }))
    expect(instant).toContain('2026-11-13')
    expect(instant).toContain('09:30')
    expect(model.dueText(action())).toBe('')
  })

  it('逾期按记录自己的时区判次日零点，今天到期单独一档', () => {
    const now = Date.parse('2026-11-11T04:00:00.000Z')
    expect(model.dueTone(action({ due: { kind: 'date', date: '2026-11-10', timeZone: 'Asia/Shanghai' } }), now)).toBe('overdue')
    expect(model.dueTone(action({ due: { kind: 'date', date: '2026-11-11', timeZone: 'Asia/Shanghai' } }), now)).toBe('today')
    expect(model.dueTone(action({ due: { kind: 'date', date: '2026-11-12', timeZone: 'Asia/Shanghai' } }), now)).toBe('open')
    expect(model.dueTone(action({ due: { kind: 'instant', at: '2026-11-11T03:00:00.000Z', timeZone: 'UTC' } }), now)).toBe('overdue')
    expect(model.dueTone(action({ due: { kind: 'instant', at: '2026-11-11T05:00:00.000Z', timeZone: 'UTC' } }), now)).toBe('near')
    expect(model.dueTone(action(), now)).toBe('none')
  })
})

describe('视图与筛选', () => {
  const now = Date.parse('2026-11-11T04:00:00.000Z')
  const rows = [
    action({ id: 'open-due', due: { kind: 'date', date: '2026-11-13', timeZone: 'Asia/Shanghai' } }),
    action({ id: 'overdue', due: { kind: 'date', date: '2026-11-09', timeZone: 'Asia/Shanghai' } }),
    action({ id: 'nodue' }),
    action({ id: 'blocked', status: 'blocked' }),
    action({ id: 'done', status: 'done' }),
    action({ id: 'cancelled', status: 'cancelled' }),
    action({ id: 'archived', archived: true }),
    action({ id: 'trashed', deletedAt: '2026-11-01T00:00:00.000Z' }),
  ]

  it('活跃只含未完成，按期限从早到晚，没期限的排后面', () => {
    expect(model.viewRows(rows, 'active', 'all', now).map((row) => row.id)).toEqual(['overdue', 'open-due', 'nodue', 'blocked'])
  })

  it('活跃里的逾期、无期限与受阻各筛各的', () => {
    expect(model.viewRows(rows, 'active', 'overdue', now).map((row) => row.id)).toEqual(['overdue'])
    expect(model.viewRows(rows, 'active', 'nodue', now).map((row) => row.id)).toEqual(['nodue', 'blocked'])
    expect(model.viewRows(rows, 'active', 'blocked', now).map((row) => row.id)).toEqual(['blocked'])
  })

  it('完成、归档与回收站各自分开', () => {
    expect(model.viewRows(rows, 'done', 'all', now).map((row) => row.id)).toEqual(['done', 'cancelled'])
    expect(model.viewRows(rows, 'archived', 'all', now).map((row) => row.id)).toEqual(['archived'])
    expect(model.viewRows(rows, 'trash', 'all', now).map((row) => row.id)).toEqual(['trashed'])
  })

  it('不是数组时不抛错，读成空列表', () => {
    expect(model.viewRows(null, 'active', 'all', now)).toEqual([])
  })
})

describe('状态与材料', () => {
  it('只认五个状态', () => {
    for (const status of ['todo', 'doing', 'blocked', 'done', 'cancelled']) expect(model.isStatus(status)).toBe(true)
    expect(model.isStatus('closed')).toBe(false)
    expect(model.isStatus(undefined)).toBe(false)
  })

  it('材料只收 http/https 的完整地址，说明不能为空', () => {
    expect(model.materialValid('https://example.com/result.pdf', '结果')).toBe(true)
    expect(model.materialValid('file:///tmp/result.pdf', '结果')).toBe(false)
    expect(model.materialValid('https://example.com', '')).toBe(false)
  })

  it('期限输入读成带时区的 date', () => {
    expect(model.dateValue('2026-11-13', 'Asia/Shanghai')).toEqual({ kind: 'date', date: '2026-11-13', timeZone: 'Asia/Shanghai' })
    expect(model.dateValue('', 'Asia/Shanghai')).toBeNull()
  })
})
