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
  ResearchEntry,
  ResearchMethod,
  RunCode,
  RunDataset,
  RunResult,
  RunStatus,
  StageEntry,
  TemplateField,
  TemplateSnapshot,
} from '@dsh-scholar-board/contracts'
import { RECORDS_FORMAT, RECORDS_LIMITS, RECORD_KINDS, RELATION_KINDS, TEMPLATE_FIELD_GROUPS, TEMPLATE_FIELD_TYPES, TEMPLATE_LIMITS, isOpenableUrl } from '@dsh-scholar-board/contracts'
export { RECORD_KINDS } from '@dsh-scholar-board/contracts'
export { FIGURE_KINDS, SUBMISSION_DECISIONS, REVISION_STATUSES } from './manuscript-validate'
export { TOPIC_QUESTION_STATUSES } from './topic-validate'
export { searchTextOf } from './search'
import { figuresOf, submissionsOf, revisionsOf, manuscriptArraysProblem } from './manuscript-validate'
import { evidenceOf, evidenceProblem, evidenceTextOf } from './evidence-validate'
import { literatureFieldsOf, literatureProblem } from './literature-validate'
import { actionSourceOf, actionSourceProblem } from './action-source'
import { isRecord } from '../guards'
import { dueOf, fail, materialsOf, refsOf, textOf, titleOf } from './fields'
import { chaptersOf, experimentsOf, thesisArraysProblem, thesisMilestonesOf, thesisResultsOf } from './thesis-validate'
import { topicArraysProblem, topicQuestionsOf } from './topic-validate'
import {
  projectArraysProblem,
  projectCommunicationsOf,
  projectDeliverablesOf,
  projectIssuesOf,
  projectMilestonesOf,
  projectRequirementsOf,
  projectTasksOf,
  requirementChangesOf,
} from './project-validate'
import { CHORE_STATUSES, categoryOf, choreStatusOf, courseArraysProblem, courseTermOf, courseWorkOf } from './study-validate'

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
  action: ['title', 'status', 'due', 'source', 'sourceEntry', 'related', 'blockedNote', 'doneNote', 'materials'],
  manuscript: ['title', 'question', 'stage', 'stageNote', 'nextStep', 'blockers', 'target', 'due', 'related', 'materials', 'figures', 'submissions', 'revisions'],
  literature: ['title', 'authors', 'venue', 'year', 'url', 'stage', 'understanding', 'questions', 'format', 'doi', 'arxivId', 'arxivVersion', 'versions', 'reading', 'external', 'related', 'materials'],
  research: ['title', 'method', 'question', 'purpose', 'hypothesis', 'steps', 'environment', 'seed', 'parameters', 'metrics', 'conclusion', 'conclusionBasis', 'conclusionScope', 'conclusionEvidence', 'related', 'materials', 'template'],
  thesis: ['title', 'question', 'chapters', 'results', 'experiments', 'milestones', 'related', 'materials'],
  project: ['title', 'summary', 'requirements', 'requirementChanges', 'tasks', 'deliverables', 'communications', 'milestones', 'issues', 'related', 'materials'],
  course: ['title', 'term', 'code', 'teacher', 'schedule', 'notes', 'work', 'related', 'materials'],
  chore: ['title', 'category', 'status', 'due', 'note', 'related', 'materials'],
  topic: ['title', 'question', 'goal', 'hypothesis', 'judgment', 'nextStep', 'questions', 'related', 'materials'],
  run: ['title', 'plan', 'status', 'code', 'datasets', 'checkpoints', 'config', 'environment', 'seed', 'evaluation', 'startedAt', 'endedAt', 'metrics', 'artifacts', 'failure', 'note', 'results', 'related', 'materials', 'template'],
  template: ['title', 'direction', 'fields'],
}

