/*
 * 组会记录卡的不碰 DOM 判定：日期、摘要、回收倒计时、视图过滤与材料地址。
 *
 * 挂在全局的 MeetingRecords 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 */
;(function (root) {
  'use strict'

  var KIND = 'meeting'
  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000

  /** 记录里的日期读成 `YYYY-MM-DD`；未知与读不出来的都是空串。 */
  function dateText(record) {
    if (record === null || typeof record !== 'object') return ''
    var value = record.date
    if (value === null || value === undefined || typeof value !== 'object') return ''
    if (value.kind === 'date' && typeof value.date === 'string') return value.date
    if (value.kind === 'instant' && typeof value.at === 'string') return value.at.slice(0, 10)
    return ''
  }

  /** 列表的一行摘要：反馈优先，没有反馈时用汇报要点，压成一行。 */
  function snippetOf(record) {
    if (record === null || typeof record !== 'object') return ''
    var source = typeof record.feedback === 'string' && record.feedback !== '' ? record.feedback : record.topics
    if (typeof source !== 'string' || source === '') return ''
    return source.replace(/\s+/g, ' ').trim()
  }

  /** 回收站里还剩几天：不认识的 deletedAt 不给倒计时。 */
  function daysLeft(record, now) {
    if (record === null || typeof record !== 'object' || typeof record.deletedAt !== 'string') return null
    var stamp = Date.parse(record.deletedAt)
    if (isNaN(stamp)) return null
    return Math.max(0, Math.ceil((stamp + 30 * DAY - (typeof now === 'number' ? now : Date.now())) / DAY))
  }

  /** 一个视图里的行：先按回收与归档状态筛，再按日期从新到旧，没日期的排在后面。 */
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
      var a = dateText(left)
      var b = dateText(right)
      if (a !== b) return a < b ? 1 : -1
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

  /** 日期输入与记录里的 `{ kind: 'date' }` 互转；时区取浏览器当前的 IANA 名。 */
  function zone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch (error) {
      return 'UTC'
    }
  }

  function dateValue(text, timeZone) {
    return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? { kind: 'date', date: text, timeZone: typeof timeZone === 'string' && timeZone !== '' ? timeZone : 'UTC' }
      : null
  }

  /** 文案里的 `{name}` 替换。 */
  function fill(text, values) {
    var out = text
    for (var name in values) {
      if (Object.prototype.hasOwnProperty.call(values, name)) out = out.split('{' + name + '}').join(String(values[name]))
    }
    return out
  }

  /**
   * 一份可复制的 Markdown 提纲：只写有内容的段落，行动项按状态勾选。
   *
   * @param {object} form - 题、日期、要点、反馈、未决问题与材料。
   * @param {object[]} actions - 从这场组会生成的行动项。
   * @param {object} headings - 各段标题。
   * @returns {string} Markdown。
   */
  function outlineOf(form, actions, headings) {
    var lines = ['# ' + (typeof form.title === 'string' && form.title.trim() !== '' ? form.title.trim() : headings.untitled)]
    if (typeof form.date === 'string' && form.date !== '') lines.push('', '- ' + headings.date + '：' + form.date)
    var sections = [
      { title: headings.topics, text: form.topics },
      { title: headings.feedback, text: form.feedback },
      { title: headings.questions, text: form.questions },
    ]
    for (var at = 0; at < sections.length; at += 1) {
      if (typeof sections[at].text !== 'string' || sections[at].text.trim() === '') continue
      lines.push('', '## ' + sections[at].title, '', sections[at].text.trim())
    }
    var materials = Array.isArray(form.materials) ? form.materials : []
    if (materials.length > 0) {
      lines.push('', '## ' + headings.materials)
      for (var index = 0; index < materials.length; index += 1) {
        var material = materials[index]
        if (material === null || typeof material !== 'object') continue
        lines.push('- [' + String(material.title || material.url) + '](' + String(material.url) + ')')
      }
    }
    var list = Array.isArray(actions) ? actions : []
    if (list.length > 0) {
      lines.push('', '## ' + headings.actions)
      for (var actionAt = 0; actionAt < list.length; actionAt += 1) {
        var action = list[actionAt]
        if (action === null || typeof action !== 'object') continue
        var mark = action.status === 'done' ? '[x]' : action.status === 'cancelled' ? '[-]' : '[ ]'
        lines.push('- ' + mark + ' ' + String(action.title))
      }
    }
    return lines.join('\n') + '\n'
  }

  root.MeetingRecords = {
    KIND: KIND,
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    dateText: dateText,
    snippetOf: snippetOf,
    daysLeft: daysLeft,
    viewRows: viewRows,
    materialValid: materialValid,
    dateValue: dateValue,
    zone: zone,
    fill: fill,
    outlineOf: outlineOf
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
