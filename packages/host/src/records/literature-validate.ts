/**
 * 文献记录的深化字段：DOI、arXiv id/版本、形态、版本关联与阅读记录。
 *
 * 标识按 `literature-identifiers` 的同一套规则规范化；写进来的值不合法时直接拒绝，
 * 读盘时只报告问题，不抛出。
 */
import type { LiteratureFormat, ReadingEntry, RecordRef } from '@dsh-scholar-board/contracts'
import { LITERATURE_FORMATS, RECORDS_LIMITS, normalizeArxivId, normalizeArxivVersion, normalizeDoi } from '@dsh-scholar-board/contracts'
import { isRecord } from '../guards'
import { dueOf, fail, textOf } from './fields'

/**
 * 一段阅读记录里的文字。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 去空白后的文字；未填时是 `null`。
 */
function readingText(value: unknown, field: string): string | null {
  const text = textOf(value, field)
  if (text !== null && [...text].length > RECORDS_LIMITS.readingText) {
    fail(`${field} 最多 ${String(RECORDS_LIMITS.readingText)} 个字符`)
  }
  return text
}

/**
 * 文献标识：DOI 与 arXiv 主 id/版本都按规范化后的形式保存。
 *
 * @param input - 外来字段。
 * @returns 规范化后的标识；未填的字段不出现在结果里。
 */
export interface LiteratureIdentifiers {
  doi?: string | null
  arxivId?: string | null
  arxivVersion?: string | null
  format?: LiteratureFormat | null
}

export function literatureIdentifiersOf(input: Record<string, unknown>): LiteratureIdentifiers {
  const out: LiteratureIdentifiers = {}
  if (input.doi !== undefined) {
    if (input.doi === null) out.doi = null
    else {
      const doi = normalizeDoi(input.doi)
      if (doi === null) fail('doi 要写成 10.xxxx/… 的形式')
      out.doi = doi
    }
  }
  if (input.arxivId !== undefined) {
    if (input.arxivId === null) out.arxivId = null
    else {
      const arxivId = normalizeArxivId(input.arxivId)
      if (arxivId === null) fail('arxivId 要写成 2401.12345 或 hep-th/9901001 的形式')
      out.arxivId = arxivId
    }
  }
  if (input.arxivVersion !== undefined) {
    if (input.arxivVersion === null) out.arxivVersion = null
    else {
      const version = normalizeArxivVersion(input.arxivVersion)
      if (version === null) fail('arxivVersion 要写成 v1、v2 这样的形式')
      out.arxivVersion = version
    }
  }
  if (input.format !== undefined) {
    if (input.format === null) out.format = null
    else if (typeof input.format !== 'string' || !LITERATURE_FORMATS.includes(input.format as (typeof LITERATURE_FORMATS)[number])) {
      fail(`format 只能是 ${LITERATURE_FORMATS.join('、')}`)
    } else {
      out.format = input.format as LiteratureFormat
    }
  }
  return out
}

/** 文献深化字段的规范化结果；未出现的字段不覆盖。 */
export interface LiteratureFields extends LiteratureIdentifiers {
  versions?: RecordRef[] | null
  reading?: ReadingEntry[] | null
}

/**
 * 规范化文献的深化字段。
 *
 * @param input - 外来字段。
 * @returns 规范化后的字段；未出现的字段不覆盖。
 */
export function literatureFieldsOf(input: Record<string, unknown>): LiteratureFields {
  const out: LiteratureFields = { ...literatureIdentifiersOf(input) }
  if (input.versions !== undefined) out.versions = literatureVersionsOf(input.versions, 'versions')
  if (input.reading !== undefined) out.reading = readingEntriesOf(input.reading, 'reading')
  return out
}

/**
 * 同一工作的其他版本：只指向文献记录，id 不重复。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 版本引用；未填时是 `null`。
 */
