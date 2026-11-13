/*
 * 横向项目卡的不碰 DOM 判定：负责事项、交付物、沟通结论、验收节点、待确认问题、关联记录与材料。
 *
 * 挂在全局的 ProjectRecords 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 * 事项、节点与问题状态均由用户维护，这里不判断合同履约，也不管审批与经费。
 */
;(function (root) {
  'use strict'

  var KIND = 'project'
  var TASK_STATUSES = ['todo', 'doing', 'blocked', 'done']
  var DELIVERABLE_STATUSES = ['draft', 'review', 'delivered', 'accepted']
  var MILESTONE_STATUSES = ['todo', 'doing', 'done']
  var ISSUE_STATUSES = ['open', 'doing', 'resolved']
  var RELATED_KINDS = ['meeting', 'action', 'manuscript']
  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000
  var MAX_ITEMS = 100
  var MAX_MILESTONES = 50
  var LABEL_LENGTH = 60
  var VERSION_LENGTH = 32
  var TITLE_LENGTH = 200

  /** 负责事项的状态文案键。 */
  function taskKey(status) {
    return status === 'doing' ? 'taskDoing' : status === 'done' ? 'taskDone' : status === 'blocked' ? 'taskBlocked' : 'taskTodo'
  }

  /** 交付物的状态文案键。 */
  function deliverableKey(status) {
    if (status === 'review') return 'deliverableReview'
    if (status === 'delivered') return 'deliverableDelivered'
    if (status === 'accepted') return 'deliverableAccepted'
    return 'deliverableDraft'
  }

  /** 验收节点的状态文案键。 */
  function milestoneKey(status) {
    return status === 'doing' ? 'itemDoing' : status === 'done' ? 'itemDone' : 'itemTodo'
  }

  /** 待确认问题的状态文案键。 */
  function issueKey(status) {
    return status === 'doing' ? 'issueDoing' : status === 'resolved' ? 'issueResolved' : 'issueOpen'
  }

  /** 关联记录的类型文案键。 */
  function relatedKey(kind) {
    if (kind === 'meeting') return 'relatedMeeting'
    if (kind === 'action') return 'relatedAction'
    return 'relatedManuscript'
  }

  function inList(list, value) {
    return typeof value === 'string' && list.indexOf(value) >= 0
  }

  function isTaskStatus(status) { return inList(TASK_STATUSES, status) }
  function isDeliverableStatus(status) { return inList(DELIVERABLE_STATUSES, status) }
  function isMilestoneStatus(status) { return inList(MILESTONE_STATUSES, status) }
  function isIssueStatus(status) { return inList(ISSUE_STATUSES, status) }
  function isRelatedKind(kind) { return inList(RELATED_KINDS, kind) }

  /** 一段非空文字；空白或不是文字时是空串。 */
  function textOf(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

  /** 日期输入与记录里的 `{ kind: 'date' }` 互转。 */
  function dateValue(text, timeZone) {
    return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? { kind: 'date', date: text, timeZone: typeof timeZone === 'string' && timeZone !== '' ? timeZone : 'UTC' }
      : null
  }

  function zone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch (error) {
      return 'UTC'
    }
  }

  /** 日期输入框里的值：日期原样，时刻取日期部分。 */
  function dateInputOf(due) {
    if (due === null || typeof due !== 'object') return ''
    if (due.kind === 'date' && typeof due.date === 'string') return due.date
    if (due.kind === 'instant' && typeof due.at === 'string') return due.at.slice(0, 10)
    return ''
  }

  /** 一组条目里真正可用的对象；不是数组时当空。 */
  function listOf(record, field) {
    return record !== null && typeof record === 'object' && Array.isArray(record[field]) ? record[field] : []
  }

  /** 按一组字段要求挑出条目；缺任一字段就跳过。 */
  function pick(list, check) {
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var entry = list[at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.id !== 'string' || entry.id === '') continue
      if (!check(entry)) continue
      out.push(entry)
    }
    return out
  }

  /** 负责事项：要有 id、标题与认识的状态。 */
  function tasksOf(record) {
    return pick(listOf(record, 'tasks'), function (entry) {
      return textOf(entry.title) !== '' && isTaskStatus(entry.status)
    })
  }

  /** 交付物：要有 id、名称、版本与认识的状态。 */
  function deliverablesOf(record) {
    return pick(listOf(record, 'deliverables'), function (entry) {
      return textOf(entry.name) !== '' && textOf(entry.version) !== '' && isDeliverableStatus(entry.status)
    })
  }

  /** 沟通结论：要有 id 与一句话。 */
  function communicationsOf(record) {
    return pick(listOf(record, 'communications'), function (entry) {
      return textOf(entry.summary) !== ''
    })
  }

  /** 验收节点：要有 id 与名称。 */
  function milestonesOf(record) {
    return pick(listOf(record, 'milestones'), function (entry) {
      return textOf(entry.label) !== ''
    })
  }

  /** 待确认问题：要有 id、标题与认识的状态。 */
  function issuesOf(record) {
    return pick(listOf(record, 'issues'), function (entry) {
      return textOf(entry.title) !== '' && isIssueStatus(entry.status)
    })
  }

  /** 关联记录：只认会议、行动项与稿件。 */
  function relatedOf(record) {
    return pick(listOf(record, 'related'), function (entry) {
      return isRelatedKind(entry.kind)
    })
  }

  /** 还没完成的事项条数。 */
  function openTasks(record) {
    var list = tasksOf(record)
    var count = 0
    for (var at = 0; at < list.length; at += 1) if (list[at].status !== 'done') count += 1
    return count
  }

  /** 还没解决的待确认问题条数。 */
  function openIssues(record) {
    var list = issuesOf(record)
    var count = 0
    for (var at = 0; at < list.length; at += 1) if (list[at].status !== 'resolved') count += 1
    return count
  }

  /** 还没完成、且有日期的最近一个验收节点；没有日期时排在最后。 */
  function nextMilestone(record) {
    var list = milestonesOf(record)
    var chosen = null
    for (var at = 0; at < list.length; at += 1) {
      if (list[at].status === 'done') continue
      if (chosen === null) {
        chosen = list[at]
        continue
      }
      var left = dateInputOf(list[at].due)
      var right = dateInputOf(chosen.due)
      if (left !== '' && (right === '' || left < right)) chosen = list[at]
    }
    return chosen
  }

  /** 一个验收节点的一行字：名称与日期；没填日期就只写名称。 */
  function milestoneLine(milestone, text) {
    if (milestone === null || typeof milestone !== 'object') return ''
    var label = textOf(milestone.label)
    var date = dateInputOf(milestone.due)
    return date === '' ? label : label + ' · ' + date
  }

  /** 列表的一行摘要：最近一个未完成节点，没有节点时说明未知。 */
  function summaryLine(record, text) {
    var milestone = nextMilestone(record)
    if (milestone === null) return String(text.t('noMilestone'))
    return milestoneLine(milestone, text)
  }

  /** 交付物的一行字：名称与版本。 */
  function deliverableLine(deliverable, text) {
    if (deliverable === null || typeof deliverable !== 'object') return ''
    var name = textOf(deliverable.name) === '' ? String(text.t('unknown')) : textOf(deliverable.name)
    var version = textOf(deliverable.version) === '' ? String(text.t('unknown')) : textOf(deliverable.version)
    return name + ' · ' + version
  }

  /** 回收站里还剩几天：不认识的 deletedAt 不给倒计时。 */
  function daysLeft(record, now) {
    if (record === null || typeof record !== 'object' || typeof record.deletedAt !== 'string') return null
    var stamp = Date.parse(record.deletedAt)
    if (isNaN(stamp)) return null
    return Math.max(0, Math.ceil((stamp + 30 * DAY - (typeof now === 'number' ? now : Date.now())) / DAY))
  }

  /** 一个视图里的行：按回收与归档状态筛，按最近更新从新到旧。 */
  function viewRows(records, view) {
    var list = Array.isArray(records) ? records : []
    var rows = []
    for (var at = 0; at < list.length; at += 1) {
      var record = list[at]
      if (record === null || typeof record !== 'object') continue
      var trashed = typeof record.deletedAt === 'string'
      if (view === 'trash') {
        if (!trashed) continue
      } else if (trashed) {
        continue
      }
      if (view === 'archived' && record.archived !== true) continue
      if (view !== 'archived' && view !== 'trash' && record.archived === true) continue
      rows.push(record)
    }
    rows.sort(function (left, right) {
      return String(right.updatedAt).localeCompare(String(left.updatedAt))
    })
    return rows
  }

  /** 一行可选的日期；空值不写，格式不完整时返回 null。 */
  function dueOf(row, key) {
    if (row[key] === null || row[key] === undefined) return undefined
    var date = typeof row[key] === 'string' ? row[key] : dateInputOf(row[key])
    if (date === '') return null
    var due = dateValue(date, zone())
    return due === null ? null : due
  }

  /** 标题一类的文字：去掉首尾空白后不能为空，也不能超过上限。 */
  function labelOf(value, limit) {
    var text = textOf(value)
    if (text === '' || [...text].length > limit) return null
    return text
  }

  /**
   * 负责事项：标题与状态；日期、说明可留空。
   *
   * @param {Array} rows - `{ id, title, status, due, note }` 行。
   * @returns {Array|null} 归一后的事项；有问题时是 null。
   */
  function cleanTasks(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') return null
      var title = labelOf(row.title, TITLE_LENGTH)
      if (title === null || !isTaskStatus(row.status)) return null
      var entry = { id: String(row.id), title: title, status: row.status }
      var due = dueOf(row, 'due')
      if (due === null) return null
      if (due !== undefined) entry.due = due
      if (textOf(row.note) !== '') entry.note = textOf(row.note)
      out.push(entry)
      if (out.length > MAX_ITEMS) return null
    }
    return out
  }

  /**
   * 交付物：名称、版本与状态；日期、说明可留空。
   *
   * @param {Array} rows - `{ id, name, version, status, due, note }` 行。
   * @returns {Array|null} 归一后的交付物；有问题时是 null。
   */
  function cleanDeliverables(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') return null
      var name = labelOf(row.name, TITLE_LENGTH)
      var version = labelOf(row.version, VERSION_LENGTH)
      if (name === null || version === null || !isDeliverableStatus(row.status)) return null
      var entry = { id: String(row.id), name: name, version: version, status: row.status }
      var due = dueOf(row, 'due')
      if (due === null) return null
      if (due !== undefined) entry.due = due
      if (textOf(row.note) !== '') entry.note = textOf(row.note)
      out.push(entry)
      if (out.length > MAX_ITEMS) return null
    }
    return out
  }

  /**
   * 沟通结论：一句话；日期与说明可留空。
   *
   * @param {Array} rows - `{ id, summary, at, note }` 行。
   * @returns {Array|null} 归一后的沟通；有问题时是 null。
   */
  function cleanCommunications(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') return null
      var summary = labelOf(row.summary, TITLE_LENGTH)
      if (summary === null) return null
      var entry = { id: String(row.id), summary: summary }
      var when = dueOf(row, 'at')
      if (when === null) return null
      if (when !== undefined) entry.at = when
      if (textOf(row.note) !== '') entry.note = textOf(row.note)
      out.push(entry)
      if (out.length > MAX_ITEMS) return null
    }
    return out
  }

  /**
   * 验收节点：名称、状态与可选日期。
   *
   * @param {Array} rows - `{ id, label, status, due, note }` 行。
   * @returns {Array|null} 归一后的节点；有问题时是 null。
   */
  function cleanMilestones(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') return null
      var label = labelOf(row.label, LABEL_LENGTH)
      if (label === null || !isMilestoneStatus(row.status)) return null
      var entry = { id: String(row.id), label: label, status: row.status }
      var due = dueOf(row, 'due')
      if (due === null) return null
      if (due !== undefined) entry.due = due
      if (textOf(row.note) !== '') entry.note = textOf(row.note)
      out.push(entry)
      if (out.length > MAX_MILESTONES) return null
    }
    return out
  }

  /**
   * 待确认问题：标题与状态；说明可留空。
   *
   * @param {Array} rows - `{ id, title, status, note }` 行。
   * @returns {Array|null} 归一后的问题；有问题时是 null。
   */
  function cleanIssues(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') return null
      var title = labelOf(row.title, TITLE_LENGTH)
      if (title === null || !isIssueStatus(row.status)) return null
      var entry = { id: String(row.id), title: title, status: row.status }
      if (textOf(row.note) !== '') entry.note = textOf(row.note)
      out.push(entry)
      if (out.length > MAX_ITEMS) return null
    }
    return out
  }

  /** 材料地址只收 http/https 的完整地址，说明不能是空的。 */
  function materialValid(url, title) {
    if (textOf(title) === '') return false
    return openableUrl(url)
  }

  /** 地址只收 http/https 的完整地址；空串表示未填。 */
  function openableUrl(url) {
    if (typeof url !== 'string' || url === '') return false
    try {
      return /^https?:$/.test(new URL(url).protocol)
    } catch (error) {
      return false
    }
  }

  /** 文案里的 `{name}` 替换。 */
  function fill(text, values) {
    var out = text
    for (var name in values) {
      if (Object.prototype.hasOwnProperty.call(values, name)) out = out.split('{' + name + '}').join(String(values[name]))
    }
    return out
  }

  root.ProjectRecords = {
    KIND: KIND,
    TASK_STATUSES: TASK_STATUSES,
    DELIVERABLE_STATUSES: DELIVERABLE_STATUSES,
    MILESTONE_STATUSES: MILESTONE_STATUSES,
    ISSUE_STATUSES: ISSUE_STATUSES,
    RELATED_KINDS: RELATED_KINDS,
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    MAX_ITEMS: MAX_ITEMS,
    MAX_MILESTONES: MAX_MILESTONES,
    LABEL_LENGTH: LABEL_LENGTH,
    VERSION_LENGTH: VERSION_LENGTH,
    TITLE_LENGTH: TITLE_LENGTH,
    taskKey: taskKey,
    deliverableKey: deliverableKey,
    milestoneKey: milestoneKey,
    issueKey: issueKey,
    relatedKey: relatedKey,
    isTaskStatus: isTaskStatus,
    isDeliverableStatus: isDeliverableStatus,
    isMilestoneStatus: isMilestoneStatus,
    isIssueStatus: isIssueStatus,
    isRelatedKind: isRelatedKind,
    textOf: textOf,
    dateValue: dateValue,
    zone: zone,
    dateInputOf: dateInputOf,
    tasksOf: tasksOf,
    deliverablesOf: deliverablesOf,
    communicationsOf: communicationsOf,
    milestonesOf: milestonesOf,
    issuesOf: issuesOf,
    relatedOf: relatedOf,
    openTasks: openTasks,
    openIssues: openIssues,
    nextMilestone: nextMilestone,
    milestoneLine: milestoneLine,
    summaryLine: summaryLine,
    deliverableLine: deliverableLine,
    daysLeft: daysLeft,
    viewRows: viewRows,
    cleanTasks: cleanTasks,
    cleanDeliverables: cleanDeliverables,
    cleanCommunications: cleanCommunications,
    cleanMilestones: cleanMilestones,
    cleanIssues: cleanIssues,
    materialValid: materialValid,
    openableUrl: openableUrl,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
