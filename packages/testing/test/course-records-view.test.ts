/**
 * 课程卡的判定：学期与起止、作业考试、补交标记、关联记录、近期事项、视图过滤与保存前的整理。
 *
 * `course-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片
 * 真正在用的实现。课程不算学分，也不校验培养规则。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/course-records/course-model.js'
import '../../widgets/course-records/copy.js'

interface CourseModel {
  KIND: string
  WORK_KINDS: string[]
  WORK_STATUSES: string[]
  RELATED_KINDS: string[]
  DAY: number
  DRAFT_DELAY: number
  LOAD_TIMEOUT: number
  MAX_WORK: number
  TERM_LABEL_LENGTH: number
  TITLE_LENGTH: number
  RECENT_LIMIT: number
  workKey(status: unknown): string
  workKindKey(kind: unknown): string
  relatedKey(kind: unknown): string
  isWorkKind(kind: unknown): boolean
  isWorkStatus(status: unknown): boolean
  isRelatedKind(kind: unknown): boolean
  textOf(value: unknown): string
  zone(): string
  dateValue(text: unknown, timeZone?: string): unknown
  dateInputOf(due: unknown): string
  termOf(record: unknown): Record<string, unknown> | null
  termRange(record: unknown): string
  termGroups(records: unknown): Array<{ label: string, range: string, start: string, records: Array<Record<string, unknown>> }>
  workOf(record: unknown): Array<Record<string, unknown>>
  relatedOf(record: unknown): Array<Record<string, unknown>>
  openWork(record: unknown): number
  nextWork(record: unknown): Record<string, unknown> | null
  workLine(work: unknown, text: { t: (key: string) => string }): string
  summaryLine(record: unknown, text: { t: (key: string) => string }): string
  courseLine(record: unknown, text: { t: (key: string) => string }): string
  recentWork(records: unknown, now?: number, limit?: number): { rows: Array<{ record: Record<string, unknown>, work: Record<string, unknown> }>, total: number }
  daysLeft(record: unknown, now?: number): number | null
  viewRows(records: unknown, view: string): Array<Record<string, unknown>>
  cleanWork(rows: unknown): Array<Record<string, unknown>> | null
  cleanTerm(label: unknown, startText: unknown, endText: unknown): Record<string, unknown> | null
  materialValid(url: unknown, title: unknown): boolean
  openableUrl(url: unknown): boolean
  fill(text: string, values: Record<string, unknown>): string
}

const model = (globalThis as unknown as { CourseRecords: CourseModel }).CourseRecords
const copy = (globalThis as unknown as { CourseRecordsCopy: Record<string, unknown> }).CourseRecordsCopy
const text = { t: (key: string) => key }

/** 一门课程。 */
function course(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c1',
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
      { id: 'w1', kind: 'assignment', title: '第一次作业', status: 'todo', due: { kind: 'date', date: '2026-11-20', timeZone: 'Asia/Shanghai' } },
      { id: 'w2', kind: 'exam', title: '期中考试', status: 'doing', due: { kind: 'date', date: '2026-11-15', timeZone: 'Asia/Shanghai' } },
      { id: 'w3', kind: 'assignment', title: '第二次作业', status: 'done' },
    ],
    related: [{ kind: 'meeting', id: 'meeting-1' }, { kind: 'action', id: 'action-1' }],
    materials: [{ id: 'cm1', url: 'https://example.com/slides', title: '课件' }],
    updatedAt: '2026-11-12T08:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

