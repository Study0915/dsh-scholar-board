/** 稿件图表、投稿轮次和修回条目的校验（D36）。 */
import type { FigureKind, ManuscriptFigure, PlotCode, RecordRef, RevisionItem, RevisionStatus, SubmissionDecision, SubmissionRound } from '@dsh-scholar-board/contracts'
import { RECORDS_LIMITS, RELATION_KINDS } from '@dsh-scholar-board/contracts'
import { isRecord } from '../guards'
import { dueOf, fail, materialsOf, textOf, titleOf } from './fields'

/** 图表目录里的两种条目。 */
export const FIGURE_KINDS: readonly FigureKind[] = ['figure', 'table']

/** 投稿轮次的七种结果；拒稿、撤稿与转投都留在历史里。 */
export const SUBMISSION_DECISIONS: readonly SubmissionDecision[] = ['pending', 'minor', 'major', 'accepted', 'rejected', 'withdrawn', 'transferred']

/** 修回事项的四种状态。 */
export const REVISION_STATUSES: readonly RevisionStatus[] = ['todo', 'doing', 'done', 'declined']

/**
 * 图表的编号：去空白后非空，按 Unicode 码点计不超过编号上限。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 去空白之后的编号。
 */
function labelOf(value: unknown, field: string): string {
  if (typeof value !== 'string') fail(`${field} 要是文字`)
  const wanted = value.trim()
  if (wanted === '') fail(`${field} 不能是空的`)
  if ([...wanted].length > RECORDS_LIMITS.figureLabelLength) fail(`${field} 最多 ${String(RECORDS_LIMITS.figureLabelLength)} 个字符`)
  return wanted
}

/**
 * 修回反馈与改动：比标题长，仍受单条记录预算约束。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @param required - 反馈必填；改动可留空。
 * @returns 去空白之后的文字；未填时是 `null`。
 */
function revisionTextOf(value: unknown, field: string, required: boolean): string | null {
  if (value === null) {
    if (required) fail(`${field} 不能是空的`)
    return null
  }
  if (typeof value !== 'string') fail(`${field} 要是文字`)
  const wanted = value.trim()
  if (wanted === '') {
    if (required) fail(`${field} 不能是空的`)
    return null
  }
  if ([...wanted].length > RECORDS_LIMITS.revisionText) fail(`${field} 最多 ${String(RECORDS_LIMITS.revisionText)} 个字符`)
  return wanted
}

/**
 * 图表引用的运行：只收可关联类型里的 run，id 不重复。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 运行引用；未填时是 `null`。
 */
