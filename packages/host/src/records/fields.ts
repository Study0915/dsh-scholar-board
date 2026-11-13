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
