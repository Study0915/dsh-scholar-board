/*
 * 小论文卡的不碰 DOM 判定：阶段与历史、期限、视图与筛选、材料地址。
 *
 * 挂在全局的 Manuscripts 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 */
;(function (root) {
  'use strict'

  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000
  var STAGES = ['idea', 'experiment', 'writing', 'internal-review', 'submitted', 'revision', 'accepted', 'archived']
  var ACTIVE_STAGES = ['idea', 'experiment', 'writing', 'internal-review', 'submitted', 'revision']

  /** 阶段读成文案键。 */
  function stageKey(stage) {
    if (stage === 'experiment') return 'stageExperiment'
    if (stage === 'writing') return 'stageWriting'
    if (stage === 'internal-review') return 'stageInternalReview'
    if (stage === 'submitted') return 'stageSubmitted'
    if (stage === 'revision') return 'stageRevision'
    if (stage === 'accepted') return 'stageAccepted'
    if (stage === 'archived') return 'stageArchived'
    return 'stageIdea'
  }

  function isStage(value) {
    return STAGES.indexOf(value) !== -1
  }

  /** 一个时刻读成 `YYYY-MM-DD`；读不出来时是空串。 */
  function dateOf(at) {
    if (typeof at !== 'string') return ''
    var stamp = Date.parse(at)
    if (isNaN(stamp)) return ''
    return new Date(stamp).toISOString().slice(0, 10)
  }

  /** 期限读成一行字：日期原样，时刻写到分钟。 */
  function dueText(record) {
    if (record === null || typeof record !== 'object') return ''
    var due = record.due
    if (due === null || due === undefined || typeof due !== 'object') return ''
    if (due.kind === 'date' && typeof due.date === 'string') return due.date
    if (due.kind === 'instant' && typeof due.at === 'string') {
      var stamp = Date.parse(due.at)
      if (isNaN(stamp)) return ''
      var zone = typeof due.timeZone === 'string' && due.timeZone !== '' ? due.timeZone : 'UTC'
      try {
        return new Intl.DateTimeFormat('zh-CN', {
          timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(new Date(stamp)).replace(/\//g, '-')
      } catch (error) {
        return due.at.slice(0, 16).replace('T', ' ')
      }
    }
    return ''
  }

  /** 一个时刻在某个时区里的日期。 */
  function dateIn(stamp, zone) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(stamp))
    } catch (error) {
      return ''
    }
  }

  /** 期限的紧迫程度：逾期按记录自己的时区判次日零点。 */
  function dueTone(record, now) {
    if (record === null || typeof record !== 'object') return 'none'
    var due = record.due
    if (due === null || due === undefined || typeof due !== 'object') return 'none'
    var stamp = typeof now === 'number' ? now : Date.now()
    if (due.kind === 'instant' && typeof due.at === 'string') {
      var at = Date.parse(due.at)
      if (isNaN(at)) return 'none'
      if (at < stamp) return 'overdue'
      return at - stamp <= 3 * DAY ? 'near' : 'open'
    }
    if (due.kind === 'date' && typeof due.date === 'string') {
      var zone = typeof due.timeZone === 'string' && due.timeZone !== '' ? due.timeZone : 'UTC'
      var today = dateIn(stamp, zone)
      if (today === '') return 'none'
      if (due.date < today) return 'overdue'
      if (due.date === today) return 'today'
      return 'open'
    }
    return 'none'
  }

  function dueKey(record) {
    var due = record !== null && typeof record === 'object' ? record.due : null
    if (due === null || due === undefined || typeof due !== 'object') return null
    if (due.kind === 'date' && typeof due.date === 'string') return due.date
    if (due.kind === 'instant' && typeof due.at === 'string') return due.at
    return null
  }

  /** 阶段历史，最近的在前；不认识的条目跳过。 */
  function historyOf(record) {
    if (record === null || typeof record !== 'object' || !Array.isArray(record.stageHistory)) return []
    return record.stageHistory.slice().reverse()
  }

  /**
   * 一个视图里的行：活跃、完成（已接收或阶段归档）、归档与回收站分开，活跃里再按阶段筛。
   *
   * @param {unknown} records - 读到的记录。
   * @param {string} view - `active`、`finished`、`archived` 或 `trash`。
   * @param {string} stage - 活跃里的阶段；空串表示全部。
   * @param {number} now - 当前时刻。
   * @returns {object[]} 要画的行。
   */
  function viewRows(records, view, stage, now) {
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
      if ((view === 'active' || view === 'finished') && record.archived === true) continue
      var finished = record.stage === 'accepted' || record.stage === 'archived'
      if (view === 'active' && finished) continue
      if (view === 'finished' && !finished) continue
      if (view === 'active' && stage !== '' && record.stage !== stage) continue
      rows.push(record)
    }
    rows.sort(function (left, right) {
      if (view === 'active') {
        var a = dueKey(left)
        var b = dueKey(right)
        if (a !== null && b !== null && a !== b) return a < b ? -1 : 1
        if (a !== null && b === null) return -1
        if (a === null && b !== null) return 1
      }
      return String(right.updatedAt).localeCompare(String(left.updatedAt))
    })
    return rows
  }

  /** 材料地址只收 http/https 的完整地址，说明不能是空的。 */
  function materialValid(url, title) {
    if (typeof title !== 'string' || title.trim() === '') return false
    try {
      return /^https?:$/.test(new URL(String(url)).protocol)
    } catch (error) {
      return false
    }
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

  /** 文案里的 `{name}` 替换。 */
  function fill(text, values) {
    var out = text
    for (var name in values) {
      if (Object.prototype.hasOwnProperty.call(values, name)) out = out.split('{' + name + '}').join(String(values[name]))
    }
    return out
  }

  root.Manuscripts = {
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    STAGES: STAGES,
    ACTIVE_STAGES: ACTIVE_STAGES,
    stageKey: stageKey,
    isStage: isStage,
    dateOf: dateOf,
    dueText: dueText,
    dueTone: dueTone,
    historyOf: historyOf,
    viewRows: viewRows,
    materialValid: materialValid,
    dateValue: dateValue,
    zone: zone,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
