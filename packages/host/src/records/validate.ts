/**
 * 领域记录的写入校验（D36）：字段、枚举、日期、引用与材料地址只在这里判定一次。
 *
 * 能力层的 JSON Schema 只挡住调用形状；业务规则在这里给出可读的拒绝。可选字段用 `null` 表示清除，
 * 空串按未填处理——存储里不出现用空串冒充有值的字段。
 */
import type {
  ActionStatus,
  DomainRecord,
  FigureKind,
  LiteratureStage,
  ManuscriptFigure,
  ManuscriptStage,
  MaterialRef,
  ProjectCommunication,
  ProjectDeliverable,
  ProjectIssue,
  ProjectMilestone,
  ProjectTask,
  RecordKind,
  RecordRef,
  ResearchEntry,
  ResearchMethod,
  RevisionItem,
  RevisionStatus,
  StageEntry,
  SubmissionDecision,
  SubmissionRound,
  ThesisChapter,
  ThesisExperiment,
  ThesisMilestone,
  ThesisResult,
} from '@dsh-scholar-board/contracts'
import { RECORDS_FORMAT, RECORDS_LIMITS, isOpenableUrl } from '@dsh-scholar-board/contracts'
import { isRecord } from '../guards'
import { dueOf, fail, materialsOf, textOf, titleOf } from './fields'
import { chaptersOf, experimentsOf, thesisArraysProblem, thesisMilestonesOf, thesisResultsOf } from './thesis-validate'
import {
  projectArraysProblem,
  projectCommunicationsOf,
  projectDeliverablesOf,
  projectIssuesOf,
  projectMilestonesOf,
  projectTasksOf,
} from './project-validate'

/** 七种记录。 */
export const RECORD_KINDS: readonly RecordKind[] = ['meeting', 'action', 'manuscript', 'literature', 'research', 'thesis', 'project']

/** 行动项的五个状态。 */
export const ACTION_STATUSES: readonly ActionStatus[] = ['todo', 'doing', 'blocked', 'done', 'cancelled']

/** 稿件的八个阶段。 */
export const MANUSCRIPT_STAGES: readonly ManuscriptStage[] = ['idea', 'experiment', 'writing', 'internal-review', 'submitted', 'revision', 'accepted', 'archived']

/** 文献的三个阅读阶段。 */
export const LITERATURE_STAGES: readonly LiteratureStage[] = ['queued', 'reading', 'understood']

/** 研究记录的三种做法。 */
export const RESEARCH_METHODS: readonly ResearchMethod[] = ['derivation', 'simulation', 'experiment']

/** 图表目录里的两种条目。 */
export const FIGURE_KINDS: readonly FigureKind[] = ['figure', 'table']

/** 投稿轮次的七种结果；拒稿、撤稿与转投都留在历史里。 */
export const SUBMISSION_DECISIONS: readonly SubmissionDecision[] = ['pending', 'minor', 'major', 'accepted', 'rejected', 'withdrawn', 'transferred']

/** 修回事项的四种状态。 */
export const REVISION_STATUSES: readonly RevisionStatus[] = ['todo', 'doing', 'done', 'declined']

/** 每种记录可写的字段；系统字段与阶段历史不在这张表里。 */
const WRITABLE: Record<RecordKind, readonly string[]> = {
  meeting: ['title', 'date', 'topics', 'feedback', 'openQuestions', 'related', 'materials', 'derivedFrom'],
  action: ['title', 'status', 'due', 'source', 'related', 'blockedNote', 'doneNote', 'materials'],
  manuscript: ['title', 'question', 'stage', 'stageNote', 'nextStep', 'blockers', 'target', 'due', 'related', 'materials', 'figures', 'submissions', 'revisions'],
  literature: ['title', 'authors', 'venue', 'year', 'url', 'stage', 'understanding', 'questions', 'related', 'materials'],
  research: ['title', 'method', 'question', 'environment', 'seed', 'parameters', 'metrics', 'conclusion', 'related', 'materials'],
  thesis: ['title', 'question', 'chapters', 'results', 'experiments', 'milestones', 'related', 'materials'],
  project: ['title', 'summary', 'tasks', 'deliverables', 'communications', 'milestones', 'issues', 'related', 'materials'],
}

/** 每种记录允许指向的引用类型。 */
const REFERRABLE: Record<RecordKind, readonly RecordKind[]> = {
  meeting: ['manuscript'],
  action: ['meeting', 'manuscript'],
  manuscript: ['meeting', 'action'],
  literature: ['manuscript'],
  research: ['manuscript'],
  thesis: ['action'],
  project: ['meeting', 'action', 'manuscript'],
}