/** 每种记录允许指向的引用类型；模板不参与关联。 */
const REFERRABLE: Record<RecordKind, readonly RecordKind[]> = {
  meeting: RELATION_KINDS,
  action: RELATION_KINDS,
  manuscript: RELATION_KINDS,
  literature: RELATION_KINDS,
  research: RELATION_KINDS,
  thesis: RELATION_KINDS,
  project: RELATION_KINDS,
  course: RELATION_KINDS,
  chore: RELATION_KINDS,
  topic: RELATION_KINDS,
  run: RELATION_KINDS,
  template: [],
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
    const definition = entry.definition === undefined ? null : textOf(entry.definition, `${field}[${String(index)}].definition`)
    return { name, value: quantity, ...(unit === null ? {} : { unit }), ...(definition === null ? {} : { definition }) }
  })
}

/** 运行的五个状态；不认识的值直接拒绝。 */
export const RUN_STATUSES: readonly RunStatus[] = ['planned', 'running', 'succeeded', 'failed', 'cancelled']

/**
 * 运行状态：只认五个明确的值。
 *
 * @param value - 外来值。
 * @returns 状态。
 */
function runStatusOf(value: unknown): RunStatus {
  if (typeof value !== 'string' || !RUN_STATUSES.includes(value as RunStatus)) fail(`status 只能是 ${RUN_STATUSES.join('、')}`)
  return value as RunStatus
}

/**
 * 运行时间：可留空；填了要是能解析的时间字符串，统一存成 UTC。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns ISO 时间；未填时是 `null`。
 */
function runTimeOf(value: unknown, field: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} 要是时间字符串`)
  const stamp = Date.parse(value)
  if (Number.isNaN(stamp)) fail(`${field} 不是可识别的时间`)
  return new Date(stamp).toISOString()
}

/**
 * 运行的代码来源：仓库与提交都可留空。
 *
 * @param value - 外来值。
 * @returns 代码来源；未填时是 `null`。
 */
function runCodeOf(value: unknown): RunCode | null {
  if (value === null) return null
  if (!isRecord(value)) fail('code 要写成 { repository?, commit? }')
  const repository = value.repository === undefined ? null : textOf(value.repository, 'code.repository')
  const commit = value.commit === undefined ? null : textOf(value.commit, 'code.commit')
  return { ...(repository === null ? {} : { repository }), ...(commit === null ? {} : { commit }) }
}

/**
 * 运行用到的数据集：名称必填，划分与版本可留空，id 唯一。
 *
 * @param value - 外来值。
 * @returns 数据集表；未填时是 `null`。
 */
function runDatasetsOf(value: unknown): RunDataset[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail('datasets 要是数组')
  if (value.length > RECORDS_LIMITS.runDatasets) fail(`datasets 最多 ${String(RECORDS_LIMITS.runDatasets)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`datasets[${String(index)}] 要写成 { id, name, split?, version? }`)
    if (typeof entry.id !== 'string' || entry.id === '' || entry.id.length > 64) fail(`datasets[${String(index)}].id 不合法`)
    if (seen.has(entry.id)) fail('datasets 里的 id 重复')
    seen.add(entry.id)
    const name = titleOf(entry.name, `datasets[${String(index)}].name`)
    const split = entry.split === undefined ? null : textOf(entry.split, `datasets[${String(index)}].split`)
    const version = entry.version === undefined ? null : textOf(entry.version, `datasets[${String(index)}].version`)
    return { id: entry.id, name, ...(split === null ? {} : { split }), ...(version === null ? {} : { version }) }
  })
}

/**
 * 运行结果：单次观测或统计汇总；汇总缺来源时必须显式标记手工汇总。
 *
 * @param value - 外来值。
 * @returns 结果表；未填时是 `null`。
 */