function figureRunsOf(value: unknown, field: string): RecordRef[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail(`${field} 要是数组`)
  if (value.length > RECORDS_LIMITS.figureRuns) fail(`${field} 最多 ${String(RECORDS_LIMITS.figureRuns)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    if (!isRecord(entry) || entry.kind !== 'run') fail(`${field}[${String(index)}] 要写成 { kind: "run", id }`)
    if (typeof entry.id !== 'string' || entry.id === '' || entry.id.length > 64) fail(`${field}[${String(index)}].id 不合法`)
    if (seen.has(entry.id)) fail(`${field} 里的 id 重复`)
    seen.add(entry.id)
    return { kind: 'run', id: entry.id }
  })
}

/**
 * 图表的绘图代码：仓库与提交都可留空，只校验长度。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 代码来源；未填时是 `null`。
 */
function figurePlotOf(value: unknown, field: string): PlotCode | null {
  if (value === null) return null
  if (!isRecord(value)) fail(`${field} 要写成 { repository?, commit? }`)
  const repository = value.repository === undefined ? null : textOf(value.repository, `${field}.repository`)
  const commit = value.commit === undefined ? null : textOf(value.commit, `${field}.commit`)
  if (repository !== null && repository.length > 2048) fail(`${field}.repository 最多 2048 个字符`)
  if (commit !== null && commit.length > 200) fail(`${field}.commit 最多 200 个字符`)
  return {
    ...(repository === null ? {} : { repository }),
    ...(commit === null ? {} : { commit }),
  }
}

/**
 * 图表目录：编号与标题必填，证据材料只收 http/https，条目 id 不重复。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 图表表；未填时是 `null`。
 */
export function figuresOf(value: unknown, field: string): ManuscriptFigure[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail(`${field} 要是数组`)
  if (value.length > RECORDS_LIMITS.figures) fail(`${field} 最多 ${String(RECORDS_LIMITS.figures)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${field}[${String(index)}] 要写成 { id, kind, label, title }`)
    if (typeof entry.id !== 'string' || entry.id === '' || entry.id.length > 64) fail(`${field}[${String(index)}].id 不合法`)
    if (seen.has(entry.id)) fail(`${field} 里的 id 重复`)
    seen.add(entry.id)
    if (typeof entry.kind !== 'string' || !FIGURE_KINDS.includes(entry.kind as FigureKind)) {
      fail(`${field}[${String(index)}].kind 只能是 ${FIGURE_KINDS.join('、')}`)
    }
    const label = labelOf(entry.label, `${field}[${String(index)}].label`)
    const title = titleOf(entry.title, `${field}[${String(index)}].title`)
    const note = entry.note === undefined ? null : textOf(entry.note, `${field}[${String(index)}].note`)
    const materials = entry.materials === undefined ? null : materialsOf(entry.materials, `${field}[${String(index)}].materials`)
    const runs = entry.runs === undefined ? null : figureRunsOf(entry.runs, `${field}[${String(index)}].runs`)
    const plot = entry.plot === undefined ? null : figurePlotOf(entry.plot, `${field}[${String(index)}].plot`)
    const conclusion = entry.conclusion === undefined ? null : textOf(entry.conclusion, `${field}[${String(index)}].conclusion`)
    if (conclusion !== null && [...conclusion].length > RECORDS_LIMITS.revisionText) fail(`${field}[${String(index)}].conclusion 最多 ${String(RECORDS_LIMITS.revisionText)} 个字符`)
    return {
      id: entry.id,
      kind: entry.kind as FigureKind,
      label,
      title,
      ...(note === null ? {} : { note }),
      ...(runs === null ? {} : { runs }),
      ...(plot === null ? {} : { plot }),
      ...(conclusion === null ? {} : { conclusion }),
      ...(materials === null ? {} : { materials }),
    }
  })
}

/**
 * 投稿轮次：刊会必填，结果必填，投稿与决定日期可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 轮次表；未填时是 `null`。
 */
export function submissionsOf(value: unknown, field: string): SubmissionRound[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail(`${field} 要是数组`)
  if (value.length > RECORDS_LIMITS.submissions) fail(`${field} 最多 ${String(RECORDS_LIMITS.submissions)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${field}[${String(index)}] 要写成 { id, venue, decision }`)
    if (typeof entry.id !== 'string' || entry.id === '' || entry.id.length > 64) fail(`${field}[${String(index)}].id 不合法`)
    if (seen.has(entry.id)) fail(`${field} 里的 id 重复`)
    seen.add(entry.id)
    const venue = titleOf(entry.venue, `${field}[${String(index)}].venue`)
    if (typeof entry.decision !== 'string' || !SUBMISSION_DECISIONS.includes(entry.decision as SubmissionDecision)) {
      fail(`${field}[${String(index)}].decision 只能是 ${SUBMISSION_DECISIONS.join('、')}`)
    }
    const submittedAt = entry.submittedAt === undefined ? null : dueOf(entry.submittedAt, `${field}[${String(index)}].submittedAt`)
    const decidedAt = entry.decidedAt === undefined ? null : dueOf(entry.decidedAt, `${field}[${String(index)}].decidedAt`)
    const note = entry.note === undefined ? null : textOf(entry.note, `${field}[${String(index)}].note`)
    return {
      id: entry.id,
      venue,
      decision: entry.decision as SubmissionDecision,
      ...(submittedAt === null ? {} : { submittedAt }),
      ...(decidedAt === null ? {} : { decidedAt }),
      ...(note === null ? {} : { note }),
    }
  })
}

/**
 * 修回事项：反馈必填、必须指向本稿件的一轮投稿，改动与证据可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 修回表；未填时是 `null`。
 */
export function revisionsOf(value: unknown, field: string): RevisionItem[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail(`${field} 要是数组`)
  if (value.length > RECORDS_LIMITS.revisions) fail(`${field} 最多 ${String(RECORDS_LIMITS.revisions)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${field}[${String(index)}] 要写成 { id, roundId, feedback, status }`)
    if (typeof entry.id !== 'string' || entry.id === '' || entry.id.length > 64) fail(`${field}[${String(index)}].id 不合法`)
    if (seen.has(entry.id)) fail(`${field} 里的 id 重复`)
    seen.add(entry.id)
    if (typeof entry.roundId !== 'string' || entry.roundId === '' || entry.roundId.length > 64) fail(`${field}[${String(index)}].roundId 不合法`)
    const feedback = revisionTextOf(entry.feedback, `${field}[${String(index)}].feedback`, true)
    const change = entry.change === undefined ? null : revisionTextOf(entry.change, `${field}[${String(index)}].change`, false)
    if (typeof entry.status !== 'string' || !REVISION_STATUSES.includes(entry.status as RevisionStatus)) {
      fail(`${field}[${String(index)}].status 只能是 ${REVISION_STATUSES.join('、')}`)
    }
    const materials = entry.materials === undefined ? null : materialsOf(entry.materials, `${field}[${String(index)}].materials`)
    return {
      id: entry.id,
      roundId: entry.roundId,
      feedback: feedback as string,
      status: entry.status as RevisionStatus,
      ...(change === null ? {} : { change }),
      ...(materials === null ? {} : { materials }),
    }
  })
}

/**
 * 稿件里三组内嵌条目的形状与互链：修回必须指向本稿件的一轮投稿。
 *
 * @param value - 一条记录。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
export function manuscriptArraysProblem(value: Record<string, unknown>): string | null {
  if (value.figures !== undefined) {
    if (!Array.isArray(value.figures)) return 'figures 不是数组'
    const ids = new Set<string>()
    for (const entry of value.figures as unknown[]) {
      if (!isRecord(entry)) return 'figures 的条目不合法'
      if (typeof entry.id !== 'string' || entry.id === '') return 'figures 的条目缺少 id'
      if (ids.has(entry.id)) return 'figures 的 id 重复'
      ids.add(entry.id)
      if (entry.kind !== 'figure' && entry.kind !== 'table') return 'figures 的 kind 不认识'
      if (typeof entry.label !== 'string' || entry.label === '' || typeof entry.title !== 'string' || entry.title === '') return 'figures 的条目缺少编号或标题'
      if (entry.runs !== undefined && (!Array.isArray(entry.runs) || entry.runs.some((run: unknown) => !isRecord(run) || run.kind !== 'run' || typeof run.id !== 'string' || run.id === ''))) return 'figures 的 runs 不合法'
      if (entry.plot !== undefined && !isRecord(entry.plot)) return 'figures 的 plot 不合法'
      if (entry.conclusion !== undefined && typeof entry.conclusion !== 'string') return 'figures 的 conclusion 不合法'
    }
  }
  const roundIds = new Set<string>()
  if (value.submissions !== undefined) {
    if (!Array.isArray(value.submissions)) return 'submissions 不是数组'
    for (const entry of value.submissions as unknown[]) {
      if (!isRecord(entry)) return 'submissions 的条目不合法'
      if (typeof entry.id !== 'string' || entry.id === '') return 'submissions 的条目缺少 id'
      if (roundIds.has(entry.id)) return 'submissions 的 id 重复'
      roundIds.add(entry.id)
      if (typeof entry.venue !== 'string' || entry.venue === '') return 'submissions 的条目缺少刊会'
      if (typeof entry.decision !== 'string' || !SUBMISSION_DECISIONS.includes(entry.decision as SubmissionDecision)) return 'submissions 的 decision 不认识'
    }
  }
  if (value.revisions !== undefined) {
    if (!Array.isArray(value.revisions)) return 'revisions 不是数组'
    const ids = new Set<string>()
    for (const entry of value.revisions as unknown[]) {
      if (!isRecord(entry)) return 'revisions 的条目不合法'
      if (typeof entry.id !== 'string' || entry.id === '') return 'revisions 的条目缺少 id'
      if (ids.has(entry.id)) return 'revisions 的 id 重复'
      ids.add(entry.id)
      if (typeof entry.roundId !== 'string' || !roundIds.has(entry.roundId)) return '修回事项指向的投稿轮次不存在'
      if (typeof entry.feedback !== 'string' || entry.feedback === '') return 'revisions 的条目缺少反馈'
      if (typeof entry.status !== 'string' || !REVISION_STATUSES.includes(entry.status as RevisionStatus)) return 'revisions 的 status 不认识'
    }
  }
  return null
}
