/**
 * 领域记录（D36）：组会、行动项、小论文、文献与研究记录的共享存储形状。
 *
 * 记录由宿主独占读写，卡片经能力与数据源访问；这里只写盘上与线上的形状。字段、状态转换与容量的
 * 完整规格在 `docs/scholar-records-spec.md`。
 */
import type { Due } from './campus'
import type { LiteratureFormat } from './literature-identifiers'
import type { TemplateRecord, TemplateSnapshot } from './templates'

/** 记录存储的格式版本；读盘时不认识的版本保留原文件并报错。 */
export const RECORDS_FORMAT = 1

/** 看板自己提供的能力与数据源（D24、D32）：不与任何提供方重名。 */
export const RECORDS_PROVIDER = 'widget-board'
export const RECORDS_READ_CAPABILITY = 'records.read'
export const RECORDS_WRITE_CAPABILITY = 'records.write'
export const RECORDS_DRAFT_CAPABILITY = 'records.draft'
export const RECORDS_OPEN_CAPABILITY = 'records.open'
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
  figureRuns: 20,
  evidence: 50,
  submissions: 50,
  revisions: 200,
  figureLabelLength: 32,
  revisionText: 2000,
  thesisItems: 100,
  thesisMilestones: 50,
  milestoneLabelLength: 60,
  projectItems: 100,
  projectMilestones: 50,
  versionLength: 32,
  courseWork: 100,
  termLabelLength: 40,
  categoryLength: 40,
  topicQuestions: 100,
  topicQuestionText: 2000,
  runDatasets: 32,
  runResults: 50,
  runResultText: 2000,
  runResultSources: 20,
  runMethodLength: 200,
  runDispersionLength: 200,
  searchLength: 200,
  literatureDoiLength: 200,
  arxivIdLength: 64,
  arxivVersionLength: 16,
  literatureVersions: 20,
  readingEntries: 100,
  readingText: 2000,
  materialPathLength: 1024,
  materialPurposeLength: 200,
  materialDeviceLength: 80,
  materialVersionLength: 80,
  literatureExternal: 4,
  roundChecklist: 40,
  reviewerLength: 80,
  commentNoLength: 40,
  locationLength: 200,
  chapterLinks: 20,
} as const

/** 领域记录的十二种类型；`template` 只由模板面板读写，不出现在关联选择器里。 */
export type RecordKind = 'meeting' | 'action' | 'manuscript' | 'literature' | 'research' | 'thesis' | 'project' | 'course' | 'chore' | 'topic' | 'run' | 'template'

/** 记录类型的唯一列表，校验、筛选和关系查询共用。 */
export const RECORD_KINDS: readonly RecordKind[] = ['meeting', 'action', 'manuscript', 'literature', 'research', 'thesis', 'project', 'course', 'chore', 'topic', 'run', 'template']

/** 可以互相引用的记录类型；模板不是可关联的对象。 */
export const RELATION_KINDS: readonly RecordKind[] = RECORD_KINDS.filter(kind => kind !== 'template')

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

/** 图表的绘图代码来源；仓库与提交都允许未知。 */
export interface PlotCode {
  repository?: string
  commit?: string
}

/** 图表目录里的一行：图或表、编号、标题、来源运行、材料、绘图代码与结论说明。 */
export type FigureKind = 'figure' | 'table'

export interface ManuscriptFigure {
  id: string
  kind: FigureKind
  label: string
  title: string
  note?: string
  runs?: RecordRef[]
  plot?: PlotCode
  conclusion?: string
  materials?: MaterialRef[]
}

/**
 * 结论依据的一条引用：记录类型、id 与引用时的修订号；条目与材料可选。
 *
 * `revision` 是引用那一刻记录自己的修订号；详情读取当前记录后与它比较，不同就提示来源已更新。
 */
export interface EvidenceRef {
  kind: RecordKind
  id: string
  revision: number
  entryId?: string
  materialId?: string
  summary?: string
}

/** 一轮投稿的结果；拒稿、撤稿与转投都留在这里，旧轮次不删。 */
export type SubmissionDecision = 'pending' | 'minor' | 'major' | 'accepted' | 'rejected' | 'withdrawn' | 'transferred'

