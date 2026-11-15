/**
 * 课题问题条目的字段校验：稳定 id、内容、状态与可选行动项引用。
 *
 * 问题是否解决由用户填写；转成行动项只记来源与条目 id，不因为行动项完成而改问题状态。
 */
import type { TopicQuestion, TopicQuestionStatus } from '@dsh-scholar-board/contracts'
import { RECORDS_LIMITS } from '@dsh-scholar-board/contracts'
import { isRecord } from '../guards'
import { fail, idItemsOf, titleOf } from './fields'

/** 问题的三种状态。 */
export const TOPIC_QUESTION_STATUSES: readonly TopicQuestionStatus[] = ['open', 'investigating', 'resolved']

/**
 * 一个问题条目：内容必填，状态只认三种，行动项引用可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 条目表；未填时是 `null`。
 */
export function topicQuestionsOf(value: unknown, field: string): TopicQuestion[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.topicQuestions, '对象')
  if (rows === null) return null
  const seen = new Set<string>()
  return rows.map((entry, index) => {
    const at = `${field}[${String(index)}]`
    const text = titleOf(entry.text, `${at}.text`)
    if ([...text].length > RECORDS_LIMITS.topicQuestionText) fail(`${at}.text 最多 ${String(RECORDS_LIMITS.topicQuestionText)} 个字符`)
    if (typeof entry.status !== 'string' || !TOPIC_QUESTION_STATUSES.includes(entry.status as TopicQuestionStatus)) {
      fail(`${at}.status 只能是 ${TOPIC_QUESTION_STATUSES.join('、')}`)
    }
    if (entry.actionId !== undefined && entry.actionId !== null) {
      if (typeof entry.actionId !== 'string' || entry.actionId === '' || entry.actionId.length > 64) fail(`${at}.actionId 不合法`)
      if (seen.has(entry.actionId)) fail(`${field} 里的 actionId 重复`)
      seen.add(entry.actionId)
    }
    return {
      id: entry.id as string,
      text,
      status: entry.status as TopicQuestionStatus,
      ...(entry.actionId === undefined || entry.actionId === null ? {} : { actionId: entry.actionId }),
    }
  })
}

/**
 * 课题的问题表：形状、状态与 id 唯一。
 *
 * @param value - 一条记录。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
export function topicArraysProblem(value: Record<string, unknown>): string | null {
  const questions = value.questions
  if (questions === undefined) return null
  if (!Array.isArray(questions)) return 'questions 不是数组'
  const ids = new Set<string>()
  for (const entry of questions as unknown[]) {
    if (!isRecord(entry)) return 'questions 的条目不合法'
    if (typeof entry.id !== 'string' || entry.id === '') return 'questions 的条目缺少 id'
    if (ids.has(entry.id)) return 'questions 的 id 重复'
    ids.add(entry.id)
    if (typeof entry.text !== 'string' || entry.text.trim() === '') return 'questions 的条目缺少内容'
    if (typeof entry.status !== 'string' || !TOPIC_QUESTION_STATUSES.includes(entry.status as TopicQuestionStatus)) return 'questions 的 status 不认识'
    if (entry.actionId !== undefined && entry.actionId !== null && (typeof entry.actionId !== 'string' || entry.actionId === '')) return 'questions 的 actionId 不合法'
  }
  return null
}
