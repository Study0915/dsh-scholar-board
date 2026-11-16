/**
 * 横向项目的记录形状：需求、需求变更、个人负责事项、交付物、验收与沟通结论。
 *
 * 这些类型由 `records.ts` 的 `ProjectRecord` 汇聚；拆到这里是为了让共享记录文件的长度
 * 保持在停止线之内，引用与容量的规则仍在 `records.ts` 与 `docs/scholar-records-spec.md`。
 */
import type { Due } from './campus'
import type { MaterialRef, RecordBase, RecordRef } from './records'

/** 横向项目里个人负责的一项事项；是否受阻由用户填。 */
export type ProjectItemStatus = 'todo' | 'doing' | 'blocked' | 'done'

export interface ProjectTask {
  id: string
  title: string
  status: ProjectItemStatus
  due?: Due
  note?: string
  materials?: MaterialRef[]
  /** 这条事项服务的一条需求；需求删掉后保留 id，详情里标为缺失。 */
  requirement?: string
  /** 由这条事项转出的共享行动项；重复点击回到同一条。 */
  actionId?: string
  /** 负责人：一位成员 id；成员停用后仍按原 id 显示当时的调用。 */
  owner?: string
  /** 协作人：成员 id 列表，去重。 */
  collaborators?: string[]
  /** 待确认人：成员 id 列表；只是记录，不是审批身份。 */
  confirmers?: string[]
}

/** 交付物状态：草稿、评审中、已交付与已验收。 */
export type ProjectDeliverableStatus = 'draft' | 'review' | 'delivered' | 'accepted'

/** 交付物建立时绑定的需求与版本；需求后来升级也不改写这份依据。 */
export interface ProjectRequirementRef {
  id: string
  version: string
}

/** 一次验收：失败也留档，待补事项写在同一条里。 */
export interface ProjectAcceptance {
  id: string
  at?: Due
  opinion: string
  passed: boolean
  pending?: string
}

/** 冻结的材料清单：只存引用与当时的字段快照，不复制外部正文。 */
export interface ProjectFrozenMaterials {
  at: Due
  materials: MaterialRef[]
}

export interface ProjectDeliverable {
  id: string
  name: string
  version: string
  status: ProjectDeliverableStatus
  due?: Due
  note?: string
  materials?: MaterialRef[]
  /** 关联的需求与建立时的版本。 */
  requirements?: ProjectRequirementRef[]
  /** 测试报告材料；与实现材料分开列。 */
  testReports?: MaterialRef[]
  /** 已知限制，交给验收人判断。 */
  limitations?: string
  /** 实际交付时间；与计划日期分开。 */
  deliveredAt?: Due
  /** 验收记录；失败与待补事项都保留。 */
  acceptances?: ProjectAcceptance[]
  /** 材料清单快照。 */
  frozen?: ProjectFrozenMaterials
}

/** 需求状态；确认与否由用户填写。 */
export type ProjectRequirementStatus = 'pending' | 'confirmed' | 'cancelled'

/** 一条项目需求：编号、版本、验收口径、测试方法与关联事项。 */
export interface ProjectRequirement {
  id: string
  no?: string
  title: string
  description?: string
  version: string
  status: ProjectRequirementStatus
  /** 来源记录：会议、行动项、稿件等。 */
  sources?: RecordRef[]
  materials?: MaterialRef[]
  metric?: string
  unit?: string
  threshold?: string
  testMethod?: string
  /** 关联事项的 id；事项删掉后保留 id，追溯区标为缺失。 */
  tasks?: string[]
  /** 由这条需求转出的共享行动项。 */
  actionId?: string
}

/** 需求的一次版本变更；前后版本都留在这里，不改写旧记录。 */
export interface ProjectRequirementChange {
  id: string
  requirementId: string
  fromVersion: string
  toVersion: string
  at?: Due
  reason: string
  impact?: string
  communication?: string
  confirmation?: string
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
  /** 由这个问题转出的共享行动项。 */
  actionId?: string
}

/** 评审指向的对象：项目本身、一份交付物或一条需求。 */
export type ProjectReviewTarget = 'project' | 'deliverable' | 'requirement'

/** 一次评审：对象、当时的版本、评审人、意见、决定与后续行动。 */
export interface ProjectReview {
  id: string
  target: ProjectReviewTarget
  /** 交付物或需求的条目 id；评审整个项目时留空。 */
  targetId?: string
  /** 被评审对象当时的版本；只记录，不随对象升级改写。 */
  targetVersion?: string
  /** 评审人：成员 id。 */
  reviewer?: string
  at?: Due
  opinion: string
  decision: string
  followUp?: string
}

/** 一次交接：接手人、当前进度、材料、操作说明、已知问题、待办与确认情况。 */
export interface ProjectHandover {
  id: string
  /** 接手人：成员 id。 */
  receiver?: string
  at?: Due
  progress?: string
  materials?: string
  instructions?: string
  issues?: string
  todos?: string
  /** 交接确认由用户手动记录，生成交接草稿不算确认。 */
  confirmed: boolean
  confirmedAt?: Due
}

/** 横向项目：需求、需求变更、个人负责事项、交付物版本、沟通结论、验收节点与问题。 */
export interface ProjectRecord extends RecordBase {
  kind: 'project'
  title: string
  summary?: string
  requirements?: ProjectRequirement[]
  requirementChanges?: ProjectRequirementChange[]
  tasks?: ProjectTask[]
  deliverables?: ProjectDeliverable[]
  communications?: ProjectCommunication[]
  milestones?: ProjectMilestone[]
  issues?: ProjectIssue[]
  reviews?: ProjectReview[]
  handovers?: ProjectHandover[]
  related?: RecordRef[]
  materials?: MaterialRef[]
}
