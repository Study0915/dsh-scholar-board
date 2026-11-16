/** 领域记录的检索文本，供统一查询使用。 */
import type { DomainRecord, ResearchEntry, ManuscriptFigure, RevisionItem, SubmissionRound, CourseWork, MaterialRef, ProjectCommunication, ProjectDeliverable, ProjectIssue, ProjectTask, ThesisChapter, ThesisExperiment, ThesisMilestone, ThesisResult } from '@dsh-scholar-board/contracts'

/** 搜索和展示时要读的文本字段。 */
const TEXT_FIELDS = ['title', 'summary', 'topics', 'feedback', 'openQuestions', 'question', 'goal', 'purpose', 'hypothesis', 'steps', 'judgment', 'nextStep', 'blockers', 'target', 'blockedNote', 'doneNote', 'authors', 'venue', 'understanding', 'questions', 'doi', 'arxivId', 'arxivVersion', 'environment', 'seed', 'evaluation', 'failure', 'conclusion', 'conclusionBasis', 'conclusionScope', 'code', 'teacher', 'schedule', 'notes', 'note', 'category', 'direction'] as const

/**
 * 一条记录的搜索文本：标题与全部短文本字段，材料标题也进来。
 *
 * @param record - 记录。
 * @returns 小写之后的整段文字。
 */
