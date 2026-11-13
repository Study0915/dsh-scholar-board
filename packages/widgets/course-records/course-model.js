/*
 * 课程卡的不碰 DOM 判定：学期、作业考试、学习笔记、关联与材料，以及跨课程的近期事项。
 *
 * 挂在全局的 CourseRecords 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 * 课程不算学分、不校验培养规则；补交只按用户勾选记录，不按日期推断。
 */
;(function (root) {
  'use strict'

  var KIND = 'course'
  var WORK_KINDS = ['assignment', 'exam']
  var WORK_STATUSES = ['todo', 'doing', 'done']
  var RELATED_KINDS = ['meeting', 'action', 'manuscript']
  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000
  var MAX_WORK = 100
  var TERM_LABEL_LENGTH = 40
  var TITLE_LENGTH = 200
  var RECENT_LIMIT = 5

  /** 作业与考试的状态文案键。 */
  function workKey(status) {
    return status === 'doing' ? 'workDoing' : status === 'done' ? 'workDone' : 'workTodo'
  }

  /** 作业与考试的类型文案键。 */
  function workKindKey(kind) {
    return kind === 'exam' ? 'workExam' : 'workAssignment'
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

  function isWorkKind(kind) { return inList(WORK_KINDS, kind) }
  function isWorkStatus(status) { return inList(WORK_STATUSES, status) }
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

  /** 学期：名称非空时可用；起止只是日期。 */
  function termOf(record) {
    var term = record !== null && typeof record === 'object' ? record.term : null
    if (term === null || typeof term !== 'object' || textOf(term.label) === '') return null
    return term
  }

  /** 学期起止：只有日期时才返回，时刻不在这里展示。 */
  function termRange(record) {
    var term = termOf(record)
    if (term === null) return ''
    var start = term.start !== null && typeof term.start === 'object' && term.start.kind === 'date' ? textOf(term.start.date) : ''
    var end = term.end !== null && typeof term.end === 'object' && term.end.kind === 'date' ? textOf(term.end.date) : ''
    if (start !== '' && end !== '') return start + ' ~ ' + end
    return start !== '' ? start : end
  }

  /** 作业与考试：要有 id、类型、标题与认识的状态。 */
  function workOf(record) {
    return pick(listOf(record, 'work'), function (entry) {
      return isWorkKind(entry.kind) && textOf(entry.title) !== '' && isWorkStatus(entry.status)
    })
  }

  /** 关联记录：只认会议、行动项与稿件。 */
  function relatedOf(record) {
    return pick(listOf(record, 'related'), function (entry) {
      return isRelatedKind(entry.kind)
    })
  }

  /** 还没完成的作业与考试条数。 */
  function openWork(record) {
    var list = workOf(record)
    var count = 0
    for (var at = 0; at < list.length; at += 1) if (list[at].status !== 'done') count += 1
    return count
  }

  /** 最近一个未完成、且有日期的作业或考试；没有日期时排在最后。 */
  function nextWork(record) {
    var list = workOf(record)
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

  /** 一条作业或考试的一行字：类型、标题与日期。 */
  function workLine(work, text) {
    if (work === null || typeof work !== 'object') return ''
    var kind = String(text.t(workKindKey(work.kind)))
    var title = textOf(work.title)
    var date = dateInputOf(work.due)
    var late = work.late === true ? ' · ' + String(text.t('workLate')) : ''
    return kind + ' · ' + title + (date === '' ? '' : ' · ' + date) + late
  }

  /** 列表的一行摘要：最近一个未完成事项，没有时说明未知。 */
  function summaryLine(record, text) {
    var work = nextWork(record)
    if (work === null) return String(text.t('noWork'))
    return workLine(work, text)
  }

  /** 课程的一行字：课程名与学期名。 */
  function courseLine(record, text) {
    var term = termOf(record)
    var label = textOf(record !== null && typeof record === 'object' ? record.title : '')
    if (term === null) return label
    return label + ' · ' + textOf(term.label)
  }

  /** 回收站里还剩几天：不认识的 deletedAt 不给倒计时。 */
  function daysLeft(record, now) {
    if (record === null || typeof record !== 'object' || typeof record.deletedAt !== 'string') return null
    var stamp = Date.parse(record.deletedAt)
    if (isNaN(stamp)) return null
    return Math.max(0, Math.ceil((stamp + 30 * DAY - (typeof now === 'number' ? now : Date.now())) / DAY))
  }

  /** 一个视图里的行：按回收与归档状态筛。 */
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
    return rows
  }

  /**
   * 学期分组：有起止日期的学期排前面并按开始日期从新到旧，只有名称的排后面按名称排。
   *
   * @param records - 一个视图里的课程。
   * @returns 分组后的 `{ label, range, start, records }`。
   */
  function termGroups(records) {
    var list = Array.isArray(records) ? records : []
    var groups = []
    var byLabel = {}
    for (var at = 0; at < list.length; at += 1) {
      var record = list[at]
      if (record === null || typeof record !== 'object') continue
      var term = termOf(record)
      var label = term === null ? '' : textOf(term.label)
      if (byLabel[label] === undefined) {
        byLabel[label] = { label: label, range: termRange(record), start: '', records: [] }
        groups.push(byLabel[label])
      }
      byLabel[label].records.push(record)
      if (byLabel[label].start === '') {
        var start = term !== null && term.start !== null && typeof term.start === 'object' && term.start.kind === 'date' ? textOf(term.start.date) : ''
        if (start !== '') byLabel[label].start = start
      }
    }
    groups.sort(function (left, right) {
      if (left.start !== '' && right.start !== '') return left.start < right.start ? 1 : left.start > right.start ? -1 : 0
      if (left.start !== '') return -1
      if (right.start !== '') return 1
      return left.label.localeCompare(right.label)
    })
    for (var group = 0; group < groups.length; group += 1) {
      groups[group].records.sort(function (left, right) {
        var a = dateInputOf(nextWork(left) === null ? null : nextWork(left).due)
        var b = dateInputOf(nextWork(right) === null ? null : nextWork(right).due)
        if (a !== '' && b !== '' && a !== b) return a < b ? -1 : 1
        if (a !== '' && b === '') return -1
        if (a === '' && b !== '') return 1
        return String(left.title).localeCompare(String(right.title))
      })
    }
    return groups
  }

  /**
   * 近期事项：所有活跃课程里未完成、且有日期的作业与考试，按日期从早到晚。
   *
   * @param records - 活跃课程。
   * @param now - 当前时刻，不用于筛选，只留给将来的窗口判断。
   * @param limit - 最多几条。
   * @returns `{ rows, total }`，每行带 `{ record, work }`。
   */
  function recentWork(records, now, limit) {
    var list = Array.isArray(records) ? records : []
    var rows = []
    for (var at = 0; at < list.length; at += 1) {
      var record = list[at]
      if (record === null || typeof record !== 'object' || record.archived === true || typeof record.deletedAt === 'string') continue
      var work = workOf(record)
      for (var index = 0; index < work.length; index += 1) {
        if (work[index].status === 'done') continue
        if (dateInputOf(work[index].due) === '') continue
        rows.push({ record: record, work: work[index] })
      }
    }
    rows.sort(function (left, right) {
      var a = dateInputOf(left.work.due)
      var b = dateInputOf(right.work.due)
      return a < b ? -1 : a > b ? 1 : 0
    })
    var cap = typeof limit === 'number' && limit > 0 ? limit : RECENT_LIMIT
    return { rows: rows.slice(0, cap), total: rows.length }
  }

  /** 一行可选的日期；空值不写，格式不完整时返回 null。 */
  function dueOf(row) {
    if (row.due === null || row.due === undefined) return undefined
    var date = typeof row.due === 'string' ? row.due : dateInputOf(row.due)
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
   * 作业与考试：类型、标题与状态；日期、说明与补交标记可留空。
   *
   * @param rows - `{ id, kind, title, status, due, late, note }` 行。
   * @returns 归一后的条目；有问题时是 null。
   */
  function cleanWork(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') return null
      var title = labelOf(row.title, TITLE_LENGTH)
      if (title === null || !isWorkKind(row.kind) || !isWorkStatus(row.status)) return null
      var entry = { id: String(row.id), kind: row.kind, title: title, status: row.status }
      var due = dueOf(row)
      if (due === null) return null
      if (due !== undefined) entry.due = due
      if (row.late === true) entry.late = true
      if (textOf(row.note) !== '') entry.note = textOf(row.note)
      out.push(entry)
      if (out.length > MAX_WORK) return null
    }
    return out
  }

  /**
   * 学期：名称必填；两个日期可留空，但填了就要完整。
   *
   * @param label - 学期名。
   * @param startText - 开始日期输入。
   * @param endText - 结束日期输入。
   * @returns 学期；有问题时是 null。
   */
  function cleanTerm(label, startText, endText) {
    var wanted = labelOf(label, TERM_LABEL_LENGTH)
    if (wanted === null) return null
    var term = { label: wanted }
    var start = textOf(startText) === '' ? undefined : dateValue(textOf(startText), zone())
    var end = textOf(endText) === '' ? undefined : dateValue(textOf(endText), zone())
    if (start === null || end === null) return null
    if (start !== undefined) term.start = start
    if (end !== undefined) term.end = end
    return term
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

  root.CourseRecords = {
    KIND: KIND,
    WORK_KINDS: WORK_KINDS,
    WORK_STATUSES: WORK_STATUSES,
    RELATED_KINDS: RELATED_KINDS,
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    MAX_WORK: MAX_WORK,
    TERM_LABEL_LENGTH: TERM_LABEL_LENGTH,
    TITLE_LENGTH: TITLE_LENGTH,
    RECENT_LIMIT: RECENT_LIMIT,
    workKey: workKey,
    workKindKey: workKindKey,
    relatedKey: relatedKey,
    isWorkKind: isWorkKind,
    isWorkStatus: isWorkStatus,
    isRelatedKind: isRelatedKind,
    textOf: textOf,
    zone: zone,
    dateValue: dateValue,
    dateInputOf: dateInputOf,
    termOf: termOf,
    termRange: termRange,
    termGroups: termGroups,
    workOf: workOf,
    relatedOf: relatedOf,
    openWork: openWork,
    nextWork: nextWork,
    workLine: workLine,
    summaryLine: summaryLine,
    courseLine: courseLine,
    recentWork: recentWork,
    daysLeft: daysLeft,
    viewRows: viewRows,
    cleanWork: cleanWork,
    cleanTerm: cleanTerm,
    materialValid: materialValid,
    openableUrl: openableUrl,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
