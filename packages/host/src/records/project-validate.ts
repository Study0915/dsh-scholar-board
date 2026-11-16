/**
 * 横向项目的字段校验：需求、需求变更、个人负责事项、交付物、验收记录、沟通结论、验收节点与待确认问题。
 *
 * 这里只认形状、状态与上限，不收合同金额或其他敏感业务细节；审批与经费另行决定。
 */
import type {
  ProjectAcceptance,
  ProjectCommunication,
  ProjectDeliverable,
  ProjectDeliverableStatus,
  ProjectFrozenMaterials,
  ProjectHandover,
  ProjectIssue,
  ProjectIssueStatus,
  ProjectItemStatus,
  ProjectMilestone,
  ProjectRequirement,
  ProjectRequirementChange,
  ProjectRequirementRef,
  ProjectRequirementStatus,
  ProjectReview,
  ProjectReviewTarget,
  ProjectTask,
} from '@dsh-scholar-board/contracts'
import { RECORDS_LIMITS, RELATION_KINDS } from '@dsh-scholar-board/contracts'
import { isRecord } from '../guards'
import { boundedTextOf, dueOf, extrasOf, fail, idItemsOf, idsOf, labeledMilestonesOf, materialsOf, refsOf, textOf, titleOf, titledRowsOf } from './fields'

/** 个人负责事项的四种状态。 */
export const PROJECT_TASK_STATUSES: readonly ProjectItemStatus[] = ['todo', 'doing', 'blocked', 'done']

/** 交付物的四种状态。 */
export const PROJECT_DELIVERABLE_STATUSES: readonly ProjectDeliverableStatus[] = ['draft', 'review', 'delivered', 'accepted']

/** 验收节点与问题的状态。 */
export const PROJECT_MILESTONE_STATUSES: readonly ProjectMilestone['status'][] = ['todo', 'doing', 'done']
export const PROJECT_ISSUE_STATUSES: readonly ProjectIssueStatus[] = ['open', 'doing', 'resolved']

/** 评审指向的对象。 */
export const PROJECT_REVIEW_TARGETS: readonly ProjectReviewTarget[] = ['project', 'deliverable', 'requirement']

/** 需求状态。 */
export const PROJECT_REQUIREMENT_STATUSES: readonly ProjectRequirementStatus[] = ['pending', 'confirmed', 'cancelled']

/**
 * 一段必填、有上限的文字；去掉首尾空白后按 Unicode 码点计。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @param limit - 最多几个字符。
 * @returns 文字。
 */
function requiredTextOf(value: unknown, field: string, limit: number): string {
  const text = textOf(value, field)
  if (text === null) fail(`${field} 不能是空的`)
  if ([...text].length > limit) fail(`${field} 最多 ${String(limit)} 个字符`)
  return text
}

/**
 * 版本号：必填、去空白后不超过上限。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 版本号。
 */
