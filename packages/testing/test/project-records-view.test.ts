/**
 * 横向项目卡的判定：负责事项、交付物版本、沟通结论、验收节点、待确认问题、视图过滤与材料地址。
 *
 * `project-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片
 * 真正在用的实现。审批与经费不在默认模板里，这里也不判断合同履约。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/project-records/project-model.js'
import '../../widgets/project-records/copy.js'

interface ProjectModel {
  KIND: string
  TASK_STATUSES: string[]
  DELIVERABLE_STATUSES: string[]
  MILESTONE_STATUSES: string[]
  ISSUE_STATUSES: string[]
  RELATED_KINDS: string[]
  MAX_ITEMS: number
  MAX_MILESTONES: number
  LABEL_LENGTH: number
  VERSION_LENGTH: number
  TITLE_LENGTH: number
  taskKey(status: unknown): string
  deliverableKey(status: unknown): string
  milestoneKey(status: unknown): string
  issueKey(status: unknown): string
  relatedKey(kind: unknown): string
  isTaskStatus(status: unknown): boolean
  isDeliverableStatus(status: unknown): boolean
  isIssueStatus(status: unknown): boolean
  isRelatedKind(kind: unknown): boolean
  textOf(value: unknown): string
  dateValue(text: unknown, timeZone?: string): unknown
  dateInputOf(due: unknown): string
  tasksOf(record: unknown): Array<Record<string, unknown>>
  deliverablesOf(record: unknown): Array<Record<string, unknown>>
  communicationsOf(record: unknown): Array<Record<string, unknown>>
  milestonesOf(record: unknown): Array<Record<string, unknown>>
  issuesOf(record: unknown): Array<Record<string, unknown>>
  relatedOf(record: unknown): Array<Record<string, unknown>>
  openTasks(record: unknown): number
  openIssues(record: unknown): number
  nextMilestone(record: unknown): Record<string, unknown> | null
  milestoneLine(milestone: unknown, text: { t: (key: string) => string }): string
  summaryLine(record: unknown, text: { t: (key: string) => string }): string
  deliverableLine(deliverable: unknown, text: { t: (key: string) => string }): string
  daysLeft(record: unknown, now?: number): number | null
  viewRows(records: unknown, view: string): Array<Record<string, unknown>>
  cleanTasks(rows: unknown): Array<Record<string, unknown>> | null
  cleanDeliverables(rows: unknown): Array<Record<string, unknown>> | null
  cleanCommunications(rows: unknown): Array<Record<string, unknown>> | null
  cleanMilestones(rows: unknown): Array<Record<string, unknown>> | null
  cleanIssues(rows: unknown): Array<Record<string, unknown>> | null
  materialValid(url: unknown, title: unknown): boolean
  openableUrl(url: unknown): boolean
  fill(text: string, values: Record<string, unknown>): string
}

const model = (globalThis as unknown as { ProjectRecords: ProjectModel }).ProjectRecords
const copy = (globalThis as unknown as { ProjectRecordsCopy: Record<string, unknown> }).ProjectRecordsCopy
const text = { t: (key: string) => key }

/** 一条横向项目记录。 */
function project(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    kind: 'project',
    title: '低轨星座干扰抑制模块合作',
    summary: '为合作方整理干扰抑制模块的可复现实验与阶段交付。',
    tasks: [
      { id: 'p1', title: '搭建链路级仿真', status: 'doing', due: { kind: 'date', date: '2026-11-20', timeZone: 'Asia/Shanghai' } },
      { id: 'p2', title: '整理月度进展', status: 'todo' },
      { id: 'p3', title: '已完成的联调', status: 'done' },
    ],
    deliverables: [
      { id: 'd1', name: '仿真代码包', version: 'v0.3', status: 'delivered' },
      { id: 'd2', name: '阶段报告', version: '草案 1', status: 'draft' },
    ],
    communications: [
      { id: 'n1', summary: '确认本月只做单小区场景', at: { kind: 'date', date: '2026-11-05', timeZone: 'Asia/Shanghai' } },
    ],
    milestones: [
      { id: 'm1', label: '第一次阶段评审', status: 'todo', due: { kind: 'date', date: '2026-12-01', timeZone: 'Asia/Shanghai' } },
      { id: 'm2', label: '启动会', status: 'done' },
      { id: 'm3', label: '最终验收', status: 'todo' },
    ],
    issues: [
      { id: 'i1', title: '测试数据的使用范围待确认', status: 'open' },
      { id: 'i2', title: '日志格式已对齐', status: 'resolved' },
    ],
    related: [{ kind: 'meeting', id: 'meeting-1' }, { kind: 'action', id: 'action-1' }, { kind: 'research', id: 'research-1' }],
    materials: [{ id: 'pm1', url: 'https://example.com/brief', title: '需求摘要' }],
    updatedAt: '2026-11-12T08:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

describe('状态与缺失内容的说法', () => {
  it('只认事项、交付物、节点、问题与关联记录的固定集合', () => {
    expect(model.KIND).toBe('project')
    expect(model.TASK_STATUSES).toEqual(['todo', 'doing', 'blocked', 'done'])
    expect(model.DELIVERABLE_STATUSES).toEqual(['draft', 'review', 'delivered', 'accepted'])
    expect(model.MILESTONE_STATUSES).toEqual(['todo', 'doing', 'done'])
    expect(model.ISSUE_STATUSES).toEqual(['open', 'doing', 'resolved'])
    expect(model.RELATED_KINDS).toEqual(['meeting', 'action', 'manuscript'])
    expect(model.taskKey('doing')).toBe('taskDoing')
    expect(model.taskKey('blocked')).toBe('taskBlocked')
    expect(model.taskKey('done')).toBe('taskDone')
    expect(model.taskKey('other')).toBe('taskTodo')
    expect(model.deliverableKey('review')).toBe('deliverableReview')
    expect(model.deliverableKey('delivered')).toBe('deliverableDelivered')
    expect(model.deliverableKey('accepted')).toBe('deliverableAccepted')
    expect(model.deliverableKey('other')).toBe('deliverableDraft')
    expect(model.milestoneKey('doing')).toBe('itemDoing')
    expect(model.milestoneKey('done')).toBe('itemDone')
    expect(model.milestoneKey('other')).toBe('itemTodo')
    expect(model.issueKey('doing')).toBe('issueDoing')
    expect(model.issueKey('resolved')).toBe('issueResolved')
    expect(model.issueKey('other')).toBe('issueOpen')
    expect(model.relatedKey('meeting')).toBe('relatedMeeting')
    expect(model.relatedKey('action')).toBe('relatedAction')
    expect(model.relatedKey('manuscript')).toBe('relatedManuscript')
    expect(model.isTaskStatus('blocked')).toBe(true)
    expect(model.isTaskStatus('cancelled')).toBe(false)
    expect(model.isDeliverableStatus('accepted')).toBe(true)
    expect(model.isIssueStatus('closed')).toBe(false)
    expect(model.isRelatedKind('research')).toBe(false)
  })

  it('空白文字读成空串，日期输入与记录里的日期互转', () => {
    expect(model.textOf('  仿真  ')).toBe('仿真')
    expect(model.textOf(null)).toBe('')
    expect(model.dateValue('2026-11-20', 'Asia/Shanghai')).toEqual({ kind: 'date', date: '2026-11-20', timeZone: 'Asia/Shanghai' })
    expect(model.dateValue('2026-1-5')).toBeNull()
    expect(model.dateInputOf({ kind: 'date', date: '2026-11-20', timeZone: 'UTC' })).toBe('2026-11-20')
    expect(model.dateInputOf({ kind: 'instant', at: '2026-11-20T09:00:00.000Z' })).toBe('2026-11-20')
    expect(model.dateInputOf(null)).toBe('')
  })
})

describe('事项、交付物、沟通、节点、问题与关联记录', () => {
  it('只挑有 id 与必要字段的条目', () => {
    expect(model.tasksOf(project())).toHaveLength(3)
    expect(model.tasksOf(project({ tasks: [{ id: 'p1', title: ' ', status: 'todo' }, { title: '没有 id' }, null, { id: 'p2', title: '联调', status: 'unknown' }] }))).toHaveLength(0)
    expect(model.deliverablesOf(project())).toHaveLength(2)
    expect(model.deliverablesOf(project({ deliverables: [{ id: 'd1', name: '代码包', status: 'draft' }, { id: 'd2', name: '报告', version: 'v1', status: 'draft' }] }))).toHaveLength(1)
    expect(model.communicationsOf(project())).toHaveLength(1)
    expect(model.communicationsOf(project({ communications: [{ id: 'n1', summary: ' ' }, { id: 'n2', summary: '沿用上一版' }] }))).toHaveLength(1)
    expect(model.milestonesOf(project())).toHaveLength(3)
    expect(model.milestonesOf(project({ milestones: [{ id: 'm1', label: ' ' }, { id: 'm2', label: '验收' }] }))).toHaveLength(1)
    expect(model.issuesOf(project())).toHaveLength(2)
    expect(model.issuesOf(project({ issues: [{ id: 'i1', title: '待确认', status: 'closed' }, { id: 'i2', title: '日志', status: 'open' }] }))).toHaveLength(1)
    expect(model.relatedOf(project())).toHaveLength(2)
    expect(model.tasksOf(null)).toEqual([])
  })

  it('未完成的事项与问题只数没完成的，缺字段时当空', () => {
    expect(model.openTasks(project())).toBe(2)
    expect(model.openTasks(project({ tasks: [] }))).toBe(0)
    expect(model.openTasks(null)).toBe(0)
    expect(model.openIssues(project())).toBe(1)
    expect(model.openIssues(null)).toBe(0)
  })

  it('最近的验收节点跳过已完成项，有日期的排在没日期的前面', () => {
    expect(model.nextMilestone(project())).toMatchObject({ id: 'm1', label: '第一次阶段评审' })
    const undated = project({ milestones: [{ id: 'm1', label: '最终验收', status: 'todo' }, { id: 'm2', label: '阶段评审', status: 'todo', due: { kind: 'date', date: '2026-12-01' } }] })
    expect(model.nextMilestone(undated)).toMatchObject({ id: 'm2' })
    const done = project({ milestones: [{ id: 'm1', label: '启动会', status: 'done' }] })
    expect(model.nextMilestone(done)).toBeNull()
    expect(model.summaryLine(done, text)).toBe('noMilestone')
  })

  it('节点一行写名称与日期；交付物一行写名称与版本', () => {
    expect(model.milestoneLine({ label: '阶段评审', due: { kind: 'date', date: '2026-12-01' } }, text)).toBe('阶段评审 · 2026-12-01')
    expect(model.milestoneLine({ label: '最终验收' }, text)).toBe('最终验收')
    expect(model.milestoneLine(null, text)).toBe('')
    expect(model.summaryLine(project(), text)).toBe('第一次阶段评审 · 2026-12-01')
    expect(model.deliverableLine({ name: '仿真代码包', version: 'v0.3' }, text)).toBe('仿真代码包 · v0.3')
    expect(model.deliverableLine({ name: '阶段报告' }, text)).toBe('阶段报告 · unknown')
    expect(model.deliverableLine(null, text)).toBe('')
  })
})

describe('视图过滤与排序', () => {
  const rows = [
    project({ id: 'old', updatedAt: '2026-10-01T00:00:00.000Z' }),
    project({ id: 'new', updatedAt: '2026-11-10T00:00:00.000Z' }),
    project({ id: 'archived', archived: true, updatedAt: '2026-11-06T00:00:00.000Z' }),
    project({ id: 'trashed', deletedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z' }),
    project({ id: 'trashed-archived', archived: true, deletedAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' }),
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
    expect(model.viewRows([null, 42, project()], 'active')).toHaveLength(1)
  })
})

describe('保存前的整理', () => {
  it('事项去掉首尾空白，日期与说明可留空；缺标题或状态不认识时整组拒绝', () => {
    expect(model.cleanTasks([
      { id: 'p1', title: ' 搭建仿真 ', status: 'doing', due: '2026-11-20', note: ' 先跑通 ' },
      { id: 'p2', title: '整理进展', status: 'todo', due: null },
    ])).toEqual([
      { id: 'p1', title: '搭建仿真', status: 'doing', due: expect.objectContaining({ kind: 'date', date: '2026-11-20' }), note: '先跑通' },
      { id: 'p2', title: '整理进展', status: 'todo' },
    ])
    expect(model.cleanTasks([{ id: 'p1', title: '', status: 'todo' }])).toBeNull()
    expect(model.cleanTasks([{ id: 'p1', title: '搭建仿真', status: 'cancelled' }])).toBeNull()
    expect(model.cleanTasks([{ id: 'p1', title: 'x'.repeat(model.TITLE_LENGTH + 1), status: 'todo' }])).toBeNull()
    expect(model.cleanTasks([{ id: 'p1', title: '搭建仿真', status: 'todo', due: '2026-1-5' }])).toBeNull()
    expect(model.cleanTasks([])).toEqual([])
  })

  it('交付物要有名称与版本，版本不超过上限，状态只认四种', () => {
    expect(model.cleanDeliverables([
      { id: 'd1', name: ' 仿真代码包 ', version: ' v0.3 ', status: 'delivered' },
      { id: 'd2', name: '阶段报告', version: '草案 1', status: 'draft' },
    ])).toEqual([
      { id: 'd1', name: '仿真代码包', version: 'v0.3', status: 'delivered' },
      { id: 'd2', name: '阶段报告', version: '草案 1', status: 'draft' },
    ])
    expect(model.cleanDeliverables([{ id: 'd1', name: '代码包', status: 'draft' }])).toBeNull()
    expect(model.cleanDeliverables([{ id: 'd1', name: '代码包', version: '', status: 'draft' }])).toBeNull()
    expect(model.cleanDeliverables([{ id: 'd1', name: '代码包', version: 'v'.repeat(model.VERSION_LENGTH + 1), status: 'draft' }])).toBeNull()
    expect(model.cleanDeliverables([{ id: 'd1', name: '代码包', version: 'v1', status: 'sent' }])).toBeNull()
    expect(model.cleanDeliverables(null)).toEqual([])
  })

  it('沟通要有一句话，日期可留空', () => {
    expect(model.cleanCommunications([
      { id: 'n1', summary: ' 确认只做单小区 ', at: '2026-11-05', note: ' 与会议记录一致 ' },
      { id: 'n2', summary: '沿用上一版接口' },
    ])).toEqual([
      { id: 'n1', summary: '确认只做单小区', at: expect.objectContaining({ kind: 'date', date: '2026-11-05' }), note: '与会议记录一致' },
      { id: 'n2', summary: '沿用上一版接口' },
    ])
    expect(model.cleanCommunications([{ id: 'n1', summary: ' ' }])).toBeNull()
    expect(model.cleanCommunications([{ id: 'n1', summary: '结论', at: '不是日期' }])).toBeNull()
  })

  it('节点名称不超过上限，日期留空就不写，日期不完整时拒绝', () => {
    expect(model.cleanMilestones([
      { id: 'm1', label: ' 第一次阶段评审 ', status: 'todo', due: '2026-12-01' },
      { id: 'm2', label: '最终验收', status: 'todo', due: null, note: '等对方通知' },
    ])).toEqual([
      { id: 'm1', label: '第一次阶段评审', status: 'todo', due: expect.objectContaining({ kind: 'date', date: '2026-12-01' }) },
      { id: 'm2', label: '最终验收', status: 'todo', note: '等对方通知' },
    ])
    expect(model.cleanMilestones([{ id: 'm1', label: '', status: 'todo' }])).toBeNull()
    expect(model.cleanMilestones([{ id: 'm1', label: '评审', status: 'todo', due: '2026-12-1' }])).toBeNull()
    expect(model.cleanMilestones([{ id: 'm1', label: 'x'.repeat(model.LABEL_LENGTH + 1), status: 'todo' }])).toBeNull()
    expect(model.cleanMilestones([{ id: 'm1', label: '验收', status: 'done' }])).toEqual([{ id: 'm1', label: '验收', status: 'done' }])
  })

  it('问题要有标题与状态，说明可以没有', () => {
    expect(model.cleanIssues([
      { id: 'i1', title: ' 数据范围待确认 ', status: 'open', note: ' 下周问对方 ' },
    ])).toEqual([{ id: 'i1', title: '数据范围待确认', status: 'open', note: '下周问对方' }])
    expect(model.cleanIssues([{ id: 'i1', title: '', status: 'open' }])).toBeNull()
    expect(model.cleanIssues([{ id: 'i1', title: '待确认', status: 'closed' }])).toBeNull()
    expect(model.cleanIssues([])).toEqual([])
  })
})

describe('回收倒计时、地址与文案', () => {
  it('回收倒计时按三十天算，读不出来的时间不给倒计时', () => {
    const now = Date.parse('2026-11-10T00:00:00.000Z')
    expect(model.daysLeft(project({ deletedAt: '2026-11-01T00:00:00.000Z' }), now)).toBe(21)
    expect(model.daysLeft(project({ deletedAt: '2026-11-10T00:00:00.000Z' }), now)).toBe(30)
    expect(model.daysLeft(project({ deletedAt: '不是时间' }), now)).toBeNull()
    expect(model.daysLeft(project(), now)).toBeNull()
  })

  it('材料只收 http/https 的完整地址，说明不能为空', () => {
    expect(model.materialValid('https://example.com/brief', '需求摘要')).toBe(true)
    expect(model.materialValid('http://example.com', '需求摘要')).toBe(true)
    expect(model.materialValid('file:///etc/passwd', '需求摘要')).toBe(false)
    expect(model.materialValid('javascript:alert(1)', '需求摘要')).toBe(false)
    expect(model.materialValid('https://example.com', '  ')).toBe(false)
    expect(model.openableUrl('https://example.com/run/42')).toBe(true)
    expect(model.openableUrl('')).toBe(false)
  })

  it('文案占位符全部替换', () => {
    expect(model.fill('负责事项 {done}/{total}', { done: 2, total: 5 })).toBe('负责事项 2/5')
  })
})

describe('样例与清单', () => {
  it('s 与 l 两个尺寸族都有样例', () => {
    const samples = JSON.parse(readFileSync(new URL('../../widgets/project-records/samples.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(Object.keys(samples).sort()).toEqual(['l', 'm'])
  })

  it('清单声明记录能力，文案键与 copy.js 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/project-records/widget.json', import.meta.url), 'utf8')) as {
      id: string
      source: string
      capabilities: string[]
      scripts: string[]
      text: Record<string, unknown>
    }
    expect(manifest.id).toBe('project-records')
    expect(manifest.source).toBe('widget-board:records')
    expect(manifest.capabilities).toEqual([
      'widget-board:records.read',
      'widget-board:records.write',
      'widget-board:records.draft',
    ])
    expect(manifest.scripts).toEqual(['project-model.js', 'copy.js', 'view.js', 'rows.js', 'editor.js'])
    expect(Object.keys(manifest.text).sort()).toEqual(Object.keys(copy).sort())
  })
})
