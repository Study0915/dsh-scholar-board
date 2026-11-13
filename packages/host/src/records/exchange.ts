/**
 * 领域记录的导出与导入（D36）：`.dshrecords` 是 gzip 的 JSON 包，材料只随文本保存地址。
 *
 * 导出默认只含活跃记录，归档与回收站由调用方勾选。导入整包校验后一次写入：包内每条 id 重映射成
 * 新的 UUID，前向引用经同一张映射表改写，关联保留；指向包外且不存在的 id 保持悬空。任一记录不合法、
 * 重复或超出工作区容量时整批拒绝，不留半份。
 */
import { randomUUID } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { DomainRecord, RecordKind } from '@dsh-scholar-board/contracts'
import { RECORDS_LIMITS } from '@dsh-scholar-board/contracts'
import { isRecord } from '../guards'
import { Refusal } from '../refusal'
import type { RecordsStore } from './store'
import { assertRecordWritable, recordBytes, storedProblem } from './validate'

/** 导出包的格式版本。 */
export const RECORDS_EXPORT_FORMAT = 1

/** 导入包解压之后最多这么大：工作区总字节上限的四倍，挡住压缩炸弹。 */
export const IMPORT_UNPACKED_LIMIT = 64 * 1024 * 1024

/** 导出时勾选的范围。 */
export interface ExportScope {
  includeArchived: boolean
  includeTrashed: boolean
  kinds?: RecordKind[]
}

/** 一次导入的预览；不改动任何记录。 */
export interface ImportPreview {
  format: number
  exportedAt: string | null
  scope: unknown
  total: number
  byKind: Record<RecordKind, number>
  active: number
  archived: number
  trashed: number
  bytes: number
}

/** 一个导出包读出来的内容。 */
interface RecordsPackage {
  format: number
  exportedAt: string | null
  scope: unknown
  records: DomainRecord[]
}

/**
 * 把符合条件的记录打成一个 `.dshrecords`。
 *
 * @param store - 记录存储。
 * @param scope - 勾选的范围。
 * @param now - 导出时刻。
 * @returns gzip 之后的包。
 */
export function exportRecords(store: RecordsStore, scope: ExportScope, now: number): Buffer {
  const records = store.snapshot({ includeArchived: scope.includeArchived, includeTrashed: scope.includeTrashed })
    .filter((record) => scope.kinds === undefined || scope.kinds.includes(record.kind))
  const body = {
    format: RECORDS_EXPORT_FORMAT,
    exportedAt: new Date(now).toISOString(),
    scope,
    records,
  }
  return gzipSync(Buffer.from(`${JSON.stringify(body, null, 2)}\n`, 'utf8'))
}

/**
 * 读一个导入包：格式、版本与每条记录都要合法。
 *
 * @param bytes - 包的全部字节。
 * @returns 解出来的内容。
 * @throws {Refusal} 不是 gzip JSON、版本不认识、记录不合法或解压后超限，400。
 */
export function readRecordsPackage(bytes: Buffer): RecordsPackage {
  let parsed: unknown
  try {
    parsed = JSON.parse(gunzipSync(bytes, { maxOutputLength: IMPORT_UNPACKED_LIMIT }).toString('utf8')) as unknown
  } catch (error) {
    throw new Refusal(400, `这不是可读的 .dshrecords 文件：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(parsed) || parsed.format !== RECORDS_EXPORT_FORMAT || !Array.isArray(parsed.records)) {
    throw new Refusal(400, '记录包的 format 不是 1，或缺少 records 数组')
  }
  const records = parsed.records.map((entry, index) => {
    const problem = storedProblem(entry)
    if (problem !== null) throw new Refusal(400, `记录包第 ${String(index + 1)} 条不合法：${problem}`)
    const record = entry as DomainRecord
    assertRecordWritable(record)
    if (recordBytes(record) > RECORDS_LIMITS.recordBytes) {
      throw new Refusal(400, `记录包第 ${String(index + 1)} 条超过 ${String(RECORDS_LIMITS.recordBytes)} 字节`)
    }
    return record
  })
  return {
    format: RECORDS_EXPORT_FORMAT,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
    scope: parsed.scope ?? null,
    records,
  }
}

/**
 * 一次导入的预览：条数、类型、生命周期分布与序列化大小，供确认页显示。
 *
 * @param bytes - 包的全部字节。
 * @returns 预览。
 */
export function previewRecords(bytes: Buffer): ImportPreview {
  const pkg = readRecordsPackage(bytes)
  const byKind: Record<RecordKind, number> = { meeting: 0, action: 0, manuscript: 0, literature: 0, research: 0, thesis: 0, project: 0 }
  let active = 0
  let archived = 0
  let trashed = 0
  let size = 0
  for (const record of pkg.records) {
    byKind[record.kind] += 1
    size += recordBytes(record)
    if (record.deletedAt !== undefined) trashed += 1
    else if (record.archived) archived += 1
    else active += 1
  }
  return {
    format: pkg.format,
    exportedAt: pkg.exportedAt,
    scope: pkg.scope,
    total: pkg.records.length,
    byKind,
    active,
    archived,
    trashed,
    bytes: size,
  }
}

/**
 * 导入一个包：id 全部重映射，前向引用经同一张表改写，整批一次写入。
 *
 * @param store - 记录存储。
 * @param bytes - 包的全部字节。
 * @param now - 导入时刻。
 * @returns 导入的条数。
 * @throws {Refusal} 包不合法、记录重复或超出工作区容量。
 */
export async function importRecords(store: RecordsStore, bytes: Buffer, now: number): Promise<number> {
  const pkg = readRecordsPackage(bytes)
  const mapping = new Map<string, string>()
  for (const record of pkg.records) mapping.set(record.id, randomUUID())
  const at = new Date(now).toISOString()
  const remapped = pkg.records.map((record) => {
    const copy = JSON.parse(JSON.stringify(record)) as DomainRecord & { related?: { kind: RecordKind, id: string }[], source?: { kind: RecordKind, id: string }, derivedFrom?: string }
    copy.id = mapping.get(record.id) as string
    copy.revision = 1
    copy.updatedAt = at
    copy.lastEditedBy = { widget: 'records.import', instance: 'records.import' }
    if (Array.isArray(copy.related)) {
      copy.related = copy.related.map((ref) => ({ ...ref, id: mapping.get(ref.id) ?? ref.id }))
    }
    if (copy.source !== undefined) {
      copy.source = { ...copy.source, id: mapping.get(copy.source.id) ?? copy.source.id }
    }
    if (typeof copy.derivedFrom === 'string') {
      copy.derivedFrom = mapping.get(copy.derivedFrom) ?? copy.derivedFrom
    }
    return copy as DomainRecord
  })
  return await store.importMany(remapped)
}

/**
 * 导出文件的名字：日期在名字里，全部是 ASCII。
 *
 * @param now - 导出时刻。
 * @returns 文件名。
 */
export function exportFileName(now: number): string {
  const date = new Date(now).toISOString().slice(0, 10).replaceAll('-', '')
  return `dsh-scholar-records-${date}.dshrecords`
}
