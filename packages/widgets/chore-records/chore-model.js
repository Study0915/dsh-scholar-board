/*
 * 其他事务卡的不碰 DOM 判定：自定义类别、状态、期限筛选与完成归档。
 *
 * 挂在全局的 ChoreRecords 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 * 期限只用于排序与筛选，不判断是否真的办完；完成与取消是两件事。
 */
;(function (root) {
  'use strict'

  var KIND = 'chore'
  var STATUSES = ['todo', 'doing', 'done', 'cancelled']
  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000
  var CATEGORY_LENGTH = 40
  var TITLE_LENGTH = 200
  var SOON_DAYS = 7

  /** 事务状态的文案键。 */
  function statusKey(status) {
    if (status === 'doing') return 'choreDoing'
    if (status === 'done') return 'choreDone'
    if (status === 'cancelled') return 'choreCancelled'
    return 'choreTodo'
  }

  function inList(list, value) {
    return typeof value === 'string' && list.indexOf(value) >= 0
  }

  function isStatus(status) { return inList(STATUSES, status) }

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

  /** 事务的类别：没填时是空串。 */
  function categoryOf(record) {
    return record !== null && typeof record === 'object' ? textOf(record.category) : ''
  }

  /** 已有的类别，按名称排序；空类别不进来。 */
  function categoryOptions(records) {
    var list = Array.isArray(records) ? records : []
    var seen = {}
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var category = categoryOf(list[at])
      if (category === '' || seen[category] === true) continue
      seen[category] = true
      out.push(category)
    }
    out.sort(function (left, right) { return left.localeCompare(right) })
    return out
  }

  /**
   * 期限的远近：逾期、今天、七天内、以后再分，没期限是 none。
   *
   * @param record - 事务记录。
   * @param now - 当前时刻。
   * @returns 一个筛选与配色用的桶名。
   */
  function dueState(record, now) {
    var due = record !== null && typeof record === 'object' ? record.due : null
    if (due === null || due === undefined || typeof due !== 'object') return 'none'
    var stamp = typeof now === 'number' ? now : Date.now()
    if (due.kind === 'date' && typeof due.date === 'string') {
      var timeZone = typeof due.timeZone === 'string' && due.timeZone !== '' ? due.timeZone : 'UTC'
      var today = ''
      try {
        today = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(stamp))
      } catch (error) {
        today = ''
      }
      if (today === '') return 'none'
      if (due.date < today) return 'overdue'
      if (due.date === today) return 'today'
      var left = Math.round((Date.parse(due.date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY)
      return left <= SOON_DAYS ? 'soon' : 'later'
    }
    if (due.kind === 'instant' && typeof due.at === 'string') {
      var at = Date.parse(due.at)
      if (isNaN(at)) return 'none'
      if (at < stamp) return 'overdue'
      return at - stamp <= SOON_DAYS * DAY ? 'soon' : 'later'
    }
    return 'none'
  }

  /** 期限的文案键。 */
  function dueKey(state) {
    if (state === 'overdue') return 'dueOverdue'
    if (state === 'today') return 'dueToday'
    if (state === 'soon') return 'dueSoon'
    if (state === 'later') return 'dueLater'
    return 'dueNone'
  }

  /** 回收站里还剩几天：不认识的 deletedAt 不给倒计时。 */
  function daysLeft(record, now) {
    if (record === null || typeof record !== 'object' || typeof record.deletedAt !== 'string') return null
    var stamp = Date.parse(record.deletedAt)
    if (isNaN(stamp)) return null
    return Math.max(0, Math.ceil((stamp + 30 * DAY - (typeof now === 'number' ? now : Date.now())) / DAY))
  }

  /**
   * 一个视图里的行：先按归档或回收站筛，再按期限桶与类别筛，最后按期限从早到晚。
   *
   * @param records - 事务记录。
   * @param view - `active`、`archived` 或 `trash`。
   * @param filter - `all`、`overdue`、`soon` 或 `none`。
   * @param category - 类别；空串表示不筛。
   * @param now - 当前时刻。
   * @returns 行。
   */
  function viewRows(records, view, filter, category, now) {
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
      if (textOf(category) !== '' && categoryOf(record) !== category) continue
      var state = dueState(record, now)
      if (filter === 'overdue' && state !== 'overdue' && state !== 'today') continue
      if (filter === 'soon' && state !== 'soon' && state !== 'today') continue
      if (filter === 'none' && state !== 'none') continue
      rows.push(record)
    }
    rows.sort(function (left, right) {
      var a = dateInputOf(left.due)
      var b = dateInputOf(right.due)
      if (a !== '' && b !== '' && a !== b) return a < b ? -1 : 1
      if (a !== '' && b === '') return -1
      if (a === '' && b !== '') return 1
      return String(right.updatedAt).localeCompare(String(left.updatedAt))
    })
    return rows
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

  /** 类别：必填，去空白后不超过上限；空串与超长都是 `null`。 */
  function cleanCategory(value) {
    var text = textOf(value)
    if (text === '' || [...text].length > CATEGORY_LENGTH) return null
    return text
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

  root.ChoreRecords = {
    KIND: KIND,
    STATUSES: STATUSES,
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    CATEGORY_LENGTH: CATEGORY_LENGTH,
    TITLE_LENGTH: TITLE_LENGTH,
    SOON_DAYS: SOON_DAYS,
    statusKey: statusKey,
    isStatus: isStatus,
    textOf: textOf,
    zone: zone,
    dateValue: dateValue,
    dateInputOf: dateInputOf,
    categoryOf: categoryOf,
    categoryOptions: categoryOptions,
    dueState: dueState,
    dueKey: dueKey,
    daysLeft: daysLeft,
    viewRows: viewRows,
    labelOf: labelOf,
    cleanCategory: cleanCategory,
    materialValid: materialValid,
    openableUrl: openableUrl,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
