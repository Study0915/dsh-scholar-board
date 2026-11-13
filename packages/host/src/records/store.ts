/**
 * 领域记录的共享存储（D36）：`$DSH_HOME/widget-board/records.json`，宿主独占读写。
 *
 * 首批整份一份文件：记录之间互相引用，一次原子写入就让关联与跨视图一致没有跨文件窗口。写入走串行
 * 队列＋临时文件改名；更新核对 expectedRevision，成功之后修订号加一。回收站里的记录满三十天在
 * 读盘与每次写入时清除。整份文件的大小与条数由上限收住，拆分的时机见 D36 的重审条件。
 */
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type {
  DomainRecord,
  ManuscriptRecord,
  RecordKind,
  RecordQuery,
  RecordWriteResult,
  RecordsQuota,
  RecordsView,
} from '@dsh-scholar-board/contracts'
import { RECORDS_FORMAT, RECORDS_LIMITS, RECORDS_PAGE } from '@dsh-scholar-board/contracts'
import { createWriteQueue, writeJsonFile } from '../disk'
import { isRecord } from '../guards'
import { Refusal } from '../refusal'
import { normalizeInput, recordBytes, searchTextOf, stageEntryOf, storedProblem } from './validate'

/** 一次写入来自哪张卡片；由宿主填写，组件伪造不了。 */
export interface RecordActor {
  widget: string
  instance: string
}

/** 记录存储。 */
export interface RecordsStore {
  /** 盘上的那份文件。 */
  readonly file: string
  /** 按筛选条件读一份快照；默认是全部活跃记录。 */
  view(query?: RecordQuery): RecordsView
  /** 按同样的筛选条件读出全部记录，不分页：导出与容量核对用。 */
  snapshot(query?: RecordQuery): DomainRecord[]
  /**
   * 一次导入多条已经校验过、id 已重映射的记录；任一重复、超限或到顶都整批拒绝。
   *
   * @param records - 要加入的记录。
   * @returns 导入的条数。
   */
  importMany(records: DomainRecord[]): Promise<number>
  /**
   * 一条记录。
   *
   * @param id - 记录 id。
   * @returns 那条记录；不在存储里时是 `undefined`。
   */
  get(id: string): DomainRecord | undefined
  /** 新建一条记录；`input` 是除系统字段之外的字段。 */
  create(input: unknown, actor: RecordActor): Promise<RecordWriteResult>
  /** 更新一条记录；`expectedRevision` 过期时拒绝。 */
  update(id: string, expectedRevision: number, patch: unknown, actor: RecordActor): Promise<RecordWriteResult>
  /** 归档；已经归档时原样返回。 */
  archive(id: string, expectedRevision: number, actor: RecordActor): Promise<RecordWriteResult>
  /** 恢复：回收站里的清除回收标记，归档的清除归档标记。 */
  restore(id: string, expectedRevision: number, actor: RecordActor): Promise<RecordWriteResult>
  /** 移入回收站；不级联。 */
  trash(id: string, expectedRevision: number, actor: RecordActor): Promise<RecordWriteResult>
  /** 记录有变化时回调；返回退订。 */
  onChange(listener: () => void): () => void
  /** 等写入队列清空。 */
  settled(): Promise<void>
}

/** 磁盘上的形状。 */
interface RecordsFile {
  version: number
  records: DomainRecord[]
}

const TRASH_MS = RECORDS_LIMITS.trashDays * 24 * 60 * 60 * 1000

/**
 * 读一份 JSON；文件不存在时是 `null`。
 *
 * @param file - 文件路径。
 * @returns 解析后的 JSON。
 * @throws {Error} 文件读不出来或不是合法 JSON；原文件保留。
 */
