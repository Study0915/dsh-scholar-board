/*
 * 毕业论文卡的不碰 DOM 判定：章节、成果来源、待补实验、学位节点、缺失内容的说法与材料地址。
 *
 * 挂在全局的 ThesisRecords 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 * 学位节点与实验进度都由用户维护，这里不预设学校规则，也不判断毕业资格。
 */
;(function (root) {
  'use strict'

  var KIND = 'thesis'
  var CHAPTER_STATUSES = ['planned', 'drafting', 'revising', 'done']
  var ITEM_STATUSES = ['todo', 'doing', 'done']
  var RESULT_KINDS = ['manuscript', 'research']
  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000
  var MAX_ITEMS = 100
  var MAX_MILESTONES = 50
  var LABEL_LENGTH = 60
  var TITLE_LENGTH = 200

  /** 章节状态对应的文案键。 */
  function chapterKey(status) {
    if (status === 'drafting') return 'chapterDrafting'
    if (status === 'revising') return 'chapterRevising'
    if (status === 'done') return 'chapterDone'
    return 'chapterPlanned'
  }

  /** 待补实验与学位节点的状态文案键。 */
  function itemKey(status) {
    return status === 'doing' ? 'itemDoing' : status === 'done' ? 'itemDone' : 'itemTodo'
  }

  /** 成果来源的两种记录类型文案键。 */
  function resultKey(kind) {
    return kind === 'research' ? 'resultResearch' : 'resultManuscript'
  }

  function isChapterStatus(status) {
    return CHAPTER_STATUSES.indexOf(status) >= 0
  }

  function isItemStatus(status) {
    return ITEM_STATUSES.indexOf(status) >= 0
  }

  function isResultKind(kind) {
    return RESULT_KINDS.indexOf(kind) >= 0
  }

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

  /** 章节：要有 id、标题与认识的状态。 */
  function chaptersOf(record) {
    var out = []
    var list = listOf(record, 'chapters')
    for (var at = 0; at < list.length; at += 1) {
      var entry = list[at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.id !== 'string' || textOf(entry.title) === '') continue
      out.push(entry)
    }
    return out
  }

  /** 成果来源：要有 id、类型与来源记录。 */
  function resultsOf(record) {
    var out = []
    var list = listOf(record, 'results')
    for (var at = 0; at < list.length; at += 1) {
      var entry = list[at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.id !== 'string' || !isResultKind(entry.kind) || typeof entry.recordId !== 'string' || entry.recordId === '') continue
      out.push(entry)
    }
    return out
  }

  /** 待补实验：要有 id 与标题。 */
  function experimentsOf(record) {
    var out = []
    var list = listOf(record, 'experiments')
    for (var at = 0; at < list.length; at += 1) {
      var entry = list[at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.id !== 'string' || textOf(entry.title) === '') continue
      out.push(entry)
    }
    return out
  }

  /** 学位节点：要有 id 与名称。 */
  function milestonesOf(record) {
    var out = []
    var list = listOf(record, 'milestones')
    for (var at = 0; at < list.length; at += 1) {
      var entry = list[at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.id !== 'string' || textOf(entry.label) === '') continue
      out.push(entry)
    }
    return out
  }

  /** 还没完成的待补实验条数。 */
  function openExperiments(record) {
    var list = experimentsOf(record)
    var count = 0
    for (var at = 0; at < list.length; at += 1) if (list[at].status !== 'done') count += 1
    return count
  }

  /** 还没完成、且有日期的最近一个学位节点；没有日期时排在最后。 */
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

  /** 一个学位节点的一行字：名称与日期；没填日期就只写名称。 */
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

  /** 成果来源的一行字：类型与来源标题；来源缺失时直接说明。 */
  function resultLine(result, title, text) {
    var kind = text.t(resultKey(result.kind))
    var name = typeof title === 'string' && title !== '' ? title : String(text.t('missingSource'))
    return kind + ' · ' + name
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

  /**
   * 把编辑面板里的章节行整理成可保存的样子；缺标题或状态不认识时返回 null。
   *
   * @param {Array} rows - `{ id, title, status, question, note }` 行。
   * @returns {Array|null} 归一后的章节；有问题时是 null。
   */
  function cleanChapters(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') return null
      var title = textOf(row.title)
      if (title === '' || [...title].length > TITLE_LENGTH) return null
      if (!isChapterStatus(row.status)) return null
      var entry = { id: String(row.id), title: title, status: row.status }
      if (textOf(row.question) !== '') entry.question = textOf(row.question)
      if (textOf(row.note) !== '') entry.note = textOf(row.note)
      out.push(entry)
      if (out.length > MAX_ITEMS) return null
    }
    return out
  }

  /**
   * 成果来源：类型、来源记录与可选说明；缺来源时返回 null。
   *
   * @param {Array} rows - `{ id, kind, recordId, note, materials }` 行。
   * @returns {Array|null} 归一后的成果；有问题时是 null。
   */
  function cleanResults(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') return null
      if (!isResultKind(row.kind)) return null
      var recordId = textOf(row.recordId)
      if (recordId === '' || recordId.length > 64) return null
      var entry = { id: String(row.id), kind: row.kind, recordId: recordId }
      if (textOf(row.note) !== '') entry.note = textOf(row.note)
      out.push(entry)
      if (out.length > MAX_ITEMS) return null
    }
    return out
  }

  /**
   * 待补实验：标题与状态；缺标题时返回 null。
   *
   * @param {Array} rows - `{ id, title, status, note }` 行。
   * @returns {Array|null} 归一后的实验；有问题时是 null。
   */
  function cleanExperiments(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') return null
      var title = textOf(row.title)
      if (title === '' || [...title].length > TITLE_LENGTH) return null
      if (!isItemStatus(row.status)) return null
      var entry = { id: String(row.id), title: title, status: row.status }
      if (textOf(row.note) !== '') entry.note = textOf(row.note)
      out.push(entry)
      if (out.length > MAX_ITEMS) return null
    }
    return out
  }

  /**
   * 学位节点：名称、状态与可选日期；缺名称或日期不完整时返回 null。
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
      var label = textOf(row.label)
      if (label === '' || [...label].length > LABEL_LENGTH) return null
      if (!isItemStatus(row.status)) return null
      var entry = { id: String(row.id), label: label, status: row.status }
      if (row.due !== null && row.due !== undefined) {
        var date = typeof row.due === 'string' ? row.due : dateInputOf(row.due)
        if (date === '') return null
        entry.due = dateValue(date, zone())
        if (entry.due === null) return null
      }
      if (textOf(row.note) !== '') entry.note = textOf(row.note)
      out.push(entry)
      if (out.length > MAX_MILESTONES) return null
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

  root.ThesisRecords = {
    KIND: KIND,
    CHAPTER_STATUSES: CHAPTER_STATUSES,
    ITEM_STATUSES: ITEM_STATUSES,
    RESULT_KINDS: RESULT_KINDS,
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    MAX_ITEMS: MAX_ITEMS,
    MAX_MILESTONES: MAX_MILESTONES,
    LABEL_LENGTH: LABEL_LENGTH,
    TITLE_LENGTH: TITLE_LENGTH,
    chapterKey: chapterKey,
    itemKey: itemKey,
    resultKey: resultKey,
    isChapterStatus: isChapterStatus,
    isItemStatus: isItemStatus,
    isResultKind: isResultKind,
    textOf: textOf,
    dateValue: dateValue,
    zone: zone,
    dateInputOf: dateInputOf,
    chaptersOf: chaptersOf,
    resultsOf: resultsOf,
    experimentsOf: experimentsOf,
    milestonesOf: milestonesOf,
    openExperiments: openExperiments,
    nextMilestone: nextMilestone,
    milestoneLine: milestoneLine,
    summaryLine: summaryLine,
    resultLine: resultLine,
    daysLeft: daysLeft,
    viewRows: viewRows,
    cleanChapters: cleanChapters,
    cleanResults: cleanResults,
    cleanExperiments: cleanExperiments,
    cleanMilestones: cleanMilestones,
    materialValid: materialValid,
    openableUrl: openableUrl,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
