/*
 * 科研总览卡的不碰 DOM 判定：三组近期记录怎么挑、怎么排，期限怎么读。
 *
 * 挂在全局的 Overview 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 */
;(function (root) {
  'use strict'

  var DAY = 86400000
  var LOAD_TIMEOUT = 4000

  function dateText(record) {
    if (record === null || typeof record !== 'object') return ''
    var value = record.date
    if (value === null || value === undefined || typeof value !== 'object') return ''
    if (value.kind === 'date' && typeof value.date === 'string') return value.date
    if (value.kind === 'instant' && typeof value.at === 'string') return value.at.slice(0, 10)
    return ''
  }

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
      var today = ''
      try {
        today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(stamp))
      } catch (error) {
        today = ''
      }
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

  function alive(record) {
    return record !== null && typeof record === 'object' && typeof record.deletedAt !== 'string' && record.archived !== true
  }

  /** 三组各挑几条，`total` 给「还有 N 项」用。 */
  function section(rows, total, limit) {
    return { rows: rows.slice(0, limit), total: total, more: Math.max(0, total - limit) }
  }

  function byDueThenUpdated(left, right) {
    var a = dueKey(left)
    var b = dueKey(right)
    if (a !== null && b !== null && a !== b) return a < b ? -1 : 1
    if (a !== null && b === null) return -1
    if (a === null && b !== null) return 1
    return String(right.updatedAt).localeCompare(String(left.updatedAt))
  }

  /** 近期行动项：待办、进行中与受阻，按期限从早到晚，没期限的按更新排。 */
  function actionRows(records, now, limit) {
    var list = Array.isArray(records) ? records : []
    var rows = []
    for (var at = 0; at < list.length; at += 1) {
      var record = list[at]
      if (!alive(record) || record.kind !== 'action') continue
      if (record.status === 'done' || record.status === 'cancelled') continue
      rows.push(record)
    }
    rows.sort(byDueThenUpdated)
    return section(rows, rows.length, typeof limit === 'number' ? limit : 5)
  }

  /** 最近组会：按会议日期从新到旧，没有日期的按更新排。 */
  function meetingRows(records, limit) {
    var list = Array.isArray(records) ? records : []
    var rows = []
    for (var at = 0; at < list.length; at += 1) {
      var record = list[at]
      if (!alive(record) || record.kind !== 'meeting') continue
      rows.push(record)
    }
    rows.sort(function (left, right) {
      var a = dateText(left)
      var b = dateText(right)
      if (a !== b) return a < b ? 1 : -1
      return String(right.updatedAt).localeCompare(String(left.updatedAt))
    })
    return section(rows, rows.length, typeof limit === 'number' ? limit : 3)
  }

  /** 活跃稿件：未接收、未阶段归档，按期限从早到晚，没期限的按更新排。 */
  function manuscriptRows(records, now, limit) {
    var list = Array.isArray(records) ? records : []
    var rows = []
    for (var at = 0; at < list.length; at += 1) {
      var record = list[at]
      if (!alive(record) || record.kind !== 'manuscript') continue
      if (record.stage === 'accepted' || record.stage === 'archived') continue
      rows.push(record)
    }
    rows.sort(byDueThenUpdated)
    return section(rows, rows.length, typeof limit === 'number' ? limit : 4)
  }

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

  function fill(text, values) {
    var out = text
    for (var name in values) {
      if (Object.prototype.hasOwnProperty.call(values, name)) out = out.split('{' + name + '}').join(String(values[name]))
    }
    return out
  }

  root.Overview = {
    DAY: DAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    dateText: dateText,
    dueText: dueText,
    dueTone: dueTone,
    actionRows: actionRows,
    meetingRows: meetingRows,
    manuscriptRows: manuscriptRows,
    stageKey: stageKey,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