async function readJsonOrNull(file: string): Promise<unknown> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(`${file} 不是合法 JSON，原文件保留：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 打开记录存储：读盘、清掉过期的回收站条目，返回唯一的写入者。
 *
 * @param file - `$DSH_HOME/widget-board/records.json`。
 * @param options - `now` 供测试注入时钟；`limits` 供测试压小条数与字节上限。
 * @returns 记录存储。
 * @throws {Error} 格式版本不认识或某条记录不合法；原文件保留。
 */
export async function openRecords(file: string, options: { now?: () => number, limits?: { records: number, bytes: number } } = {}): Promise<RecordsStore> {
  const now = options.now ?? Date.now
  const limits = { records: options.limits?.records ?? RECORDS_LIMITS.records, bytes: options.limits?.bytes ?? RECORDS_LIMITS.bytes }
  const parsed = await readJsonOrNull(file)
  let records: DomainRecord[] = []
  if (parsed !== null) {
    if (!isRecord(parsed) || !Number.isInteger(parsed.version) || !Array.isArray(parsed.records)) {
      throw new Error(`${file} 不是记录文件，原文件保留`)
    }
    if (parsed.version !== RECORDS_FORMAT) {
      throw new Error(`${file} 的格式版本是 ${String(parsed.version)}，这个宿主只认 ${RECORDS_FORMAT}；原文件保留`)
    }
    records = (parsed.records as unknown[]).map((entry, index) => {
      const problem = storedProblem(entry)
      if (problem !== null) throw new Error(`${file} 里第 ${String(index + 1)} 条记录不合法（${problem}），原文件保留`)
      return entry as DomainRecord
    })
  }

  const queue = createWriteQueue()
  let bytes = records.reduce((total, record) => total + recordBytes(record), 0)
  const listeners = new Set<() => void>()

  /**
   * 清掉三十天前移入回收站的记录。
   *
   * @returns 有没有删掉东西。
   */
  const purge = (): boolean => {
    const cutoff = now() - TRASH_MS
    const kept = records.filter((record) => record.deletedAt === undefined || Date.parse(record.deletedAt) > cutoff)
    if (kept.length === records.length) return false
    records = kept
    bytes = records.reduce((total, record) => total + recordBytes(record), 0)
    return true
  }

  // 读盘时清一次：过期的回收站条目不该等到下一次写入才消失。
  if (purge()) await writeJsonFile(file, { version: RECORDS_FORMAT, records } satisfies RecordsFile)

  /** 现在的用量。 */
  const quota = (): RecordsQuota => ({
    count: records.length,
    bytes,
    countLimit: limits.records,
    bytesLimit: limits.bytes,
    warning: records.length >= limits.records * RECORDS_LIMITS.warnRatio || bytes >= limits.bytes * RECORDS_LIMITS.warnRatio,
  })

  /** 写盘并通知；通知的异常不退回给写入方。 */
  const persist = async (): Promise<void> => {
    await writeJsonFile(file, { version: RECORDS_FORMAT, records } satisfies RecordsFile)
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        console.error(`widget-board: 记录变更通知失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /**
   * 在队列里做一次写入：先清过期回收站，再执行改动，最后写盘。
   *
   * @param run - 由当前记录算出下一条要替换的列表与结果。
   * @returns 操作自己的结果。
   */
  const mutate = async <T>(run: () => { next: DomainRecord[], result: T }): Promise<T> => {
    return await queue(async () => {
      purge()
      const { next, result } = run()
      const nextBytes = next.reduce((total, record) => total + recordBytes(record), 0)
      if (next.length > limits.records || nextBytes > limits.bytes) {
        throw new Refusal(409, `工作区记录已达上限（${String(records.length)}/${String(limits.records)} 条，${String(bytes)}/${String(limits.bytes)} 字节）；先整理归档或回收站`, { code: 'records-limit', quota: quota() })
      }
      records = next
      bytes = nextBytes
      await persist()
      return result
    })
  }

  const find = (id: string): DomainRecord => {
    const found = records.find((record) => record.id === id)
    if (found === undefined) throw new Refusal(404, `没有这条记录：${id}`, { code: 'record-missing' })
    return found
  }

  const checkRevision = (record: DomainRecord, expectedRevision: number): void => {
    if (record.revision !== expectedRevision) {
      throw new Refusal(409, `修订号已过期：期望 ${String(expectedRevision)}，当前 ${String(record.revision)}`, { code: 'stale-revision', revision: record.revision, record })
    }
  }

  const replace = (record: DomainRecord): DomainRecord[] => records.map((entry) => entry.id === record.id ? record : entry)

  /** 按筛选条件过滤，不分页；`view` 与导出共用这一份判定。 */
  const filtered = (query: RecordQuery): DomainRecord[] => {
    const search = query.search?.trim().toLowerCase()
    const ids = query.ids === undefined ? undefined : new Set(query.ids)
    return records.filter((record) => {
      if (query.kind !== undefined && record.kind !== query.kind) return false
      if (ids !== undefined && !ids.has(record.id)) return false
      if (query.source !== undefined) {
        if (record.kind !== 'action') return false
        const source = record.source
        if (source === undefined || source.kind !== query.source.kind || source.id !== query.source.id) return false
      }
      const trashed = record.deletedAt !== undefined
      if (trashed && query.includeTrashed !== true) return false
      if (!trashed && record.archived && query.includeArchived !== true) return false
      if (search !== undefined && search !== '' && !searchTextOf(record).includes(search)) return false
      return true
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  const checkSize = (record: DomainRecord): void => {
    if (recordBytes(record) > RECORDS_LIMITS.recordBytes) {
      throw new Refusal(413, `单条记录超过 ${String(RECORDS_LIMITS.recordBytes)} 字节，先拆分内容`, { code: 'record-too-large', bytes: recordBytes(record) })
    }
  }

  return {
    file,
    view(query = {}) {
      const all = filtered(query)
      const page: DomainRecord[] = []
      let used = 0
      let truncated = false
      for (const record of all) {
        if (page.length >= RECORDS_PAGE.max) { truncated = true; break }
        const size = recordBytes(record)
        if (page.length > 0 && used + size > RECORDS_PAGE.bytes) { truncated = true; break }
        page.push(record)
        used += size
      }
      return { records: page, quota: quota(), total: all.length, truncated }
    },
    snapshot(query = {}) {
      return filtered(query)
    },
    async importMany(imported) {
      return await mutate(() => {
        const ids = new Set<string>()
        for (const record of imported) {
          const problem = storedProblem(record)
          if (problem !== null) throw new Refusal(400, `导入的记录不合法：${problem}`)
          checkSize(record)
          if (ids.has(record.id) || records.some((entry) => entry.id === record.id)) {
            throw new Refusal(400, `导入的记录 id 与现有记录重复：${record.id}`)
          }
          ids.add(record.id)
        }
        return { next: [...records, ...imported], result: imported.length }
      })
    },
    get(id) {
      return records.find((record) => record.id === id)
    },
    async create(input, actor) {
      return await mutate(() => {
        if (!isRecord(input) || typeof input.kind !== 'string' || !['meeting', 'action', 'manuscript', 'literature'].includes(input.kind)) {
          throw new Refusal(400, '新记录要写明 kind：meeting、action、manuscript 或 literature')
        }
        const kind = input.kind as RecordKind
        const { kind: _ignored, ...fieldsInput } = input
        const fields = normalizeInput(kind, fieldsInput, 'create')
        const at = new Date(now()).toISOString()
        const base = {
          id: randomUUID(),
          kind,
          schemaVersion: RECORDS_FORMAT,
          revision: 1,
          createdAt: at,
          updatedAt: at,
          archived: false,
          lastEditedBy: actor,
        }
        const { stageNote, ...rest } = fields
        const record = { ...base, ...withoutNulls(rest) } as unknown as DomainRecord
        if (kind === 'manuscript') {
          const manuscript = record as ManuscriptRecord
          manuscript.stageHistory = [stageEntryOf(manuscript.stage, at, typeof stageNote === 'string' ? stageNote : null)]
        }
        const problem = storedProblem(record)
        if (problem !== null) throw new Refusal(400, `记录不合法：${problem}`)
        checkSize(record)
        if (records.length + 1 > limits.records) {
          throw new Refusal(409, `工作区记录已达上限（${String(records.length)}/${String(limits.records)} 条）；先整理归档或回收站`, { code: 'records-limit', quota: quota() })
        }
        return { next: [...records, record], result: { record, revision: record.revision } }
      })
    },
    async update(id, expectedRevision, patch, actor) {
      return await mutate(() => {
        const current = find(id)
        if (current.deletedAt !== undefined) throw new Refusal(409, '记录在回收站里，先恢复再编辑', { code: 'record-trashed' })
        checkRevision(current, expectedRevision)
        const fields = normalizeInput(current.kind, patch, 'update')
        const at = new Date(now()).toISOString()
        const next = { ...current, updatedAt: at, revision: current.revision + 1, lastEditedBy: actor } as unknown as Record<string, unknown>
        const { stageNote, ...rest } = fields
        for (const [key, value] of Object.entries(rest)) {
          if (value === null) delete next[key]
          else next[key] = value
        }
        if (current.kind === 'manuscript' && fields.stage !== undefined && fields.stage !== current.stage) {
          const history = [...current.stageHistory, stageEntryOf(fields.stage as ManuscriptRecord['stage'], at, typeof stageNote === 'string' ? stageNote : null)]
          if (history.length > RECORDS_LIMITS.stageHistory) {
            throw new Refusal(409, `阶段历史最多 ${String(RECORDS_LIMITS.stageHistory)} 条，先归档旧的记录`, { code: 'stage-history-full' })
          }
          next.stageHistory = history
        }
        const record = next as unknown as DomainRecord
        const problem = storedProblem(record)
        if (problem !== null) throw new Refusal(400, `记录不合法：${problem}`)
        checkSize(record)
        return { next: replace(record), result: { record, revision: record.revision } }
      })
    },
    async archive(id, expectedRevision, actor) {
      return await mutate(() => {
        const current = find(id)
        if (current.deletedAt !== undefined) throw new Refusal(409, '记录在回收站里，先恢复再归档', { code: 'record-trashed' })
        checkRevision(current, expectedRevision)
        if (current.archived) return { next: records, result: { record: current, revision: current.revision } }
        const record = { ...current, archived: true, updatedAt: new Date(now()).toISOString(), revision: current.revision + 1, lastEditedBy: actor }
        return { next: replace(record), result: { record, revision: record.revision } }
      })
    },
    async restore(id, expectedRevision, actor) {
      return await mutate(() => {
        const current = find(id)
        checkRevision(current, expectedRevision)
        if (current.deletedAt === undefined && !current.archived) {
          return { next: records, result: { record: current, revision: current.revision } }
        }
        const at = new Date(now()).toISOString()
        const record = {
          ...current,
          archived: current.deletedAt === undefined ? false : current.archived,
          updatedAt: at,
          revision: current.revision + 1,
          lastEditedBy: actor,
        } as DomainRecord
        if (current.deletedAt !== undefined) delete (record as { deletedAt?: string }).deletedAt
        return { next: replace(record), result: { record, revision: record.revision } }
      })
    },
    async trash(id, expectedRevision, actor) {
      return await mutate(() => {
        const current = find(id)
        checkRevision(current, expectedRevision)
        if (current.deletedAt !== undefined) return { next: records, result: { record: current, revision: current.revision } }
        const at = new Date(now()).toISOString()
        const record = { ...current, deletedAt: at, updatedAt: at, revision: current.revision + 1, lastEditedBy: actor }
        return { next: replace(record), result: { record, revision: record.revision } }
      })
    },
    onChange(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async settled() {
      await queue.settled()
    },
  }
}

/**
 * 去掉归一结果里表示「未填」的项。
 *
 * @param fields - 归一后的字段。
 * @returns 只带值的字段。
 */
function withoutNulls(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && key !== 'stageNote') out[key] = value
  }
  return out
}
