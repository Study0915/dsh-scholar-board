/**
 * 科研总览的判定：三组记录各挑哪些、怎么排，期限怎么读。
 *
 * `overview-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件。
 */
import { describe, expect, it } from 'vitest'
import '../../widgets/research-overview/overview-model.js'

interface Sections {
  rows: Array<Record<string, unknown>>
  total: number
  more: number
}

interface OverviewModel {
  dateText(record: unknown): string
  dueText(record: unknown): string
  dueTone(record: unknown, now?: number): string
  actionRows(records: unknown, now?: number, limit?: number): Sections
  meetingRows(records: unknown, limit?: number): Sections
  manuscriptRows(records: unknown, now?: number, limit?: number): Sections
  stageKey(stage: unknown): string
}

const model = (globalThis as unknown as { Overview: OverviewModel }).Overview

describe('近期行动项', () => {
  const now = Date.parse('2026-11-11T04:00:00.000Z')
  const rows = [
    { id: 'later', kind: 'action', title: '稍后', status: 'todo', due: { kind: 'date', date: '2026-11-20', timeZone: 'Asia/Shanghai' }, updatedAt: '2026-11-10T00:00:00.000Z' },
    { id: 'soon', kind: 'action', title: '先做', status: 'doing', due: { kind: 'date', date: '2026-11-12', timeZone: 'Asia/Shanghai' }, updatedAt: '2026-11-09T00:00:00.000Z' },
    { id: 'nodue', kind: 'action', title: '无期限', status: 'blocked', updatedAt: '2026-11-08T00:00:00.000Z' },
    { id: 'done', kind: 'action', title: '已完成', status: 'done', updatedAt: '2026-11-07T00:00:00.000Z' },
    { id: 'cancelled', kind: 'action', title: '已取消', status: 'cancelled', updatedAt: '2026-11-06T00:00:00.000Z' },
    { id: 'archived', kind: 'action', title: '归档', status: 'todo', archived: true, updatedAt: '2026-11-05T00:00:00.000Z' },
    { id: 'trashed', kind: 'action', title: '回收站', status: 'todo', deletedAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z' },
    { id: 'meeting', kind: 'meeting', title: '组会', updatedAt: '2026-11-03T00:00:00.000Z' },
  ]

  it('只挑待办、进行中与受阻，按期限从早到晚，没期限的在后', () => {
    const result = model.actionRows(rows, now, 5)
    expect(result.rows.map((row) => row.id)).toEqual(['soon', 'later', 'nodue'])
    expect(result.total).toBe(3)
    expect(result.more).toBe(0)
  })

  it('超过条数时给出还有几项', () => {
    const result = model.actionRows(rows, now, 1)
    expect(result.rows).toHaveLength(1)
    expect(result.total).toBe(3)
    expect(result.more).toBe(2)
  })
})

describe('最近组会与活跃稿件', () => {
  const now = Date.parse('2026-11-11T04:00:00.000Z')
  const meetings = [
    { id: 'old', kind: 'meeting', title: '旧', date: { kind: 'date', date: '2026-10-01', timeZone: 'Asia/Shanghai' }, updatedAt: '2026-10-01T00:00:00.000Z' },
    { id: 'new', kind: 'meeting', title: '新', date: { kind: 'date', date: '2026-11-06', timeZone: 'Asia/Shanghai' }, updatedAt: '2026-11-06T00:00:00.000Z' },
    { id: 'archived', kind: 'meeting', title: '归档', archived: true, updatedAt: '2026-11-07T00:00:00.000Z' },
  ]
  const manuscripts = [
    { id: 'writing', kind: 'manuscript', title: '写作中', stage: 'writing', due: { kind: 'date', date: '2026-12-01', timeZone: 'Asia/Shanghai' }, updatedAt: '2026-11-01T00:00:00.000Z' },
    { id: 'experiment', kind: 'manuscript', title: '实验中', stage: 'experiment', due: { kind: 'date', date: '2026-11-20', timeZone: 'Asia/Shanghai' }, updatedAt: '2026-11-02T00:00:00.000Z' },
    { id: 'accepted', kind: 'manuscript', title: '已接收', stage: 'accepted', updatedAt: '2026-11-03T00:00:00.000Z' },
  ]

  it('组会按日期从新到旧，归档不出现在最近里', () => {
    const result = model.meetingRows(meetings, 3)
    expect(result.rows.map((row) => row.id)).toEqual(['new', 'old'])
  })

  it('活跃稿件不含已接收与阶段归档，按期限从早到晚', () => {
    const result = model.manuscriptRows(manuscripts, now, 4)
    expect(result.rows.map((row) => row.id)).toEqual(['experiment', 'writing'])
    expect(model.stageKey('internal-review')).toBe('stageInternalReview')
  })
})
