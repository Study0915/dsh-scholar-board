import type { DomainRecord, RecordRef } from './records'

/**
 * 一条记录显式持有的前向引用；关系查询与来源展示共用。
 *
 * @param record - 领域记录。
 * @returns 去重后的引用，不改变原记录。
 */
export function recordReferences(record: DomainRecord): RecordRef[] {
  const refs: RecordRef[] = record.kind === 'member' ? [] : [...(record.related ?? [])]
  const memberRefs = (ids: readonly string[] | undefined): void => {
    for (const id of ids ?? []) refs.push({ kind: 'member', id })
  }
  const assignmentRefs = (entry: { owner?: string, collaborators?: string[], confirmers?: string[] }): void => {
    if (entry.owner !== undefined) refs.push({ kind: 'member', id: entry.owner })
    memberRefs(entry.collaborators)
    memberRefs(entry.confirmers)
  }
  if (record.kind === 'meeting') {
    memberRefs(record.participants)
    if (record.derivedFrom !== undefined) refs.push({ kind: 'meeting', id: record.derivedFrom })
  }
  if (record.kind === 'action') {
    if (record.source !== undefined) refs.push(record.source)
    assignmentRefs(record)
  }
  if (record.kind === 'project') {
    for (const requirement of record.requirements ?? []) {
      for (const source of requirement.sources ?? []) refs.push(source)
      if (requirement.actionId !== undefined) refs.push({ kind: 'action', id: requirement.actionId })
    }
    for (const task of record.tasks ?? []) {
      if (task.actionId !== undefined) refs.push({ kind: 'action', id: task.actionId })
      assignmentRefs(task)
    }
    for (const issue of record.issues ?? []) {
      if (issue.actionId !== undefined) refs.push({ kind: 'action', id: issue.actionId })
    }
    for (const review of record.reviews ?? []) {
      if (review.reviewer !== undefined) refs.push({ kind: 'member', id: review.reviewer })
    }
    for (const handover of record.handovers ?? []) {
      if (handover.receiver !== undefined) refs.push({ kind: 'member', id: handover.receiver })
    }
  }
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
