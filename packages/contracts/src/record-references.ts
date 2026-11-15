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
  if (record.kind === 'topic') {
    for (const question of record.questions ?? []) {
      if (question.actionId !== undefined) refs.push({ kind: 'action', id: question.actionId })
    }
  }
  if (record.kind === 'run') {
    if (record.plan !== undefined) refs.push(record.plan)
    for (const result of record.results ?? []) {
      for (const source of result.sources ?? []) refs.push({ kind: 'run', id: source })
    }
  }
  if (record.kind === 'literature') {
    for (const version of record.versions ?? []) refs.push(version)
  }
  if (record.kind === 'research') {
    for (const evidence of record.conclusionEvidence ?? []) refs.push({ kind: evidence.kind, id: evidence.id })
  }
  if (record.kind === 'manuscript') {
    for (const figure of record.figures ?? []) {
      for (const run of figure.runs ?? []) refs.push(run)
    }
  }
  const seen = new Set<string>()
  return refs.filter(ref => {
    const key = `${ref.kind}:${ref.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
