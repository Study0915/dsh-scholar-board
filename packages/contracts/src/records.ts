/**
 * 领域记录（D36）：组会、行动项、小论文、文献与研究记录的共享存储形状。
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
  entries: 64,
  unitLength: 32,
  stageHistory: 200,
  figures: 100,
  submissions: 50,
  revisions: 200,
  figureLabelLength: 32,
  revisionText: 2000,
  thesisItems: 100,
  thesisMilestones: 50,
  milestoneLabelLength: 60,
  searchLength: 200,
} as const

/** 领域记录的六种类型。 */
export type RecordKind = 'meeting' | 'action' | 'manuscript' | 'literature' | 'research' | 'thesis'

/** 文献的阅读阶段；读懂与问题由用户填写，订阅条目加入时是待读。 */
export type LiteratureStage = 'queued' | 'reading' | 'understood'

/** 研究记录的三种做法：推导、仿真与实验。 */
export type ResearchMethod = 'derivation' | 'simulation' | 'experiment'

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

/** 图表目录里的一行：图或表、编号、标题与证据材料。 */
export type FigureKind = 'figure' | 'table'

export interface ManuscriptFigure {
  id: string
  kind: FigureKind
  label: string
  title: string
  note?: string
  materials?: MaterialRef[]
}

/** 一轮投稿的结果；拒稿、撤稿与转投都留在这里，旧轮次不删。 */
export type SubmissionDecision = 'pending' | 'minor' | 'major' | 'accepted' | 'rejected' | 'withdrawn' | 'transferred'

export interface SubmissionRound {
  id: string
  venue: string
  submittedAt?: Due
  decision: SubmissionDecision
  decidedAt?: Due
  note?: string
}

/** 一条修回事项：审稿反馈、对应改动与证据材料。 */
export type RevisionStatus = 'todo' | 'doing' | 'done' | 'declined'

export interface RevisionItem {
  id: string
  roundId: string
  feedback: string
  change?: string
  status: RevisionStatus
  materials?: MaterialRef[]
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

/** 研究记录里的一行参数或指标：名称、数值与可选单位。 */
export interface ResearchEntry {
  name: string
  value: string
  unit?: string
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
  figures?: ManuscriptFigure[]
  submissions?: SubmissionRound[]
  revisions?: RevisionItem[]
}

/** 文献阅读。 */
export interface LiteratureRecord extends RecordBase {
  kind: 'literature'
  title: string
  authors?: string
  venue?: string
  year?: number
  url?: string
  stage: LiteratureStage
  understanding?: string
  questions?: string
  related?: RecordRef[]
  materials?: MaterialRef[]
}

/** 研究记录：推导、仿真或实验的做法与可复现信息。 */
export interface ResearchRecord extends RecordBase {
  kind: 'research'
  title: string
  method: ResearchMethod
  question?: string
  environment?: string
  seed?: string
  parameters?: ResearchEntry[]
  metrics?: ResearchEntry[]
  conclusion?: string
  related?: RecordRef[]
  materials?: MaterialRef[]
}

/** 毕业论文的一章；状态由用户推进，不按页数或百分比推断。 */
export type ThesisChapterStatus = 'planned' | 'drafting' | 'revising' | 'done'

export interface ThesisChapter {
  id: string
  title: string
  status: ThesisChapterStatus
  question?: string
  note?: string
}

/** 已有成果：指向一条小论文或研究记录，标题由宿主现取。 */
export type ThesisResultKind = 'manuscript' | 'research'

export interface ThesisResult {
  id: string
  kind: ThesisResultKind
  recordId: string
  note?: string
  materials?: MaterialRef[]
}

/** 待补实验：做完与否由用户填，不执行实验程序。 */
export type ThesisItemStatus = 'todo' | 'doing' | 'done'

export interface ThesisExperiment {
  id: string
  title: string
  status: ThesisItemStatus
  note?: string
}

/** 学位节点：名称与日期都由用户维护，不预设学校规则。 */
export interface ThesisMilestone {
  id: string
  label: string
  status: ThesisItemStatus
  due?: Due
  note?: string
}

/** 毕业论文：章节、成果来源、待补实验与可自定义的学位节点。 */
export interface ThesisRecord extends RecordBase {
  kind: 'thesis'
  title: string
  question?: string
  chapters?: ThesisChapter[]
  results?: ThesisResult[]
  experiments?: ThesisExperiment[]
  milestones?: ThesisMilestone[]
  related?: RecordRef[]
  materials?: MaterialRef[]
}

/** 一条领域记录。 */
export type DomainRecord = MeetingRecord | ActionRecord | ManuscriptRecord | LiteratureRecord | ResearchRecord | ThesisRecord

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