/** 投稿检查项的状态：未备与已备。 */
export type SubmissionCheckStatus = 'missing' | 'ready'

/**
 * 一轮投稿里的提交材料检查项：正文、补充、声明、图表与代码数据说明等由用户自己定义。
 *
 * 版本说明是这一轮冻结时的快照；旧轮次的清单不因后来的修改而变。
 */
export interface SubmissionCheckItem {
  id: string
  label: string
  status: SubmissionCheckStatus
  version?: string
}

export interface SubmissionRound {
  id: string
  venue: string
  submittedAt?: Due
  decision: SubmissionDecision
  decidedAt?: Due
  /** 这一轮要交出去的期限。 */
  deadline?: Due
  /** 提交材料检查表；冻结后不再随别的轮次改动。 */
  checklist?: SubmissionCheckItem[]
  /** 清单冻结的日期；只记录，不阻止用户手动解冻。 */
  frozenAt?: Due
  note?: string
}

/** 一条修回事项：审稿反馈、对应改动与证据材料。 */
export type RevisionStatus = 'todo' | 'doing' | 'done' | 'declined'

/**
 * 审稿意见的一条：审稿人称呼与意见编号只是用户写的标签，不是认证身份。
 *
 * `actionId` 指向由这条意见转出的行动项；同一意见按稳定条目 id 去重，不重复创建。
 * 行动项完成不等于回复已完成，回复仍需单独填写。
 */
export interface RevisionItem {
  id: string
  roundId: string
  reviewer?: string
  commentNo?: string
  feedback: string
  change?: string
  location?: string
  reply?: string
  status: RevisionStatus
  /** 不采纳时的理由；标为不采纳时必填。 */
  reason?: string
  actionId?: string
  materials?: MaterialRef[]
}

/** 指向前向记录的引用；反向引用由宿主现算，不双写。 */
export interface RecordRef {
  kind: RecordKind
  id: string
}

/**
 * 内嵌在记录里的材料引用：网页给地址，本地给路径，两者不混用。
 *
 * 旧记录只有 `url`，读的时候按 `web` 处理。本地路径只是文本，宿主不据此扫描磁盘或执行，
 * 打开能力也只对网页材料生效。
 */
export interface MaterialRef {
  id: string
  kind?: MaterialKind
  url?: string
  path?: string
  title: string
  note?: string
  /** 这份材料用来做什么。 */
  purpose?: string
  /** 材料所在的设备标签，用来发现跨设备失效的引用。 */
  device?: string
  /** 材料自己的版本说明，不是记录的修订号。 */
  version?: string
  /** 最后一次核对材料仍可用的日期。 */
  checkedAt?: string
}

/** 材料的两种来源：网页与本地路径。 */
export type MaterialKind = 'web' | 'local'

/**
 * 一条外部来源：外部提供方、库与条目 key，以及读它时的接口版本。
 *
 * 外部版本与记录自己的修订号无关，导入后记录仍按本地修订号读写。
 */
export interface ExternalSourceRef {
  provider: 'zotero'
  library: string
  itemKey: string
  apiVersion: string
  fetchedAt: string
}

