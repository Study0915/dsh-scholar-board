/*
 * 课题卡的不碰 DOM 判定：问题条目、状态、摘要、视图过滤、材料地址与行动项来源。
 *
 * 挂在全局的 TopicRecords 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 * 问题是否解决由用户填写，行动项完成与否单独记录，这里不把两者互相推断。
 */
;(function (root) {
  'use strict'

  var KIND = 'topic'
  var STATUSES = ['open', 'investigating', 'resolved']
  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000
  var MAX_QUESTIONS = 100
  var QUESTION_TEXT = 2000

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

  /** 只认三种问题状态；不认识的值按待解算。 */
  function statusOf(question) {
    if (question === null || typeof question !== 'object') return 'open'
    return STATUSES.indexOf(question.status) >= 0 ? question.status : 'open'
  }

  /** 状态对应的文案键。 */
  function statusKey(status) {
    return status === 'investigating' ? 'questionInvestigating' : status === 'resolved' ? 'questionResolved' : 'questionOpen'
  }

  /** 问题条目里真正有 id 与内容的那些；空行不显示。 */
  function questionsOf(record) {
    if (record === null || typeof record !== 'object' || !Array.isArray(record.questions)) return []
    var out = []
    for (var at = 0; at < record.questions.length; at += 1) {
      var question = record.questions[at]
      if (question === null || typeof question !== 'object') continue
      if (typeof question.id !== 'string' || question.id === '') continue
      if (typeof question.text !== 'string' || question.text.trim() === '') continue
      out.push(question)
    }
    return out
  }

  /** 待解、调查中与已解决的数量；列表行用这一行字。 */
  function questionCounts(record) {
    var questions = questionsOf(record)
    var counts = { open: 0, investigating: 0, resolved: 0, total: questions.length }
    for (var at = 0; at < questions.length; at += 1) counts[statusOf(questions[at])] += 1
    return counts
  }

  /** 一行摘要：当前判断优先，其次下一步，最后研究问题；都没有时说明未知。 */
  function summaryOf(record, unknown) {
    var value = textOf(record, 'judgment')
    if (value === '') value = textOf(record, 'nextStep')
    if (value === '') value = textOf(record, 'question')
    return value === '' ? String(unknown) : value
  }

  /** 一组前向引用：related 加上问题里的行动项；按种类与 id 去重。 */
  function referencesOf(record) {
    var refs = []
    if (record !== null && typeof record === 'object' && Array.isArray(record.related)) {
      for (var at = 0; at < record.related.length; at += 1) {
        var ref = record.related[at]
        if (ref !== null && typeof ref === 'object' && typeof ref.kind === 'string' && typeof ref.id === 'string') refs.push(ref)
      }
    }
    var questions = questionsOf(record)
    for (var questionAt = 0; questionAt < questions.length; questionAt += 1) {
      var question = questions[questionAt]
      if (typeof question.actionId === 'string' && question.actionId !== '') refs.push({ kind: 'action', id: question.actionId })
    }
    var seen = {}
    var out = []
    for (var index = 0; index < refs.length; index += 1) {
      var key = refs[index].kind + ':' + refs[index].id
      if (seen[key] === true) continue
      seen[key] = true
      out.push(refs[index])
    }
    return out
  }

  /** 回收站里还剩几天：不认识的 deletedAt 不给倒计时。 */
  function daysLeft(record, now) {
    if (record === null || typeof record !== 'object' || typeof record.deletedAt !== 'string') return null
    var stamp = Date.parse(record.deletedAt)
    if (isNaN(stamp)) return null
    return Math.max(0, Math.ceil((stamp + 30 * DAY - (typeof now === 'number' ? now : Date.now())) / DAY))
  }

  /** 一个视图里的行：先按回收与归档状态筛，按最近更新从新到旧。 */
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
   * 把编辑面板里的问题行整理成可保存的样子。
   *
   * 整行都空的行丢掉；文字超长或状态不认识时返回 null，由界面提示。
   *
   * @param {Array} rows - `{ id, text, status, actionId? }` 行。
   * @returns {Array|null} 归一后的条目；有不合格行时是 null。
   */
  function cleanQuestions(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    var seen = {}
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') continue
      var text = typeof row.text === 'string' ? row.text.trim() : ''
      if (text === '') continue
      if ([...text].length > QUESTION_TEXT) return null
      var id = typeof row.id === 'string' && row.id !== '' ? row.id : ''
      if (id === '' || seen[id] === true) return null
      seen[id] = true
      var status = STATUSES.indexOf(row.status) >= 0 ? row.status : 'open'
      var entry = { id: id, text: text, status: status }
      if (typeof row.actionId === 'string' && row.actionId !== '') entry.actionId = row.actionId
      out.push(entry)
      if (out.length > MAX_QUESTIONS) return null
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

  root.TopicRecords = {
    KIND: KIND,
    STATUSES: STATUSES,
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    MAX_QUESTIONS: MAX_QUESTIONS,
    QUESTION_TEXT: QUESTION_TEXT,
    textOf: textOf,
    shownText: shownText,
    statusOf: statusOf,
    statusKey: statusKey,
    questionsOf: questionsOf,
    questionCounts: questionCounts,
    summaryOf: summaryOf,
    referencesOf: referencesOf,
    daysLeft: daysLeft,
    viewRows: viewRows,
    cleanQuestions: cleanQuestions,
    materialValid: materialValid,
    openableUrl: openableUrl,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