describe('状态与缺失内容的说法', () => {
  it('只认作业考试的类型、状态与关联记录集合', () => {
    expect(model.KIND).toBe('course')
    expect(model.WORK_KINDS).toEqual(['assignment', 'exam'])
    expect(model.WORK_STATUSES).toEqual(['todo', 'doing', 'done'])
    expect(model.RELATED_KINDS).toEqual(['meeting', 'action', 'manuscript'])
    expect(model.workKey('doing')).toBe('workDoing')
    expect(model.workKey('done')).toBe('workDone')
    expect(model.workKey('other')).toBe('workTodo')
    expect(model.workKindKey('exam')).toBe('workExam')
    expect(model.workKindKey('assignment')).toBe('workAssignment')
    expect(model.workKindKey('other')).toBe('workAssignment')
    expect(model.relatedKey('meeting')).toBe('relatedMeeting')
    expect(model.relatedKey('action')).toBe('relatedAction')
    expect(model.relatedKey('manuscript')).toBe('relatedManuscript')
    expect(model.isWorkKind('exam')).toBe(true)
    expect(model.isWorkKind('quiz')).toBe(false)
    expect(model.isWorkStatus('done')).toBe(true)
    expect(model.isWorkStatus('closed')).toBe(false)
    expect(model.isRelatedKind('manuscript')).toBe(true)
    expect(model.isRelatedKind('research')).toBe(false)
  })

  it('空白文字读成空串，日期输入与记录里的日期互转', () => {
    expect(model.textOf('  课程  ')).toBe('课程')
    expect(model.textOf(null)).toBe('')
    expect(model.dateValue('2026-11-20', 'Asia/Shanghai')).toEqual({ kind: 'date', date: '2026-11-20', timeZone: 'Asia/Shanghai' })
    expect(model.dateValue('2026-1-5')).toBeNull()
    expect(model.dateInputOf({ kind: 'date', date: '2026-11-20', timeZone: 'UTC' })).toBe('2026-11-20')
    expect(model.dateInputOf({ kind: 'instant', at: '2026-11-20T09:00:00.000Z' })).toBe('2026-11-20')
    expect(model.dateInputOf(null)).toBe('')
  })
})

describe('学期、作业考试与关联记录', () => {
  it('学期要有名称；起止只按日期显示', () => {
    expect(model.termOf(course())).toMatchObject({ label: '2026 秋' })
    expect(model.termOf(course({ term: { label: '  ' } }))).toBeNull()
    expect(model.termOf(course({ term: null }))).toBeNull()
    expect(model.termRange(course())).toBe('2026-09-01 ~ 2027-01-15')
    expect(model.termRange(course({ term: { label: '2026 秋', start: { kind: 'date', date: '2026-09-01' } } }))).toBe('2026-09-01')
    expect(model.termRange(course({ term: { label: '2026 秋', end: { kind: 'date', date: '2027-01-15' } } }))).toBe('2027-01-15')
    expect(model.termRange(course({ term: { label: '2026 秋' } }))).toBe('')
  })

  it('作业考试要有 id、类型、标题与认识的状态；关联只认会议、行动项与稿件', () => {
    expect(model.workOf(course())).toHaveLength(3)
    expect(model.workOf(course({
      work: [
        { id: 'w1', kind: 'quiz', title: '小测', status: 'todo' },
        { id: 'w2', kind: 'exam', title: ' ', status: 'todo' },
        { id: 'w3', kind: 'exam', title: '期末', status: 'done' },
        { kind: 'exam', title: '没有 id', status: 'todo' },
        null,
      ],
    }))).toHaveLength(1)
    expect(model.workOf(null)).toEqual([])
    expect(model.relatedOf(course())).toHaveLength(2)
    expect(model.relatedOf(course({
      related: [
        { kind: 'meeting', id: 'meeting-1' },
        { kind: 'research', id: 'research-1' },
        { kind: 'manuscript', id: 'manuscript-1' },
        { id: 'action-1' },
      ],
    }))).toHaveLength(2)
  })

  it('未完成的作业考试只数没完成的，最近的跳过完成项与无日期项', () => {
    expect(model.openWork(course())).toBe(2)
    expect(model.openWork(course({ work: [] }))).toBe(0)
    expect(model.openWork(null)).toBe(0)
    expect(model.nextWork(course())).toMatchObject({ id: 'w2', title: '期中考试' })
    const undated = course({
      work: [
        { id: 'w1', kind: 'assignment', title: '没有日期', status: 'todo' },
        { id: 'w2', kind: 'exam', title: '有日期', status: 'todo', due: { kind: 'date', date: '2026-11-15' } },
      ],
    })
    expect(model.nextWork(undated)).toMatchObject({ id: 'w2' })
    expect(model.nextWork(course({ work: [{ id: 'w1', kind: 'assignment', title: '交完了', status: 'done' }] }))).toBeNull()
  })

  it('一条作业写类型、标题与日期；课程写名称与学期', () => {
    expect(model.workLine({ kind: 'exam', title: '期中考试', due: { kind: 'date', date: '2026-11-15' } }, text)).toBe('workExam · 期中考试 · 2026-11-15')
    expect(model.workLine({ kind: 'exam', title: '期中考试', late: true }, text)).toBe('workExam · 期中考试 · workLate')
    expect(model.workLine(null, text)).toBe('')
    expect(model.summaryLine(course(), text)).toBe('workExam · 期中考试 · 2026-11-15')
    expect(model.summaryLine(course({ work: [{ id: 'w1', kind: 'assignment', title: '交完了', status: 'done' }] }), text)).toBe('noWork')
    expect(model.courseLine(course(), text)).toBe('低轨星座干扰抑制 · 2026 秋')
    expect(model.courseLine(course({ term: null }), text)).toBe('低轨星座干扰抑制')
  })
})