export function literatureVersionsOf(value: unknown, field: string): RecordRef[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail(`${field} 要是数组`)
  if (value.length > RECORDS_LIMITS.literatureVersions) fail(`${field} 最多 ${String(RECORDS_LIMITS.literatureVersions)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`${field}[${String(index)}] 要写成 { kind: 'literature', id }`)
    if (entry.kind !== 'literature') fail(`${field}[${String(index)}].kind 只能是 literature`)
    if (typeof entry.id !== 'string' || entry.id === '' || entry.id.length > 64) fail(`${field}[${String(index)}].id 不合法`)
    if (seen.has(entry.id)) fail(`${field} 里有重复的版本`)
    seen.add(entry.id)
    return { kind: 'literature', id: entry.id }
  })
}

/**
 * 阅读记录：稳定 id、位置、笔记、理解、疑问、待复现事项与日期。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 阅读条目；未填时是 `null`。
 */
export function readingEntriesOf(value: unknown, field: string): ReadingEntry[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail(`${field} 要是数组`)
  if (value.length > RECORDS_LIMITS.readingEntries) fail(`${field} 最多 ${String(RECORDS_LIMITS.readingEntries)} 项`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const at = `${field}[${String(index)}]`
    if (!isRecord(entry)) fail(`${at} 要写成 { id, location?, note? }`)
    if (typeof entry.id !== 'string' || entry.id === '' || entry.id.length > 64) fail(`${at}.id 不合法`)
    if (seen.has(entry.id)) fail(`${field} 里的阅读条目 id 重复`)
    seen.add(entry.id)
    const location = readingText(entry.location, `${at}.location`)
    const note = readingText(entry.note, `${at}.note`)
    const understanding = readingText(entry.understanding, `${at}.understanding`)
    const questions = readingText(entry.questions, `${at}.questions`)
    const reproduce = readingText(entry.reproduce, `${at}.reproduce`)
    const date = entry.at === undefined || entry.at === null ? null : dueOf(entry.at, `${at}.at`)
    if (entry.actionId !== undefined && entry.actionId !== null
      && (typeof entry.actionId !== 'string' || entry.actionId === '' || entry.actionId.length > 64)) {
      fail(`${at}.actionId 不合法`)
    }
    return {
      id: entry.id,
      ...(location === null ? {} : { location }),
      ...(note === null ? {} : { note }),
      ...(understanding === null ? {} : { understanding }),
      ...(questions === null ? {} : { questions }),
      ...(reproduce === null ? {} : { reproduce }),
      ...(date === null ? {} : { at: date }),
      ...(typeof entry.actionId === 'string' ? { actionId: entry.actionId } : {}),
    }
  })
}

/**
 * 落盘文献的深化字段形状；读取旧文件时只报问题，不抛出。
 *
 * @param value - 存储里的文献记录。
 * @returns 问题说明；通过时是 `null`。
 */
export function literatureProblem(value: Record<string, unknown>): string | null {
  if (value.doi !== undefined && normalizeDoi(value.doi) === null) return 'doi 不合法'
  if (value.arxivId !== undefined && normalizeArxivId(value.arxivId) === null) return 'arxivId 不合法'
  if (value.arxivVersion !== undefined && normalizeArxivVersion(value.arxivVersion) === null) return 'arxivVersion 不合法'
  if (value.format !== undefined && (typeof value.format !== 'string' || !LITERATURE_FORMATS.includes(value.format as (typeof LITERATURE_FORMATS)[number]))) return 'format 不合法'
  const versions = value.versions
  if (versions !== undefined) {
    if (!Array.isArray(versions) || versions.length > RECORDS_LIMITS.literatureVersions) return 'versions 不合法'
    const seen = new Set<string>()
    for (const entry of versions as unknown[]) {
      if (!isRecord(entry) || entry.kind !== 'literature' || typeof entry.id !== 'string' || entry.id === '') return 'versions 的引用不合法'
      if (seen.has(entry.id)) return 'versions 里有重复的版本'
      seen.add(entry.id)
    }
  }
  const reading = value.reading
  if (reading !== undefined) {
    if (!Array.isArray(reading) || reading.length > RECORDS_LIMITS.readingEntries) return 'reading 不合法'
    const seen = new Set<string>()
    for (const entry of reading as unknown[]) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id === '') return 'reading 的条目 id 不合法'
      if (seen.has(entry.id)) return 'reading 里的条目 id 重复'
      seen.add(entry.id)
    }
  }
  return null
}
