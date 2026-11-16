/*
 * 成员卡片的判定：稳定 id、显示称呼、角色说明、启用状态与备注。
 *
 * 称号可以重复，列表按称呼排序，停用只是标记；分工里的引用按 id 指向成员，
 * 这里不判断任何认证身份或权限。
 */
;(function (root) {
  'use strict'

  var KIND = 'member'
  var DAY = 24 * 60 * 60 * 1000
  var TRASH_DAYS = 30
  var TITLE_LENGTH = 80
  var ROLE_LENGTH = 200
  var NOTE_LENGTH = 2000
  var LOAD_TIMEOUT = 8000

  function textOf(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

  /** 成员在界面上的称呼；称呼为空时退回 id，保证同一行仍有名字。 */
  function nameOf(record) {
    if (record === null || typeof record !== 'object') return ''
    var title = textOf(record.title)
    if (title !== '') return title
    return typeof record.id === 'string' ? record.id : ''
  }

  function roleOf(record) {
    return record !== null && typeof record === 'object' ? textOf(record.role) : ''
  }

  function noteOf(record) {
    return record !== null && typeof record === 'object' ? textOf(record.note) : ''
  }

  /** 没有启用字段的旧记录按启用处理。 */
  function enabledOf(record) {
    return record !== null && typeof record === 'object' && record.enabled === false ? false : true
  }

  function statusKey(enabled) {
    return enabled === false ? 'disabled' : 'enabled'
  }

  /**
   * 活跃、归档与回收站三个范围各自列出成员。
   *
   * 停用成员留在活跃范围里并带标记，方便继续查看与恢复；只有归档和回收站才移出。
   *
   * @param {Array} records - 宿主返回的成员记录。
   * @param {string} view - `active`、`archived` 或 `trash`。
   * @returns {Array} 排好序的成员。
   */
  function viewRows(records, view) {
    var list = Array.isArray(records) ? records : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var record = list[at]
      if (record === null || typeof record !== 'object' || record.kind !== KIND) continue
      var trashed = typeof record.deletedAt === 'string'
      var archived = record.archived === true
      if (view === 'trash') {
        if (!trashed) continue
      } else if (view === 'archived') {
        if (trashed || !archived) continue
      } else if (trashed || archived) {
        continue
      }
      out.push(record)
    }
    out.sort(function (left, right) {
      var byName = nameOf(left).localeCompare(nameOf(right), 'zh-Hans-CN')
      if (byName !== 0) return byName
      return String(left.id).localeCompare(String(right.id))
    })
    return out
  }

  /** 列表里用一句话介绍角色与备注；都没有时给出明确说法。 */
  function summaryOf(record) {
    var parts = []
    if (roleOf(record) !== '') parts.push(roleOf(record))
    if (noteOf(record) !== '') parts.push(noteOf(record))
    return parts.join(' · ')
  }

  /** 回收站里的记录还剩几天清除；不在回收站时是 null。 */
  function daysLeft(record, now) {
    if (record === null || typeof record !== 'object' || typeof record.deletedAt !== 'string') return null
    var deleted = Date.parse(record.deletedAt)
    if (!Number.isFinite(deleted)) return null
    var left = TRASH_DAYS - Math.floor(((now === undefined ? Date.now() : now) - deleted) / DAY)
    return Math.max(0, left)
  }

  function cleanTitle(value) {
    var title = textOf(value)
    if (title === '' || title.length > TITLE_LENGTH) return null
    return title
  }

  function cleanRole(value) {
    var role = textOf(value)
    if (role.length > ROLE_LENGTH) return null
    return role === '' ? null : role
  }

  function cleanNote(value) {
    var note = typeof value === 'string' ? value : ''
    if (note.length > NOTE_LENGTH) return null
    return note.trim() === '' ? null : note.trim()
  }

  function fill(text, values) {
    var out = text
    for (var name in values) {
      if (Object.prototype.hasOwnProperty.call(values, name)) out = out.split('{' + name + '}').join(String(values[name]))
    }
    return out
  }

  root.MemberRecords = {
    KIND: KIND,
    TITLE_LENGTH: TITLE_LENGTH,
    ROLE_LENGTH: ROLE_LENGTH,
    NOTE_LENGTH: NOTE_LENGTH,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    DAY: DAY,
    TRASH_DAYS: TRASH_DAYS,
    textOf: textOf,
    nameOf: nameOf,
    roleOf: roleOf,
    noteOf: noteOf,
    enabledOf: enabledOf,
    statusKey: statusKey,
    viewRows: viewRows,
    summaryOf: summaryOf,
    daysLeft: daysLeft,
    cleanTitle: cleanTitle,
    cleanRole: cleanRole,
    cleanNote: cleanNote,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
