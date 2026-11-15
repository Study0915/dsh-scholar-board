/**
 * 结论依据的校验：引用类型、id、引用时的修订号，以及可选的条目、材料与摘要。
 *
 * 修订号是引用那一刻记录自己的 revision；0 表示引用时来源已经缺失，界面据此提示。
 */
import type { EvidenceRef, RecordKind } from '@dsh-scholar-board/contracts'
import { RECORDS_LIMITS, RELATION_KINDS } from '@dsh-scholar-board/contracts'
import { isRecord } from '../guards'
import { fail } from './fields'

/** 证据摘要的上限与修回文字共用一档。 */
const SUMMARY_LIMIT = RECORDS_LIMITS.revisionText

function textWithin(value: unknown, field: string, limit: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') fail(`${field} 要是文字`)
  const wanted = value.trim()
  if (wanted === '') return null
  if ([...wanted].length > limit) fail(`${field} 最多 ${String(limit)} 个字符`)
  return wanted
}

/**
 * 结论依据的摘要与适用边界：与证据摘要同一档长度。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 去空白之后的文字；未填时是 `null`。
 */
export function evidenceTextOf(value: unknown, field: string): string | null {
  return textWithin(value, field, SUMMARY_LIMIT)
}

function keyOf(ref: EvidenceRef): string {
  return `${ref.kind}:${ref.id}:${ref.entryId ?? ''}:${ref.materialId ?? ''}`
}

function evidenceOfOne(value: unknown, field: string): EvidenceRef {
  if (!isRecord(value)) fail(`${field} 要写成 { kind, id, revision }`)
  if (typeof value.kind !== 'string' || !RELATION_KINDS.includes(value.kind as RecordKind)) fail(`${field}.kind 不认识`)
  if (typeof value.id !== 'string' || value.id === '' || value.id.length > 64) fail(`${field}.id 不合法`)
  if (!Number.isInteger(value.revision) || (value.revision as number) < 0) fail(`${field}.revision 要是非负整数`)
  const entryId = textWithin(value.entryId, `${field}.entryId`, 64)
  const materialId = textWithin(value.materialId, `${field}.materialId`, 64)
  const summary = textWithin(value.summary, `${field}.summary`, SUMMARY_LIMIT)
  return {
    kind: value.kind as RecordKind,
    id: value.id,
    revision: value.revision as number,
    ...(entryId === null ? {} : { entryId }),
    ...(materialId === null ? {} : { materialId }),
    ...(summary === null ? {} : { summary }),
  }
}

/**
 * 结论依据：最多五十条，同一记录、条目与材料的组合不重复。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 证据表；未填时是 `null`。
 */
export function evidenceOf(value: unknown, field: string): EvidenceRef[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail(`${field} 要是数组`)
  if (value.length > RECORDS_LIMITS.evidence) fail(`${field} 最多 ${String(RECORDS_LIMITS.evidence)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const ref = evidenceOfOne(entry, `${field}[${String(index)}]`)
    const key = keyOf(ref)
    if (seen.has(key)) fail(`${field} 里的引用重复`)
    seen.add(key)
    return ref
  })
}

/**
 * 落盘记录的结论依据形状；读取旧文件时只报问题，不抛出。
 *
 * @param value - 存储里的证据表。
 * @returns 问题说明；通过时是 `null`。
 */
export function evidenceProblem(value: unknown): string | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) return 'conclusionEvidence 不是数组'
  if (value.length > RECORDS_LIMITS.evidence) return 'conclusionEvidence 超过上限'
  const seen = new Set<string>()
  for (const entry of value as unknown[]) {
    if (!isRecord(entry) || typeof entry.kind !== 'string' || !RELATION_KINDS.includes(entry.kind as RecordKind)) return 'conclusionEvidence 的类型不合法'
    if (typeof entry.id !== 'string' || entry.id === '') return 'conclusionEvidence 的 id 不合法'
    if (!Number.isInteger(entry.revision) || (entry.revision as number) < 0) return 'conclusionEvidence 的修订号不合法'
    const key = `${entry.kind}:${entry.id}:${typeof entry.entryId === 'string' ? entry.entryId : ''}:${typeof entry.materialId === 'string' ? entry.materialId : ''}`
    if (seen.has(key)) return 'conclusionEvidence 的引用重复'
    seen.add(key)
  }
  return null
}