function runResultsOf(value: unknown): RunResult[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail('results 要是数组')
  if (value.length > RECORDS_LIMITS.runResults) fail(`results 最多 ${String(RECORDS_LIMITS.runResults)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const at = `results[${String(index)}]`
    if (!isRecord(entry)) fail(`${at} 要写成 { id, kind, text }`)
    if (typeof entry.id !== 'string' || entry.id === '' || entry.id.length > 64) fail(`${at}.id 不合法`)
    if (seen.has(entry.id)) fail('results 里的 id 重复')
    seen.add(entry.id)
    if (entry.kind !== 'single' && entry.kind !== 'aggregate') fail(`${at}.kind 只能是 single 或 aggregate`)
    if (typeof entry.text !== 'string') fail(`${at}.text 要是文字`)
    const text = entry.text.trim()
    if (text === '') fail(`${at}.text 不能是空的`)
    if ([...text].length > RECORDS_LIMITS.runResultText) fail(`${at}.text 最多 ${String(RECORDS_LIMITS.runResultText)} 个字符`)
    const out: RunResult = { id: entry.id, kind: entry.kind, text }
    if (entry.sources !== undefined) {
      if (!Array.isArray(entry.sources)) fail(`${at}.sources 要是数组`)
      if (entry.sources.length > RECORDS_LIMITS.runResultSources) fail(`${at}.sources 最多 ${String(RECORDS_LIMITS.runResultSources)} 项`)
      const ids = new Set<string>()
      for (const source of entry.sources) {
        if (typeof source !== 'string' || source === '' || source.length > 64) fail(`${at}.sources 的 id 不合法`)
        if (ids.has(source)) fail(`${at}.sources 的 id 重复`)
        ids.add(source)
      }
      if (ids.size > 0) out.sources = [...ids]
    }
    if (entry.method !== undefined) {
      const method = textOf(entry.method, `${at}.method`)
      if (method !== null && [...method].length > RECORDS_LIMITS.runMethodLength) fail(`${at}.method 最多 ${String(RECORDS_LIMITS.runMethodLength)} 个字符`)
      if (method !== null) out.method = method
    }
    if (entry.sampleSize !== undefined && entry.sampleSize !== null) {
      if (typeof entry.sampleSize !== 'number' || !Number.isInteger(entry.sampleSize) || entry.sampleSize < 0) fail(`${at}.sampleSize 要是非负整数`)
      out.sampleSize = entry.sampleSize
    }
    if (entry.dispersion !== undefined) {
      const dispersion = textOf(entry.dispersion, `${at}.dispersion`)
      if (dispersion !== null && [...dispersion].length > RECORDS_LIMITS.runDispersionLength) fail(`${at}.dispersion 最多 ${String(RECORDS_LIMITS.runDispersionLength)} 个字符`)
      if (dispersion !== null) out.dispersion = dispersion
    }
    if (entry.manual === true) {
      if (out.sources !== undefined) fail(`${at} 有来源运行时不需要标记手工汇总`)
      out.manual = true
    }
    if (out.kind === 'aggregate' && out.sources === undefined && out.manual !== true) fail(`${at} 的汇总没有来源运行时要标记 manual`)
    return out
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
 * 一个模板字段：键在模板里唯一，类型与位置都只认列出的值。
 *
 * @param value - 外来值。
 * @param at - 出错时指人。
 * @returns 归一后的字段。
 */
function templateFieldOf(value: unknown, at: string): TemplateField {
  if (!isRecord(value)) fail(`${at} 要写成 { key, label, type, group }`)
  const length = (text: string): number => [...text].length
  const key = textOf(value.key, `${at}.key`)
  if (key === null || length(key) > TEMPLATE_LIMITS.keyLength) fail(`${at}.key 不合法`)
  const label = titleOf(value.label, `${at}.label`)
  if (length(label) > TEMPLATE_LIMITS.labelLength) fail(`${at}.label 最多 ${String(TEMPLATE_LIMITS.labelLength)} 个字符`)
  if (!TEMPLATE_FIELD_TYPES.includes(value.type as TemplateField['type'])) fail(`${at}.type 只能是 ${TEMPLATE_FIELD_TYPES.join('、')}`)
  if (!TEMPLATE_FIELD_GROUPS.includes(value.group as TemplateField['group'])) fail(`${at}.group 只能是 ${TEMPLATE_FIELD_GROUPS.join('、')}`)
  const out: TemplateField = { key, label, type: value.type as TemplateField['type'], group: value.group as TemplateField['group'] }
  if (value.unit !== undefined) {
    const unit = textOf(value.unit, `${at}.unit`)
    if (unit !== null) {
      if (length(unit) > TEMPLATE_LIMITS.unitLength) fail(`${at}.unit 最多 ${String(TEMPLATE_LIMITS.unitLength)} 个字符`)
      out.unit = unit
    }
  }
  for (const part of ['note', 'when'] as const) {
    if (value[part] === undefined) continue
    const text = textOf(value[part], `${at}.${part}`)
    if (text === null) continue
    if (length(text) > TEMPLATE_LIMITS.noteLength) fail(`${at}.${part} 最多 ${String(TEMPLATE_LIMITS.noteLength)} 个字符`)
    out[part] = text
  }
  if (value.options !== undefined) {
    if (!Array.isArray(value.options)) fail(`${at}.options 要是数组`)
    if (value.options.length > TEMPLATE_LIMITS.options) fail(`${at}.options 最多 ${String(TEMPLATE_LIMITS.options)} 项`)
    const options: string[] = []
    for (const option of value.options) {
      const text = titleOf(option, `${at}.options`)
      if (length(text) > TEMPLATE_LIMITS.optionLength) fail(`${at}.options 的选项太长`)
      if (!options.includes(text)) options.push(text)
    }
    if (options.length > 0) out.options = options
  }
  return out
}

/**
 * 一组模板字段；键在模板里唯一。
 *
 * @param value - 外来值。
 * @returns 字段数组；`null` 表示清除。
 */
function templateFieldsOf(value: unknown): TemplateField[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail('fields 要是数组')
  if (value.length > TEMPLATE_LIMITS.fields) fail(`fields 最多 ${String(TEMPLATE_LIMITS.fields)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const field = templateFieldOf(entry, `fields[${String(index)}]`)
    if (seen.has(field.key)) fail('fields 的 key 重复')
    seen.add(field.key)
    return field
  })
}

