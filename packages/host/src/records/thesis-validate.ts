/**
 * 毕业论文的字段校验：章节、成果来源、待补实验与学位节点。
 *
 * 学位要求由用户维护，这里只校验形状、状态与上限，不预设学校规则，也不判断毕业资格。
 */
import type {
  ThesisChapter,
  ThesisChapterStatus,
  ThesisExperiment,
  ThesisItemStatus,
  ThesisMilestone,
  ThesisResult,
  ThesisResultKind,
} from '@dsh-scholar-board/contracts'
import { RECORDS_LIMITS } from '@dsh-scholar-board/contracts'
import { isRecord } from '../guards'
import { fail, idItemsOf, labeledMilestonesOf, materialsOf, textOf, titledNoteRowsOf, titledRowsOf } from './fields'

/** 毕业论文章节的四种状态。 */
export const THESIS_CHAPTER_STATUSES: readonly ThesisChapterStatus[] = ['planned', 'drafting', 'revising', 'done']

/** 待补实验与学位节点的三种状态。 */
export const THESIS_ITEM_STATUSES: readonly ThesisItemStatus[] = ['todo', 'doing', 'done']

/** 已有成果能指向的两种记录。 */
export const THESIS_RESULT_KINDS: readonly ThesisResultKind[] = ['manuscript', 'research']

/**
 * 章节：标题必填，状态只认四种，问题与说明可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 章节表；未填时是 `null`。
 */
export function chaptersOf(value: unknown, field: string): ThesisChapter[] | null {
  const rows = titledRowsOf(value, field, RECORDS_LIMITS.thesisItems, THESIS_CHAPTER_STATUSES)
  if (rows === null) return null
  return rows.map(({ entry, index, title }) => {
    const question = entry.question === undefined ? null : textOf(entry.question, `${field}[${String(index)}].question`)
    const note = entry.note === undefined ? null : textOf(entry.note, `${field}[${String(index)}].note`)
    return {
      id: entry.id as string,
      title,
      status: entry.status as ThesisChapterStatus,
      ...(question === null ? {} : { question }),
      ...(note === null ? {} : { note }),
    }
  })
}

/**
 * 成果来源：指向一条小论文或研究记录，标题由宿主现取；说明与材料可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 成果表；未填时是 `null`。
 */
export function thesisResultsOf(value: unknown, field: string): ThesisResult[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.thesisItems, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    if (typeof entry.kind !== 'string' || !THESIS_RESULT_KINDS.includes(entry.kind as ThesisResultKind)) {
      fail(`${field}[${String(index)}].kind 只能是 ${THESIS_RESULT_KINDS.join('、')}`)
    }
    if (typeof entry.recordId !== 'string' || entry.recordId === '' || entry.recordId.length > 64) fail(`${field}[${String(index)}].recordId 不合法`)
    const note = entry.note === undefined ? null : textOf(entry.note, `${field}[${String(index)}].note`)
    const materials = entry.materials === undefined ? null : materialsOf(entry.materials, `${field}[${String(index)}].materials`)
    return {
      id: entry.id as string,
      kind: entry.kind as ThesisResultKind,
      recordId: entry.recordId,
      ...(note === null ? {} : { note }),
      ...(materials === null ? {} : { materials }),
    }
  })
}

/**
 * 待补实验：标题必填、状态只认三种，说明可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 实验表；未填时是 `null`。
 */
export function experimentsOf(value: unknown, field: string): ThesisExperiment[] | null {
  const rows = titledNoteRowsOf(value, field, RECORDS_LIMITS.thesisItems, THESIS_ITEM_STATUSES)
  if (rows === null) return null
  return rows.map(({ id, title, status, note }) => ({
    id,
    title,
    status: status as ThesisItemStatus,
    ...(note === undefined ? {} : { note }),
  }))
}

/**
 * 学位节点：名称必填且不预设规则，日期与说明可留空，状态只认三种。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 节点表；未填时是 `null`。
 */
