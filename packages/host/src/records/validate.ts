/**
 * 领域记录的写入校验（D36）：字段、枚举、日期、引用与材料地址只在这里判定一次。
 *
 * 能力层的 JSON Schema 只挡住调用形状；业务规则在这里给出可读的拒绝。可选字段用 `null` 表示清除，
 * 空串按未填处理——存储里不出现用空串冒充有值的字段。
 */
import type {
  ActionStatus,
  DomainRecord,
  ManuscriptStage,
  MaterialRef,
  RecordKind,
  RecordRef,
  StageEntry,
} from '@dsh-scholar-board/contracts'
import type { Due } from '@dsh-scholar-board/contracts/campus'
import { RECORDS_FORMAT, RECORDS_LIMITS, isOpenableUrl } from '@dsh-scholar-board/contracts'
import { validZone } from '@dsh-scholar-board/model'
import { isRecord } from '../guards'
import { Refusal } from '../refusal'

/** 三种记录。 */
export const RECORD_KINDS: readonly RecordKind[] = ['meeting', 'action', 'manuscript']

/** 行动项的五个状态。 */
export const ACTION_STATUSES: readonly ActionStatus[] = ['todo', 'doing', 'blocked', 'done', 'cancelled']

/** 稿件的八个阶段。 */
export const MANUSCRIPT_STAGES: readonly ManuscriptStage[] = ['idea', 'experiment', 'writing', 'internal-review', 'submitted', 'revision', 'accepted', 'archived']

/** 每种记录可写的字段；系统字段与阶段历史不在这张表里。 */
const WRITABLE: Record<RecordKind, readonly string[]> = {
  meeting: ['title', 'date', 'topics', 'feedback', 'openQuestions', 'related', 'materials', 'derivedFrom'],
  action: ['title', 'status', 'due', 'source', 'related', 'blockedNote', 'doneNote', 'materials'],
  manuscript: ['title', 'question', 'stage', 'stageNote', 'nextStep', 'blockers', 'target', 'due', 'related', 'materials'],
}

/** 每种记录允许指向的引用类型。 */
const REFERRABLE: Record<RecordKind, readonly RecordKind[]> = {
  meeting: ['manuscript'],
  action: ['meeting', 'manuscript'],
  manuscript: ['meeting', 'action'],
}

/** 搜索和展示时要读的文本字段。 */
const TEXT_FIELDS = ['title', 'topics', 'feedback', 'openQuestions', 'question', 'nextStep', 'blockers', 'target', 'blockedNote', 'doneNote'] as const

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/

/**
 * 一条拒绝：字段名与原因写在一起，卡片直接显示这一句。
 *
 * @param message - 读得懂的说法。
 * @throws {Refusal} 总是抛出，400。
 */
function fail(message: string): never {
  throw new Refusal(400, message)
}

/**
 * 一段必填标题：去空白后非空，按 Unicode 码点计不超过上限。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 去空白之后的标题。
 */
function titleOf(value: unknown, field: string): string {
  if (typeof value !== 'string') fail(`${field} 要是文字`)
  const wanted = value.trim()
  if (wanted === '') fail(`${field} 不能是空的`)
  if ([...wanted].length > RECORDS_LIMITS.titleLength) fail(`${field} 最多 ${String(RECORDS_LIMITS.titleLength)} 个字符`)
  return wanted
}

/**
 * 一段可选文字：空串与 `null` 都表示未填。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 去空白之后的文字；未填时是 `null`。
 */
function textOf(value: unknown, field: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') fail(`${field} 要是文字`)
  const wanted = value.trim()
  return wanted === '' ? null : wanted
}

/**
 * 一个可选日期或时刻；时区必须是有效的 IANA 名。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 校验过的日期；未填时是 `null`。
 */
function dueOf(value: unknown, field: string): Due | null {
  if (value === null) return null
  if (!isRecord(value)) fail(`${field} 要写成 { kind, date 或 at, timeZone }`)
  const zone = value.timeZone
  if (typeof zone !== 'string' || zone.length > 64 || !validZone(zone)) fail(`${field} 的时区不是有效的 IANA 名`)
  if (value.kind === 'date') {
    const match = typeof value.date === 'string' ? DATE_PATTERN.exec(value.date) : null
    if (match === null) fail(`${field} 的日期要写成 YYYY-MM-DD`)
    const [, year, month, day] = match.map(Number)
    const calendar = new Date(Date.UTC(year as number, (month as number) - 1, day as number))
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== (month as number) - 1 || calendar.getUTCDate() !== day) {
      fail(`${field} 的日期不存在`)
    }
    return { kind: 'date', date: value.date as string, timeZone: zone }
  }
  if (value.kind === 'instant') {
    if (typeof value.at !== 'string' || !INSTANT_PATTERN.test(value.at) || Number.isNaN(Date.parse(value.at))) {
      fail(`${field} 的时刻要写成以 Z 结尾的 UTC ISO 字符串`)
    }
    return { kind: 'instant', at: value.at, timeZone: zone }
  }
  fail(`${field}.kind 只能是 date 或 instant`)
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
 * 一组材料引用：地址只收 http/https，记录内局部键不重复。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 材料表；未填时是 `null`。
 */
function materialsOf(value: unknown, field: string): MaterialRef[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail(`${field} 要是数组`)
  if (value.length > RECORDS_LIMITS.materials) fail(`${field} 最多 ${String(RECORDS_LIMITS.materials)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${field}[${String(index)}] 要写成 { id, url, title }`)
    if (typeof entry.id !== 'string' || entry.id === '' || entry.id.length > 64) fail(`${field}[${String(index)}].id 不合法`)
    if (seen.has(entry.id)) fail(`${field} 里的材料 id 重复`)
    seen.add(entry.id)
    if (!isOpenableUrl(entry.url)) fail(`${field}[${String(index)}].url 只收 http/https 的完整地址`)
    const title = titleOf(entry.title, `${field}[${String(index)}].title`)
    const note = entry.note === undefined ? null : textOf(entry.note, `${field}[${String(index)}].note`)
    return { id: entry.id, url: entry.url, title, ...(note === null ? {} : { note }) }
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
  if (input.question !== undefined) out.question = textOf(input.question, 'question')
  if (input.nextStep !== undefined) out.nextStep = textOf(input.nextStep, 'nextStep')
  if (input.blockers !== undefined) out.blockers = textOf(input.blockers, 'blockers')
  if (input.target !== undefined) out.target = textOf(input.target, 'target')
  if (input.blockedNote !== undefined) out.blockedNote = textOf(input.blockedNote, 'blockedNote')
  if (input.doneNote !== undefined) out.doneNote = textOf(input.doneNote, 'doneNote')
  if (input.related !== undefined) out.related = refsOf(input.related, 'related', REFERRABLE[kind])
  if (input.materials !== undefined) out.materials = materialsOf(input.materials, 'materials')
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
  if (value.kind === 'manuscript') {
    if (typeof value.stage !== 'string' || !MANUSCRIPT_STAGES.includes(value.stage as ManuscriptStage)) return 'stage 不认识'
    if (!Array.isArray(value.stageHistory)) return '缺少 stageHistory'
    for (const entry of value.stageHistory as unknown[]) {
      if (!isRecord(entry) || typeof entry.stage !== 'string' || !MANUSCRIPT_STAGES.includes(entry.stage as ManuscriptStage)) return 'stageHistory 不合法'
      if (typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))) return 'stageHistory 的时间不合法'
    }
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