/**
 * 记录引用的模板与当时的值；模板后来改动或删除都不影响这份快照。
 *
 * @param value - 外来值。
 * @returns 快照；`null` 表示清除。
 */
function templateSnapshotOf(value: unknown): TemplateSnapshot | null {
  if (value === null) return null
  if (!isRecord(value)) fail('template 要写成 { id, version, values }')
  if (typeof value.id !== 'string' || value.id === '' || value.id.length > 64) fail('template.id 不合法')
  if (!Number.isInteger(value.version) || (value.version as number) < 1) fail('template.version 要是正整数')
  if (!Array.isArray(value.values)) fail('template.values 要是数组')
  if (value.values.length > TEMPLATE_LIMITS.values) fail(`template.values 最多 ${String(TEMPLATE_LIMITS.values)} 项`)
  const seen = new Set<string>()
  const values = value.values.map((entry, index) => {
    const at = `template.values[${String(index)}]`
    if (!isRecord(entry)) fail(`${at} 要写成 { key, label, value }`)
    if (typeof entry.key !== 'string' || entry.key === '' || entry.key.length > TEMPLATE_LIMITS.keyLength) fail(`${at}.key 不合法`)
    if (seen.has(entry.key)) fail('template.values 的 key 重复')
    seen.add(entry.key)
    const label = titleOf(entry.label, `${at}.label`)
    if ([...label].length > TEMPLATE_LIMITS.labelLength) fail(`${at}.label 太长`)
    if (typeof entry.value !== 'string') fail(`${at}.value 要是文字`)
    if ([...entry.value].length > TEMPLATE_LIMITS.valueLength) fail(`${at}.value 太长`)
    return { key: entry.key, label, value: entry.value.trim() }
  })
  return { id: value.id, version: value.version as number, values }
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
  if (input.goal !== undefined) out.goal = textOf(input.goal, 'goal')
  if (input.purpose !== undefined) out.purpose = textOf(input.purpose, 'purpose')
  if (input.hypothesis !== undefined) out.hypothesis = textOf(input.hypothesis, 'hypothesis')
  if (input.steps !== undefined) out.steps = textOf(input.steps, 'steps')
  if (input.direction !== undefined || (kind === 'template' && mode === 'create')) out.direction = titleOf(input.direction, 'direction')
  if (input.fields !== undefined || (kind === 'template' && mode === 'create')) {
    const fields = templateFieldsOf(input.fields)
    if (fields === null || (kind === 'template' && mode === 'create' && fields.length === 0)) fail('模板至少需要一个字段')
    out.fields = fields
  }
  if (input.template !== undefined) out.template = templateSnapshotOf(input.template)
  if (input.judgment !== undefined) out.judgment = textOf(input.judgment, 'judgment')
  if (input.nextStep !== undefined) out.nextStep = textOf(input.nextStep, 'nextStep')
  if (input.blockers !== undefined) out.blockers = textOf(input.blockers, 'blockers')
  if (input.target !== undefined) out.target = textOf(input.target, 'target')
  if (input.authors !== undefined) out.authors = textOf(input.authors, 'authors')
  if (input.venue !== undefined) out.venue = textOf(input.venue, 'venue')
  if (input.year !== undefined) out.year = yearOf(input.year)
  if (input.url !== undefined) out.url = urlOf(input.url)
  if (kind === 'literature') Object.assign(out, literatureFieldsOf(input))
  if (input.understanding !== undefined) out.understanding = textOf(input.understanding, 'understanding')
  if (input.questions !== undefined) {
    out.questions = kind === 'topic' ? topicQuestionsOf(input.questions, 'questions') : textOf(input.questions, 'questions')
  }
  if (input.environment !== undefined) out.environment = textOf(input.environment, 'environment')
  if (input.seed !== undefined) out.seed = textOf(input.seed, 'seed')
  if (input.evaluation !== undefined) out.evaluation = textOf(input.evaluation, 'evaluation')
  if (input.failure !== undefined) out.failure = textOf(input.failure, 'failure')
  if (input.parameters !== undefined) out.parameters = entriesOf(input.parameters, 'parameters')
  if (input.checkpoints !== undefined) out.checkpoints = entriesOf(input.checkpoints, 'checkpoints')
  if (input.config !== undefined) out.config = entriesOf(input.config, 'config')
  if (input.metrics !== undefined) out.metrics = entriesOf(input.metrics, 'metrics')
  if (input.conclusion !== undefined) out.conclusion = textOf(input.conclusion, 'conclusion')
  if (input.conclusionBasis !== undefined) out.conclusionBasis = evidenceTextOf(input.conclusionBasis, 'conclusionBasis')
  if (input.conclusionScope !== undefined) out.conclusionScope = evidenceTextOf(input.conclusionScope, 'conclusionScope')
  if (input.conclusionEvidence !== undefined) out.conclusionEvidence = evidenceOf(input.conclusionEvidence, 'conclusionEvidence')
  if (input.blockedNote !== undefined) out.blockedNote = textOf(input.blockedNote, 'blockedNote')
  if (input.doneNote !== undefined) out.doneNote = textOf(input.doneNote, 'doneNote')
  if (input.related !== undefined) out.related = refsOf(input.related, 'related', REFERRABLE[kind])
  if (input.materials !== undefined) out.materials = materialsOf(input.materials, 'materials')
  if (input.artifacts !== undefined) out.artifacts = materialsOf(input.artifacts, 'artifacts')
  if (input.plan !== undefined) {
    if (input.plan === null) out.plan = null
    else {
      if (!isRecord(input.plan) || typeof input.plan.id !== 'string' || input.plan.id === '' || input.plan.id.length > 64) fail('plan 要写成 { kind: "research", id }')
      if (input.plan.kind !== 'research') fail('plan.kind 只能是 research')
      out.plan = { kind: 'research', id: input.plan.id }
    }
  }
  if (input.datasets !== undefined) out.datasets = runDatasetsOf(input.datasets)
  if (input.startedAt !== undefined) out.startedAt = runTimeOf(input.startedAt, 'startedAt')
  if (input.endedAt !== undefined) out.endedAt = runTimeOf(input.endedAt, 'endedAt')
  if (input.figures !== undefined) out.figures = figuresOf(input.figures, 'figures')
  if (input.submissions !== undefined) out.submissions = submissionsOf(input.submissions, 'submissions')
  if (input.revisions !== undefined) out.revisions = revisionsOf(input.revisions, 'revisions')
  if (input.chapters !== undefined) out.chapters = chaptersOf(input.chapters, 'chapters')
  if (input.results !== undefined) out.results = kind === 'run' ? runResultsOf(input.results) : thesisResultsOf(input.results, 'results')
  if (input.experiments !== undefined) out.experiments = experimentsOf(input.experiments, 'experiments')
  if (input.milestones !== undefined) out.milestones = kind === 'project' ? projectMilestonesOf(input.milestones, 'milestones') : thesisMilestonesOf(input.milestones, 'milestones')
  if (input.tasks !== undefined) out.tasks = projectTasksOf(input.tasks, 'tasks')
  if (input.deliverables !== undefined) out.deliverables = projectDeliverablesOf(input.deliverables, 'deliverables')
  if (input.communications !== undefined) out.communications = projectCommunicationsOf(input.communications, 'communications')
  if (input.issues !== undefined) out.issues = projectIssuesOf(input.issues, 'issues')
  if (input.requirements !== undefined) out.requirements = projectRequirementsOf(input.requirements, 'requirements')
  if (input.requirementChanges !== undefined) out.requirementChanges = requirementChangesOf(input.requirementChanges, 'requirementChanges')
  if (input.term !== undefined || (kind === 'course' && mode === 'create')) out.term = courseTermOf(input.term, 'term')
  if (input.work !== undefined) out.work = courseWorkOf(input.work, 'work')
  if (input.code !== undefined) out.code = kind === 'run' ? runCodeOf(input.code) : textOf(input.code, 'code')
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
  Object.assign(out, actionSourceOf(input, kind === 'action' && mode === 'create'))
  if (kind === 'action' && (input.status !== undefined || mode === 'create')) out.status = statusOf(input.status)
  if (kind === 'run' && (input.status !== undefined || mode === 'create')) out.status = runStatusOf(input.status)
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
  if (Array.isArray(value.related) && value.related.some(ref => isRecord(ref) && ref.id === value.id)) return '记录不能关联自身'
  if (typeof value.kind !== 'string' || !RECORD_KINDS.includes(value.kind as RecordKind)) return 'kind 不认识'
  if (value.schemaVersion !== RECORDS_FORMAT) return `schemaVersion 是 ${String(value.schemaVersion)}`
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) return 'revision 不合法'
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return '缺少时间'
  if (typeof value.archived !== 'boolean') return 'archived 不是布尔值'
  if (value.deletedAt !== undefined && (typeof value.deletedAt !== 'string' || Number.isNaN(Date.parse(value.deletedAt)))) return 'deletedAt 不合法'
  if (typeof value.title !== 'string' || value.title.trim() === '') return '缺少 title'
  if (value.kind === 'action' && (typeof value.status !== 'string' || !ACTION_STATUSES.includes(value.status as ActionStatus))) return 'status 不认识'
  if (value.kind === 'literature') {
    if (typeof value.stage !== 'string' || !LITERATURE_STAGES.includes(value.stage as LiteratureStage)) return 'stage 不认识'
    const literature = literatureProblem(value)
    if (literature !== null) return literature
  }
  if (value.kind === 'research') {
    if (typeof value.method !== 'string' || !RESEARCH_METHODS.includes(value.method as ResearchMethod)) return 'method 不认识'
    const evidence = evidenceProblem(value.conclusionEvidence)
    if (evidence !== null) return evidence
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
  if (value.kind === 'action') {
    const sourceProblem = actionSourceProblem(value)
    if (sourceProblem !== null) return sourceProblem
  }
  if (value.kind === 'chore' && (typeof value.status !== 'string' || !CHORE_STATUSES.includes(value.status as ChoreStatus))) return 'status 不认识'
  if (value.kind === 'topic') {
    const arraysProblem = topicArraysProblem(value)
    if (arraysProblem !== null) return arraysProblem
  }
  if (value.kind === 'template') {
    if (typeof value.direction !== 'string' || value.direction.trim() === '') return '缺少方向'
    if (!Array.isArray(value.fields) || value.fields.length === 0) return '缺少字段'
    const keys = new Set<string>()
    for (const entry of value.fields as unknown[]) {
      if (!isRecord(entry) || typeof entry.key !== 'string' || entry.key === '' || typeof entry.label !== 'string' || entry.label === '') return '字段缺少键或名称'
      if (keys.has(entry.key)) return '字段的键重复'
      keys.add(entry.key)
      if (!TEMPLATE_FIELD_TYPES.includes(entry.type as TemplateField['type'])) return '字段类型不认识'
      if (!TEMPLATE_FIELD_GROUPS.includes(entry.group as TemplateField['group'])) return '字段位置不认识'
    }
  }
  if ((value.kind === 'research' || value.kind === 'run') && value.template !== undefined) {
    if (!isRecord(value.template)) return 'template 不合法'
    if (typeof value.template.id !== 'string' || value.template.id === '') return 'template.id 不合法'
    if (!Number.isInteger(value.template.version) || (value.template.version as number) < 1) return 'template.version 不合法'
    if (!Array.isArray(value.template.values)) return 'template.values 不是数组'
    for (const entry of value.template.values as unknown[]) {
      if (!isRecord(entry) || typeof entry.key !== 'string' || entry.key === '' || typeof entry.label !== 'string' || typeof entry.value !== 'string') return 'template.values 不合法'
    }
  }
  if (value.kind === 'run') {
    if (typeof value.status !== 'string' || !RUN_STATUSES.includes(value.status as RunStatus)) return 'status 不认识'
    if (value.plan !== undefined) {
      if (!isRecord(value.plan) || typeof value.plan.id !== 'string' || value.plan.id === '' || value.plan.kind !== 'research') return 'plan 不合法'
    }
    if (value.code !== undefined) {
      if (!isRecord(value.code)) return 'code 不合法'
      for (const field of ['repository', 'commit'] as const) {
        if (value.code[field] !== undefined && typeof value.code[field] !== 'string') return `code.${field} 不合法`
      }
    }
    for (const field of ['datasets'] as const) {
      if (value[field] === undefined) continue
      if (!Array.isArray(value[field])) return `${field} 不是数组`
      const ids = new Set<string>()
      for (const entry of value[field] as unknown[]) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id === '' || typeof entry.name !== 'string' || entry.name === '') return `${field} 的条目缺少 id 或名称`
        if (ids.has(entry.id)) return `${field} 的 id 重复`
        ids.add(entry.id)
      }
    }
    for (const field of ['checkpoints', 'config', 'metrics'] as const) {
      if (value[field] === undefined) continue
      if (!Array.isArray(value[field])) return `${field} 不是数组`
      for (const entry of value[field] as unknown[]) {
        if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name === '' || typeof entry.value !== 'string' || entry.value === '') return `${field} 的条目缺少名称或数值`
        if (entry.unit !== undefined && (typeof entry.unit !== 'string' || entry.unit === '')) return `${field} 的单位不合法`
        if (entry.definition !== undefined && (typeof entry.definition !== 'string' || entry.definition === '')) return `${field} 的定义不合法`
      }
    }
    for (const field of ['startedAt', 'endedAt'] as const) {
      if (value[field] !== undefined && (typeof value[field] !== 'string' || Number.isNaN(Date.parse(value[field] as string)))) return `${field} 不合法`
    }
    if (value.results !== undefined) {
      if (!Array.isArray(value.results)) return 'results 不是数组'
      const ids = new Set<string>()
      for (const entry of value.results as unknown[]) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id === '') return 'results 的条目缺少 id'
        if (ids.has(entry.id)) return 'results 的 id 重复'
        ids.add(entry.id)
        if (entry.kind !== 'single' && entry.kind !== 'aggregate') return 'results 的 kind 不认识'
        if (typeof entry.text !== 'string' || entry.text.trim() === '') return 'results 的条目缺少内容'
        if (entry.sources !== undefined && (!Array.isArray(entry.sources) || entry.sources.some(source => typeof source !== 'string' || source === ''))) return 'results 的 sources 不合法'
        if (entry.kind === 'aggregate' && (entry.sources === undefined || entry.sources.length === 0) && entry.manual !== true) return 'results 的汇总没有来源运行时要标记 manual'
      }
    }
  }
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
