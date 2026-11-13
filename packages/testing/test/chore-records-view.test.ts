/**
 * 其他事务卡的判定：自定义类别、状态、期限远近、筛选与排序、完成归档、材料与保存前的整理。
 *
 * `chore-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片
 * 真正在用的实现。期限只用于排序与筛选，不判断事务是否真的办完。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/chore-records/chore-model.js'
import '../../widgets/chore-records/copy.js'

interface ChoreModel {
  KIND: string
  STATUSES: string[]
  DAY: number
  DRAFT_DELAY: number
  LOAD_TIMEOUT: number
  CATEGORY_LENGTH: number
  TITLE_LENGTH: number
  SOON_DAYS: number
  statusKey(status: unknown): string
  isStatus(status: unknown): boolean
  textOf(value: unknown): string
  zone(): string
  dateValue(text: unknown, timeZone?: string): unknown
  dateInputOf(due: unknown): string
  categoryOf(record: unknown): string
  categoryOptions(records: unknown): string[]
  dueState(record: unknown, now?: number): string
  dueKey(state: unknown): string
  daysLeft(record: unknown, now?: number): number | null
  viewRows(records: unknown, view: string, filter: string, category: string, now?: number): Array<Record<string, unknown>>
  labelOf(value: unknown, limit: number): string | null
  cleanCategory(value: unknown): string | null
  materialValid(url: unknown, title: unknown): boolean
  openableUrl(url: unknown): boolean
  fill(text: string, values: Record<string, unknown>): string
}

const model = (globalThis as unknown as { ChoreRecords: ChoreModel }).ChoreRecords
const copy = (globalThis as unknown as { ChoreRecordsCopy: Record<string, unknown> }).ChoreRecordsCopy

/** 一条其他事务。 */
function chore(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
    kind: 'chore',
    title: '报销差旅',
    category: 'admin',
    status: 'todo',
    due: { kind: 'date', date: '2026-11-12', timeZone: 'Asia/Shanghai' },
    note: '把发票交给财务',
    materials: [{ id: 'cm1', url: 'https://example.com/receipt', title: '发票' }],
    updatedAt: '2026-11-12T08:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

/** 一个日期期限。 */
function on(date: string): Record<string, unknown> {
  return { kind: 'date', date, timeZone: 'Asia/Shanghai' }
}

describe('状态、类别与缺失内容的说法', () => {
  it('四种状态，未知状态读成待办', () => {
    expect(model.KIND).toBe('chore')
    expect(model.STATUSES).toEqual(['todo', 'doing', 'done', 'cancelled'])
    expect(model.statusKey('doing')).toBe('choreDoing')
    expect(model.statusKey('done')).toBe('choreDone')
    expect(model.statusKey('cancelled')).toBe('choreCancelled')
    expect(model.statusKey('other')).toBe('choreTodo')
    expect(model.isStatus('cancelled')).toBe(true)
    expect(model.isStatus('closed')).toBe(false)
  })

  it('空白文字读成空串，日期输入与记录里的日期互转', () => {
    expect(model.textOf('  报销  ')).toBe('报销')
    expect(model.textOf(null)).toBe('')
    expect(model.dateValue('2026-11-12', 'Asia/Shanghai')).toEqual({ kind: 'date', date: '2026-11-12', timeZone: 'Asia/Shanghai' })
    expect(model.dateValue('2026-1-5')).toBeNull()
    expect(model.dateInputOf({ kind: 'date', date: '2026-11-12', timeZone: 'UTC' })).toBe('2026-11-12')
    expect(model.dateInputOf({ kind: 'instant', at: '2026-11-12T09:00:00.000Z' })).toBe('2026-11-12')
    expect(model.dateInputOf(null)).toBe('')
  })

  it('类别去空白；已有的类别去重后按名称排序', () => {
    expect(model.categoryOf(chore())).toBe('admin')
    expect(model.categoryOf(chore({ category: '  life  ' }))).toBe('life')
    expect(model.categoryOf(chore({ category: null }))).toBe('')
    expect(model.categoryOf(null)).toBe('')
    expect(model.categoryOptions([
      chore({ category: 'life' }),
      chore({ category: 'admin' }),
      chore({ category: 'life' }),
      chore({ category: '' }),
      null,
    ])).toEqual(['admin', 'life'])
    expect(model.categoryOptions(null)).toEqual([])
  })
})

describe('期限远近与倒计时', () => {
  const now = Date.parse('2026-11-10T00:00:00.000Z')

  it('逾期、今天、七天内、以后与无期限分开', () => {
    expect(model.dueState(chore({ due: on('2026-11-01') }), now)).toBe('overdue')
    expect(model.dueState(chore({ due: on('2026-11-10') }), now)).toBe('today')
    expect(model.dueState(chore({ due: on('2026-11-14') }), now)).toBe('soon')
    expect(model.dueState(chore({ due: on('2026-11-30') }), now)).toBe('later')
    expect(model.dueState(chore({ due: null }), now)).toBe('none')
    expect(model.dueState(chore({ due: { kind: 'other' } }), now)).toBe('none')
    expect(model.dueState(null, now)).toBe('none')
    expect(model.dueState(chore({ due: { kind: 'instant', at: '2026-11-09T00:00:00.000Z' } }), now)).toBe('overdue')
    expect(model.dueState(chore({ due: { kind: 'instant', at: '2026-11-15T00:00:00.000Z' } }), now)).toBe('soon')
    expect(model.dueState(chore({ due: { kind: 'instant', at: '2026-11-30T00:00:00.000Z' } }), now)).toBe('later')
  })

  it('今天按记录里的时区算，不按 UTC 漂移', () => {
    // UTC 还是 9 日晚上，上海已经是 10 日清晨，期限应算今天而不是以后。
    const evening = Date.parse('2026-11-09T20:00:00.000Z')
    expect(model.dueState(chore({ due: on('2026-11-10') }), evening)).toBe('today')
  })

  it('期限的文案键与回收倒计时', () => {
    expect(model.dueKey('overdue')).toBe('dueOverdue')
    expect(model.dueKey('today')).toBe('dueToday')
    expect(model.dueKey('soon')).toBe('dueSoon')
    expect(model.dueKey('later')).toBe('dueLater')
    expect(model.dueKey('none')).toBe('dueNone')
    expect(model.daysLeft(chore({ deletedAt: '2026-11-01T00:00:00.000Z' }), now)).toBe(21)
    expect(model.daysLeft(chore({ deletedAt: '不是时间' }), now)).toBeNull()
    expect(model.daysLeft(chore(), now)).toBeNull()
  })
})

describe('视图、筛选与排序', () => {
  const now = Date.parse('2026-11-10T00:00:00.000Z')
  const overdue = chore({ id: 'overdue', category: 'admin', due: on('2026-11-01'), updatedAt: '2026-11-01T00:00:00.000Z' })
  const today = chore({ id: 'today', category: 'life', due: on('2026-11-10'), updatedAt: '2026-11-02T00:00:00.000Z' })
  const soon = chore({ id: 'soon', category: 'admin', due: on('2026-11-14'), updatedAt: '2026-11-03T00:00:00.000Z' })
  const later = chore({ id: 'later', category: 'life', due: on('2026-11-30'), updatedAt: '2026-11-04T00:00:00.000Z' })
  const none = chore({ id: 'none', category: 'admin', due: null, updatedAt: '2026-11-05T00:00:00.000Z' })
  const archived = chore({ id: 'archived', archived: true, due: on('2026-11-06') })
  const trashed = chore({ id: 'trashed', deletedAt: '2026-11-01T00:00:00.000Z', due: on('2026-11-07') })
  const rows = [later, overdue, none, today, soon, archived, trashed]

  it('三个月视图先按归档与回收站筛', () => {
    expect(model.viewRows(rows, 'active', 'all', '', now).map((row) => row.id)).toEqual(['overdue', 'today', 'soon', 'later', 'none'])
    expect(model.viewRows(rows, 'archived', 'all', '', now).map((row) => row.id)).toEqual(['archived'])
    expect(model.viewRows(rows, 'trash', 'all', '', now).map((row) => row.id)).toEqual(['trashed'])
  })

  it('逾期把今天算进去，七天内也把今天算进去，无期限只看没期限的', () => {
    expect(model.viewRows(rows, 'active', 'overdue', '', now).map((row) => row.id)).toEqual(['overdue', 'today'])
    expect(model.viewRows(rows, 'active', 'soon', '', now).map((row) => row.id)).toEqual(['today', 'soon'])
    expect(model.viewRows(rows, 'active', 'none', '', now).map((row) => row.id)).toEqual(['none'])
  })

  it('类别筛选可以叠加期限筛选，空类别表示不筛', () => {
    expect(model.viewRows(rows, 'active', 'all', 'admin', now).map((row) => row.id)).toEqual(['overdue', 'soon', 'none'])
    expect(model.viewRows(rows, 'active', 'overdue', 'admin', now).map((row) => row.id)).toEqual(['overdue'])
  })

  it('同一天的期限按最近更新从新到旧，读不成数组时是空列表', () => {
    const older = chore({ id: 'older', due: on('2026-11-20'), updatedAt: '2026-11-01T00:00:00.000Z' })
    const newer = chore({ id: 'newer', due: on('2026-11-20'), updatedAt: '2026-11-09T00:00:00.000Z' })
    expect(model.viewRows([older, newer], 'active', 'all', '', now).map((row) => row.id)).toEqual(['newer', 'older'])
    expect(model.viewRows(null, 'active', 'all', '', now)).toEqual([])
    expect(model.viewRows([null, 42, chore()], 'active', 'all', '', now)).toHaveLength(1)
  })
})

describe('保存前的整理与地址', () => {
  it('类别必填且不超过四十字，标题不超过两百字', () => {
    expect(model.cleanCategory('  admin  ')).toBe('admin')
    expect(model.cleanCategory('')).toBeNull()
    expect(model.cleanCategory(null)).toBeNull()
    expect(model.cleanCategory('x'.repeat(model.CATEGORY_LENGTH + 1))).toBeNull()
    expect(model.labelOf(' 报销差旅 ', model.TITLE_LENGTH)).toBe('报销差旅')
    expect(model.labelOf(' ', model.TITLE_LENGTH)).toBeNull()
    expect(model.labelOf('x'.repeat(model.TITLE_LENGTH + 1), model.TITLE_LENGTH)).toBeNull()
  })

  it('材料只收 http/https 的完整地址，说明不能为空', () => {
    expect(model.materialValid('https://example.com/receipt', '发票')).toBe(true)
    expect(model.materialValid('file:///etc/passwd', '发票')).toBe(false)
    expect(model.materialValid('https://example.com', '  ')).toBe(false)
    expect(model.openableUrl('https://example.com/run/42')).toBe(true)
    expect(model.openableUrl('')).toBe(false)
    expect(model.fill('还有 {days} 天', { days: 3 })).toBe('还有 3 天')
  })
})

describe('样例与清单', () => {
  it('m 与 l 两个尺寸族都有样例', () => {
    const samples = JSON.parse(readFileSync(new URL('../../widgets/chore-records/samples.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(Object.keys(samples).sort()).toEqual(['l', 'm'])
  })

  it('清单声明记录能力，文案键与 copy.js 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/chore-records/widget.json', import.meta.url), 'utf8')) as {
      id: string
      source: string
      capabilities: string[]
      scripts: string[]
      text: Record<string, unknown>
    }
    expect(manifest.id).toBe('chore-records')
    expect(manifest.source).toBe('widget-board:records')
    expect(manifest.capabilities).toEqual([
      'widget-board:records.read',
      'widget-board:records.write',
      'widget-board:records.draft',
    ])
    expect(manifest.scripts).toEqual(['chore-model.js', 'copy.js', 'view.js', 'rows.js', 'editor.js'])
    expect(Object.keys(manifest.text).sort()).toEqual(Object.keys(copy).sort())
  })
})
