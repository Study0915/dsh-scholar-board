/*
 * 文献阅读卡的不碰 DOM 判定：阅读阶段、摘要、视图过滤、年份与材料地址。
 *
 * 挂在全局的 LiteratureRecords 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 * 摘要只取用户写的理解与问题：订阅条目自带的摘要不代表读懂（领域术语）。
 */
;(function (root) {
  'use strict'

  var KIND = 'literature'
  var STAGES = ['queued', 'reading', 'understood']
  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000

  /** 记录里的阶段：不认识的值按待读算。 */
  function stageOf(record) {
    if (record === null || typeof record !== 'object') return 'queued'
    return STAGES.indexOf(record.stage) >= 0 ? record.stage : 'queued'
  }

  /** 阶段对应的文案键。 */
  function stageKey(stage) {
    return stage === 'reading' ? 'stageReading' : stage === 'understood' ? 'stageUnderstood' : 'stageQueued'
  }

  /** 列表的一行摘要：理解优先，没有理解时用问题，压成一行。 */
  function snippetOf(record) {
    if (record === null || typeof record !== 'object') return ''
    var source = typeof record.understanding === 'string' && record.understanding !== '' ? record.understanding : record.questions
    if (typeof source !== 'string' || source === '') return ''
    return source.replace(/\s+/g, ' ').trim()
  }

  /** 作者、期刊与年份一行；都没有时是空串。 */
  function metaOf(record) {
    if (record === null || typeof record !== 'object') return ''
    var parts = []
    if (typeof record.authors === 'string' && record.authors !== '') parts.push(record.authors)
    if (typeof record.venue === 'string' && record.venue !== '') parts.push(record.venue)
    if (typeof record.year === 'number' && isFinite(record.year)) parts.push(String(record.year))
    return parts.join(' · ')
  }

  /** 回收站里还剩几天：不认识的 deletedAt 不给倒计时。 */
  function daysLeft(record, now) {
    if (record === null || typeof record !== 'object' || typeof record.deletedAt !== 'string') return null
    var stamp = Date.parse(record.deletedAt)
    if (isNaN(stamp)) return null
    return Math.max(0, Math.ceil((stamp + 30 * DAY - (typeof now === 'number' ? now : Date.now())) / DAY))
  }

  /** 一个视图里的行：先按回收与归档状态筛，再按阶段筛，按最近更新从新到旧。 */
  function viewRows(records, view, stage) {
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
      if (view === 'active' && typeof stage === 'string' && STAGES.indexOf(stage) >= 0 && stageOf(record) !== stage) continue
      rows.push(record)
    }
    rows.sort(function (left, right) {
      return String(right.updatedAt).localeCompare(String(left.updatedAt))
    })
    return rows
  }

  /** 材料地址只收 http/https 的完整地址，说明不能是空的。 */
  function materialValid(url, title) {
    if (typeof title !== 'string' || title.trim() === '') return false
    return openableUrl(url)
  }

  /** 来源地址只收 http/https 的完整地址；空串表示未填。 */
  function openableUrl(url) {
    if (typeof url !== 'string' || url === '') return false
    try {
      return /^https?:$/.test(new URL(url).protocol)
    } catch (error) {
      return false
    }
  }

  /** 年份输入读成整数；空串表示未填，越界或不是整数时是 null。 */
  function yearValue(text) {
    if (typeof text !== 'string' || text.trim() === '') return { ok: true, value: null }
    var value = Number(text)
    if (!isFinite(value) || Math.round(value) !== value || value < 1000 || value > 3000) return { ok: false, value: null }
    return { ok: true, value: value }
  }

  /** 文案里的 `{name}` 替换。 */
  function fill(text, values) {
    var out = text
    for (var name in values) {
      if (Object.prototype.hasOwnProperty.call(values, name)) out = out.split('{' + name + '}').join(String(values[name]))
    }
    return out
  }

  root.LiteratureRecords = {
    KIND: KIND,
    STAGES: STAGES,
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    stageOf: stageOf,
    stageKey: stageKey,
    snippetOf: snippetOf,
    metaOf: metaOf,
    daysLeft: daysLeft,
    viewRows: viewRows,
    materialValid: materialValid,
    openableUrl: openableUrl,
    yearValue: yearValue,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
