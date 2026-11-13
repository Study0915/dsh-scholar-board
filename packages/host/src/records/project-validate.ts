/**
 * 横向项目的字段校验：个人负责事项、交付物、沟通结论、验收节点与待确认问题。
 *
 * 这里只认形状、状态与上限，不收合同金额或其他敏感业务细节；审批与经费另行决定。
 */
import type {
  ProjectCommunication,
  ProjectDeliverable,
  ProjectDeliverableStatus,
  ProjectIssue,
  ProjectIssueStatus,
  ProjectItemStatus,
  ProjectMilestone,
  ProjectTask,
} from '@dsh-scholar-board/contracts'
import { RECORDS_LIMITS } from '@dsh-scholar-board/contracts'
import { isRecord } from '../guards'
import { dueOf, extrasOf, fail, idItemsOf, labeledMilestonesOf, textOf, titleOf, titledNoteRowsOf, titledRowsOf } from './fields'

/** 个人负责事项的四种状态。 */
export const PROJECT_TASK_STATUSES: readonly ProjectItemStatus[] = ['todo', 'doing', 'blocked', 'done']

/** 交付物的四种状态。 */
export const PROJECT_DELIVERABLE_STATUSES: readonly ProjectDeliverableStatus[] = ['draft', 'review', 'delivered', 'accepted']

/** 验收节点与问题的状态。 */
export const PROJECT_MILESTONE_STATUSES: readonly ProjectMilestone['status'][] = ['todo', 'doing', 'done']
export const PROJECT_ISSUE_STATUSES: readonly ProjectIssueStatus[] = ['open', 'doing', 'resolved']

/**
 * 个人负责事项：标题必填、状态只认四种，日期、说明与材料可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 事项表；未填时是 `null`。
 */
export function projectTasksOf(value: unknown, field: string): ProjectTask[] | null {
  const rows = titledRowsOf(value, field, RECORDS_LIMITS.projectItems, PROJECT_TASK_STATUSES)
  if (rows === null) return null
  return rows.map(({ entry, index, title }) => ({
    id: entry.id as string,
    title,
    status: entry.status as ProjectItemStatus,
    ...extrasOf(entry, `${field}[${String(index)}]`),
  }))
}

/**
 * 交付物：名称与版本必填、状态只认四种，日期、说明与材料可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 交付物表；未填时是 `null`。
 */
export function projectDeliverablesOf(value: unknown, field: string): ProjectDeliverable[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.projectItems, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    const name = titleOf(entry.name, `${field}[${String(index)}].name`)
    if (typeof entry.version !== 'string' || entry.version.trim() === '') fail(`${field}[${String(index)}].version 不能是空的`)
    const version = entry.version.trim()
    if ([...version].length > RECORDS_LIMITS.versionLength) fail(`${field}[${String(index)}].version 最多 ${String(RECORDS_LIMITS.versionLength)} 个字符`)
    if (typeof entry.status !== 'string' || !PROJECT_DELIVERABLE_STATUSES.includes(entry.status as ProjectDeliverableStatus)) {
      fail(`${field}[${String(index)}].status 只能是 ${PROJECT_DELIVERABLE_STATUSES.join('、')}`)
    }
    return {
      id: entry.id as string,
      name,
      version,
      status: entry.status as ProjectDeliverableStatus,
      ...extrasOf(entry, `${field}[${String(index)}]`),
    }
  })
}

/**
 * 沟通结论：一句话必填，日期与说明可留空；来源会议走 `related`。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 沟通表；未填时是 `null`。
 */
export function projectCommunicationsOf(value: unknown, field: string): ProjectCommunication[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.projectItems, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    const summary = titleOf(entry.summary, `${field}[${String(index)}].summary`)
    const at = entry.at === undefined ? null : dueOf(entry.at, `${field}[${String(index)}].at`)
    const note = entry.note === undefined ? null : textOf(entry.note, `${field}[${String(index)}].note`)
    return {
      id: entry.id as string,
      summary,
      ...(at === null ? {} : { at }),
      ...(note === null ? {} : { note }),
    }
  })
}

/**
 * 验收节点：名称必填且不预设合同规则，日期与说明可留空，状态只认三种。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 节点表；未填时是 `null`。
 */
export function projectMilestonesOf(value: unknown, field: string): ProjectMilestone[] | null {
  const rows = labeledMilestonesOf(value, field, RECORDS_LIMITS.projectMilestones, PROJECT_MILESTONE_STATUSES)
  if (rows === null) return null
  return rows.map(({ id, label, status, due, note }) => ({
    id,
    label,
    status: status as ProjectMilestone['status'],
    ...(due === undefined ? {} : { due }),
    ...(note === undefined ? {} : { note }),
  }))
}

/**
 * 待确认问题：标题必填、状态只认三种，说明可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 问题表；未填时是 `null`。
 */
export function projectIssuesOf(value: unknown, field: string): ProjectIssue[] | null {
  const rows = titledNoteRowsOf(value, field, RECORDS_LIMITS.projectItems, PROJECT_ISSUE_STATUSES)
  if (rows === null) return null
  return rows.map(({ id, title, status, note }) => ({
    id,
    title,
    status: status as ProjectIssueStatus,
    ...(note === undefined ? {} : { note }),
  }))
}

interface ArraySpec {
  field: string
  key: 'title' | 'label' | 'name' | 'summary'
  statuses: readonly string[]
  due: boolean
  version: boolean
}

const ARRAY_SPECS: readonly ArraySpec[] = [
  { field: 'tasks', key: 'title', statuses: PROJECT_TASK_STATUSES, due: true, version: false },
  { field: 'deliverables', key: 'name', statuses: PROJECT_DELIVERABLE_STATUSES, due: true, version: true },
  { field: 'communications', key: 'summary', statuses: [], due: true, version: false },
  { field: 'milestones', key: 'label', statuses: PROJECT_MILESTONE_STATUSES, due: true, version: false },
  { field: 'issues', key: 'title', statuses: PROJECT_ISSUE_STATUSES, due: false, version: false },
]

const KEY_NAMES: Record<ArraySpec['key'], string> = { title: '标题', label: '名称', name: '名称', summary: '结论' }

/**
 * 横向项目的五组内嵌条目：形状、状态与 id 唯一。
 *
 * @param value - 一条记录。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
export function projectArraysProblem(value: Record<string, unknown>): string | null {
  for (const spec of ARRAY_SPECS) {
    const entries = value[spec.field]
    if (entries === undefined) continue
    if (!Array.isArray(entries)) return `${spec.field} 不是数组`
    const ids = new Set<string>()
    for (const entry of entries as unknown[]) {
      if (!isRecord(entry)) return `${spec.field} 的条目不合法`
      if (typeof entry.id !== 'string' || entry.id === '') return `${spec.field} 的条目缺少 id`
      if (ids.has(entry.id)) return `${spec.field} 的 id 重复`
      ids.add(entry.id)
      if (typeof entry[spec.key] !== 'string' || entry[spec.key] === '') return `${spec.field} 的条目缺少${KEY_NAMES[spec.key]}`
      if (spec.statuses.length > 0 && (typeof entry.status !== 'string' || !spec.statuses.includes(entry.status))) return `${spec.field} 的 status 不认识`
      if (spec.version && (typeof entry.version !== 'string' || entry.version === '')) return 'deliverables 的条目缺少版本'
      if (spec.due && entry.due !== undefined && !isRecord(entry.due)) return `${spec.field} 的 due 不合法`
    }
  }
  return null
}
