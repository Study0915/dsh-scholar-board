/**
 * 课题卡的判定：问题条目、状态计数、摘要、引用、回收倒计时、视图过滤与可保存的问题表。
 *
 * `topic-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片
 * 真正在用的实现，不是另写一份样例。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/topic-records/topic-model.js'
import '../../widgets/topic-records/copy.js'

interface TopicModel {
  KIND: string
  STATUSES: string[]
  MAX_QUESTIONS: number
  QUESTION_TEXT: number
  textOf(record: unknown, field: string): string
  shownText(record: unknown, field: string, unknown: unknown): string
  statusOf(question: unknown): string
  statusKey(status: unknown): string
  questionsOf(record: unknown): Array<Record<string, unknown>>
  questionCounts(record: unknown): { open: number, investigating: number, resolved: number, total: number }
  summaryOf(record: unknown, unknown: unknown): string
  referencesOf(record: unknown): Array<{ kind: string, id: string }>
  daysLeft(record: unknown, now?: number): number | null
  viewRows(records: unknown, view: string): Array<Record<string, unknown>>
  cleanQuestions(rows: unknown): Array<Record<string, unknown>> | null
  materialValid(url: unknown, title: unknown): boolean
  openableUrl(url: unknown): boolean
  fill(text: string, values: Record<string, unknown>): string
}

const model = (globalThis as unknown as { TopicRecords: TopicModel }).TopicRecords
const copy = (globalThis as unknown as { TopicRecordsCopy: Record<string, unknown> }).TopicRecordsCopy

/** 一条课题。 */
function topic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
    kind: 'topic',
    title: '非平稳干扰下的多用户检测',
    question: '干扰功率未知时还能不能写出闭式检测器',
    goal: '给出可复现的推导与仿真口径',
    hypothesis: '先把干扰建模成慢变过程，闭式解仍然存在',
    judgment: '已知功率时有闭式解，未知功率时要迭代',
    nextStep: '补一组 8 用户、64 天线的仿真',
    questions: [
      { id: 'q1', text: '慢变假设能覆盖多普勒范围吗', status: 'investigating', actionId: 'a1' },
      { id: 'q2', text: '迭代收敛次数能否给出上界', status: 'closed' },
      { id: 'q3', text: '按场景划分后样本量够不够', status: 'resolved' },
    ],
    related: [{ kind: 'manuscript', id: 'm1' }, { kind: 'action', id: 'a1' }],
    materials: [{ id: 'mat1', url: 'https://example.com/notes.pdf', title: '推导笔记' }],
    updatedAt: '2026-11-15T08:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

describe('问题条目与状态', () => {
  it('只认三种问题状态，不认识的值按待解算', () => {
    expect(model.STATUSES).toEqual(['open', 'investigating', 'resolved'])
    expect(model.statusOf({ status: 'resolved' })).toBe('resolved')
    expect(model.statusOf({ status: 'investigating' })).toBe('investigating')
    expect(model.statusOf({ status: 'closed' })).toBe('open')
    expect(model.statusOf(null)).toBe('open')
    expect(model.statusKey('resolved')).toBe('questionResolved')
    expect(model.statusKey('investigating')).toBe('questionInvestigating')
    expect(model.statusKey('open')).toBe('questionOpen')
  })

  it('空内容、缺 id 的条目不算问题；状态未知按待解计数', () => {
    const questions = model.questionsOf(topic())
    expect(questions.map(question => question.id)).toEqual(['q1', 'q2', 'q3'])
    expect(model.questionCounts(topic())).toEqual({ open: 1, investigating: 1, resolved: 1, total: 3 })
    expect(model.questionsOf(topic({ questions: [{ id: 'q1', text: '   ', status: 'open' }, { text: '缺 id', status: 'open' }, null] }))).toEqual([])
    expect(model.questionCounts({})).toEqual({ open: 0, investigating: 0, resolved: 0, total: 0 })
  })

  it('摘要先看当前判断，再看下一步，最后看研究问题', () => {
    expect(model.summaryOf(topic(), '未知')).toBe('已知功率时有闭式解，未知功率时要迭代')
    expect(model.summaryOf(topic({ judgment: '' }), '未知')).toBe('补一组 8 用户、64 天线的仿真')
    expect(model.summaryOf(topic({ judgment: '', nextStep: '' }), '未知')).toBe('干扰功率未知时还能不能写出闭式检测器')
    expect(model.summaryOf({}, '未知')).toBe('未知')
    expect(model.shownText(topic(), 'goal', '未知')).toBe('给出可复现的推导与仿真口径')
    expect(model.shownText({}, 'goal', '未知')).toBe('未知')
  })
})

describe('引用与回收', () => {
  it('前向引用是 related 加问题里的行动项，按种类与 id 去重', () => {
    expect(model.referencesOf(topic())).toEqual([
      { kind: 'manuscript', id: 'm1' },
      { kind: 'action', id: 'a1' },
    ])
    expect(model.referencesOf({})).toEqual([])
  })

  it('回收站剩几天按三十天算，认不出的时间不给倒计时', () => {
    const now = Date.parse('2026-11-15T00:00:00.000Z')
    expect(model.daysLeft({ deletedAt: '2026-11-15T00:00:00.000Z' }, now)).toBe(30)
    expect(model.daysLeft({ deletedAt: '2026-11-01T00:00:00.000Z' }, now)).toBe(16)
    expect(model.daysLeft({ deletedAt: '2026-10-01T00:00:00.000Z' }, now)).toBe(0)
    expect(model.daysLeft({ deletedAt: 'not-a-time' }, now)).toBeNull()
    expect(model.daysLeft({}, now)).toBeNull()
  })
})