describe('学期分组与近期事项', () => {
  const autumnLate = course({
    id: 'autumn-late',
    title: '乙课',
    work: [{ id: 'w1', kind: 'assignment', title: '乙作业', status: 'todo', due: { kind: 'date', date: '2026-11-20' } }],
  })
  const autumnEarly = course({
    id: 'autumn-early',
    title: '甲课',
    work: [{ id: 'w2', kind: 'exam', title: '甲考试', status: 'todo', due: { kind: 'date', date: '2026-11-15' } }],
  })
  const spring = course({
    id: 'spring',
    title: '春季课',
    term: { label: '2026 春', start: { kind: 'date', date: '2026-02-20' }, end: { kind: 'date', date: '2026-07-10' } },
  })
  const undated = course({ id: 'undated', title: '未定课', term: { label: 'B 学期' } })
  const noTerm = course({ id: 'no-term', title: '待定课', term: null })

  it('有起止的学期按开始日期从新到旧，只有名称的排在后面', () => {
    const groups = model.termGroups([autumnLate, spring, undated, autumnEarly, noTerm])
    expect(groups.map((group) => group.label)).toEqual(['2026 秋', '2026 春', '', 'B 学期'])
    expect(groups[0].range).toBe('2026-09-01 ~ 2027-01-15')
    expect(groups[1].start).toBe('2026-02-20')
    expect(groups[2].records.map((record) => record.id)).toEqual(['no-term'])
    expect(groups[3].range).toBe('')
    expect(groups[0].records.map((record) => record.id)).toEqual(['autumn-early', 'autumn-late'])
    expect(model.termGroups(null)).toEqual([])
  })

  it('近期事项跨课程收集未完成且有日期的作业考试，按日期从早到晚', () => {
    const archived = course({ id: 'archived', archived: true })
    const trashed = course({ id: 'trashed', deletedAt: '2026-11-01T00:00:00.000Z' })
    const undatedWork = course({ id: 'undated-work', work: [{ id: 'w1', kind: 'assignment', title: '没有日期', status: 'todo' }] })
    const result = model.recentWork([autumnLate, autumnEarly, archived, trashed, undatedWork], Date.now())
    expect(result.rows.map((row) => (row.work as { id: string }).id)).toEqual(['w2', 'w1'])
    expect(result.rows.map((row) => (row.record as { id: string }).id)).toEqual(['autumn-early', 'autumn-late'])
    expect(result.total).toBe(2)
    const capped = model.recentWork([autumnLate, autumnEarly], Date.now(), 1)
    expect(capped.rows).toHaveLength(1)
    expect(capped.total).toBe(2)
    expect(model.recentWork(null).rows).toEqual([])
  })
})

describe('视图过滤、回收倒计时与地址', () => {
  it('活跃视图没有归档与回收站，归档只收归档，回收站包括归档过的回收记录', () => {
    const rows = [
      course({ id: 'new', updatedAt: '2026-11-10T00:00:00.000Z' }),
      course({ id: 'old', updatedAt: '2026-10-01T00:00:00.000Z' }),
      course({ id: 'archived', archived: true }),
      course({ id: 'trashed', deletedAt: '2026-11-01T00:00:00.000Z' }),
      course({ id: 'trashed-archived', archived: true, deletedAt: '2026-11-02T00:00:00.000Z' }),
    ]
    expect(model.viewRows(rows, 'active').map((row) => row.id)).toEqual(['new', 'old'])
    expect(model.viewRows(rows, 'archived').map((row) => row.id)).toEqual(['archived'])
    expect(model.viewRows(rows, 'trash').map((row) => row.id)).toEqual(['trashed', 'trashed-archived'])
    expect(model.viewRows(null, 'active')).toEqual([])
    expect(model.viewRows([null, 42, course()], 'active')).toHaveLength(1)
  })

  it('回收倒计时按三十天算，读不出来的时间不给倒计时', () => {
    const now = Date.parse('2026-11-10T00:00:00.000Z')
    expect(model.daysLeft(course({ deletedAt: '2026-11-01T00:00:00.000Z' }), now)).toBe(21)
    expect(model.daysLeft(course({ deletedAt: '不是时间' }), now)).toBeNull()
    expect(model.daysLeft(course(), now)).toBeNull()
  })

  it('材料只收 http/https 的完整地址，说明不能为空', () => {
    expect(model.materialValid('https://example.com/slides', '课件')).toBe(true)
    expect(model.materialValid('file:///etc/passwd', '课件')).toBe(false)
    expect(model.materialValid('https://example.com', '  ')).toBe(false)
    expect(model.openableUrl('https://example.com/run/42')).toBe(true)
    expect(model.openableUrl('')).toBe(false)
    expect(model.fill('作业 {done}/{total}', { done: 2, total: 5 })).toBe('作业 2/5')
  })
})