/** 搜索和展示时要读的文本字段。 */
const TEXT_FIELDS = ['title', 'summary', 'topics', 'feedback', 'openQuestions', 'question', 'nextStep', 'blockers', 'target', 'blockedNote', 'doneNote', 'authors', 'venue', 'understanding', 'questions', 'environment', 'seed', 'conclusion'] as const

/**
 * 一组指向前向记录的引用。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @param allowed - 这种记录允许指向的类型。
 * @returns 引用表；未填时是 `null`。
 */
function refsOf(value: unknown, field: string, allowed: readonly RecordKind[]): RecordRef[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail(`${field} 要是数组`)
  if (value.length > RECORDS_LIMITS.related) fail(`${field} 最多 ${String(RECORDS_LIMITS.related)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${field}[${String(index)}] 要写成 { kind, id }`)
    if (typeof entry.kind !== 'string' || !allowed.includes(entry.kind as RecordKind)) {
      fail(`${field}[${String(index)}].kind 只能是 ${allowed.join('、')}`)
    }
    if (typeof entry.id !== 'string' || entry.id === '' || entry.id.length > 64) fail(`${field}[${String(index)}].id 不合法`)
    const key = `${entry.kind}:${entry.id}`
    if (seen.has(key)) fail(`${field} 里有重复的引用`)
    seen.add(key)
    return { kind: entry.kind as RecordKind, id: entry.id }
  })
}

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
 * 图表目录：编号与标题必填，证据材料只收 http/https，条目 id 不重复。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 图表表；未填时是 `null`。
 */