export function searchTextOf(record: DomainRecord): string {
  const entry = record as unknown as Record<string, unknown>
  const parts: string[] = []
  for (const field of TEXT_FIELDS) {
    const value = entry[field]
    if (typeof value === 'string') parts.push(value)
  }
  const materials = entry.materials
  if (Array.isArray(materials)) {
    for (const material of materials as MaterialRef[]) {
      if (typeof material?.title === 'string') parts.push(material.title)
    }
  }
  for (const field of ['parameters', 'metrics', 'checkpoints', 'config'] as const) {
    const entries = entry[field]
    if (!Array.isArray(entries)) continue
    for (const item of entries as ResearchEntry[]) {
      if (typeof item?.name === 'string') parts.push(item.name)
      if (typeof item?.value === 'string') parts.push(item.value)
      if (typeof item?.unit === 'string') parts.push(item.unit)
      if (typeof item?.definition === 'string') parts.push(item.definition)
    }
  }
  if (Array.isArray(entry.datasets)) {
    for (const dataset of entry.datasets as { name?: unknown, split?: unknown, version?: unknown }[]) {
      if (typeof dataset?.name === 'string') parts.push(dataset.name)
      if (typeof dataset?.split === 'string') parts.push(dataset.split)
      if (typeof dataset?.version === 'string') parts.push(dataset.version)
    }
  }
  if (entry.code !== null && typeof entry.code === 'object') {
    for (const field of ['repository', 'commit'] as const) {
      const value = (entry.code as Record<string, unknown>)[field]
      if (typeof value === 'string') parts.push(value)
    }
  }
  if (Array.isArray(entry.artifacts)) {
    for (const material of entry.artifacts as MaterialRef[]) {
      if (typeof material?.title === 'string') parts.push(material.title)
    }
  }
  if (Array.isArray(entry.results)) {
    for (const result of entry.results as { text?: unknown, method?: unknown, dispersion?: unknown }[]) {
      if (typeof result?.text === 'string') parts.push(result.text)
      if (typeof result?.method === 'string') parts.push(result.method)
      if (typeof result?.dispersion === 'string') parts.push(result.dispersion)
    }
  }
  if (Array.isArray(entry.fields)) {
    for (const field of entry.fields as { label?: unknown, note?: unknown, when?: unknown, options?: unknown }[]) {
      if (typeof field?.label === 'string') parts.push(field.label)
      if (typeof field?.note === 'string') parts.push(field.note)
      if (typeof field?.when === 'string') parts.push(field.when)
      if (Array.isArray(field?.options)) parts.push(...field.options.filter((option): option is string => typeof option === 'string'))
    }
  }
  if (entry.template !== null && typeof entry.template === 'object' && Array.isArray((entry.template as { values?: unknown }).values)) {
    for (const value of (entry.template as { values: { label?: unknown, value?: unknown }[] }).values) {
      if (typeof value?.label === 'string') parts.push(value.label)
      if (typeof value?.value === 'string') parts.push(value.value)
    }
  }
  for (const figure of (Array.isArray(entry.figures) ? entry.figures : []) as ManuscriptFigure[]) {
    if (typeof figure?.label === 'string') parts.push(figure.label)
    if (typeof figure?.title === 'string') parts.push(figure.title)
    if (typeof figure?.note === 'string') parts.push(figure.note)
    if (typeof figure?.conclusion === 'string') parts.push(figure.conclusion)
    if (figure?.plot !== null && typeof figure?.plot === 'object') {
      for (const field of ['repository', 'commit'] as const) {
        const value = (figure.plot as Record<string, unknown>)[field]
        if (typeof value === 'string') parts.push(value)
      }
    }
    for (const material of Array.isArray(figure?.materials) ? figure.materials : []) {
      if (typeof material?.title === 'string') parts.push(material.title)
    }
  }
  for (const evidence of (Array.isArray(entry.conclusionEvidence) ? entry.conclusionEvidence : []) as { summary?: unknown }[]) {
    if (typeof evidence?.summary === 'string') parts.push(evidence.summary)
  }
  for (const reading of (Array.isArray(entry.reading) ? entry.reading : []) as { location?: unknown, note?: unknown, understanding?: unknown, questions?: unknown, reproduce?: unknown }[]) {
    for (const field of ['location', 'note', 'understanding', 'questions', 'reproduce'] as const) {
      const value = reading?.[field]
      if (typeof value === 'string') parts.push(value)
    }
  }
  for (const round of (Array.isArray(entry.submissions) ? entry.submissions : []) as SubmissionRound[]) {
    if (typeof round?.venue === 'string') parts.push(round.venue)
    if (typeof round?.note === 'string') parts.push(round.note)
    for (const check of Array.isArray(round?.checklist) ? round.checklist : []) {
      if (typeof check?.label === 'string') parts.push(check.label)
      if (typeof check?.version === 'string') parts.push(check.version)
    }
  }
  for (const revision of (Array.isArray(entry.revisions) ? entry.revisions : []) as RevisionItem[]) {
    for (const field of ['reviewer', 'commentNo', 'feedback', 'location', 'change', 'reply', 'reason'] as const) {
      const value = revision?.[field]
      if (typeof value === 'string') parts.push(value)
    }
    for (const material of Array.isArray(revision?.materials) ? revision.materials : []) {
      if (typeof material?.title === 'string') parts.push(material.title)
    }
  }
  for (const chapter of (Array.isArray(entry.chapters) ? entry.chapters : []) as ThesisChapter[]) {
    if (typeof chapter?.title === 'string') parts.push(chapter.title)
    if (typeof chapter?.question === 'string') parts.push(chapter.question)
    if (typeof chapter?.note === 'string') parts.push(chapter.note)
  }
  for (const result of (Array.isArray(entry.results) ? entry.results : []) as ThesisResult[]) {
    if (typeof result?.note === 'string') parts.push(result.note)
    for (const material of Array.isArray(result?.materials) ? result.materials : []) {
      if (typeof material?.title === 'string') parts.push(material.title)
    }
  }
  for (const experiment of (Array.isArray(entry.experiments) ? entry.experiments : []) as ThesisExperiment[]) {
    if (typeof experiment?.title === 'string') parts.push(experiment.title)
    if (typeof experiment?.note === 'string') parts.push(experiment.note)
    if (typeof experiment?.plan === 'string') parts.push(experiment.plan)
  }
  for (const milestone of (Array.isArray(entry.milestones) ? entry.milestones : []) as ThesisMilestone[]) {
    if (typeof milestone?.label === 'string') parts.push(milestone.label)
    if (typeof milestone?.note === 'string') parts.push(milestone.note)
  }
  for (const task of (Array.isArray(entry.tasks) ? entry.tasks : []) as ProjectTask[]) {
    if (typeof task?.title === 'string') parts.push(task.title)
    if (typeof task?.note === 'string') parts.push(task.note)
    for (const material of Array.isArray(task?.materials) ? task.materials : []) {
      if (typeof material?.title === 'string') parts.push(material.title)
    }
  }
  for (const deliverable of (Array.isArray(entry.deliverables) ? entry.deliverables : []) as ProjectDeliverable[]) {
    if (typeof deliverable?.name === 'string') parts.push(deliverable.name)
    if (typeof deliverable?.version === 'string') parts.push(deliverable.version)
    if (typeof deliverable?.note === 'string') parts.push(deliverable.note)
    for (const material of Array.isArray(deliverable?.materials) ? deliverable.materials : []) {
      if (typeof material?.title === 'string') parts.push(material.title)
    }
  }
  for (const communication of (Array.isArray(entry.communications) ? entry.communications : []) as ProjectCommunication[]) {
    if (typeof communication?.summary === 'string') parts.push(communication.summary)
    if (typeof communication?.note === 'string') parts.push(communication.note)
  }
  for (const issue of (Array.isArray(entry.issues) ? entry.issues : []) as ProjectIssue[]) {
    if (typeof issue?.title === 'string') parts.push(issue.title)
    if (typeof issue?.note === 'string') parts.push(issue.note)
  }
  for (const work of (Array.isArray(entry.work) ? entry.work : []) as CourseWork[]) {
    if (typeof work?.title === 'string') parts.push(work.title)
    if (typeof work?.note === 'string') parts.push(work.note)
    for (const material of Array.isArray(work?.materials) ? work.materials : []) {
      if (typeof material?.title === 'string') parts.push(material.title)
    }
  }
  for (const question of (Array.isArray(entry.questions) ? entry.questions : []) as { text?: unknown }[]) {
    if (typeof question?.text === 'string') parts.push(question.text)
  }
  return parts.join('\n').toLowerCase()
}
