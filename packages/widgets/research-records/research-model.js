/*
 * 研究记录卡的不碰 DOM 判定：做法、参数与指标、缺失内容的说法、视图过滤与材料地址。
 *
 * 挂在全局的 ResearchRecords 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 * 这一份不执行任何实验程序：参数、环境、种子、指标与结论都只是记录下来的文字。
 */
;(function (root) {
  'use strict'

  var KIND = 'research'
  var METHODS = ['derivation', 'simulation', 'experiment']
  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000
  var MAX_ENTRIES = 64
  var UNIT_LENGTH = 32

  /** 记录里的做法：不认识的值按仿真算。 */
  function methodOf(record) {
    if (record === null || typeof record !== 'object') return 'simulation'
    return METHODS.indexOf(record.method) >= 0 ? record.method : 'simulation'
  }

  /** 做法对应的文案键。 */
  function methodKey(method) {
    return method === 'derivation' ? 'methodDerivation' : method === 'experiment' ? 'methodExperiment' : 'methodSimulation'
  }

  /** 一段非空文字；空白或不是文字时是空串。 */
  function textOf(record, field) {
    if (record === null || typeof record !== 'object') return ''
    var value = record[field]
    if (typeof value !== 'string') return ''
    return value.trim()
  }

  /** 缺了内容时给出的说法：默认「未知」，不猜也不留白。 */
  function shownText(record, field, unknown) {
    var value = textOf(record, field)
    return value === '' ? String(unknown) : value
  }

  /** 一行摘要：结论优先，没有结论时用研究问题，都没有时说明未知。 */
  function summaryOf(record, unknown) {
    var value = textOf(record, 'conclusion')
    if (value === '') value = textOf(record, 'question')
    return value === '' ? String(unknown) : value
  }

  /** 环境（或别的单行字段）的一行提示；缺失时显式说明未知。 */
  function labelledOf(record, field, label, unknown) {
    return String(label) + '：' + shownText(record, field, unknown)
  }

  /** 一组参数或指标里真正有名称与数值的条目。 */
  function entriesOf(record, field) {
    if (record === null || typeof record !== 'object' || !Array.isArray(record[field])) return []
    var out = []
    for (var at = 0; at < record[field].length; at += 1) {
      var entry = record[field][at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.name !== 'string' || entry.name.trim() === '') continue
      if (typeof entry.value !== 'string' || entry.value.trim() === '') continue
      out.push(entry)
    }
    return out
  }

  /** 一行参数或指标：名称、数值与单位；没有单位就不补。 */
  function entryLine(entry) {
    if (entry === null || typeof entry !== 'object') return ''
    var line = String(entry.name).trim() + ' ' + String(entry.value).trim()
    if (typeof entry.unit === 'string' && entry.unit.trim() !== '') line += ' ' + entry.unit.trim()
    return line
  }

  /** 一组参数或指标的一行摘要；一条都没有时说明未知。 */
  function entriesLine(record, field, unknown) {
    var entries = entriesOf(record, field)
    if (entries.length === 0) return String(unknown)
    var parts = []
    for (var at = 0; at < entries.length && at < 3; at += 1) parts.push(entryLine(entries[at]))
    return parts.join(' · ')
  }

  /** 回收站里还剩几天：不认识的 deletedAt 不给倒计时。 */
  function daysLeft(record, now) {
    if (record === null || typeof record !== 'object' || typeof record.deletedAt !== 'string') return null
    var stamp = Date.parse(record.deletedAt)
    if (isNaN(stamp)) return null
    return Math.max(0, Math.ceil((stamp + 30 * DAY - (typeof now === 'number' ? now : Date.now())) / DAY))
  }

  /** 一个视图里的行：先按回收与归档状态筛，再按做法筛，按最近更新从新到旧。 */
  function viewRows(records, view, method) {
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
      if (view === 'active' && typeof method === 'string' && METHODS.indexOf(method) >= 0 && methodOf(record) !== method) continue
      rows.push(record)
    }
    rows.sort(function (left, right) {
      return String(right.updatedAt).localeCompare(String(left.updatedAt))
    })
    return rows
  }

  /**
   * 把编辑面板里的参数或指标行整理成可保存的样子。
   *
   * 整行都空的行丢掉；只填了一半（缺名称或缺数值）时返回 null，由界面提示。
   *
   * @param {Array} rows - `{ name, value, unit }` 行。
   * @returns {Array|null} 归一后的条目；有半填行时是 null。
   */
  function cleanEntries(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') continue
      var name = typeof row.name === 'string' ? row.name.trim() : ''
      var value = typeof row.value === 'string' ? row.value.trim() : ''
      var unit = typeof row.unit === 'string' ? row.unit.trim() : ''
      if (name === '' && value === '' && unit === '') continue
      if (name === '' || value === '') return null
      if (unit.length > UNIT_LENGTH) return null
      out.push(unit === '' ? { name: name, value: value } : { name: name, value: value, unit: unit })
      if (out.length > MAX_ENTRIES) return null
    }
    return out
  }

  /** 材料地址只收 http/https 的完整地址，说明不能是空的。 */
  function materialValid(url, title) {
    if (typeof title !== 'string' || title.trim() === '') return false
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

  root.ResearchRecords = {
    KIND: KIND,
    METHODS: METHODS,
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    MAX_ENTRIES: MAX_ENTRIES,
    UNIT_LENGTH: UNIT_LENGTH,
    methodOf: methodOf,
    methodKey: methodKey,
    textOf: textOf,
    shownText: shownText,
    summaryOf: summaryOf,
    labelledOf: labelledOf,
    entriesOf: entriesOf,
    entryLine: entryLine,
    entriesLine: entriesLine,
    daysLeft: daysLeft,
    viewRows: viewRows,
    cleanEntries: cleanEntries,
    materialValid: materialValid,
    openableUrl: openableUrl,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