describe('保存前的整理', () => {
  it('作业考试要去空白、日期完整，补交只按勾选记录', () => {
    expect(model.cleanWork([
      { id: 'w1', kind: 'assignment', title: ' 第一次作业 ', status: 'todo', due: '2026-11-20', note: ' 第 1–3 章 ' },
      { id: 'w2', kind: 'exam', title: '期中考试', status: 'doing', due: null, late: true },
    ])).toEqual([
      { id: 'w1', kind: 'assignment', title: '第一次作业', status: 'todo', due: expect.objectContaining({ kind: 'date', date: '2026-11-20' }), note: '第 1–3 章' },
      { id: 'w2', kind: 'exam', title: '期中考试', status: 'doing', late: true },
    ])
    expect(model.cleanWork([{ id: 'w1', kind: 'quiz', title: '小测', status: 'todo' }])).toBeNull()
    expect(model.cleanWork([{ id: 'w1', kind: 'exam', title: ' ', status: 'todo' }])).toBeNull()
    expect(model.cleanWork([{ id: 'w1', kind: 'exam', title: '期末', status: 'closed' }])).toBeNull()
    expect(model.cleanWork([{ id: 'w1', kind: 'exam', title: '期末', status: 'todo', due: '2026-1-5' }])).toBeNull()
    expect(model.cleanWork([{ id: 'w1', kind: 'exam', title: 'x'.repeat(model.TITLE_LENGTH + 1), status: 'todo' }])).toBeNull()
    expect(model.cleanWork(null)).toEqual([])
  })

  it('学期名称必填，起止可留空但填了就要完整', () => {
    expect(model.cleanTerm(' 2026 秋 ', '2026-09-01', '2027-01-15')).toEqual({
      label: '2026 秋',
      start: expect.objectContaining({ kind: 'date', date: '2026-09-01' }),
      end: expect.objectContaining({ kind: 'date', date: '2027-01-15' }),
    })
    expect(model.cleanTerm('2026 秋', '', '')).toEqual({ label: '2026 秋' })
    expect(model.cleanTerm('', '2026-09-01', '')).toBeNull()
    expect(model.cleanTerm('x'.repeat(model.TERM_LABEL_LENGTH + 1), '', '')).toBeNull()
    expect(model.cleanTerm('2026 秋', '2026-9-1', '')).toBeNull()
  })
})

describe('样例与清单', () => {
  it('m 与 l 两个尺寸族都有样例', () => {
    const samples = JSON.parse(readFileSync(new URL('../../widgets/course-records/samples.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(Object.keys(samples).sort()).toEqual(['l', 'm'])
  })

  it('清单声明记录能力，文案键与 copy.js 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/course-records/widget.json', import.meta.url), 'utf8')) as {
      id: string
      source: string
      capabilities: string[]
      scripts: string[]
      text: Record<string, unknown>
    }
    expect(manifest.id).toBe('course-records')
    expect(manifest.source).toBe('widget-board:records')
    expect(manifest.capabilities).toEqual([
      'widget-board:records.read',
      'widget-board:records.write',
      'widget-board:records.draft',
    ])
    expect(manifest.scripts).toEqual(['course-model.js', 'copy.js', 'view.js', 'rows.js', 'editor.js'])
    expect(Object.keys(manifest.text).sort()).toEqual(Object.keys(copy).sort())
  })
})
