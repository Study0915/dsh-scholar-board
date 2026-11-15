import type { DomainRecord, RecordRef } from './records'

/**
 * 一条记录显式持有的前向引用；关系查询与来源展示共用。
 *
 * @param record - 领域记录。
 * @returns 去重后的引用，不改变原记录。
 */
export function recordReferences(record: DomainRecord): RecordRef[] {
  const refs: RecordRef[] = [...(record.related ?? [])]
  if (record.kind === 'action' && record.source !== undefined) refs.push(record.source)
  if (record.kind === 'meeting' && record.derivedFrom !== undefined) refs.push({ kind: 'meeting', id: record.derivedFrom })
  if (record.kind === 'thesis') {
    for (const result of record.results ?? []) refs.push({ kind: result.kind, id: result.recordId })
  }
  const seen = new Set<string>()
  return refs.filter(ref => {
    const key = `${ref.kind}:${ref.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