export function thesisMilestonesOf(value: unknown, field: string): ThesisMilestone[] | null {
  const rows = labeledMilestonesOf(value, field, RECORDS_LIMITS.thesisMilestones, THESIS_ITEM_STATUSES)
  if (rows === null) return null
  return rows.map(({ id, label, status, due, note }) => ({
    id,
    label,
    status: status as ThesisItemStatus,
    ...(due === undefined ? {} : { due }),
    ...(note === undefined ? {} : { note }),
  }))
}

/**
 * 毕业论文的四组内嵌条目：形状、状态与 id 唯一。
 *
 * @param value - 一条记录。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
export function thesisArraysProblem(value: Record<string, unknown>): string | null {
  const chapters = value.chapters
  if (chapters !== undefined) {
    if (!Array.isArray(chapters)) return 'chapters 不是数组'
    const ids = new Set<string>()
    for (const entry of chapters as unknown[]) {
      if (!isRecord(entry)) return 'chapters 的条目不合法'
      if (typeof entry.id !== 'string' || entry.id === '') return 'chapters 的条目缺少 id'
      if (ids.has(entry.id)) return 'chapters 的 id 重复'
      ids.add(entry.id)
      if (typeof entry.title !== 'string' || entry.title === '') return 'chapters 的条目缺少标题'
      if (typeof entry.status !== 'string' || !THESIS_CHAPTER_STATUSES.includes(entry.status as ThesisChapterStatus)) return 'chapters 的 status 不认识'
    }
  }
  const results = value.results
  if (results !== undefined) {
    if (!Array.isArray(results)) return 'results 不是数组'
    const ids = new Set<string>()
    for (const entry of results as unknown[]) {
      if (!isRecord(entry)) return 'results 的条目不合法'
      if (typeof entry.id !== 'string' || entry.id === '') return 'results 的条目缺少 id'
      if (ids.has(entry.id)) return 'results 的 id 重复'
      ids.add(entry.id)
      if (typeof entry.kind !== 'string' || !THESIS_RESULT_KINDS.includes(entry.kind as ThesisResultKind)) return 'results 的 kind 不认识'
      if (typeof entry.recordId !== 'string' || entry.recordId === '') return 'results 的条目缺少来源记录'
    }
  }
  const experiments = value.experiments
  if (experiments !== undefined) {
    if (!Array.isArray(experiments)) return 'experiments 不是数组'
    const ids = new Set<string>()
    for (const entry of experiments as unknown[]) {
      if (!isRecord(entry)) return 'experiments 的条目不合法'
      if (typeof entry.id !== 'string' || entry.id === '') return 'experiments 的条目缺少 id'
      if (ids.has(entry.id)) return 'experiments 的 id 重复'
      ids.add(entry.id)
      if (typeof entry.title !== 'string' || entry.title === '') return 'experiments 的条目缺少标题'
      if (typeof entry.status !== 'string' || !THESIS_ITEM_STATUSES.includes(entry.status as ThesisItemStatus)) return 'experiments 的 status 不认识'
    }
  }
  const milestones = value.milestones
  if (milestones !== undefined) {
    if (!Array.isArray(milestones)) return 'milestones 不是数组'
    const ids = new Set<string>()
    for (const entry of milestones as unknown[]) {
      if (!isRecord(entry)) return 'milestones 的条目不合法'
      if (typeof entry.id !== 'string' || entry.id === '') return 'milestones 的条目缺少 id'
      if (ids.has(entry.id)) return 'milestones 的 id 重复'
      ids.add(entry.id)
      if (typeof entry.label !== 'string' || entry.label === '') return 'milestones 的条目缺少名称'
      if (typeof entry.status !== 'string' || !THESIS_ITEM_STATUSES.includes(entry.status as ThesisItemStatus)) return 'milestones 的 status 不认识'
      if (entry.due !== undefined) {
        if (!isRecord(entry.due)) return 'milestones 的 due 不合法'
        const date = entry.due.kind === 'date' && typeof entry.due.date === 'string'
        const instant = entry.due.kind === 'instant' && typeof entry.due.at === 'string'
        if (!date && !instant) return 'milestones 的 due 不合法'
      }
    }
  }
  return null
}