describe('视图过滤', () => {
  it('活跃不含归档与回收站；归档与回收站各自只看自己', () => {
    const active = topic({ id: 't1' })
    const archived = topic({ id: 't2', archived: true })
    const trashed = topic({ id: 't3', deletedAt: '2026-11-14T00:00:00.000Z' })
    const rows = [active, archived, trashed]
    expect(model.viewRows(rows, 'active').map(entry => entry.id)).toEqual(['t1'])
    expect(model.viewRows(rows, 'archived').map(entry => entry.id)).toEqual(['t2'])
    expect(model.viewRows(rows, 'trash').map(entry => entry.id)).toEqual(['t3'])
  })

  it('按最近更新从新到旧', () => {
    const older = topic({ id: 't1', updatedAt: '2026-11-10T00:00:00.000Z' })
    const newer = topic({ id: 't2', updatedAt: '2026-11-15T00:00:00.000Z' })
    expect(model.viewRows([older, newer], 'active').map(entry => entry.id)).toEqual(['t2', 't1'])
  })
})

describe('可保存的问题表', () => {
  it('整行空内容丢掉，状态归一，actionId 只留字符串', () => {
    expect(model.cleanQuestions([
      { id: 'q1', text: '  第一个问题  ', status: 'investigating', actionId: 'a1' },
      { id: 'q2', text: '', status: 'open' },
      { id: 'q3', text: '第三个问题', status: 'closed', actionId: '' },
    ])).toEqual([
      { id: 'q1', text: '第一个问题', status: 'investigating', actionId: 'a1' },
      { id: 'q3', text: '第三个问题', status: 'open' },
    ])
  })

  it('缺 id、id 重复或文字超长时整表不保存', () => {
    expect(model.cleanQuestions([{ text: '没有 id', status: 'open' }])).toBeNull()
    expect(model.cleanQuestions([{ id: 'q1', text: '重复', status: 'open' }, { id: 'q1', text: '再来', status: 'open' }])).toBeNull()
    expect(model.cleanQuestions([{ id: 'q1', text: '字'.repeat(model.QUESTION_TEXT + 1), status: 'open' }])).toBeNull()
    expect(model.cleanQuestions(Array.from({ length: model.MAX_QUESTIONS + 1 }, (_, index) => ({ id: `q${String(index)}`, text: '问题', status: 'open' })))).toBeNull()
  })

  it('上限之内、长度以内可以保存', () => {
    expect(model.cleanQuestions([{ id: 'q1', text: '字'.repeat(model.QUESTION_TEXT), status: 'open' }])).toHaveLength(1)
    expect(model.cleanQuestions(Array.from({ length: model.MAX_QUESTIONS }, (_, index) => ({ id: `q${String(index)}`, text: '问题', status: 'open' })))).toHaveLength(model.MAX_QUESTIONS)
    expect(model.cleanQuestions([])).toEqual([])
  })
})

describe('材料与占位符', () => {
  it('材料地址只收 http/https 的完整地址，说明不能为空', () => {
    expect(model.materialValid('https://example.com/notes.pdf', '推导笔记')).toBe(true)
    expect(model.materialValid('http://example.com/notes.pdf', '推导笔记')).toBe(true)
    expect(model.materialValid('javascript:alert(1)', '推导笔记')).toBe(false)
    expect(model.materialValid('https://example.com/notes.pdf', '  ')).toBe(false)
    expect(model.openableUrl('https://example.com/run/42')).toBe(true)
    expect(model.openableUrl('')).toBe(false)
  })

  it('文案占位符全部替换', () => {
    expect(model.fill('最近 {n} 条 · 共 {total} 条', { n: 3, total: 8 })).toBe('最近 3 条 · 共 8 条')
  })
})

describe('样例与清单', () => {
  it('s 与 l 两个尺寸族都有样例', () => {
    const samples = JSON.parse(readFileSync(new URL('../../widgets/topic-records/samples.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(Object.keys(samples).sort()).toEqual(['l', 'm'])
  })

  it('清单声明记录能力，文案键与 copy.js 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/topic-records/widget.json', import.meta.url), 'utf8')) as {
      id: string
      source: string
      capabilities: string[]
      scripts: string[]
      text: Record<string, unknown>
    }
    expect(manifest.id).toBe('topic-records')
    expect(manifest.source).toBe('widget-board:records')
    expect(manifest.capabilities).toEqual([
      'widget-board:records.read',
      'widget-board:records.write',
      'widget-board:records.draft',
      'widget-board:records.open',
    ])
    expect(manifest.scripts).toContain('topic-model.js')
    expect(Object.keys(manifest.text).sort()).toEqual(Object.keys(copy).sort())
  })
})
