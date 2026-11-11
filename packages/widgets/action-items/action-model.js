/*
 * 行动项卡的不碰 DOM 判定：期限、逾期、视图与筛选、材料地址。
 *
 * 挂在全局的 ActionItems 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 */
;(function (root) {
  'use strict'

  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000
  var STATUSES = ['todo', 'doing', 'blocked', 'done', 'cancelled']

  /**
   * 一个时刻在某个时区里的日期。
   *
   * @param {number} stamp - 毫秒时间戳。
   * @param {string} zone - IANA 时区。
   * @returns {string} `YYYY-MM-DD`；时区读不出来时是空串。
   */
  function dateIn(stamp, zone) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(stamp))
    } catch (error) {
      return ''
    }
  }

  /**
   * 期限读成一行字：日期原样，时刻写到分钟。
   *
   * @param {object} record - 一条行动项。
   * @returns {string} 期限文字；没有期限或读不出来时是空串。
   */
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

  /**
   * 期限的紧迫程度：逾期的按记录自己的时区判次日零点。
   *
   * @param {object} record - 一条行动项。
   * @param {number} now - 当前时刻。
   * @returns {string} `overdue`、`today`、`near`、`open` 或 `none`。
   */
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

  /** 排序用的期限键：有期限的按日期或时刻，没有的是 `null`。 */
  function dueKey(record) {
    var due = record !== null && typeof record === 'object' ? record.due : null
    if (due === null || due === undefined || typeof due !== 'object') return null
    if (due.kind === 'date' && typeof due.date === 'string') return due.date
    if (due.kind === 'instant' && typeof due.at === 'string') return due.at
    return null
  }

  /**
   * 一个视图里的行：生命周期、活跃与完成分开，活跃里再按期限与阻碍筛。
   *
   * @param {unknown} records - 读到的记录。
   * @param {string} view - `active`、`done`、`archived` 或 `trash`。
   * @param {string} filter - 活跃里的 `all`、`overdue`、`nodue` 或 `blocked`。
   * @param {number} now - 当前时刻。
   * @returns {object[]} 要画的行。
   */
  function viewRows(records, view, filter, now) {
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
      if ((view === 'active' || view === 'done') && record.archived === true) continue
      var finished = record.status === 'done' || record.status === 'cancelled'
      if (view === 'active' && finished) continue
      if (view === 'done' && !finished) continue
      if (view === 'active') {
        if (filter === 'overdue' && dueTone(record, now) !== 'overdue') continue
        if (filter === 'nodue' && record.due !== undefined) continue
        if (filter === 'blocked' && record.status !== 'blocked') continue
      }
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

  /** 状态是不是五个之一。 */
  function isStatus(value) {
    return STATUSES.indexOf(value) !== -1
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

  /** 期限输入与记录里的 `{ kind: 'date' }` 互转。 */
  function dateValue(text, timeZone) {
    return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? { kind: 'date', date: text, timeZone: typeof timeZone === 'string' && timeZone !== '' ? timeZone : 'UTC' }
      : null
  }

  /** 时区取浏览器当前的 IANA 名。 */
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

  root.ActionItems = {
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    STATUSES: STATUSES,
    dateIn: dateIn,
    dueText: dueText,
    dueTone: dueTone,
    viewRows: viewRows,
    isStatus: isStatus,
    materialValid: materialValid,
    dateValue: dateValue,
    zone: zone,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
