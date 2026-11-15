/*
 * 文献阅读卡的不碰 DOM 判定：阅读阶段、标识、阅读条目、摘要、视图过滤、年份与材料地址。
 *
 * 挂在全局的 LiteratureRecords 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 * 摘要只取用户写的理解与问题：订阅条目自带的摘要不代表读懂（领域术语）。
 * 阅读条目记录实际读到的位置，阶段由用户自己改；读了两节不等于全文已读。
 */
;(function (root) {
  'use strict'

  var KIND = 'literature'
  var STAGES = ['queued', 'reading', 'understood']
  var FORMATS = ['preprint', 'published', 'other']
  var READING_FIELDS = ['location', 'note', 'understanding', 'questions', 'reproduce']
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

  /** 标识与正式稿件类型：不认识的值按未填算。 */
  function formatOf(record) {
    if (record === null || typeof record !== 'object') return ''
    return FORMATS.indexOf(record.format) >= 0 ? record.format : ''
  }

  /** 正式稿件类型的文案键。 */
  function formatKey(format) {
    return format === 'preprint' ? 'formatPreprint' : format === 'published' ? 'formatPublished' : 'formatOther'
  }

  /** 一段非空文字；不是文字或空白时是空串。 */
  function fieldText(record, field) {
    if (record === null || typeof record !== 'object') return ''
    var value = record[field]
    return typeof value === 'string' ? value.trim() : ''
  }

  /** 一行的标识：先写 DOI，没有 DOI 时写 arXiv id 与版本，都没有时是空串。 */
  function identifierLine(record) {
    var doi = fieldText(record, 'doi')
    if (doi !== '') return 'DOI ' + doi
    var arxivId = fieldText(record, 'arxivId')
    if (arxivId === '') return ''
    return 'arXiv ' + arxivId + fieldText(record, 'arxivVersion')
  }

  /** 阅读条目的日期按 `YYYY-MM-DD` 显示；读不出来的日期不显示。 */
  function dateText(due) {
    if (due === null || typeof due !== 'object') return ''
    if (due.kind === 'date' && typeof due.date === 'string') return due.date
    if (due.kind === 'instant' && typeof due.at === 'string' && due.at.length >= 10) return due.at.slice(0, 10)
    return ''
  }

  /** 浏览器当前的 IANA 时区；读不出来时用 UTC。 */
  function zoneOf() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch (error) {
      return 'UTC'
    }
  }

  /** 日期输入与阅读条目里的 `{ kind: 'date' }` 互转。 */
  function dateValue(text, timeZone) {
    return typeof text === 'string' && text !== ''
      ? { kind: 'date', date: text, timeZone: typeof timeZone === 'string' && timeZone !== '' ? timeZone : 'UTC' }
      : null
  }

  /** 今天的本地日期，写成 `YYYY-MM-DD`。 */
  function todayText(now) {
    var date = new Date(typeof now === 'number' ? now : Date.now())
    var month = String(date.getMonth() + 1)
    var day = String(date.getDate())
    return String(date.getFullYear()) + '-' + (month.length < 2 ? '0' + month : month) + '-' + (day.length < 2 ? '0' + day : day)
  }

  /** 阅读条目按稳定 id 与文字整理；缺 id 的条目丢掉。 */
  function readingOf(record) {
    if (record === null || typeof record !== 'object' || !Array.isArray(record.reading)) return []
    var out = []
    for (var at = 0; at < record.reading.length; at += 1) {
      var entry = record.reading[at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.id !== 'string' || entry.id === '') continue
      var copy = { id: entry.id, date: dateText(entry.at) }
      for (var fieldAt = 0; fieldAt < READING_FIELDS.length; fieldAt += 1) {
        var field = READING_FIELDS[fieldAt]
        copy[field] = typeof entry[field] === 'string' ? entry[field] : ''
      }
      if (typeof entry.actionId === 'string' && entry.actionId !== '') copy.actionId = entry.actionId
      out.push(copy)
    }
    return out
  }

  /** 一条阅读条目的摘要：位置优先，其次笔记与理解。 */
  function readingTitle(entry) {
    if (entry === null || typeof entry !== 'object') return ''
    for (var at = 0; at < READING_FIELDS.length; at += 1) {
      var value = typeof entry[READING_FIELDS[at]] === 'string' ? entry[READING_FIELDS[at]].trim() : ''
      if (value !== '') return value.replace(/\s+/g, ' ')
    }
    return ''
  }

  /** 阅读条目的摘要与日期的地址行；都没有时是空串。 */
  function readingLine(entry) {
    var title = readingTitle(entry)
    var date = typeof entry.date === 'string' ? entry.date : ''
    if (title === '') return date
    return date === '' ? title : date + ' · ' + title
  }

  /**
   * 编辑中的阅读条目变成记录字段：空文字去掉，全部为空时是 `null`。
   *
   * @param {unknown} entries - 编辑面板里的条目。
   * @param {string} timeZone - 日期用的 IANA 时区。
   * @returns {Array<object> | null} 记录里的 `reading`。
   */
  function readingValue(entries, timeZone) {
    if (!Array.isArray(entries)) return null
    var out = []
    for (var at = 0; at < entries.length; at += 1) {
      var entry = entries[at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.id !== 'string' || entry.id === '') continue
      var copy = { id: entry.id }
      for (var fieldAt = 0; fieldAt < READING_FIELDS.length; fieldAt += 1) {
        var field = READING_FIELDS[fieldAt]
        var value = typeof entry[field] === 'string' ? entry[field].trim() : ''
        if (value !== '') copy[field] = value
      }
      var due = dateValue(typeof entry.date === 'string' ? entry.date : '', timeZone)
      if (due !== null) copy.at = due
      if (typeof entry.actionId === 'string' && entry.actionId !== '') copy.actionId = entry.actionId
      out.push(copy)
    }
    return out.length === 0 ? null : out
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
    FORMATS: FORMATS,
    READING_FIELDS: READING_FIELDS,
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    stageOf: stageOf,
    stageKey: stageKey,
    formatOf: formatOf,
    formatKey: formatKey,
    identifierLine: identifierLine,
    dateText: dateText,
    dateValue: dateValue,
    todayText: todayText,
    zoneOf: zoneOf,
    readingOf: readingOf,
    readingTitle: readingTitle,
    readingLine: readingLine,
    readingValue: readingValue,
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
