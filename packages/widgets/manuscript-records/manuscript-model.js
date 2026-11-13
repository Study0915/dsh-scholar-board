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
  var FIGURE_KINDS = ['figure', 'table']
  var DECISIONS = ['pending', 'minor', 'major', 'accepted', 'rejected', 'withdrawn', 'transferred']
  var REVISION_STATUSES = ['todo', 'doing', 'done', 'declined']
  var MAX_FIGURES = 100
  var MAX_ROUNDS = 50
  var MAX_REVISIONS = 200
  var FIGURE_LABEL_LENGTH = 32
  var REVISION_TEXT = 2000

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

  /** 图表类型读成文案键。 */
  function figureKey(kind) {
    return kind === 'table' ? 'figureTable' : 'figureFigure'
  }

  /** 投稿决定读成文案键。 */
  function decisionKey(decision) {
    if (decision === 'minor') return 'decisionMinor'
    if (decision === 'major') return 'decisionMajor'
    if (decision === 'accepted') return 'decisionAccepted'
    if (decision === 'rejected') return 'decisionRejected'
    if (decision === 'withdrawn') return 'decisionWithdrawn'
    if (decision === 'transferred') return 'decisionTransferred'
    return 'decisionPending'
  }

  /** 修回状态读成文案键。 */
  function revisionKey(status) {
    if (status === 'doing') return 'revisionDoing'
    if (status === 'done') return 'revisionDone'
    if (status === 'declined') return 'revisionDeclined'
    return 'revisionTodo'
  }

  function isFigureKind(value) {
    return FIGURE_KINDS.indexOf(value) !== -1
  }

  function isDecision(value) {
    return DECISIONS.indexOf(value) !== -1
  }

  function isRevisionStatus(value) {
    return REVISION_STATUSES.indexOf(value) !== -1
  }

  /** 一段字：去掉首尾空白；空串是未填。 */
  function textOf(value) {
    if (typeof value !== 'string') return ''
    return value.trim()
  }

  /** 材料只留能打开的 http/https 地址与说明。 */
  function cleanMaterials(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var material = list[at]
      if (material === null || typeof material !== 'object') continue
      if (typeof material.id !== 'string' || material.id === '') continue
      if (!materialValid(material.url, material.title)) continue
      out.push({ id: material.id, url: String(material.url), title: String(material.title).trim() })
    }
    return out
  }

  /** 图表目录：编号、标题与可选的备注；不认识的条目跳过。 */
  function cleanFigures(rows) {
    var list = Array.isArray(rows) ? rows : []
    var seen = {}
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var figure = list[at]
      if (figure === null || typeof figure !== 'object') continue
      if (typeof figure.id !== 'string' || figure.id === '' || seen[figure.id] === true) continue
      if (!isFigureKind(figure.kind)) continue
      var label = textOf(figure.label)
      var title = textOf(figure.title)
      if (label === '' || label.length > FIGURE_LABEL_LENGTH || title === '' || title.length > 200) continue
      seen[figure.id] = true
      var entry = { id: figure.id, kind: figure.kind, label: label, title: title }
      var note = textOf(figure.note)
      if (note !== '') entry.note = note
      var materials = cleanMaterials(figure.materials)
      if (materials.length > 0) entry.materials = materials
      out.push(entry)
    }
    return out
  }

  /** 投稿轮次：刊会、决定与两个日期；不认识的条目跳过。 */
  function cleanRounds(rows) {
    var list = Array.isArray(rows) ? rows : []
    var seen = {}
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var round = list[at]
      if (round === null || typeof round !== 'object') continue
      if (typeof round.id !== 'string' || round.id === '' || seen[round.id] === true) continue
      var venue = textOf(round.venue)
      if (venue === '' || venue.length > 200 || !isDecision(round.decision)) continue
      seen[round.id] = true
      var entry = { id: round.id, venue: venue, decision: round.decision }
      if (round.submittedAt !== null && typeof round.submittedAt === 'object' && round.submittedAt.kind === 'date') entry.submittedAt = round.submittedAt
      if (round.decidedAt !== null && typeof round.decidedAt === 'object' && round.decidedAt.kind === 'date') entry.decidedAt = round.decidedAt
      var note = textOf(round.note)
      if (note !== '') entry.note = note
      out.push(entry)
    }
    return out
  }

  /** 修回事项：反馈、改动与证据；指向不存在的轮次时丢弃。 */
  function cleanRevisions(rows, rounds) {
    var list = Array.isArray(rows) ? rows : []
    var roundIds = {}
    for (var index = 0; index < (Array.isArray(rounds) ? rounds : []).length; index += 1) {
      if (rounds[index] !== null && typeof rounds[index] === 'object' && typeof rounds[index].id === 'string') roundIds[rounds[index].id] = true
    }
    var seen = {}
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var revision = list[at]
      if (revision === null || typeof revision !== 'object') continue
      if (typeof revision.id !== 'string' || revision.id === '' || seen[revision.id] === true) continue
      if (typeof revision.roundId !== 'string' || roundIds[revision.roundId] !== true) continue
      var feedback = textOf(revision.feedback)
      if (feedback === '' || feedback.length > REVISION_TEXT || !isRevisionStatus(revision.status)) continue
      seen[revision.id] = true
      var entry = { id: revision.id, roundId: revision.roundId, feedback: feedback, status: revision.status }
      var change = textOf(revision.change)
      if (change !== '' && change.length <= REVISION_TEXT) entry.change = change
      var materials = cleanMaterials(revision.materials)
      if (materials.length > 0) entry.materials = materials
      out.push(entry)
    }
    return out
  }

  /** 待处理（未完成、未拒绝）的修回条数。 */
  function openRevisionCount(record) {
    if (record === null || typeof record !== 'object' || !Array.isArray(record.revisions)) return 0
    var count = 0
    for (var at = 0; at < record.revisions.length; at += 1) {
      var status = record.revisions[at] !== null && typeof record.revisions[at] === 'object' ? record.revisions[at].status : null
      if (status === 'todo' || status === 'doing') count += 1
    }
    return count
  }

  /** 一轮投稿的一行字：刊会与决定。 */
  function roundLabel(round, text) {
    if (round === null || typeof round !== 'object') return ''
    var venue = typeof round.venue === 'string' ? round.venue : ''
    return text.t(decisionKey(round.decision)) + ' · ' + venue
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
    FIGURE_KINDS: FIGURE_KINDS,
    DECISIONS: DECISIONS,
    REVISION_STATUSES: REVISION_STATUSES,
    MAX_FIGURES: MAX_FIGURES,
    MAX_ROUNDS: MAX_ROUNDS,
    MAX_REVISIONS: MAX_REVISIONS,
    FIGURE_LABEL_LENGTH: FIGURE_LABEL_LENGTH,
    REVISION_TEXT: REVISION_TEXT,
    stageKey: stageKey,
    isStage: isStage,
    figureKey: figureKey,
    decisionKey: decisionKey,
    revisionKey: revisionKey,
    isFigureKind: isFigureKind,
    isDecision: isDecision,
    isRevisionStatus: isRevisionStatus,
    dateOf: dateOf,
    dueText: dueText,
    dueTone: dueTone,
    historyOf: historyOf,
    viewRows: viewRows,
    materialValid: materialValid,
    cleanMaterials: cleanMaterials,
    cleanFigures: cleanFigures,
    cleanRounds: cleanRounds,
    cleanRevisions: cleanRevisions,
    openRevisionCount: openRevisionCount,
    roundLabel: roundLabel,
    dateValue: dateValue,
    zone: zone,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
