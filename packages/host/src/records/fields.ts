/**
 * 记录字段校验的共用零件：拒绝、标题、短文本、日期与材料。
 *
 * 这些判定被多种记录类型共用；放在这里让记录校验与论文字段校验读同一份规则。
 */
import type { MaterialRef } from '@dsh-scholar-board/contracts'
import type { Due } from '@dsh-scholar-board/contracts/campus'
import { RECORDS_LIMITS, isOpenableUrl } from '@dsh-scholar-board/contracts'
import { validZone } from '@dsh-scholar-board/model'
import { isRecord } from '../guards'
import { Refusal } from '../refusal'

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/

/**
 * 一条拒绝：字段名与原因写在一起，卡片直接显示这一句。
 *
 * @param message - 读得懂的说法。
 * @throws {Refusal} 总是抛出，400。
 */
export function fail(message: string): never {
  throw new Refusal(400, message)
}

/**
 * 一段必填标题：去空白后非空，按 Unicode 码点计不超过上限。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 去空白之后的标题。
 */
export function titleOf(value: unknown, field: string): string {
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
export function textOf(value: unknown, field: string): string | null {
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
export function dueOf(value: unknown, field: string): Due | null {
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
 * 一组材料引用：地址只收 http/https，记录内局部键不重复。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 材料表；未填时是 `null`。
 */
export function materialsOf(value: unknown, field: string): MaterialRef[] | null {
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
 * 一组带稳定 id 的条目：数组、容量与 id 唯一由这里统一把关。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @param limit - 条数上限。
 * @param shape - 条目该写成的样子，用在出错提示里。
 * @returns 条目数组；未填时是 `null`。
 */
export function idItemsOf(value: unknown, field: string, limit: number, shape: string): Record<string, unknown>[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail(`${field} 要是数组`)
  if (value.length > limit) fail(`${field} 最多 ${String(limit)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${field}[${String(index)}] 要写成 ${shape}`)
    if (typeof entry.id !== 'string' || entry.id === '' || entry.id.length > 64) fail(`${field}[${String(index)}].id 不合法`)
    if (seen.has(entry.id)) fail(`${field} 里的 id 重复`)
    seen.add(entry.id)
    return entry
  })
}

/**
 * 一组条目共有的可选内容：日期、说明与材料，缺省时不写进结果。
 *
 * 项目事项、交付物与后续同类条目都读这一份，免得每处各写一遍三样判断。
 *
 * @param entry - 一条已通过 id 校验的条目。
 * @param field - 出错时指人。
 * @returns 只含有值的那几项。
 */
export function extrasOf(entry: Record<string, unknown>, field: string): { due?: Due, note?: string, materials?: MaterialRef[] } {
  const due = entry.due === undefined ? null : dueOf(entry.due, `${field}.due`)
  const note = entry.note === undefined ? null : textOf(entry.note, `${field}.note`)
  const materials = entry.materials === undefined ? null : materialsOf(entry.materials, `${field}.materials`)
  return {
    ...(due === null ? {} : { due }),
    ...(note === null ? {} : { note }),
    ...(materials === null ? {} : { materials }),
  }
}

/** 标题与状态都过关的一行，章节、待补实验与项目事项共用。 */
export interface TitledRow {
  entry: Record<string, unknown>
  index: number
  title: string
}

/** 带标题与状态的一组条目：标题必填，状态只认给定的一组。 */
export function titledRowsOf(value: unknown, field: string, limit: number, statuses: readonly string[]): TitledRow[] | null {
  const rows = idItemsOf(value, field, limit, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    const title = titleOf(entry.title, `${field}[${String(index)}].title`)
    if (typeof entry.status !== 'string' || !statuses.includes(entry.status)) {
      fail(`${field}[${String(index)}].status 只能是 ${statuses.join('、')}`)
    }
    return { entry, index, title }
  })
}

/** 标题、状态与可选说明都过关的一行，待补实验与待确认问题共用。 */
export interface TitledNoteRow {
  id: string
  title: string
  status: string
  note?: string
}

/** 只有标题、状态与一句可选说明的一组条目。 */
export function titledNoteRowsOf(value: unknown, field: string, limit: number, statuses: readonly string[]): TitledNoteRow[] | null {
  const rows = titledRowsOf(value, field, limit, statuses)
  if (rows === null) return null
  return rows.map(({ entry, index, title }) => {
    const note = entry.note === undefined ? null : textOf(entry.note, `${field}[${String(index)}].note`)
    return { id: entry.id as string, title, status: entry.status as string, ...(note === null ? {} : { note }) }
  })
}

/** 名称、状态与可选日期都过关的一行，学位节点与验收节点共用。 */
export interface LabeledMilestoneRow {
  id: string
  label: string
  status: string
  due?: Due
  note?: string
}

/** 名称必填、日期与说明可留空的一组节点；状态由调用方给。 */
export function labeledMilestonesOf(value: unknown, field: string, limit: number, statuses: readonly string[]): LabeledMilestoneRow[] | null {
  const rows = idItemsOf(value, field, limit, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    if (typeof entry.label !== 'string' || entry.label.trim() === '') fail(`${field}[${String(index)}].label 不能是空的`)
    const label = entry.label.trim()
    if ([...label].length > RECORDS_LIMITS.milestoneLabelLength) fail(`${field}[${String(index)}].label 最多 ${String(RECORDS_LIMITS.milestoneLabelLength)} 个字符`)
    if (typeof entry.status !== 'string' || !statuses.includes(entry.status)) {
      fail(`${field}[${String(index)}].status 只能是 ${statuses.join('、')}`)
    }
    const due = entry.due === undefined ? null : dueOf(entry.due, `${field}[${String(index)}].due`)
    const note = entry.note === undefined ? null : textOf(entry.note, `${field}[${String(index)}].note`)
    return {
      id: entry.id as string,
      label,
      status: entry.status,
      ...(due === null ? {} : { due }),
      ...(note === null ? {} : { note }),
    }
  })
}