function versionOf(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} 不能是空的`)
  const version = value.trim()
  if ([...version].length > RECORDS_LIMITS.versionLength) fail(`${field} 最多 ${String(RECORDS_LIMITS.versionLength)} 个字符`)
  return version
}

/**
 * 可选的记录 id：非空、不超过 64 字符。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns id；未填时是 `undefined`。
 */
function linkIdOf(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value === '' || value.length > 64) fail(`${field} 不合法`)
  return value
}

/**
 * 个人负责事项：标题必填、状态只认四种，日期、说明与材料可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 事项表；未填时是 `null`。
 */
export function projectTasksOf(value: unknown, field: string): ProjectTask[] | null {
  const rows = titledRowsOf(value, field, RECORDS_LIMITS.projectItems, PROJECT_TASK_STATUSES)
  if (rows === null) return null
  return rows.map(({ entry, index, title }) => {
    const at = `${field}[${String(index)}]`
    const requirement = linkIdOf(entry.requirement, `${at}.requirement`)
    const actionId = linkIdOf(entry.actionId, `${at}.actionId`)
    const owner = linkIdOf(entry.owner, `${at}.owner`)
    const collaborators = entry.collaborators === undefined ? null : idsOf(entry.collaborators, `${at}.collaborators`, RECORDS_LIMITS.assignmentRefs)
    const confirmers = entry.confirmers === undefined ? null : idsOf(entry.confirmers, `${at}.confirmers`, RECORDS_LIMITS.assignmentRefs)
    return {
      id: entry.id as string,
      title,
      status: entry.status as ProjectItemStatus,
      ...(requirement === undefined ? {} : { requirement }),
      ...(actionId === undefined ? {} : { actionId }),
      ...(owner === undefined ? {} : { owner }),
      ...(collaborators === null ? {} : { collaborators }),
      ...(confirmers === null ? {} : { confirmers }),
      ...extrasOf(entry, at),
    }
  })
}

/**
 * 交付物建立时绑定的需求与版本。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 引用表；未填时是 `null`。
 */
function requirementRefsOf(value: unknown, field: string): ProjectRequirementRef[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.projectRequirements, '对象')
  if (rows === null) return null
  const seen = new Set<string>()
  return rows.map((entry, index) => {
    if (seen.has(entry.id as string)) fail(`${field} 里的需求 id 重复`)
    seen.add(entry.id as string)
    return { id: entry.id as string, version: versionOf(entry.version, `${field}[${String(index)}].version`) }
  })
}

/**
 * 一次验收：意见必填，失败时的待补事项可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 验收表；未填时是 `null`。
 */
function acceptancesOf(value: unknown, field: string): ProjectAcceptance[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.deliverableAcceptances, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    const at = `${field}[${String(index)}]`
    if (typeof entry.passed !== 'boolean') fail(`${at}.passed 要是布尔值`)
    const when = entry.at === undefined ? null : dueOf(entry.at, `${at}.at`)
    const pending = boundedTextOf(entry.pending, `${at}.pending`, RECORDS_LIMITS.acceptanceOpinionLength)
    return {
      id: entry.id as string,
      opinion: requiredTextOf(entry.opinion, `${at}.opinion`, RECORDS_LIMITS.acceptanceOpinionLength),
      passed: entry.passed,
      ...(when === null ? {} : { at: when }),
      ...(pending === null ? {} : { pending }),
    }
  })
}

/**
 * 一份冻结的材料清单：冻结时间必填，材料按引用保存。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 快照；未填时是 `null`。
 */
function frozenOf(value: unknown, field: string): ProjectFrozenMaterials | null {
  if (value === null) return null
  if (!isRecord(value)) fail(`${field} 要写成 { at, materials }`)
  const at = dueOf(value.at, `${field}.at`)
  if (at === null) fail(`${field}.at 不能是空的`)
  const materials = materialsOf(value.materials, `${field}.materials`)
  if (materials === null) fail(`${field}.materials 不能是空的`)
  return { at, materials }
}

/**
 * 交付物：名称与版本必填、状态只认四种，日期、说明与材料可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 交付物表；未填时是 `null`。
 */
export function projectDeliverablesOf(value: unknown, field: string): ProjectDeliverable[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.projectItems, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    const at = `${field}[${String(index)}]`
    const name = titleOf(entry.name, `${at}.name`)
    const version = versionOf(entry.version, `${at}.version`)
    if (typeof entry.status !== 'string' || !PROJECT_DELIVERABLE_STATUSES.includes(entry.status as ProjectDeliverableStatus)) {
      fail(`${at}.status 只能是 ${PROJECT_DELIVERABLE_STATUSES.join('、')}`)
    }
    const requirements = entry.requirements === undefined ? null : requirementRefsOf(entry.requirements, `${at}.requirements`)
    const testReports = entry.testReports === undefined ? null : materialsOf(entry.testReports, `${at}.testReports`)
    const limitations = boundedTextOf(entry.limitations, `${at}.limitations`, RECORDS_LIMITS.deliverableLimitationsLength)
    const deliveredAt = entry.deliveredAt === undefined ? null : dueOf(entry.deliveredAt, `${at}.deliveredAt`)
    const acceptances = entry.acceptances === undefined ? null : acceptancesOf(entry.acceptances, `${at}.acceptances`)
    const frozen = entry.frozen === undefined ? null : frozenOf(entry.frozen, `${at}.frozen`)
    return {
      id: entry.id as string,
      name,
      version,
      status: entry.status as ProjectDeliverableStatus,
      ...(requirements === null ? {} : { requirements }),
      ...(testReports === null ? {} : { testReports }),
      ...(limitations === null ? {} : { limitations }),
      ...(deliveredAt === null ? {} : { deliveredAt }),
      ...(acceptances === null ? {} : { acceptances }),
      ...(frozen === null ? {} : { frozen }),
      ...extrasOf(entry, at),
    }
  })
}

/**
 * 需求：编号、标题、版本与状态必填，验收口径、测试方法与关联事项可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 需求表；未填时是 `null`。
 */
export function projectRequirementsOf(value: unknown, field: string): ProjectRequirement[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.projectRequirements, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    const at = `${field}[${String(index)}]`
    if (typeof entry.status !== 'string' || !PROJECT_REQUIREMENT_STATUSES.includes(entry.status as ProjectRequirementStatus)) {
      fail(`${at}.status 只能是 ${PROJECT_REQUIREMENT_STATUSES.join('、')}`)
    }
    const no = boundedTextOf(entry.no, `${at}.no`, RECORDS_LIMITS.requirementNoLength)
    const description = boundedTextOf(entry.description, `${at}.description`, RECORDS_LIMITS.requirementText)
    const sources = entry.sources === undefined ? null : refsOf(entry.sources, `${at}.sources`, RELATION_KINDS)
    const materials = entry.materials === undefined ? null : materialsOf(entry.materials, `${at}.materials`)
    const metric = boundedTextOf(entry.metric, `${at}.metric`, RECORDS_LIMITS.requirementMetricLength)
    const unit = boundedTextOf(entry.unit, `${at}.unit`, RECORDS_LIMITS.unitLength)
    const threshold = boundedTextOf(entry.threshold, `${at}.threshold`, RECORDS_LIMITS.requirementThresholdLength)
    const testMethod = boundedTextOf(entry.testMethod, `${at}.testMethod`, RECORDS_LIMITS.requirementTestMethodLength)
    const tasks = entry.tasks === undefined ? null : idsOf(entry.tasks, `${at}.tasks`, RECORDS_LIMITS.projectItems)
    const actionId = linkIdOf(entry.actionId, `${at}.actionId`)
    return {
      id: entry.id as string,
      title: titleOf(entry.title, `${at}.title`),
      version: versionOf(entry.version, `${at}.version`),
      status: entry.status as ProjectRequirementStatus,
      ...(no === null ? {} : { no }),
      ...(description === null ? {} : { description }),
      ...(sources === null ? {} : { sources }),
      ...(materials === null ? {} : { materials }),
      ...(metric === null ? {} : { metric }),
      ...(unit === null ? {} : { unit }),
      ...(threshold === null ? {} : { threshold }),
      ...(testMethod === null ? {} : { testMethod }),
      ...(tasks === null ? {} : { tasks }),
      ...(actionId === undefined ? {} : { actionId }),
    }
  })
}

/**
 * 需求变更：前后版本与原因必填，影响、沟通依据与确认情况可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 变更表；未填时是 `null`。
 */
export function requirementChangesOf(value: unknown, field: string): ProjectRequirementChange[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.requirementChanges, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    const at = `${field}[${String(index)}]`
    if (typeof entry.requirementId !== 'string' || entry.requirementId === '' || entry.requirementId.length > 64) {
      fail(`${at}.requirementId 不合法`)
    }
    const when = entry.at === undefined ? null : dueOf(entry.at, `${at}.at`)
    const impact = boundedTextOf(entry.impact, `${at}.impact`, RECORDS_LIMITS.requirementText)
    const communication = boundedTextOf(entry.communication, `${at}.communication`, RECORDS_LIMITS.requirementText)
    const confirmation = boundedTextOf(entry.confirmation, `${at}.confirmation`, RECORDS_LIMITS.requirementMetricLength)
    return {
      id: entry.id as string,
      requirementId: entry.requirementId,
      fromVersion: versionOf(entry.fromVersion, `${at}.fromVersion`),
      toVersion: versionOf(entry.toVersion, `${at}.toVersion`),
      reason: requiredTextOf(entry.reason, `${at}.reason`, RECORDS_LIMITS.requirementText),
      ...(when === null ? {} : { at: when }),
      ...(impact === null ? {} : { impact }),
      ...(communication === null ? {} : { communication }),
      ...(confirmation === null ? {} : { confirmation }),
    }
  })
}

/**
 * 沟通结论：一句话必填，日期与说明可留空；来源会议走 `related`。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 沟通表；未填时是 `null`。
 */
export function projectCommunicationsOf(value: unknown, field: string): ProjectCommunication[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.projectItems, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    const summary = titleOf(entry.summary, `${field}[${String(index)}].summary`)
    const at = entry.at === undefined ? null : dueOf(entry.at, `${field}[${String(index)}].at`)
    const note = entry.note === undefined ? null : textOf(entry.note, `${field}[${String(index)}].note`)
    return {
      id: entry.id as string,
      summary,
      ...(at === null ? {} : { at }),
      ...(note === null ? {} : { note }),
    }
  })
}

/**
 * 验收节点：名称必填且不预设合同规则，日期与说明可留空，状态只认三种。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 节点表；未填时是 `null`。
 */
export function projectMilestonesOf(value: unknown, field: string): ProjectMilestone[] | null {
  const rows = labeledMilestonesOf(value, field, RECORDS_LIMITS.projectMilestones, PROJECT_MILESTONE_STATUSES)
  if (rows === null) return null
  return rows.map(({ id, label, status, due, note }) => ({
    id,
    label,
    status: status as ProjectMilestone['status'],
    ...(due === undefined ? {} : { due }),
    ...(note === undefined ? {} : { note }),
  }))
}

/**
 * 待确认问题：标题必填、状态只认三种，说明可留空。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 问题表；未填时是 `null`。
 */
export function projectIssuesOf(value: unknown, field: string): ProjectIssue[] | null {
  const rows = titledRowsOf(value, field, RECORDS_LIMITS.projectItems, PROJECT_ISSUE_STATUSES)
  if (rows === null) return null
  return rows.map(({ entry, index, title }) => {
    const at = `${field}[${String(index)}]`
    const note = entry.note === undefined ? null : textOf(entry.note, `${at}.note`)
    const actionId = linkIdOf(entry.actionId, `${at}.actionId`)
    return {
      id: entry.id as string,
      title,
      status: entry.status as ProjectIssueStatus,
      ...(note === null ? {} : { note }),
      ...(actionId === undefined ? {} : { actionId }),
    }
  })
}

/**
 * 评审：对象与决定必填，评审人、日期、版本与后续行动可留空。
 *
 * 评审记录的是用户写下的意见与决定，不构成审批身份；`reviewer` 只是成员 id。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 评审表；未填时是 `null`。
 */
export function projectReviewsOf(value: unknown, field: string): ProjectReview[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.projectReviews, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    const at = `${field}[${String(index)}]`
    if (typeof entry.target !== 'string' || !PROJECT_REVIEW_TARGETS.includes(entry.target as ProjectReviewTarget)) {
      fail(`${at}.target 只能是 ${PROJECT_REVIEW_TARGETS.join('、')}`)
    }
    const targetId = linkIdOf(entry.targetId, `${at}.targetId`)
    const targetVersion = entry.targetVersion === undefined ? null : versionOf(entry.targetVersion, `${at}.targetVersion`)
    if (entry.target !== 'project' && targetId === undefined) fail(`${at}.targetId 在评审交付物或需求时不能是空的`)
    const reviewer = linkIdOf(entry.reviewer, `${at}.reviewer`)
    const when = entry.at === undefined ? null : dueOf(entry.at, `${at}.at`)
    const followUp = boundedTextOf(entry.followUp, `${at}.followUp`, RECORDS_LIMITS.reviewFollowUpLength)
    return {
      id: entry.id as string,
      target: entry.target as ProjectReviewTarget,
      ...(targetId === undefined ? {} : { targetId }),
      ...(targetVersion === null ? {} : { targetVersion }),
      ...(reviewer === undefined ? {} : { reviewer }),
      ...(when === null ? {} : { at: when }),
      opinion: requiredTextOf(entry.opinion, `${at}.opinion`, RECORDS_LIMITS.reviewOpinionLength),
      decision: requiredTextOf(entry.decision, `${at}.decision`, RECORDS_LIMITS.reviewDecisionLength),
      ...(followUp === null ? {} : { followUp }),
    }
  })
}

/**
 * 交接：接手人、进度等文字都可留空，确认状态必填。
 *
 * 交接确认由用户手动记录；只有 `confirmed` 为真时 `confirmedAt` 才有意义。
 *
 * @param value - 外来值。
 * @param field - 出错时指人。
 * @returns 交接表；未填时是 `null`。
 */
export function projectHandoversOf(value: unknown, field: string): ProjectHandover[] | null {
  const rows = idItemsOf(value, field, RECORDS_LIMITS.projectHandovers, '对象')
  if (rows === null) return null
  return rows.map((entry, index) => {
    const at = `${field}[${String(index)}]`
    if (typeof entry.confirmed !== 'boolean') fail(`${at}.confirmed 要是布尔值`)
    const receiver = linkIdOf(entry.receiver, `${at}.receiver`)
    const when = entry.at === undefined ? null : dueOf(entry.at, `${at}.at`)
    const progress = boundedTextOf(entry.progress, `${at}.progress`, RECORDS_LIMITS.handoverText)
    const materials = boundedTextOf(entry.materials, `${at}.materials`, RECORDS_LIMITS.handoverText)
    const instructions = boundedTextOf(entry.instructions, `${at}.instructions`, RECORDS_LIMITS.handoverText)
    const issues = boundedTextOf(entry.issues, `${at}.issues`, RECORDS_LIMITS.handoverText)
    const todos = boundedTextOf(entry.todos, `${at}.todos`, RECORDS_LIMITS.handoverText)
    const confirmedAt = entry.confirmedAt === undefined ? null : dueOf(entry.confirmedAt, `${at}.confirmedAt`)
    if (confirmedAt !== null && entry.confirmed !== true) fail(`${at} 未确认时不能填 confirmedAt`)
    return {
      id: entry.id as string,
      ...(receiver === undefined ? {} : { receiver }),
      ...(when === null ? {} : { at: when }),
      ...(progress === null ? {} : { progress }),
      ...(materials === null ? {} : { materials }),
      ...(instructions === null ? {} : { instructions }),
      ...(issues === null ? {} : { issues }),
      ...(todos === null ? {} : { todos }),
      confirmed: entry.confirmed,
      ...(confirmedAt === null ? {} : { confirmedAt }),
    }
  })
}

interface ArraySpec {
  field: string
  key: 'title' | 'label' | 'name' | 'summary' | 'reason'
  statuses: readonly string[]
  due: boolean
  version: boolean
}

const ARRAY_SPECS: readonly ArraySpec[] = [
  { field: 'requirements', key: 'title', statuses: PROJECT_REQUIREMENT_STATUSES, due: false, version: true },
  { field: 'requirementChanges', key: 'reason', statuses: [], due: false, version: false },
  { field: 'tasks', key: 'title', statuses: PROJECT_TASK_STATUSES, due: true, version: false },
  { field: 'deliverables', key: 'name', statuses: PROJECT_DELIVERABLE_STATUSES, due: true, version: true },
  { field: 'communications', key: 'summary', statuses: [], due: true, version: false },
  { field: 'milestones', key: 'label', statuses: PROJECT_MILESTONE_STATUSES, due: true, version: false },
  { field: 'issues', key: 'title', statuses: PROJECT_ISSUE_STATUSES, due: false, version: false },
]

const KEY_NAMES: Record<ArraySpec['key'], string> = { title: '标题', label: '名称', name: '名称', summary: '结论', reason: '原因' }

/**
 * 交付物里的验收记录在盘上也要是认识的形状。
 *
 * @param entry - 一条交付物。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
function deliverableAcceptancesProblem(entry: Record<string, unknown>): string | null {
  if (entry.acceptances === undefined) return null
  if (!Array.isArray(entry.acceptances)) return 'deliverables 的 acceptances 不是数组'
  const ids = new Set<string>()
  for (const acceptance of entry.acceptances as unknown[]) {
    if (!isRecord(acceptance)) return 'deliverables 的验收记录不合法'
    if (typeof acceptance.id !== 'string' || acceptance.id === '') return 'deliverables 的验收记录缺少 id'
    if (ids.has(acceptance.id)) return 'deliverables 的验收记录 id 重复'
    ids.add(acceptance.id)
    if (typeof acceptance.passed !== 'boolean') return 'deliverables 的验收记录缺少结论'
    if (typeof acceptance.opinion !== 'string' || acceptance.opinion.trim() === '') return 'deliverables 的验收记录缺少意见'
  }
  return null
}

/**
 * 内嵌的一组引用：只要在盘上出现，就必须是带 id 的对象；需求引用还要带版本。
 *
 * @param value - 条目上的字段值。
 * @param name - 出错时指人。
 * @param withVersion - 是否要求版本号。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
function refsProblem(value: unknown, name: string, withVersion: boolean): string | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) return `${name} 不是数组`
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) return `${name} 的条目不合法`
    if (typeof entry.id !== 'string' || entry.id === '') return `${name} 的条目缺少 id`
    if (withVersion && (typeof entry.version !== 'string' || entry.version === '')) return `${name} 的条目缺少版本`
  }
  return null
}

/**
 * 交付物与需求里的内嵌材料、需求引用与冻结快照在盘上也要是认识的形状。
 *
 * @param entry - 一条交付物或需求。
 * @param name - 出错时指人。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
function nestedRefsProblem(entry: Record<string, unknown>, name: string): string | null {
  const problems = [
    refsProblem(entry.requirements, `${name} 的 requirements`, true),
    refsProblem(entry.testReports, `${name} 的 testReports`, false),
    refsProblem(entry.sources, `${name} 的 sources`, false),
    refsProblem(entry.materials, `${name} 的 materials`, false),
  ]
  for (const problem of problems) if (problem !== null) return problem
  if (entry.frozen === undefined) return null
  if (!isRecord(entry.frozen)) return `${name} 的 frozen 不合法`
  if (!isRecord(entry.frozen.at)) return `${name} 的 frozen 缺少 at`
  if (!Array.isArray(entry.frozen.materials)) return `${name} 的 frozen 缺少 materials`
  return null
}

/**
 * 成员 id 的数组在盘上也要是一串非空字符串。
 *
 * @param value - 条目上的字段值。
 * @param name - 出错时指人。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
function memberIdsProblem(value: unknown, name: string): string | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) return `${name} 不是数组`
  const seen = new Set<string>()
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'string' || entry === '') return `${name} 里有不合法的成员 id`
    if (seen.has(entry)) return `${name} 里的成员 id 重复`
    seen.add(entry)
  }
  return null
}

/**
 * 评审与交接条目在盘上也要是认识的形状。
 *
 * @param field - `reviews` 或 `handovers`。
 * @param entries - 记录上的数组。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
function reviewEntryProblem(field: 'reviews' | 'handovers', entries: unknown[]): string | null {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (!isRecord(entry)) return `${field} 的条目不合法`
    if (typeof entry.id !== 'string' || entry.id === '') return `${field} 的条目缺少 id`
    if (ids.has(entry.id)) return `${field} 的 id 重复`
    ids.add(entry.id)
    if (field === 'reviews') {
      if (typeof entry.target !== 'string' || !PROJECT_REVIEW_TARGETS.includes(entry.target as ProjectReviewTarget)) return 'reviews 的 target 不认识'
      if (typeof entry.opinion !== 'string' || entry.opinion.trim() === '') return 'reviews 的条目缺少意见'
      if (typeof entry.decision !== 'string' || entry.decision.trim() === '') return 'reviews 的条目缺少决定'
      if (entry.target !== 'project' && (typeof entry.targetId !== 'string' || entry.targetId === '')) return 'reviews 的条目缺少 targetId'
      continue
    }
    if (typeof entry.confirmed !== 'boolean') return 'handovers 的条目缺少确认状态'
    if (entry.confirmed !== true && entry.confirmedAt !== undefined) return 'handovers 未确认时不能带 confirmedAt'
  }
  return null
}

/**
 * 横向项目的几组内嵌条目：形状、状态与 id 唯一。
 *
 * @param value - 一条记录。
 * @returns 不合格时是一句原因；合格时是 `null`。
 */
export function projectArraysProblem(value: Record<string, unknown>): string | null {
  for (const spec of ARRAY_SPECS) {
    const entries = value[spec.field]
    if (entries === undefined) continue
    if (!Array.isArray(entries)) return `${spec.field} 不是数组`
    const ids = new Set<string>()
    for (const entry of entries as unknown[]) {
      if (!isRecord(entry)) return `${spec.field} 的条目不合法`
      if (typeof entry.id !== 'string' || entry.id === '') return `${spec.field} 的条目缺少 id`
      if (ids.has(entry.id)) return `${spec.field} 的 id 重复`
      ids.add(entry.id)
      if (typeof entry[spec.key] !== 'string' || entry[spec.key] === '') return `${spec.field} 的条目缺少${KEY_NAMES[spec.key]}`
      if (spec.statuses.length > 0 && (typeof entry.status !== 'string' || !spec.statuses.includes(entry.status))) return `${spec.field} 的 status 不认识`
      if (spec.version && (typeof entry.version !== 'string' || entry.version === '')) return `${spec.field} 的条目缺少版本`
      if (spec.due && entry.due !== undefined && !isRecord(entry.due)) return `${spec.field} 的 due 不合法`
      if (spec.field === 'requirementChanges') {
        if (typeof entry.requirementId !== 'string' || entry.requirementId === '') return 'requirementChanges 的条目缺少 requirementId'
        if (typeof entry.fromVersion !== 'string' || entry.fromVersion === '') return 'requirementChanges 的条目缺少 fromVersion'
        if (typeof entry.toVersion !== 'string' || entry.toVersion === '') return 'requirementChanges 的条目缺少 toVersion'
        if (entry.at !== undefined && !isRecord(entry.at)) return 'requirementChanges 的 at 不合法'
      }
      if (spec.field === 'tasks') {
        if (entry.owner !== undefined && (typeof entry.owner !== 'string' || entry.owner === '')) return 'tasks 的 owner 不合法'
        for (const name of ['collaborators', 'confirmers'] as const) {
          const problem = memberIdsProblem(entry[name], `tasks 的 ${name}`)
          if (problem !== null) return problem
        }
      }
      if (spec.field === 'deliverables') {
        const problem = deliverableAcceptancesProblem(entry)
        if (problem !== null) return problem
      }
      if (spec.field === 'deliverables' || spec.field === 'requirements') {
        const problem = nestedRefsProblem(entry, spec.field)
        if (problem !== null) return problem
      }
    }
  }
  for (const field of ['reviews', 'handovers'] as const) {
    const entries = value[field]
    if (entries === undefined) continue
    if (!Array.isArray(entries)) return `${field} 不是数组`
    const problem = reviewEntryProblem(field, entries as unknown[])
    if (problem !== null) return problem
  }
  return null
}