function figuresOf(value: unknown, field: string): ManuscriptFigure[] | null {
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
    return {
      id: entry.id,
      kind: entry.kind as FigureKind,
      label,
      title,
      ...(note === null ? {} : { note }),
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
function submissionsOf(value: unknown, field: string): SubmissionRound[] | null {
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
function revisionsOf(value: unknown, field: string): RevisionItem[] | null {
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
 * 行动项的状态。
 *
 * @param value - 外来值。
 * @returns 状态。
 */
function statusOf(value: unknown): ActionStatus {
  if (typeof value !== 'string' || !ACTION_STATUSES.includes(value as ActionStatus)) {
    fail(`status 只能是 ${ACTION_STATUSES.join('、')}`)
  }
  return value as ActionStatus
}

/**
 * 稿件的阶段。
 *
 * @param value - 外来值。
 * @returns 阶段。
 */
function stageOf(value: unknown): ManuscriptStage {
  if (typeof value !== 'string' || !MANUSCRIPT_STAGES.includes(value as ManuscriptStage)) {
    fail(`stage 只能是 ${MANUSCRIPT_STAGES.join('、')}`)
  }
  return value as ManuscriptStage
}

/**
 * 文献的阅读阶段。
 *
 * @param value - 外来值。
 * @returns 阶段。
 */
function literatureStageOf(value: unknown): LiteratureStage {
  if (typeof value !== 'string' || !LITERATURE_STAGES.includes(value as LiteratureStage)) {
    fail(`stage 只能是 ${LITERATURE_STAGES.join('、')}`)
  }
  return value as LiteratureStage
}

/**
 * 研究记录的做法：推导、仿真或实验。
 *
 * @param value - 外来值。
 * @returns 做法。
 */
function researchMethodOf(value: unknown): ResearchMethod {
  if (typeof value !== 'string' || !RESEARCH_METHODS.includes(value as ResearchMethod)) {
    fail(`method 只能是 ${RESEARCH_METHODS.join('、')}`)
  }
  return value as ResearchMethod
}

/**
 * 一组参数或指标：名称与数值必填，单位可留空；名称与数值都不能是空白。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 条目表；未填时是 `null`。
 */
function entriesOf(value: unknown, field: string): ResearchEntry[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail(`${field} 要是数组`)
  if (value.length > RECORDS_LIMITS.entries) fail(`${field} 最多 ${String(RECORDS_LIMITS.entries)} 项`)
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${field}[${String(index)}] 要写成 { name, value, unit? }`)
    const name = titleOf(entry.name, `${field}[${String(index)}].name`)
    const quantity = titleOf(entry.value, `${field}[${String(index)}].value`)
    if (entry.unit !== undefined && entry.unit !== null) {
      if (typeof entry.unit !== 'string') fail(`${field}[${String(index)}].unit 要是文字`)
      if ([...entry.unit.trim()].length > RECORDS_LIMITS.unitLength) fail(`${field}[${String(index)}].unit 最多 ${String(RECORDS_LIMITS.unitLength)} 个字符`)
    }
    const unit = entry.unit === undefined ? null : textOf(entry.unit, `${field}[${String(index)}].unit`)
    return { name, value: quantity, ...(unit === null ? {} : { unit }) }
  })
}

/**
 * 出版年份：可留空，填了就要是一个像样的整数。
 *
 * @param value - 外来值。
 * @returns 年份；未填时是 `null`。
 */
function yearOf(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1000 || value > 3000) {
    fail('year 要是 1000 到 3000 之间的整数')
  }
  return value
}

/**
 * 来源地址：可留空，填了就要是 http/https 的完整地址（D26）。
 *
 * @param value - 外来值。
 * @returns 地址；未填时是 `null`。
 */
function urlOf(value: unknown): string | null {
  if (value === null) return null
  if (!isOpenableUrl(value)) fail('url 只收 http/https 的完整地址')
  return value
}

/**
 * 一条记录的写入字段：建新与更新共用，更新时允许只给一部分。
 *
 * @param kind - 记录类型。
 * @param input - 外来对象。
 * @param mode - 新建还是更新。
 * @returns 归一后的字段；值为 `null` 的项表示清除。
 * @throws {Refusal} 字段不认识、必填缺席或取值不合法，400。
 */
export function normalizeInput(kind: RecordKind, input: unknown, mode: 'create' | 'update'): Record<string, unknown> {
  if (!isRecord(input)) fail('记录要是一个 JSON 对象')
  const writable = WRITABLE[kind]
  for (const key of Object.keys(input)) {
    if (!writable.includes(key)) fail(`记录不接受字段 ${key}`)
  }
  const out: Record<string, unknown> = {}
  if (input.title !== undefined || mode === 'create') out.title = titleOf(input.title, 'title')
  if (input.date !== undefined) out.date = dueOf(input.date, 'date')
  if (input.due !== undefined) out.due = dueOf(input.due, 'due')
  if (input.topics !== undefined) out.topics = textOf(input.topics, 'topics')
  if (input.feedback !== undefined) out.feedback = textOf(input.feedback, 'feedback')
  if (input.openQuestions !== undefined) out.openQuestions = textOf(input.openQuestions, 'openQuestions')
  if (input.summary !== undefined) out.summary = textOf(input.summary, 'summary')
  if (input.question !== undefined) out.question = textOf(input.question, 'question')
  if (input.nextStep !== undefined) out.nextStep = textOf(input.nextStep, 'nextStep')
  if (input.blockers !== undefined) out.blockers = textOf(input.blockers, 'blockers')
  if (input.target !== undefined) out.target = textOf(input.target, 'target')
  if (input.authors !== undefined) out.authors = textOf(input.authors, 'authors')
  if (input.venue !== undefined) out.venue = textOf(input.venue, 'venue')
  if (input.year !== undefined) out.year = yearOf(input.year)
  if (input.url !== undefined) out.url = urlOf(input.url)
  if (input.understanding !== undefined) out.understanding = textOf(input.understanding, 'understanding')
  if (input.questions !== undefined) out.questions = textOf(input.questions, 'questions')
  if (input.environment !== undefined) out.environment = textOf(input.environment, 'environment')
  if (input.seed !== undefined) out.seed = textOf(input.seed, 'seed')
  if (input.parameters !== undefined) out.parameters = entriesOf(input.parameters, 'parameters')
  if (input.metrics !== undefined) out.metrics = entriesOf(input.metrics, 'metrics')
  if (input.conclusion !== undefined) out.conclusion = textOf(input.conclusion, 'conclusion')
  if (input.blockedNote !== undefined) out.blockedNote = textOf(input.blockedNote, 'blockedNote')
  if (input.doneNote !== undefined) out.doneNote = textOf(input.doneNote, 'doneNote')
  if (input.related !== undefined) out.related = refsOf(input.related, 'related', REFERRABLE[kind])
  if (input.materials !== undefined) out.materials = materialsOf(input.materials, 'materials')
  if (input.figures !== undefined) out.figures = figuresOf(input.figures, 'figures')
  if (input.submissions !== undefined) out.submissions = submissionsOf(input.submissions, 'submissions')
  if (input.revisions !== undefined) out.revisions = revisionsOf(input.revisions, 'revisions')
  if (input.chapters !== undefined) out.chapters = chaptersOf(input.chapters, 'chapters')
  if (input.results !== undefined) out.results = thesisResultsOf(input.results, 'results')
  if (input.experiments !== undefined) out.experiments = experimentsOf(input.experiments, 'experiments')
  if (input.milestones !== undefined) out.milestones = kind === 'project' ? projectMilestonesOf(input.milestones, 'milestones') : thesisMilestonesOf(input.milestones, 'milestones')
  if (input.tasks !== undefined) out.tasks = projectTasksOf(input.tasks, 'tasks')
  if (input.deliverables !== undefined) out.deliverables = projectDeliverablesOf(input.deliverables, 'deliverables')
  if (input.communications !== undefined) out.communications = projectCommunicationsOf(input.communications, 'communications')
  if (input.issues !== undefined) out.issues = projectIssuesOf(input.issues, 'issues')
  if (input.derivedFrom !== undefined) {
    if (input.derivedFrom === null) out.derivedFrom = null
    else if (typeof input.derivedFrom !== 'string' || input.derivedFrom === '' || input.derivedFrom.length > 64) fail('derivedFrom 不合法')
    else out.derivedFrom = input.derivedFrom
  }
  if (input.source !== undefined) {
    if (input.source === null) out.source = null
    else {
      if (!isRecord(input.source) || typeof input.source.id !== 'string' || input.source.id === '' || input.source.id.length > 64) fail('source 要写成 { kind, id }')
      if (input.source.kind !== 'meeting' && input.source.kind !== 'manuscript') fail('source.kind 只能是 meeting 或 manuscript')
      out.source = { kind: input.source.kind, id: input.source.id }
    }
  }
  if (kind === 'action' && (input.status !== undefined || mode === 'create')) out.status = statusOf(input.status)
  if (kind === 'manuscript' && (input.stage !== undefined || mode === 'create')) out.stage = stageOf(input.stage)
  if (kind === 'literature' && (input.stage !== undefined || mode === 'create')) out.stage = literatureStageOf(input.stage)
  if (kind === 'research' && (input.method !== undefined || mode === 'create')) out.method = researchMethodOf(input.method)
  if (out.stage !== undefined && input.stageNote !== undefined) {
    out.stageNote = textOf(input.stageNote, 'stageNote')
  }
  return out
}

/**
 * 一次写入之后整条记录序列化的大小。
 *
 * @param record - 记录。
 * @returns UTF-8 字节数。
 */
export function recordBytes(record: DomainRecord): number {
  return Buffer.byteLength(JSON.stringify(record), 'utf8')
}

/**
 * 一条从外部读进来的记录（例如导入包）的字段合不合规矩。
 *
 * 系统字段照旧由宿主维护；其余字段必须都在这种记录的可写表里，值按与写入相同的规则校验。
 *
 * @param record - 一条完整记录。
 * @throws {Refusal} 有任何不认识或不合法的地方，400。
 */
export function assertRecordWritable(record: DomainRecord): void {
  const writable = WRITABLE[record.kind]
  const entry = record as unknown as Record<string, unknown>
  const system = new Set(['id', 'kind', 'schemaVersion', 'revision', 'createdAt', 'updatedAt', 'archived', 'deletedAt', 'lastEditedBy', 'stageHistory'])
  for (const key of Object.keys(entry)) {
    if (system.has(key)) continue
    if (!writable.includes(key)) fail(`记录不接受字段 ${key}`)
  }
  const input: Record<string, unknown> = {}
  for (const key of writable) {
    if (entry[key] !== undefined) input[key] = entry[key]
  }
  normalizeInput(record.kind, input, 'update')
}

/**
 * 稿件里三组内嵌条目的形状与互链：修回必须指向本稿件的一轮投稿。
 *
 * @param value - 一条记录。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
function manuscriptArraysProblem(value: Record<string, unknown>): string | null {
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

/**
 * 一条记录能不能被当作存储里的一份读回来：系统字段与各类型的必填项都在。
 *
 * @param value - 从磁盘读出来的值。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
export function storedProblem(value: unknown): string | null {
  if (!isRecord(value)) return '不是对象'
  if (typeof value.id !== 'string' || value.id === '') return '缺少 id'
  if (typeof value.kind !== 'string' || !RECORD_KINDS.includes(value.kind as RecordKind)) return 'kind 不认识'
  if (value.schemaVersion !== RECORDS_FORMAT) return `schemaVersion 是 ${String(value.schemaVersion)}`
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) return 'revision 不合法'
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return '缺少时间'
  if (typeof value.archived !== 'boolean') return 'archived 不是布尔值'
  if (value.deletedAt !== undefined && (typeof value.deletedAt !== 'string' || Number.isNaN(Date.parse(value.deletedAt)))) return 'deletedAt 不合法'
  if (typeof value.title !== 'string' || value.title.trim() === '') return '缺少 title'
  if (value.kind === 'action' && (typeof value.status !== 'string' || !ACTION_STATUSES.includes(value.status as ActionStatus))) return 'status 不认识'
  if (value.kind === 'literature' && (typeof value.stage !== 'string' || !LITERATURE_STAGES.includes(value.stage as LiteratureStage))) return 'stage 不认识'
  if (value.kind === 'research') {
    if (typeof value.method !== 'string' || !RESEARCH_METHODS.includes(value.method as ResearchMethod)) return 'method 不认识'
    for (const field of ['parameters', 'metrics'] as const) {
      const entries = value[field]
      if (entries === undefined) continue
      if (!Array.isArray(entries)) return `${field} 不是数组`
      for (const entry of entries as unknown[]) {
        if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name === '' || typeof entry.value !== 'string' || entry.value === '') return `${field} 的条目缺少名称或数值`
        if (entry.unit !== undefined && (typeof entry.unit !== 'string' || entry.unit === '')) return `${field} 的单位不合法`
      }
    }
  }
  if (value.kind === 'manuscript') {
    if (typeof value.stage !== 'string' || !MANUSCRIPT_STAGES.includes(value.stage as ManuscriptStage)) return 'stage 不认识'
    if (!Array.isArray(value.stageHistory)) return '缺少 stageHistory'
    for (const entry of value.stageHistory as unknown[]) {
      if (!isRecord(entry) || typeof entry.stage !== 'string' || !MANUSCRIPT_STAGES.includes(entry.stage as ManuscriptStage)) return 'stageHistory 不合法'
      if (typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))) return 'stageHistory 的时间不合法'
    }
    const arraysProblem = manuscriptArraysProblem(value)
    if (arraysProblem !== null) return arraysProblem
  }
  if (value.kind === 'thesis') {
    const arraysProblem = thesisArraysProblem(value)
    if (arraysProblem !== null) return arraysProblem
  }
  if (value.kind === 'project') {
    const arraysProblem = projectArraysProblem(value)
    if (arraysProblem !== null) return arraysProblem
  }
  return null
}

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
  for (const field of ['parameters', 'metrics'] as const) {
    const entries = entry[field]
    if (!Array.isArray(entries)) continue
    for (const item of entries as ResearchEntry[]) {
      if (typeof item?.name === 'string') parts.push(item.name)
      if (typeof item?.value === 'string') parts.push(item.value)
      if (typeof item?.unit === 'string') parts.push(item.unit)
    }
  }
  for (const figure of (Array.isArray(entry.figures) ? entry.figures : []) as ManuscriptFigure[]) {
    if (typeof figure?.label === 'string') parts.push(figure.label)
    if (typeof figure?.title === 'string') parts.push(figure.title)
    if (typeof figure?.note === 'string') parts.push(figure.note)
    for (const material of Array.isArray(figure?.materials) ? figure.materials : []) {
      if (typeof material?.title === 'string') parts.push(material.title)
    }
  }
  for (const round of (Array.isArray(entry.submissions) ? entry.submissions : []) as SubmissionRound[]) {
    if (typeof round?.venue === 'string') parts.push(round.venue)
    if (typeof round?.note === 'string') parts.push(round.note)
  }
  for (const revision of (Array.isArray(entry.revisions) ? entry.revisions : []) as RevisionItem[]) {
    if (typeof revision?.feedback === 'string') parts.push(revision.feedback)
    if (typeof revision?.change === 'string') parts.push(revision.change)
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
  return parts.join('\n').toLowerCase()
}

/**
 * 时间在稿件阶段历史里的一次落点。
 *
 * @param stage - 新阶段。
 * @param at - UTC ISO 字符串。
 * @param note - 可选说明。
 * @returns 一条历史项。
 */
export function stageEntryOf(stage: ManuscriptStage, at: string, note: string | null): StageEntry {
  return { stage, at, ...(note === null ? {} : { note }) }
}
