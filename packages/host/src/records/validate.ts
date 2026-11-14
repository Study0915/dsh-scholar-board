/**
 * 领域记录的写入校验（D36）：字段、枚举、日期、引用与材料地址只在这里判定一次。
 *
 * 能力层的 JSON Schema 只挡住调用形状；业务规则在这里给出可读的拒绝。可选字段用 `null` 表示清除，
 * 空串按未填处理——存储里不出现用空串冒充有值的字段。
 */
import type {
  ActionStatus,
  ChoreStatus,
  DomainRecord,
  LiteratureStage,
  ManuscriptStage,
  RecordKind,
  RecordRef,
  ResearchEntry,
  ResearchMethod,
  StageEntry,
} from '@dsh-scholar-board/contracts'
import { RECORDS_FORMAT, RECORDS_LIMITS, isOpenableUrl } from '@dsh-scholar-board/contracts'
export { FIGURE_KINDS, SUBMISSION_DECISIONS, REVISION_STATUSES } from './manuscript-validate'
export { searchTextOf } from './search'
import { figuresOf, submissionsOf, revisionsOf, manuscriptArraysProblem } from './manuscript-validate'
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
import { CHORE_STATUSES, categoryOf, choreStatusOf, courseArraysProblem, courseTermOf, courseWorkOf } from './study-validate'

/** 九种记录。 */
export const RECORD_KINDS: readonly RecordKind[] = ['meeting', 'action', 'manuscript', 'literature', 'research', 'thesis', 'project', 'course', 'chore']

/** 行动项的五个状态。 */
export const ACTION_STATUSES: readonly ActionStatus[] = ['todo', 'doing', 'blocked', 'done', 'cancelled']

/** 稿件的八个阶段。 */
export const MANUSCRIPT_STAGES: readonly ManuscriptStage[] = ['idea', 'experiment', 'writing', 'internal-review', 'submitted', 'revision', 'accepted', 'archived']

/** 文献的三个阅读阶段。 */
export const LITERATURE_STAGES: readonly LiteratureStage[] = ['queued', 'reading', 'understood']

/** 研究记录的三种做法。 */
export const RESEARCH_METHODS: readonly ResearchMethod[] = ['derivation', 'simulation', 'experiment']

/** 每种记录可写的字段；系统字段与阶段历史不在这张表里。 */
const WRITABLE: Record<RecordKind, readonly string[]> = {
  meeting: ['title', 'date', 'topics', 'feedback', 'openQuestions', 'related', 'materials', 'derivedFrom'],
  action: ['title', 'status', 'due', 'source', 'related', 'blockedNote', 'doneNote', 'materials'],
  manuscript: ['title', 'question', 'stage', 'stageNote', 'nextStep', 'blockers', 'target', 'due', 'related', 'materials', 'figures', 'submissions', 'revisions'],
  literature: ['title', 'authors', 'venue', 'year', 'url', 'stage', 'understanding', 'questions', 'related', 'materials'],
  research: ['title', 'method', 'question', 'environment', 'seed', 'parameters', 'metrics', 'conclusion', 'related', 'materials'],
  thesis: ['title', 'question', 'chapters', 'results', 'experiments', 'milestones', 'related', 'materials'],
  project: ['title', 'summary', 'tasks', 'deliverables', 'communications', 'milestones', 'issues', 'related', 'materials'],
  course: ['title', 'term', 'code', 'teacher', 'schedule', 'notes', 'work', 'related', 'materials'],
  chore: ['title', 'category', 'status', 'due', 'note', 'materials'],
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
  course: ['meeting', 'action', 'manuscript'],
  chore: [],
}

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
  if (input.term !== undefined || (kind === 'course' && mode === 'create')) out.term = courseTermOf(input.term, 'term')
  if (input.work !== undefined) out.work = courseWorkOf(input.work, 'work')
  if (input.code !== undefined) out.code = textOf(input.code, 'code')
  if (input.teacher !== undefined) out.teacher = textOf(input.teacher, 'teacher')
  if (input.schedule !== undefined) out.schedule = textOf(input.schedule, 'schedule')
  if (input.notes !== undefined) out.notes = textOf(input.notes, 'notes')
  if (input.note !== undefined) out.note = textOf(input.note, 'note')
  if (input.category !== undefined || (kind === 'chore' && mode === 'create')) out.category = categoryOf(input.category)
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
  if (kind === 'chore' && (input.status !== undefined || mode === 'create')) out.status = choreStatusOf(input.status)
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
  if (value.kind === 'course') {
    if (!isRecord(value.term) || typeof value.term.label !== 'string' || value.term.label === '') return '缺少学期'
    const arraysProblem = courseArraysProblem(value)
    if (arraysProblem !== null) return arraysProblem
  }
  if (value.kind === 'chore' && (typeof value.status !== 'string' || !CHORE_STATUSES.includes(value.status as ChoreStatus))) return 'status 不认识'
  return null
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
