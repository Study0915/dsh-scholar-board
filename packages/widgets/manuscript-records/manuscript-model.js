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
  var MAX_FIGURE_RUNS = 20
  var FIGURE_LABEL_LENGTH = 32
  var REVISION_TEXT = 2000
  var PLOT_REPOSITORY = 2048
  var PLOT_COMMIT = 200
  var FIGURE_CONCLUSION = 2000
  var MAX_CHECKLIST = 40
  var CHECK_LABEL_LENGTH = 200
  var CHECK_VERSION_LENGTH = 80
  var REVIEWER_LENGTH = 80
  var COMMENT_NO_LENGTH = 40
  var LOCATION_LENGTH = 200
  var CHECK_STATUSES = ['missing', 'ready']

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

  /** 图表对应的运行引用；没有时是空数组。 */
  function figureRunsOf(figure) {
    return figure !== null && typeof figure === 'object' && Array.isArray(figure.runs) ? figure.runs : []
  }

  /** 图表里可以引用的运行：类型必须是 run，同一运行只留一次。 */
  function cleanFigureRuns(rows) {
    var list = Array.isArray(rows) ? rows : []
    var seen = {}
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var ref = list[at]
      if (ref === null || typeof ref !== 'object' || ref.kind !== 'run') continue
      if (typeof ref.id !== 'string' || ref.id === '' || ref.id.length > 64 || seen[ref.id] === true) continue
      if (out.length >= MAX_FIGURE_RUNS) break
      seen[ref.id] = true
      out.push({ kind: 'run', id: ref.id })
    }
    return out
  }

  /** 绘图代码：仓库与提交各自可选，都空时不写。 */
  function cleanPlot(plot) {
    if (plot === null || typeof plot !== 'object') return null
    var repository = textOf(plot.repository)
    var commit = textOf(plot.commit)
    var out = {}
    if (repository !== '' && repository.length <= PLOT_REPOSITORY) out.repository = repository
    if (commit !== '' && commit.length <= PLOT_COMMIT) out.commit = commit
    return out.repository === undefined && out.commit === undefined ? null : out
  }

  /** 图表目录：编号、标题与可选的备注、运行、材料、绘图代码与结论；不认识的条目跳过。 */
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
      var runs = cleanFigureRuns(figure.runs)
      if (runs.length > 0) entry.runs = runs
      var materials = cleanMaterials(figure.materials)
      if (materials.length > 0) entry.materials = materials
      var plot = cleanPlot(figure.plot)
      if (plot !== null) entry.plot = plot
      var conclusion = textOf(figure.conclusion)
      if (conclusion !== '' && conclusion.length <= FIGURE_CONCLUSION) entry.conclusion = conclusion
      out.push(entry)
    }
    return out
  }

  /** 投稿检查表：名称、已备或待备与可选的版本说明；不认识的条目跳过。 */
  function cleanChecklist(rows) {
    var list = Array.isArray(rows) ? rows : []
    var seen = {}
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var item = list[at]
      if (item === null || typeof item !== 'object') continue
      if (typeof item.id !== 'string' || item.id === '' || seen[item.id] === true) continue
      var label = textOf(item.label)
      if (label === '' || label.length > CHECK_LABEL_LENGTH) continue
      if (CHECK_STATUSES.indexOf(item.status) === -1) continue
      if (out.length >= MAX_CHECKLIST) break
      seen[item.id] = true
      var entry = { id: item.id, label: label, status: item.status }
      var version = textOf(item.version)
      if (version !== '' && version.length <= CHECK_VERSION_LENGTH) entry.version = version
      out.push(entry)
    }
    return out
  }

  /** 投稿轮次：刊会、决定与日期；检查表与冻结日期可选，不认识的条目跳过。 */
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
      if (round.deadline !== null && typeof round.deadline === 'object' && round.deadline.kind === 'date') entry.deadline = round.deadline
      var checklist = cleanChecklist(round.checklist)
      if (checklist.length > 0) entry.checklist = checklist
      if (round.frozenAt !== null && typeof round.frozenAt === 'object' && round.frozenAt.kind === 'date') entry.frozenAt = round.frozenAt
      var note = textOf(round.note)
      if (note !== '') entry.note = note
      out.push(entry)
    }
    return out
  }

  /** 修回事项：反馈、改动与证据；指向不存在的轮次时丢弃，标为不改时必须写理由。 */
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
      var reviewer = textOf(revision.reviewer)
      if (reviewer !== '' && reviewer.length <= REVIEWER_LENGTH) entry.reviewer = reviewer
      var commentNo = textOf(revision.commentNo)
      if (commentNo !== '' && commentNo.length <= COMMENT_NO_LENGTH) entry.commentNo = commentNo
      var change = textOf(revision.change)
      if (change !== '' && change.length <= REVISION_TEXT) entry.change = change
      var location = textOf(revision.location)
      if (location !== '' && location.length <= LOCATION_LENGTH) entry.location = location
      var reply = textOf(revision.reply)
      if (reply !== '' && reply.length <= REVISION_TEXT) entry.reply = reply
      var reason = textOf(revision.reason)
      if (reason !== '' && reason.length <= REVISION_TEXT) entry.reason = reason
      if (revision.status === 'declined' && entry.reason === undefined) continue
      var actionId = textOf(revision.actionId)
      if (actionId !== '' && actionId.length <= 64) entry.actionId = actionId
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

  /** 一个日期或时刻读成 `YYYY-MM-DD`；读不出来时是空串。 */
  function dueDateOf(due) {
    if (due === null || typeof due !== 'object') return ''
    if (due.kind === 'date' && typeof due.date === 'string') return due.date
    if (due.kind === 'instant' && typeof due.at === 'string') return dateOf(due.at)
    return ''
  }

  /** 检查项状态读成文案键。 */
  function checkStatusKey(status) {
    return status === 'ready' ? 'checkReady' : 'checkMissing'
  }

  /**
   * 选中的一轮投稿写成 Markdown：刊会、决定、日期、检查表与这一轮的修回事项。
   *
   * 没备齐的检查项与没填的回复都照实写出来，复制出去就是一份可直接核对的清单。
   *
   * @param {object} record - 一条稿件。
   * @param {string} roundId - 选中的投稿轮次。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {string} Markdown 文本；轮次不存在时是空串。
   */
  function roundMarkdown(record, roundId, text) {
    if (record === null || typeof record !== 'object') return ''
    var rounds = Array.isArray(record.submissions) ? record.submissions : []
    var round = null
    for (var at = 0; at < rounds.length; at += 1) {
      if (rounds[at] !== null && typeof rounds[at] === 'object' && rounds[at].id === roundId) round = rounds[at]
    }
    if (round === null) return ''
    var lines = ['# ' + text.t('mdRound') + ' · ' + String(record.title), '']
    lines.push('- ' + text.t('venue') + '：' + String(round.venue))
    lines.push('- ' + text.t('decision') + '：' + text.t(decisionKey(round.decision)))
    var submitted = dueDateOf(round.submittedAt)
    if (submitted !== '') lines.push('- ' + text.t('submittedAt') + '：' + submitted)
    var decided = dueDateOf(round.decidedAt)
    if (decided !== '') lines.push('- ' + text.t('decidedAt') + '：' + decided)
    var deadline = dueDateOf(round.deadline)
    if (deadline !== '') lines.push('- ' + text.t('roundDeadline') + '：' + deadline)
    var frozen = dueDateOf(round.frozenAt)
    if (frozen !== '') lines.push('- ' + text.t('roundFrozenAt') + '：' + frozen)
    var note = textOf(round.note)
    if (note !== '') lines.push('- ' + text.t('roundNote') + '：' + note)
    var checklist = Array.isArray(round.checklist) ? round.checklist : []
    lines.push('', '## ' + text.t('mdChecklist'))
    if (checklist.length === 0) lines.push(text.t('checklistEmpty'))
    var missing = 0
    for (var check = 0; check < checklist.length; check += 1) {
      var item = checklist[check]
      if (item === null || typeof item !== 'object') continue
      var label = textOf(item.label)
      if (label === '') continue
      if (item.status === 'missing') missing += 1
      var version = textOf(item.version)
      lines.push('- ' + (item.status === 'ready' ? '[x] ' : '[ ] ') + label + (version !== '' ? '（' + version + '）' : ''))
    }
    if (missing > 0) lines.push('- ' + text.t('mdMissing') + '：' + String(missing))
    var revisions = []
    if (Array.isArray(record.revisions)) {
      for (var rev = 0; rev < record.revisions.length; rev += 1) {
        var revision = record.revisions[rev]
        if (revision !== null && typeof revision === 'object' && revision.roundId === roundId) revisions.push(revision)
      }
    }
    lines.push('', '## ' + text.t('mdRevisions'))
    if (revisions.length === 0) lines.push(text.t('mdNone'))
    for (var index = 0; index < revisions.length; index += 1) {
      var entry = revisions[index]
      var reviewer = textOf(entry.reviewer)
      var commentNo = textOf(entry.commentNo)
      var head = '### ' + String(index + 1) + '.'
      if (reviewer !== '') head += ' ' + reviewer
      if (commentNo !== '') head += ' · ' + text.t('revisionCommentNo') + ' ' + commentNo
      if (reviewer === '' && commentNo === '') head += ' ' + text.t('revisionFeedback')
      lines.push('', head)
      lines.push('- ' + text.t('revisionStatus') + '：' + text.t(revisionKey(entry.status)))
      lines.push('- ' + text.t('mdFeedback') + '：' + textOf(entry.feedback))
      var location = textOf(entry.location)
      if (location !== '') lines.push('- ' + text.t('mdLocation') + '：' + location)
      var change = textOf(entry.change)
      if (change !== '') lines.push('- ' + text.t('mdChange') + '：' + change)
      var reply = textOf(entry.reply)
      if (reply !== '') lines.push('- ' + text.t('mdReply') + '：' + reply)
      var reason = textOf(entry.reason)
      if (reason !== '') lines.push('- ' + text.t('mdReason') + '：' + reason)
      if (typeof entry.actionId === 'string' && entry.actionId !== '') lines.push('- ' + text.t('mdAction') + '：' + entry.actionId)
      var materials = Array.isArray(entry.materials) ? entry.materials : []
      for (var mat = 0; mat < materials.length; mat += 1) {
        var material = materials[mat]
        if (material === null || typeof material !== 'object') continue
        lines.push('- ' + text.t('mdEvidence') + '：' + String(material.title) + ' — ' + String(material.url))
      }
    }
    return lines.join('\n') + '\n'
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

  /** 某个时区里的今天，`YYYY-MM-DD`；冻结轮次时用它记日期。 */
  function todayIn(timeZone, stamp) {
    var at = typeof stamp === 'number' && isFinite(stamp) ? new Date(stamp) : new Date()
    var name = typeof timeZone === 'string' && timeZone !== '' ? timeZone : 'UTC'
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: name, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
    } catch (error) {
      return new Date(at.getTime()).toISOString().slice(0, 10)
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
    MAX_FIGURE_RUNS: MAX_FIGURE_RUNS,
    FIGURE_LABEL_LENGTH: FIGURE_LABEL_LENGTH,
    REVISION_TEXT: REVISION_TEXT,
    PLOT_REPOSITORY: PLOT_REPOSITORY,
    PLOT_COMMIT: PLOT_COMMIT,
    FIGURE_CONCLUSION: FIGURE_CONCLUSION,
    MAX_CHECKLIST: MAX_CHECKLIST,
    CHECK_LABEL_LENGTH: CHECK_LABEL_LENGTH,
    CHECK_VERSION_LENGTH: CHECK_VERSION_LENGTH,
    REVIEWER_LENGTH: REVIEWER_LENGTH,
    COMMENT_NO_LENGTH: COMMENT_NO_LENGTH,
    LOCATION_LENGTH: LOCATION_LENGTH,
    CHECK_STATUSES: CHECK_STATUSES,
    stageKey: stageKey,
    isStage: isStage,
    figureKey: figureKey,
    decisionKey: decisionKey,
    revisionKey: revisionKey,
    checkStatusKey: checkStatusKey,
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
    figureRunsOf: figureRunsOf,
    cleanFigureRuns: cleanFigureRuns,
    cleanPlot: cleanPlot,
    cleanFigures: cleanFigures,
    cleanChecklist: cleanChecklist,
    cleanRounds: cleanRounds,
    cleanRevisions: cleanRevisions,
    openRevisionCount: openRevisionCount,
    roundLabel: roundLabel,
    dueDateOf: dueDateOf,
    roundMarkdown: roundMarkdown,
    dateValue: dateValue,
    zone: zone,
    todayIn: todayIn,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
