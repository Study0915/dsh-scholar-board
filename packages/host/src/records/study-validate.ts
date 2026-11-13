/**
 * 研究生课程与其他事务的字段校验：学期、作业考试、学习笔记、自定义类别与期限。
 *
 * 课程只记形状、状态与上限，不算学分、不校验培养规则；其他事务复用同一套日期语义。
 */
import type {
  ChoreStatus,
  CourseTerm,
  CourseWork,
  CourseWorkKind,
  CourseWorkStatus,
} from '@dsh-scholar-board/contracts'
import { RECORDS_LIMITS } from '@dsh-scholar-board/contracts'
import { isRecord } from '../guards'
import { dueOf, extrasOf, fail, idItemsOf, textOf, titleOf } from './fields'

/** 作业与考试的三种状态。 */
export const COURSE_WORK_STATUSES: readonly CourseWorkStatus[] = ['todo', 'doing', 'done']

/** 作业与考试的两种类型。 */
export const COURSE_WORK_KINDS: readonly CourseWorkKind[] = ['assignment', 'exam']

/** 其他事务的四种状态。 */
export const CHORE_STATUSES: readonly ChoreStatus[] = ['todo', 'doing', 'done', 'cancelled']

/**
 * 一段有长度上限的必填名称：学期名与类别都短。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @param limit - 上限。
 * @returns 去空白之后的名称。
 */
function labelOf(value: unknown, field: string, limit: number): string {
  const wanted = titleOf(value, field)
  if ([...wanted].length > limit) fail(`${field} 最多 ${String(limit)} 个字符`)
  return wanted
}

/**
 * 学期：名称必填，起止可留空；起止只收日期，不收时刻。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 学期。
 */
export function courseTermOf(value: unknown, field: string): CourseTerm {
  if (!isRecord(value)) fail(`${field} 要写成 { label, start?, end? }`)
  const label = labelOf(value.label, `${field}.label`, RECORDS_LIMITS.termLabelLength)
  const start = value.start === undefined ? null : dueOf(value.start, `${field}.start`)
  const end = value.end === undefined ? null : dueOf(value.end, `${field}.end`)
  if (start !== null && start.kind !== 'date') fail(`${field}.start 要写成日期`)
  if (end !== null && end.kind !== 'date') fail(`${field}.end 要写成日期`)
  return {
    label,
    ...(start === null ? {} : { start }),
    ...(end === null ? {} : { end }),
  }
}

/**
 * 作业与考试：类型、标题、状态必填；补交只由 `late` 显式标记。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 条目表；未填时是 `null`。
 */
export function courseWorkOf(value: unknown, field: string): CourseWork[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.courseWork, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    const at = `${field}[${String(index)}]`
    if (typeof entry.kind !== 'string' || !COURSE_WORK_KINDS.includes(entry.kind as CourseWorkKind)) {
      fail(`${at}.kind 只能是 ${COURSE_WORK_KINDS.join('、')}`)
    }
    const title = titleOf(entry.title, `${at}.title`)
    if (typeof entry.status !== 'string' || !COURSE_WORK_STATUSES.includes(entry.status as CourseWorkStatus)) {
      fail(`${at}.status 只能是 ${COURSE_WORK_STATUSES.join('、')}`)
    }
    if (entry.late !== undefined && typeof entry.late !== 'boolean') fail(`${at}.late 要是布尔值`)
    return {
      id: entry.id as string,
      kind: entry.kind as CourseWorkKind,
      title,
      status: entry.status as CourseWorkStatus,
      ...(entry.late === true ? { late: true } : {}),
      ...extrasOf(entry, at),
    }
  })
}

/**
 * 一门课的工作条目：形状、类型、状态与 id 唯一。
 *
 * @param value - 一条记录。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
export function courseArraysProblem(value: Record<string, unknown>): string | null {
  const work = value.work
  if (work === undefined) return null
  if (!Array.isArray(work)) return 'work 不是数组'
  const ids = new Set<string>()
  for (const entry of work as unknown[]) {
    if (!isRecord(entry)) return 'work 的条目不合法'
    if (typeof entry.id !== 'string' || entry.id === '') return 'work 的条目缺少 id'
    if (ids.has(entry.id)) return 'work 的 id 重复'
    ids.add(entry.id)
    if (typeof entry.kind !== 'string' || !COURSE_WORK_KINDS.includes(entry.kind as CourseWorkKind)) return 'work 的 kind 不认识'
    if (typeof entry.title !== 'string' || entry.title === '') return 'work 的条目缺少标题'
    if (typeof entry.status !== 'string' || !COURSE_WORK_STATUSES.includes(entry.status as CourseWorkStatus)) return 'work 的 status 不认识'
    if (entry.due !== undefined && !isRecord(entry.due)) return 'work 的 due 不合法'
    if (entry.late !== undefined && typeof entry.late !== 'boolean') return 'work 的 late 不合法'
  }
  return null
}

/** 自定义类别：必填，去空白后不超过上限。 */
export function categoryOf(value: unknown): string {
  const category = titleOf(value, 'category')
  if ([...category].length > RECORDS_LIMITS.categoryLength) fail(`category 最多 ${String(RECORDS_LIMITS.categoryLength)} 个字符`)
  return category
}

/** 其他事务的状态。 */
export function choreStatusOf(value: unknown): ChoreStatus {
  if (typeof value !== 'string' || !CHORE_STATUSES.includes(value as ChoreStatus)) {
    fail(`status 只能是 ${CHORE_STATUSES.join('、')}`)
  }
  return value as ChoreStatus
}
