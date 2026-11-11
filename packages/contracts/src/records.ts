/**
 * 领域记录（D36）：组会、行动项与小论文的共享存储形状。
 *
 * 记录由宿主独占读写，卡片经能力与数据源访问；这里只写盘上与线上的形状。字段、状态转换与容量的
 * 完整规格在 `docs/scholar-records-spec.md`。
 */
import type { Due } from './campus'

/** 记录存储的格式版本；读盘时不认识的版本保留原文件并报错。 */
export const RECORDS_FORMAT = 1

/** 看板自己提供的能力与数据源（D24、D32）：不与任何提供方重名。 */
export const RECORDS_PROVIDER = 'widget-board'
export const RECORDS_READ_CAPABILITY = 'records.read'
export const RECORDS_WRITE_CAPABILITY = 'records.write'
export const RECORDS_DRAFT_CAPABILITY = 'records.draft'
export const RECORDS_SOURCE = 'records'

/** 容量与字段上限；用户 2026-11-10 确认的一万条、16 MiB 与三十天回收站。 */
export const RECORDS_LIMITS = {
  records: 10000,
  bytes: 16 * 1024 * 1024,
  recordBytes: 64 * 1024,
  warnRatio: 0.9,
  trashDays: 30,
  titleLength: 200,
  related: 100,
  materials: 64,
  stageHistory: 200,
  searchLength: 200,
} as const

/** 三种领域记录。 */
export type RecordKind = 'meeting' | 'action' | 'manuscript'

/** 行动项状态；取消与删除是两件事。 */
export type ActionStatus = 'todo' | 'doing' | 'blocked' | 'done' | 'cancelled'

/** 稿件阶段；可回退，每次变更记进 `stageHistory`。 */
export type ManuscriptStage = 'idea' | 'experiment' | 'writing' | 'internal-review' | 'submitted' | 'revision' | 'accepted' | 'archived'

/** 稿件阶段的一次变更，由宿主维护。 */
export interface StageEntry {
  stage: ManuscriptStage
  at: string
  note?: string
}

/** 指向前向记录的引用；反向引用由宿主现算，不双写。 */
export interface RecordRef {
  kind: RecordKind
  id: string
}

/** 内嵌在记录里的材料引用；首批仅 http/https（D26）。 */
export interface MaterialRef {
  id: string
  url: string
  title: string
  note?: string
}

/** 每条记录都有的系统字段；组件不可写。 */
export interface RecordBase {
  id: string
  kind: RecordKind
  schemaVersion: number
  revision: number
  createdAt: string
  updatedAt: string
  archived: boolean
  deletedAt?: string
  lastEditedBy?: { widget: string, instance: string }
}

/** 组会记录。 */
export interface MeetingRecord extends RecordBase {
  kind: 'meeting'
  title: string
  date?: Due
  topics?: string
  feedback?: string
  openQuestions?: string
  related?: RecordRef[]
  materials?: MaterialRef[]
  derivedFrom?: string
}

/** 行动项。 */
export interface ActionRecord extends RecordBase {
  kind: 'action'
  title: string
  status: ActionStatus
  due?: Due
  source?: RecordRef
  related?: RecordRef[]
  blockedNote?: string
  doneNote?: string
  materials?: MaterialRef[]
}

/** 小论文。 */
export interface ManuscriptRecord extends RecordBase {
  kind: 'manuscript'
  title: string
  question?: string
  stage: ManuscriptStage
  stageHistory: StageEntry[]
  nextStep?: string
  blockers?: string
  target?: string
  due?: Due
  related?: RecordRef[]
  materials?: MaterialRef[]
}

/** 一条领域记录。 */
export type DomainRecord = MeetingRecord | ActionRecord | ManuscriptRecord

/** 工作区当前的用量；到九成时 `warning` 为真，到顶阻止新建。 */
export interface RecordsQuota {
  count: number
  bytes: number
  countLimit: number
  bytesLimit: number
  warning: boolean
}

/** 一次读取的结果；`total` 是筛选后的全部条数，`truncated` 表示只给出了一部分。 */
export interface RecordsView {
  records: DomainRecord[]
  quota: RecordsQuota
  total: number
  truncated: boolean
}

/** 读记录时能给的筛选条件；不给条件时是全部活跃记录。 */
export interface RecordQuery {
  kind?: RecordKind
  ids?: string[]
  includeArchived?: boolean
  includeTrashed?: boolean
  search?: string
  /** 只看来源指向某条记录的行动项：反向引用由宿主现算，不双写。 */
  source?: { kind: 'meeting' | 'manuscript', id: string }
}

/** 一次读取最多给出多少条，以及序列化后的字节预算：消息上限 320 KB，留出余量。 */
export const RECORDS_PAGE = { max: 200, bytes: 192 * 1024 } as const

/** 写入能力的操作集合；永久删除只在界面，能力面不暴露。 */
export type RecordWriteOp = 'create' | 'update' | 'archive' | 'restore' | 'trash'

/** 写操作的返回：写后的记录与它的修订号。 */
export interface RecordWriteResult {
  record: DomainRecord
  revision: number
}