/** 研究记录里的一行参数或指标：名称、数值、可选单位与可选定义。 */
export interface ResearchEntry {
  name: string
  value: string
  unit?: string
  definition?: string
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

/** 行动项。`source.kind` 为 `topic` 时，`sourceEntry` 指向课题里的问题条目。 */
export interface ActionRecord extends RecordBase {
  kind: 'action'
  title: string
  status: ActionStatus
  due?: Due
  source?: RecordRef
  sourceEntry?: string
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

/** 一条阅读记录：读到哪、记下什么、还有哪些疑问与待复现事项。 */
export interface ReadingEntry {
  id: string
  /** 章节、页码或公式位置，原样记录。 */
  location?: string
  note?: string
  understanding?: string
  questions?: string
  reproduce?: string
  at?: Due
  /** 问题转成的行动项；由界面写回，宿主不自动建。 */
  actionId?: string
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
  format?: LiteratureFormat
  doi?: string
  arxivId?: string
  arxivVersion?: string
  /** 同一工作的其他版本（预印本与正式稿等），只指向文献记录。 */
  versions?: RecordRef[]
  reading?: ReadingEntry[]
  related?: RecordRef[]
  materials?: MaterialRef[]
  /** 从外部文献库导入时的来源；记录自己的修订号与外部版本无关。 */
  external?: ExternalSourceRef[]
}

/** 研究记录：推导、仿真或实验的做法与可复现信息；也承载方案的实验目的与步骤。 */
export interface ResearchRecord extends RecordBase {
  kind: 'research'
  title: string
  method: ResearchMethod
  question?: string
  purpose?: string
  hypothesis?: string
  steps?: string
  environment?: string
  seed?: string
  parameters?: ResearchEntry[]
  metrics?: ResearchEntry[]
  conclusion?: string
  conclusionBasis?: string
  conclusionScope?: string
  conclusionEvidence?: EvidenceRef[]
  related?: RecordRef[]
  materials?: MaterialRef[]
  template?: TemplateSnapshot
}

/** 运行状态；由用户或以后明确接入的数据源维护，这里不执行程序。 */
export type RunStatus = 'planned' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** 运行的代码来源；仓库与提交都允许未知。 */
export interface RunCode {
  repository?: string
  commit?: string
}

/** 一次运行用到的数据集、划分与版本。 */
export interface RunDataset {
  id: string
  name: string
  split?: string
  version?: string
}

/** 一条运行结果：单次运行的观测，或明确标记来源与统计口径的汇总。 */
export interface RunResult {
  id: string
  kind: 'single' | 'aggregate'
  text: string
  sources?: string[]
  method?: string
  sampleSize?: number
  dispersion?: string
  manual?: boolean
}

/** 运行记录：按方案实际开展的一次运行或一次统计汇总。 */
export interface RunRecord extends RecordBase {
  kind: 'run'
  title: string
  plan?: RecordRef
  status: RunStatus
  code?: RunCode
  datasets?: RunDataset[]
  checkpoints?: ResearchEntry[]
  config?: ResearchEntry[]
  environment?: string
  seed?: string
  evaluation?: string
  startedAt?: string
  endedAt?: string
  metrics?: ResearchEntry[]
  artifacts?: MaterialRef[]
  failure?: string
  note?: string
  results?: RunResult[]
  related?: RecordRef[]
  materials?: MaterialRef[]
  template?: TemplateSnapshot
}

/** 毕业论文的一章；状态由用户推进，不按页数或百分比推断。 */
export type ThesisChapterStatus = 'planned' | 'drafting' | 'revising' | 'done'

export interface ThesisChapter {
  id: string
  title: string
  status: ThesisChapterStatus
  question?: string
  note?: string
  /** 这一章用到课题、稿件或研究记录；删除章节不会删除这些成果。 */
  links?: RecordRef[]
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
  /** 补这项实验用的方案；只记文字，不启动实验。 */
  plan?: string
  /** 对应的行动项；完成行动项不自动把实验标成做完。 */
  actionId?: string
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

/** 横向项目里个人负责的一项事项；是否受阻由用户填。 */
export type ProjectItemStatus = 'todo' | 'doing' | 'blocked' | 'done'

export interface ProjectTask {
  id: string
  title: string
  status: ProjectItemStatus
  due?: Due
  note?: string
  materials?: MaterialRef[]
}

/** 交付物状态：草稿、评审中、已交付与已验收。 */
export type ProjectDeliverableStatus = 'draft' | 'review' | 'delivered' | 'accepted'

export interface ProjectDeliverable {
  id: string
  name: string
  version: string
  status: ProjectDeliverableStatus
  due?: Due
  note?: string
  materials?: MaterialRef[]
}

/** 一次沟通的结论：一句话与可选日期；来源会议走 related。 */
export interface ProjectCommunication {
  id: string
  summary: string
  at?: Due
  note?: string
}

/** 验收节点：名称与日期由用户维护，不预设合同规则。 */
export interface ProjectMilestone {
  id: string
  label: string
  status: 'todo' | 'doing' | 'done'
  due?: Due
  note?: string
}

/** 待确认问题：未解决与否由用户填。 */
export type ProjectIssueStatus = 'open' | 'doing' | 'resolved'

export interface ProjectIssue {
  id: string
  title: string
  status: ProjectIssueStatus
  note?: string
}

/** 横向项目：需求摘要、个人负责事项、交付物版本、沟通结论、验收节点与问题。 */
export interface ProjectRecord extends RecordBase {
  kind: 'project'
  title: string
  summary?: string
  tasks?: ProjectTask[]
  deliverables?: ProjectDeliverable[]
  communications?: ProjectCommunication[]
  milestones?: ProjectMilestone[]
  issues?: ProjectIssue[]
  related?: RecordRef[]
  materials?: MaterialRef[]
}

/** 一门课的作业或考试；补交由用户显式标记，不按时间推断。 */
export type CourseWorkKind = 'assignment' | 'exam'

/** 作业与考试的状态。 */
export type CourseWorkStatus = 'todo' | 'doing' | 'done'

export interface CourseWork {
  id: string
  kind: CourseWorkKind
  title: string
  status: CourseWorkStatus
  due?: Due
  late?: boolean
  note?: string
  materials?: MaterialRef[]
}

/** 学期：名称必填，起止日期可留空；跨学期由名称与日期一起区分。 */
export interface CourseTerm {
  label: string
  start?: Due
  end?: Due
}

/** 研究生课程：学期、作业考试、学习笔记与资料。 */
export interface CourseRecord extends RecordBase {
  kind: 'course'
  title: string
  term: CourseTerm
  code?: string
  teacher?: string
  schedule?: string
  notes?: string
  work?: CourseWork[]
  related?: RecordRef[]
  materials?: MaterialRef[]
}

/** 其他事务的状态；取消与完成分开。 */
export type ChoreStatus = 'todo' | 'doing' | 'done' | 'cancelled'

/** 其他事务：自定义类别、可选期限与说明，完成后可归档。 */
export interface ChoreRecord extends RecordBase {
  kind: 'chore'
  title: string
  category: string
  status: ChoreStatus
  due?: Due
  note?: string
  related?: RecordRef[]
  materials?: MaterialRef[]
}

/** 课题里一个问题的状态：待解、调查中、已解决；解决与否由用户判断。 */
export type TopicQuestionStatus = 'open' | 'investigating' | 'resolved'

/** 课题里的一个问题条目；转成行动项后保留条目的稳定 id。 */
export interface TopicQuestion {
  id: string
  text: string
  status: TopicQuestionStatus
  actionId?: string
}

/** 研究课题：问题、目标、假设、当前判断、下一步与待解问题。 */
export interface TopicRecord extends RecordBase {
  kind: 'topic'
  title: string
  question?: string
  goal?: string
  hypothesis?: string
  judgment?: string
  nextStep?: string
  questions?: TopicQuestion[]
  related?: RecordRef[]
  materials?: MaterialRef[]
}

/** 一条领域记录。 */
export type DomainRecord = MeetingRecord | ActionRecord | ManuscriptRecord | LiteratureRecord | ResearchRecord | ThesisRecord | ProjectRecord | CourseRecord | ChoreRecord | TopicRecord | RunRecord | TemplateRecord

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
  /** 本页实际给出的记录之后的位置；受条数或字节限制时可继续读。 */
  nextOffset?: number
}

/** 读记录时能给的筛选条件；不给条件时是全部活跃记录。 */
export interface RecordQuery {
  kind?: RecordKind
  ids?: string[]
  includeArchived?: boolean
  includeTrashed?: boolean
  search?: string
  offset?: number
  /** 找到直接引用该记录的对象，不预先双写反向列表。 */
  references?: RecordRef
  /** 只看来源指向某条记录的行动项：反向引用由宿主现算，不双写。 */
  source?: { kind: 'meeting' | 'manuscript' | 'topic' | 'literature', id: string }
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
