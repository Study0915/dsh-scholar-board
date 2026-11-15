/**
 * 行动的来源：会议、稿件、课题或文献里的一条。
 *
 * 写进来的值不合法时直接拒绝；读盘时只报告问题，不抛出。
 */
import { isRecord } from '../guards'
import { fail } from './fields'

/** 行动能挂靠的记录类型。 */
export const ACTION_SOURCE_KINDS = ['meeting', 'manuscript', 'topic', 'literature'] as const
export type ActionSourceKind = (typeof ACTION_SOURCE_KINDS)[number]

/** 来源字段的规范化结果；未出现的字段不覆盖。 */
export interface ActionSourceFields {
  source?: { kind: ActionSourceKind, id: string } | null
  sourceEntry?: string | null
}

function isActionSourceKind(value: unknown): value is ActionSourceKind {
  return typeof value === 'string' && (ACTION_SOURCE_KINDS as readonly string[]).includes(value)
}

/**
 * 规范化 `source` 与 `sourceEntry`。
 *
 * @param input - 外来字段。
 * @param requireEntry - 新建行动时为真：课题与文献来源要写明条目。
 * @returns 规范化后的来源字段。
 */
export function actionSourceOf(input: Record<string, unknown>, requireEntry: boolean): ActionSourceFields {
  const out: ActionSourceFields = {}
  if (input.source !== undefined) {
    if (input.source === null) out.source = null
    else {
      if (!isRecord(input.source) || typeof input.source.id !== 'string' || input.source.id === '' || input.source.id.length > 64) fail('source 要写成 { kind, id }')
      if (!isActionSourceKind(input.source.kind)) fail(`source.kind 只能是 ${ACTION_SOURCE_KINDS.join('、')}`)
      out.source = { kind: input.source.kind, id: input.source.id }
    }
  }
  if (input.sourceEntry !== undefined) {
    if (input.sourceEntry === null) out.sourceEntry = null
    else if (typeof input.sourceEntry !== 'string' || input.sourceEntry === '' || input.sourceEntry.length > 64) fail('sourceEntry 不合法')
    else out.sourceEntry = input.sourceEntry
  }
  if (requireEntry && isRecord(out.source)
    && (out.source.kind === 'topic' || out.source.kind === 'literature') && out.sourceEntry === undefined) {
    fail('来源是课题或文献时要写明条目 sourceEntry')
  }
  return out
}

/**
 * 落盘行动的来源形状；读取旧文件时只报问题，不抛出。
 *
 * @param value - 存储里的行动记录。
 * @returns 问题说明；通过时是 `null`。
 */
export function actionSourceProblem(value: Record<string, unknown>): string | null {
  if (value.source !== undefined) {
    if (!isRecord(value.source) || typeof value.source.id !== 'string' || value.source.id === '') return 'source 不合法'
    if (!isActionSourceKind(value.source.kind)) return 'source.kind 不认识'
  }
  if (value.sourceEntry !== undefined && (typeof value.sourceEntry !== 'string' || value.sourceEntry === '')) return 'sourceEntry 不合法'
  if (isRecord(value.source) && (value.source.kind === 'topic' || value.source.kind === 'literature') && typeof value.sourceEntry !== 'string') return '来源缺少条目'
  return null
}
