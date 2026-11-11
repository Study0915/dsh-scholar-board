/*
 * 科研总览卡的主脚本：从共享记录的数据源取活跃记录，分成近期行动项、最近组会与活跃稿件。
 *
 * 行动项可以就地完成，来源会议在卡片里只读展开；快速记录只新建一条行动项。任一记录变化时宿主重推，
 * 三节跟着换；数据源没有初值时等第一份推送，超时或读取失败给出重试。
 */
;(function (root) {
  'use strict'

  var copy = root.OverviewCopy
  var pure = root.Overview

  /* 没有 DOM 的环境（单元测试）只载入判定那一份。 */
  if (typeof document === 'undefined') return

  var card = document.querySelector('.ov')
  if (card === null) return

  var widget = window.widget
  var READ = 'widget-board:records.read'
  var WRITE = 'widget-board:records.write'
  var LOAD_TIMEOUT = pure.LOAD_TIMEOUT

  function isZh() {
    if (widget !== undefined && typeof widget.lang === 'string' && widget.lang !== '') {
      return widget.lang.toLowerCase().indexOf('zh') === 0
    }
    return true
  }

  function t(key) {
    if (widget !== undefined && typeof widget.t === 'function') {
      var value = widget.t(key)
      if (value !== key && value !== '') return value
    }
    var entry = copy[key]
    if (entry === undefined) return key
    return isZh() ? entry.zh : entry.en
  }

  function put(node, value) {
    if (node !== null && node !== undefined) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  var nodes = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    banner: card.querySelector('[data-role="banner"]'),
    actions: card.querySelector('[data-role="actions"]'),
    actionsEmpty: card.querySelector('[data-role="actions-empty"]'),
    actionsMore: card.querySelector('[data-role="actions-more"]'),
    meetings: card.querySelector('[data-role="meetings"]'),
    meetingsEmpty: card.querySelector('[data-role="meetings-empty"]'),
    manuscripts: card.querySelector('[data-role="manuscripts"]'),
    manuscriptsEmpty: card.querySelector('[data-role="manuscripts-empty"]'),
    note: card.querySelector('[data-role="note"]'),
    noteWrap: card.querySelector('.ov__note-wrap'),
    retry: card.querySelector('[data-action="retry"]'),
    refresh: card.querySelector('[data-action="refresh"]'),
    quickAdd: card.querySelector('[data-action="quick-add"]'),
    quickDialog: card.querySelector('[data-role="quick-dialog"]'),
    quickHint: card.querySelector('[data-role="quick-hint"]'),
    quickTitle: card.querySelector('[data-field="quick-title"]'),
    quickDue: card.querySelector('[data-field="quick-due"]'),
    quickCreate: card.querySelector('[data-action="quick-create"]'),
    sourceDialog: card.querySelector('[data-role="source-dialog"]'),
    sourceTitle: card.querySelector('[data-role="source-title"]'),
    sourceMeta: card.querySelector('[data-role="source-meta"]'),
    sourceFeedback: card.querySelector('[data-role="source-feedback"]'),
    sourceQuestions: card.querySelector('[data-role="source-questions"]'),
    sr: card.querySelector('[data-role="sr"]')
  }

  var live = widget !== undefined && typeof widget.call === 'function'
  var app = {
    actions: null,
    meetings: null,
    manuscripts: null,
    records: null,
    busy: false,
    loaded: false,
  }
  var loadTimer = null

  function setBanner(message) {
    if (nodes.banner === null) return
    put(nodes.banner, message)
    nodes.banner.hidden = message === ''
    put(nodes.sr, message)
  }

  function applyLabels() {
    var props = widget !== undefined && widget.props !== null && typeof widget.props === 'object' ? widget.props : {}
    var title = typeof props.title === 'string' && props.title.trim() !== '' ? props.title.trim() : t('title')
    var kicker = typeof props.kicker === 'string' ? props.kicker.trim() : t('kicker')
    put(nodes.title, title)
    put(nodes.kicker, kicker)
    if (nodes.kicker !== null) nodes.kicker.hidden = kicker === ''
    if (nodes.actions !== null) nodes.actions.setAttribute('aria-label', t('actions'))
    put(nodes.refresh, t('refresh'))
    put(nodes.quickAdd, t('quickAdd'))
    put(card.querySelector('[data-role="label-actions"]'), t('actions'))
    put(card.querySelector('[data-role="label-meetings"]'), t('meetings'))
    put(card.querySelector('[data-role="label-manuscripts"]'), t('manuscripts'))
    put(nodes.actionsEmpty, t('actionsEmpty'))
    put(nodes.meetingsEmpty, t('meetingsEmpty'))
    put(nodes.manuscriptsEmpty, t('manuscriptsEmpty'))
    put(nodes.retry, t('retry'))
    put(nodes.quickHint, t('quickAdd'))
    put(card.querySelector('[data-role="label-action-title"]'), t('actionTitle'))
    put(card.querySelector('[data-role="label-action-due"]'), t('actionDue'))
    put(card.querySelector('[data-action="quick-cancel"]'), t('cancel'))
    put(nodes.quickCreate, t('create'))
    put(card.querySelector('[data-role="source-title"]'), t('sourceTitle'))
    put(card.querySelector('[data-action="source-close"]'), t('close'))
  }

  function sectionEmpty(list, empty, count) {
    if (list !== null) list.hidden = count === 0
    if (empty !== null) empty.hidden = count > 0
  }

  function dueChip(record, now) {
    var chip = document.createElement('span')
    chip.className = 'ov__due'
    var text = pure.dueText(record)
    chip.dataset.tone = pure.dueTone(record, now)
    chip.textContent = text === '' ? t('dueNone') : text
    return chip
  }

  function actionRow(record, now) {
    var row = document.createElement('li')
    row.className = 'ov__row'
    row.dataset.id = record.id
    var dot = document.createElement('span')
    dot.className = 'ov__dot'
    dot.dataset.status = record.status
    dot.setAttribute('aria-hidden', 'true')
    var body = document.createElement('span')
    body.className = 'ov__row-body'
    var title = document.createElement('span')
    title.className = 'ov__row-title'
    title.textContent = record.title
    var meta = document.createElement('span')
    meta.className = 'ov__row-meta'
    meta.appendChild(dueChip(record, now))
    if (record.status === 'blocked' && typeof record.blockedNote === 'string' && record.blockedNote.trim() !== '') {
      var blocked = document.createElement('span')
      blocked.className = 'ov__tag'
      blocked.dataset.tone = 'blocked'
      blocked.textContent = record.blockedNote.trim().replace(/\s+/g, ' ')
      meta.appendChild(blocked)
    }
    if (record.source !== null && record.source !== undefined && typeof record.source === 'object') {
      var source = document.createElement('button')
      source.type = 'button'
      source.className = 'ov__source'
      source.dataset.source = record.id
      source.textContent = t('source')
      meta.appendChild(source)
    }
    body.append(title, meta)
    var quick = document.createElement('button')
    quick.type = 'button'
    quick.className = 'ov__quick'
    quick.dataset.quick = record.id
    quick.textContent = t('quickDone')
    row.append(dot, body, quick)
    return row
  }

  function meetingRow(record) {
    var row = document.createElement('li')
    row.className = 'ov__row ov__row--static'
    var date = document.createElement('span')
    date.className = 'ov__date'
    date.textContent = pure.dateText(record) === '' ? t('dateUnknown') : pure.dateText(record)
    var body = document.createElement('span')
    body.className = 'ov__row-body'
    var title = document.createElement('span')
    title.className = 'ov__row-title'
    title.textContent = record.title
    body.appendChild(title)
    if (typeof record.openQuestions === 'string' && record.openQuestions.trim() !== '') {
      var meta = document.createElement('span')
      meta.className = 'ov__row-meta'
      var tag = document.createElement('span')
      tag.className = 'ov__tag'
      tag.dataset.tone = 'question'
      tag.textContent = t('openQuestions')
      meta.appendChild(tag)
      body.appendChild(meta)
    }
    row.append(date, body)
    return row
  }

  function manuscriptRow(record) {
    var row = document.createElement('li')
    row.className = 'ov__row ov__row--static'
    var stage = document.createElement('span')
    stage.className = 'ov__stage'
    stage.dataset.stage = record.stage
    stage.textContent = t(pure.stageKey(record.stage))
    var body = document.createElement('span')
    body.className = 'ov__row-body'
    var title = document.createElement('span')
    title.className = 'ov__row-title'
    title.textContent = record.title
    body.appendChild(title)
    var meta = document.createElement('span')
    meta.className = 'ov__row-meta'
    if (typeof record.nextStep === 'string' && record.nextStep.trim() !== '') {
      var next = document.createElement('span')
      next.className = 'ov__next'
      next.textContent = record.nextStep.trim().replace(/\s+/g, ' ')
      meta.appendChild(next)
    }
    if (typeof record.target === 'string' && record.target.trim() !== '') {
      var target = document.createElement('span')
      target.className = 'ov__tag'
      target.textContent = record.target.trim()
      meta.appendChild(target)
    }
    meta.appendChild(dueChip(record, Date.now()))
    body.appendChild(meta)
    row.append(stage, body)
    return row
  }

  function renderRows(list, rows, empty, more, moreText) {
    if (list === null) return
    list.replaceChildren.apply(list, rows)
    sectionEmpty(list, empty, rows.length)
    if (more !== null) {
      more.hidden = moreText === ''
      put(more, moreText)
    }
  }

  /** 从一组记录画出三节；`records` 是共享存储里的活跃记录。 */
  function render(records) {
    var now = Date.now()
    app.records = records
    var actions = pure.actionRows(records, now, 5)
    var meetings = pure.meetingRows(records, 3)
    var manuscripts = pure.manuscriptRows(records, now, 4)
    var actionNodes = []
    for (var at = 0; at < actions.rows.length; at += 1) actionNodes.push(actionRow(actions.rows[at], now))
    var meetingNodes = []
    for (var index = 0; index < meetings.rows.length; index += 1) meetingNodes.push(meetingRow(meetings.rows[index]))
    var manuscriptNodes = []
    for (var m = 0; m < manuscripts.rows.length; m += 1) manuscriptNodes.push(manuscriptRow(manuscripts.rows[m]))
    renderRows(nodes.actions, actionNodes, nodes.actionsEmpty, nodes.actionsMore, actions.more > 0 ? pure.fill(t('actionsMore'), { n: actions.more }) : '')
    renderRows(nodes.meetings, meetingNodes, nodes.meetingsEmpty, null, '')
    renderRows(nodes.manuscripts, manuscriptNodes, nodes.manuscriptsEmpty, null, '')
    if (nodes.noteWrap !== null) nodes.noteWrap.hidden = true
    card.dataset.state = 'ready'
    app.loaded = true
  }

  function emptyRender() {
    render([])
  }

  /** 数据源没有初值时走三次按需读，把三类记录拼在一起。 */
  function load() {
    if (!live || app.busy) return
    app.busy = true
    if (nodes.refresh !== null) nodes.refresh.disabled = true
    var reads = [
      widget.call(READ, { kind: 'action' }),
      widget.call(READ, { kind: 'meeting' }),
      widget.call(READ, { kind: 'manuscript' }),
    ]
    Promise.all(reads).then(function (results) {
      app.busy = false
      if (nodes.refresh !== null) nodes.refresh.disabled = false
      var records = []
      for (var at = 0; at < results.length; at += 1) {
        var result = results[at]
        if (result !== null && typeof result === 'object' && Array.isArray(result.records)) records = records.concat(result.records)
      }
      render(records)
      setBanner('')
    }, function (error) {
      app.busy = false
      if (nodes.refresh !== null) nodes.refresh.disabled = false
      card.dataset.state = 'failed'
      put(nodes.note, t('failed') + '：' + messageOf(error))
      if (nodes.noteWrap !== null) nodes.noteWrap.hidden = false
      if (nodes.retry !== null) nodes.retry.hidden = false
    })
  }

  function messageOf(error) {
    return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
  }

  /** 数据源推来一份就重画；没有推送时等超时再给重试。 */
  function onData(data) {
    if (loadTimer !== null) {
      window.clearTimeout(loadTimer)
      loadTimer = null
    }
    if (data !== null && typeof data === 'object' && Array.isArray(data.records)) {
      render(data.records)
      return
    }
    if (!app.loaded) emptyRender()
  }

  function quickSet(record) {
    if (!live) return
    widget.call(WRITE, { op: 'update', id: record.id, expectedRevision: record.revision, patch: { status: 'done' } }).then(function () {
      setBanner('')
    }, function (error) {
      setBanner(pure.fill(t('quickFailed'), { reason: messageOf(error) }))
      load()
    })
  }

  function openQuick() {
    if (typeof nodes.quickDialog.showModal !== 'function') return
    nodes.quickHint.textContent = t('quickAdd')
    nodes.quickTitle.value = ''
    nodes.quickDue.value = ''
    nodes.quickDialog.showModal()
    nodes.quickTitle.focus()
  }

  function closeQuick() {
    if (nodes.quickDialog.open) nodes.quickDialog.close()
  }

  function createQuick() {
    if (!live) return
    var title = nodes.quickTitle.value.trim()
    if (title === '') {
      nodes.quickHint.textContent = t('titleRequired')
      nodes.quickTitle.focus()
      return
    }
    var record = { kind: 'action', title: title, status: 'todo' }
    if (nodes.quickDue.value !== '') {
      record.due = { kind: 'date', date: nodes.quickDue.value, timeZone: pureZone() }
    }
    nodes.quickCreate.disabled = true
    widget.call(WRITE, { op: 'create', record: record }).then(function () {
      nodes.quickCreate.disabled = false
      closeQuick()
      setBanner(t('created'))
      load()
    }, function (error) {
      nodes.quickCreate.disabled = false
      nodes.quickHint.textContent = t('createFailed') + '：' + messageOf(error)
    })
  }

  function pureZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch (error) {
      return 'UTC'
    }
  }

  function openSource(actionId) {
    if (!live || app.records === null) return
    var action = null
    for (var at = 0; at < app.records.length; at += 1) {
      if (app.records[at].id === actionId) {
        action = app.records[at]
        break
      }
    }
    if (action === null || action.source === null || action.source === undefined) return
    var source = action.source
    nodes.sourceTitle.textContent = t('sourceTitle')
    nodes.sourceMeta.textContent = ''
    nodes.sourceFeedback.textContent = ''
    nodes.sourceQuestions.textContent = ''
    if (typeof nodes.sourceDialog.showModal === 'function') nodes.sourceDialog.showModal()
    widget.call(READ, { ids: [source.id], includeTrashed: true, includeArchived: true }).then(function (result) {
      var meeting = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records[0] : null
      if (meeting === null || typeof meeting !== 'object') {
        nodes.sourceTitle.textContent = t('sourceMissing')
        return
      }
      var trashed = typeof meeting.deletedAt === 'string'
      nodes.sourceTitle.textContent = meeting.title + (trashed ? '（' + t('sourceTrashed') + '）' : '')
      nodes.sourceMeta.textContent = pure.dateText(meeting) === '' ? t('dateUnknown') : pure.dateText(meeting)
      if (typeof meeting.feedback === 'string' && meeting.feedback.trim() !== '') {
        nodes.sourceFeedback.textContent = t('feedback') + '：' + meeting.feedback.trim()
      }
      if (typeof meeting.openQuestions === 'string' && meeting.openQuestions.trim() !== '') {
        nodes.sourceQuestions.textContent = t('openQuestions') + '：' + meeting.openQuestions.trim()
      }
    }, function () {
      nodes.sourceTitle.textContent = t('sourceMissing')
    })
  }

  function closeSource() {
    if (nodes.sourceDialog.open) nodes.sourceDialog.close()
  }

  function renderSample() {
    applyLabels()
    var now = Date.now()
    var records = [
      { id: 'sample-a1', kind: 'action', title: '补一个基线对比', status: 'doing', due: { kind: 'date', date: '2026-11-13', timeZone: 'Asia/Shanghai' }, source: { kind: 'meeting', id: 'sample-m1' }, updatedAt: new Date(now).toISOString(), archived: false },
      { id: 'sample-a2', kind: 'action', title: '统一坐标轴的量纲', status: 'blocked', blockedNote: '等仿真环境重装', updatedAt: new Date(now).toISOString(), archived: false },
      { id: 'sample-m1', kind: 'meeting', title: '第 8 次组会：干扰分析', date: { kind: 'date', date: '2026-11-06', timeZone: 'Asia/Shanghai' }, openQuestions: '静态信道假设是否放宽', updatedAt: new Date(now).toISOString(), archived: false },
      { id: 'sample-p1', kind: 'manuscript', title: '低轨星座干扰分析', stage: 'experiment', nextStep: '补一个基线对比', target: 'IEEE TWC', due: { kind: 'date', date: '2026-12-15', timeZone: 'Asia/Shanghai' }, updatedAt: new Date(now).toISOString(), archived: false },
      { id: 'sample-p2', kind: 'manuscript', title: '稀疏阵列角度估计', stage: 'writing', nextStep: '统一坐标轴的量纲', updatedAt: new Date(now).toISOString(), archived: false }
    ]
    render(records)
    nodes.refresh.disabled = true
    nodes.quickAdd.disabled = true
  }

  if (nodes.actions !== null) {
    nodes.actions.addEventListener('click', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var source = target.closest('.ov__source')
      if (source !== null) {
        openSource(source.getAttribute('data-source'))
        return
      }
      var quick = target.closest('.ov__quick')
      if (quick === null || app.records === null) return
      var id = quick.getAttribute('data-quick')
      for (var at = 0; at < app.records.length; at += 1) {
        if (app.records[at].id === id) {
          quickSet(app.records[at])
          return
        }
      }
    })
  }
  nodes.refresh.addEventListener('click', function () { load() })
  nodes.quickAdd.addEventListener('click', openQuick)
  nodes.retry.addEventListener('click', function () {
    if (nodes.retry !== null) nodes.retry.hidden = true
    if (nodes.noteWrap !== null) nodes.noteWrap.hidden = true
    load()
  })
  card.querySelector('[data-action="quick-cancel"]').addEventListener('click', closeQuick)
  nodes.quickCreate.addEventListener('click', createQuick)
  card.querySelector('[data-action="source-close"]').addEventListener('click', closeSource)

  applyLabels()
  if (!live) {
    renderSample()
    return
  }
  if (widget.size !== null && widget.size !== undefined && widget.size.placement === 'preview') {
    renderSample()
  } else {
    var initial = widget.data
    if (initial !== null && initial !== undefined && typeof initial === 'object' && Array.isArray(initial.records)) {
      render(initial.records)
    } else {
      put(nodes.note, t('loading'))
      if (nodes.noteWrap !== null) nodes.noteWrap.hidden = false
      loadTimer = window.setTimeout(function () {
        if (!app.loaded) {
          card.dataset.state = 'failed'
          put(nodes.note, t('failed'))
          if (nodes.retry !== null) nodes.retry.hidden = false
        }
      }, LOAD_TIMEOUT)
    }
    if (typeof widget.onData === 'function') widget.onData(onData)
    if (typeof widget.onProps === 'function') widget.onProps(applyLabels)
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
