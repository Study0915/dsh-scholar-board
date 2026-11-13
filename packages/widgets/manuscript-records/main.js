/*
 * 小论文卡的主脚本：列表、阶段筛选、搜索、详情打开关闭与事件接线（D36）。
 *
 * 列表来自数据源 `widget-board:records`，任一记录变化时宿主重推；搜索、归档与回收站视图走
 * `records.read`。详情与保存面板在 editor.js：阶段变更由宿主记入历史，草稿与修订冲突与其他记录卡一致。
 *
 * 判定在 manuscript-model.js，文案在 copy.js，画面零件在 view.js；这一份只管列表与接线。
 */
;(function (root) {
  'use strict'

  var copy = root.ManuscriptsCopy
  var view = root.ManuscriptsView
  var pure = root.Manuscripts

  /* 没有 DOM 的环境（单元测试）只载入判定那一份。 */
  if (typeof document === 'undefined') return

  var card = document.querySelector('.ms')
  if (card === null) return

  var widget = window.widget
  var READ = 'widget-board:records.read'
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
    count: card.querySelector('[data-field="count"]'),
    search: card.querySelector('[data-role="search"]'),
    stageFilter: card.querySelector('[data-role="stage-filter"]'),
    list: card.querySelector('[data-role="list"]'),
    note: card.querySelector('[data-role="note"]'),
    noteWrap: card.querySelector('.ms__note-wrap'),
    retry: card.querySelector('[data-action="retry"]'),
    newButton: card.querySelector('[data-action="new"]'),
    tabs: card.querySelectorAll('.ms__tab'),
    detail: card.querySelector('[data-role="detail"]'),
    detailState: card.querySelector('[data-role="detail-state"]'),
    detailHint: card.querySelector('[data-role="detail-hint"]'),
    titleInput: card.querySelector('[data-field="title-input"]'),
    question: card.querySelector('[data-field="question"]'),
    stageSelect: card.querySelector('[data-field="stage"]'),
    stageNote: card.querySelector('[data-field="stage-note"]'),
    next: card.querySelector('[data-field="next"]'),
    blockers: card.querySelector('[data-field="blockers"]'),
    target: card.querySelector('[data-field="target"]'),
    dueInput: card.querySelector('[data-field="due-input"]'),
    related: card.querySelector('[data-role="related"]'),
    meetingPicker: card.querySelector('[data-role="meeting-picker"]'),
    actionPicker: card.querySelector('[data-role="action-picker"]'),
    historySection: card.querySelector('[data-role="history-section"]'),
    history: card.querySelector('[data-role="history"]'),
    figures: card.querySelector('[data-role="figures"]'),
    figuresEmpty: card.querySelector('[data-role="figures-empty"]'),
    addFigure: card.querySelector('[data-action="add-figure"]'),
    submissions: card.querySelector('[data-role="submissions"]'),
    submissionsEmpty: card.querySelector('[data-role="submissions-empty"]'),
    addRound: card.querySelector('[data-action="add-round"]'),
    revisions: card.querySelector('[data-role="revisions"]'),
    revisionsEmpty: card.querySelector('[data-role="revisions-empty"]'),
    addRevision: card.querySelector('[data-action="add-revision"]'),
    materials: card.querySelector('[data-role="materials"]'),
    materialError: card.querySelector('[data-role="material-error"]'),
    materialUrl: card.querySelector('[data-field="material-url"]'),
    materialTitle: card.querySelector('[data-field="material-title"]'),
    archiveAction: card.querySelector('[data-action="archive"]'),
    restoreAction: card.querySelector('[data-action="restore"]'),
    trashAction: card.querySelector('[data-action="trash"]'),
    saveButton: card.querySelector('[data-action="save"]'),
    confirm: card.querySelector('[data-role="confirm"]'),
    confirmText: card.querySelector('[data-role="confirm-text"]'),
    conflict: card.querySelector('[data-role="conflict"]'),
    conflictText: card.querySelector('[data-role="conflict-text"]'),
    sr: card.querySelector('[data-role="sr"]')
  }
  if (nodes.detailState !== null) nodes.detailState.setAttribute('role', 'status')
  var labels = {
    title: card.querySelector('[data-role="label-title"]'),
    question: card.querySelector('[data-role="label-question"]'),
    stage: card.querySelector('[data-role="label-stage"]'),
    stageNote: card.querySelector('[data-role="label-stage-note"]'),
    next: card.querySelector('[data-role="label-next"]'),
    blockers: card.querySelector('[data-role="label-blockers"]'),
    target: card.querySelector('[data-role="label-target"]'),
    due: card.querySelector('[data-role="label-due"]'),
    related: card.querySelector('[data-role="label-related"]'),
    history: card.querySelector('[data-role="label-history"]'),
    figures: card.querySelector('[data-role="label-figures"]'),
    submissions: card.querySelector('[data-role="label-submissions"]'),
    revisions: card.querySelector('[data-role="label-revisions"]'),
    materials: card.querySelector('[data-role="label-materials"]')
  }

  var live = widget !== undefined && typeof widget.call === 'function'
  var saved = widget !== undefined && widget.state !== null && typeof widget.state === 'object' ? widget.state : {}
  var ui = {
    view: saved.view === 'finished' || saved.view === 'archived' || saved.view === 'trash' ? saved.view : 'active',
    stage: typeof saved.stage === 'string' && pure.ACTIVE_STAGES.indexOf(saved.stage) !== -1 ? saved.stage : '',
    search: '',
    openId: typeof saved.openId === 'string' ? saved.openId : null,
    draftIds: saved.draftIds !== null && typeof saved.draftIds === 'object' ? saved.draftIds : {}
  }
  var app = {
    rows: [],
    quota: null,
    total: 0,
    truncated: false,
    baseline: null,
    pendingLatest: null,
    draftId: null,
    materials: [],
    related: [],
    dirty: false,
    saving: false,
    editing: false,
    lastData: null,
    restoreOpen: ui.openId !== null,
    triggerId: null
  }
  var loadTimer = null

  function persist(patch) {
    if (widget !== undefined && typeof widget.setState === 'function') widget.setState(patch)
  }

  function setStatus(message, tone) {
    if (nodes.detailState === null) return
    put(nodes.detailState, message)
    nodes.detailState.dataset.tone = tone || 'neutral'
    put(nodes.sr, message)
  }

  function stageOptions(select, includeAll, value) {
    if (select === null) return
    var options = []
    if (includeAll) {
      var all = document.createElement('option')
      all.value = ''
      all.textContent = t('stageAll')
      options.push(all)
    }
    for (var at = 0; at < pure.STAGES.length; at += 1) {
      var option = document.createElement('option')
      option.value = pure.STAGES[at]
      option.textContent = t(pure.stageKey(pure.STAGES[at]))
      options.push(option)
    }
    select.replaceChildren.apply(select, options)
    select.value = value
  }

  function applyLabels() {
    var props = widget !== undefined && widget.props !== null && typeof widget.props === 'object' ? widget.props : {}
    var title = typeof props.title === 'string' && props.title.trim() !== '' ? props.title.trim() : t('title')
    var kicker = typeof props.kicker === 'string' ? props.kicker.trim() : t('kicker')
    put(nodes.title, title)
    put(nodes.kicker, kicker)
    if (nodes.kicker !== null) nodes.kicker.hidden = kicker === ''
    if (nodes.list !== null) nodes.list.setAttribute('aria-label', title)
    put(nodes.newButton, t('new'))
    nodes.search.setAttribute('placeholder', t('search'))
    nodes.search.setAttribute('aria-label', t('search'))
    for (var at = 0; at < nodes.tabs.length; at += 1) put(nodes.tabs[at], t(nodes.tabs[at].getAttribute('data-view')))
    stageOptions(nodes.stageFilter, true, ui.stage)
    stageOptions(nodes.stageSelect, false, nodes.stageSelect !== null ? nodes.stageSelect.value : 'idea')
    put(nodes.retry, t('retry'))
    put(labels.title, t('title'))
    put(labels.question, t('question'))
    put(labels.stage, t('stage'))
    put(labels.stageNote, t('stageNote'))
    put(labels.next, t('nextStep'))
    put(labels.blockers, t('blockers'))
    put(labels.target, t('target'))
    put(labels.due, t('due'))
    put(labels.related, t('related'))
    put(labels.history, t('history'))
    put(labels.figures, t('figures'))
    put(labels.submissions, t('submissions'))
    put(labels.revisions, t('revisions'))
    put(labels.materials, t('material'))
    put(nodes.figuresEmpty, t('figuresEmpty'))
    put(nodes.submissionsEmpty, t('submissionsEmpty'))
    put(nodes.revisionsEmpty, t('revisionsEmpty'))
    put(nodes.addFigure, t('addFigure'))
    put(nodes.addRound, t('addRound'))
    put(nodes.addRevision, t('addRevision'))
    put(card.querySelector('[data-action="close"]'), t('close'))
    put(card.querySelector('[data-action="add-material"]'), t('addMaterial'))
    put(card.querySelector('[data-action="add-meeting"]'), t('add'))
    put(card.querySelector('[data-action="add-action"]'), t('add'))
    put(nodes.saveButton, t('save'))
    put(nodes.archiveAction, t('archive'))
    put(nodes.restoreAction, t('restore'))
    put(nodes.trashAction, t('trashAction'))
    nodes.materialUrl.setAttribute('placeholder', t('materialUrl'))
    nodes.materialTitle.setAttribute('placeholder', t('materialTitle'))
    if (nodes.meetingPicker !== null) nodes.meetingPicker.setAttribute('aria-label', t('relatedMeeting'))
    if (nodes.actionPicker !== null) nodes.actionPicker.setAttribute('aria-label', t('relatedAction'))
    put(nodes.confirm.querySelector('[data-action="confirm-keep"]'), t('keepEditing'))
    put(nodes.confirm.querySelector('[data-action="confirm-close"]'), t('closeKeepDraft'))
    put(nodes.conflict.querySelector('[data-action="conflict-keep"]'), t('keepEditing'))
    put(nodes.conflict.querySelector('[data-action="conflict-reload"]'), t('loadLatest'))
  }

  function countLine(rows) {
    if (nodes.count === null) return
    var line = rows.length === 0 ? '' : (isZh() ? String(rows.length) + ' 条' : String(rows.length))
    if (app.quota !== null && app.quota.warning === true && app.quota.countLimit > 0) {
      var percent = Math.min(100, Math.round((app.quota.count / app.quota.countLimit) * 100))
      var bytesPercent = app.quota.bytesLimit > 0 ? Math.round((app.quota.bytes / app.quota.bytesLimit) * 100) : 0
      var used = Math.max(percent, bytesPercent)
      line += ' · ' + String(used) + '%'
      nodes.count.title = pure.fill(t('quotaWarning'), { percent: used })
    } else {
      nodes.count.title = ''
    }
    put(nodes.count, line)
  }

  function setNote(message, options) {
    if (nodes.note === null) return
    put(nodes.note, message)
    nodes.note.hidden = message === ''
    if (nodes.retry !== null) nodes.retry.hidden = !(options !== undefined && options.retry === true)
  }

  function setTabs() {
    for (var at = 0; at < nodes.tabs.length; at += 1) {
      var button = nodes.tabs[at]
      var selected = button.getAttribute('data-view') === ui.view
      button.setAttribute('aria-selected', selected ? 'true' : 'false')
      button.dataset.active = selected ? 'true' : 'false'
    }
    if (nodes.stageFilter !== null) nodes.stageFilter.hidden = ui.view !== 'active'
  }

  function renderData(data) {
    var records = data !== null && typeof data === 'object' && Array.isArray(data.records) ? data.records : []
    app.lastData = data !== null && typeof data === 'object' ? data : null
    app.quota = data !== null && typeof data === 'object' && data.quota !== null && typeof data.quota === 'object' ? data.quota : null
    app.total = data !== null && typeof data === 'object' && typeof data.total === 'number' ? data.total : records.length
    app.truncated = data !== null && typeof data === 'object' && data.truncated === true
    var text = { t: t, fill: pure.fill, now: Date.now() }
    app.rows = pure.viewRows(records, ui.view, ui.stage, text.now)
    var rows = []
    for (var index = 0; index < app.rows.length; index += 1) rows.push(view.rowOf(app.rows[index], text))
    if (nodes.list !== null) {
      nodes.list.replaceChildren.apply(nodes.list, rows)
      nodes.list.hidden = rows.length === 0
    }
    countLine(app.rows)
    if (rows.length === 0) {
      setNote(ui.search !== '' ? t('emptySearch') : ui.view === 'finished' ? t('emptyFinished') : ui.view === 'archived' ? t('emptyArchived') : ui.view === 'trash' ? t('emptyTrash') : t('emptyActive'))
    } else if (app.truncated) {
      setNote(pure.fill(t('truncated'), { n: app.rows.length, total: app.total }))
    } else {
      setNote('')
    }
    card.dataset.state = 'ready'
    restoreOpenOnce()
  }

  function refreshList() {
    if (!live) {
      renderSample()
      return
    }
    if (ui.search === '' && app.lastData !== null && (ui.view === 'active' || ui.view === 'finished')) {
      renderData(app.lastData)
      return
    }
    var query = { kind: 'manuscript' }
    if (ui.search !== '') query.search = ui.search
    if (ui.view === 'archived') query.includeArchived = true
    if (ui.view === 'trash') query.includeTrashed = true
    widget.call(READ, query).then(function (data) {
      renderData(data)
    }, function (error) {
      card.dataset.state = 'failed'
      setNote(t('failed') + '：' + messageOf(error), { retry: true })
    })
  }

  function messageOf(error) {
    return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
  }

  function restoreOpenOnce() {
    if (!app.restoreOpen || ui.openId === null) return
    app.restoreOpen = false
    var wanted = ui.openId
    for (var at = 0; at < app.rows.length; at += 1) {
      if (app.rows[at].id === wanted) {
        editor.openRecord(app.rows[at])
        return
      }
    }
    widget.call(READ, { ids: [wanted], includeArchived: true, includeTrashed: true }).then(function (result) {
      var record = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records[0] : null
      if (record !== null && typeof record === 'object') editor.openRecord(record)
    }, function () {})
  }

  var editor = root.createManuscriptEditor({
    card: card,
    widget: widget,
    live: live,
    nodes: nodes,
    ui: ui,
    app: app,
    t: t,
    pure: pure,
    view: view,
    setStatus: setStatus,
    persist: persist,
    refreshList: function () { refreshList() }
  })

  /** 图表、投稿与修回里的输入：文本走 input，选择走 change，逐项交回编辑器。 */
  function wireDeep(list, attr, update) {
    if (list === null) return
    list.addEventListener('input', function (event) {
      var target = event.target
      if (!(target instanceof Element) || target.tagName === 'SELECT') return
      var row = target.closest('[' + attr + ']')
      if (row === null) return
      var field = target.getAttribute('data-field')
      if (field !== null) update(row.getAttribute(attr), field, target.value)
    })
    list.addEventListener('change', function (event) {
      var target = event.target
      if (!(target instanceof Element) || target.tagName !== 'SELECT') return
      var row = target.closest('[' + attr + ']')
      if (row === null) return
      var field = target.getAttribute('data-field')
      if (field !== null) update(row.getAttribute(attr), field, target.value)
    })
  }

  function renderSample() {
    applyLabels()
    var rows = view.sampleRows()
    app.rows = rows
    var text = { t: t, fill: pure.fill, now: Date.now() }
    var rendered = []
    for (var at = 0; at < rows.length; at += 1) rendered.push(view.rowOf(rows[at], text))
    if (nodes.list !== null) {
      nodes.list.replaceChildren.apply(nodes.list, rendered)
      nodes.list.hidden = false
    }
    setNote('')
    put(nodes.count, isZh() ? '3 条' : '3')
    card.dataset.state = 'ready'
    nodes.newButton.disabled = true
    nodes.search.disabled = true
  }

  nodes.search.addEventListener('input', function () {
    ui.search = nodes.search.value.trim()
    refreshList()
  })
  if (nodes.stageFilter !== null) {
    nodes.stageFilter.addEventListener('change', function () {
      ui.stage = nodes.stageFilter.value
      persist({ stage: ui.stage })
      if (app.lastData !== null) renderData(app.lastData)
    })
  }
  for (var tabAt = 0; tabAt < nodes.tabs.length; tabAt += 1) {
    nodes.tabs[tabAt].addEventListener('click', function (event) {
      var wanted = event.currentTarget.getAttribute('data-view')
      if (wanted === ui.view) return
      ui.view = wanted
      persist({ view: wanted })
      setTabs()
      app.lastData = null
      setNote(t('loading'))
      card.dataset.state = 'loading'
      refreshList()
    })
  }
  nodes.newButton.addEventListener('click', function () {
    app.triggerId = null
    editor.openNew()
  })
  nodes.retry.addEventListener('click', function () {
    app.lastData = null
    refreshList()
  })
  if (nodes.list !== null) {
    nodes.list.addEventListener('click', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var row = target.closest('.ms__row')
      if (row === null) return
      var id = row.getAttribute('data-id')
      for (var at = 0; at < app.rows.length; at += 1) {
        if (app.rows[at].id === id) {
          app.triggerId = id
          editor.openRecord(app.rows[at])
          return
        }
      }
    })
  }
  card.querySelector('[data-action="back"]').addEventListener('click', function () { editor.closeDetail(false) })
  card.querySelector('[data-action="close"]').addEventListener('click', function () { editor.closeDetail(false) })
  nodes.saveButton.addEventListener('click', function () { editor.save() })
  nodes.archiveAction.addEventListener('click', function () { editor.lifeOp('archive') })
  nodes.restoreAction.addEventListener('click', function () { editor.lifeOp('restore') })
  nodes.trashAction.addEventListener('click', function () { editor.lifeOp('trash') })
  card.querySelector('[data-action="add-material"]').addEventListener('click', function () { editor.addMaterial() })
  card.querySelector('[data-action="add-meeting"]').addEventListener('click', function () { editor.addRelated('meeting') })
  card.querySelector('[data-action="add-action"]').addEventListener('click', function () { editor.addRelated('action') })
  if (nodes.related !== null) {
    nodes.related.addEventListener('click', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var remove = target.closest('.ms__related-remove')
      if (remove !== null) editor.removeRelated(remove.getAttribute('data-related'))
    })
  }
  if (nodes.materials !== null) {
    nodes.materials.addEventListener('click', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var open = target.closest('.ms__material-open')
      if (open !== null && typeof open.dataset.url === 'string' && live && typeof widget.open === 'function') {
        widget.open(open.dataset.url)
        return
      }
      var remove = target.closest('.ms__material-remove')
      if (remove !== null) editor.removeMaterial(remove.getAttribute('data-material'))
    })
  }
  nodes.addFigure.addEventListener('click', function () { editor.addFigure() })
  nodes.addRound.addEventListener('click', function () { editor.addRound() })
  nodes.addRevision.addEventListener('click', function () { editor.addRevision() })
  wireDeep(nodes.figures, 'data-figure', function (id, field, value) { editor.updateFigure(id, field, value) })
  wireDeep(nodes.submissions, 'data-round', function (id, field, value) { editor.updateRound(id, field, value) })
  wireDeep(nodes.revisions, 'data-revision', function (id, field, value) { editor.updateRevision(id, field, value) })
  if (nodes.figures !== null) {
    nodes.figures.addEventListener('click', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var remove = target.closest('[data-action="remove-figure"]')
      if (remove !== null) editor.removeFigure(remove.getAttribute('data-figure'))
    })
  }
  if (nodes.submissions !== null) {
    nodes.submissions.addEventListener('click', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var remove = target.closest('[data-action="remove-round"]')
      if (remove !== null) editor.removeRound(remove.getAttribute('data-round'))
    })
  }
  if (nodes.revisions !== null) {
    nodes.revisions.addEventListener('click', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var open = target.closest('.ms__material-open')
      if (open !== null && typeof open.dataset.url === 'string' && live && typeof widget.open === 'function') {
        widget.open(open.dataset.url)
        return
      }
      var action = target.closest('[data-action]')
      if (action === null) return
      var name = action.getAttribute('data-action')
      if (name === 'remove-revision') editor.removeRevision(action.getAttribute('data-revision'))
      else if (name === 'add-revision-material') editor.addRevisionMaterial(action.getAttribute('data-revision'))
      else if (name === 'remove-revision-material') editor.removeRevisionMaterial(action.getAttribute('data-revision'), action.getAttribute('data-material'))
    })
  }
  nodes.confirm.querySelector('[data-action="confirm-keep"]').addEventListener('click', function () { nodes.confirm.close() })
  nodes.confirm.querySelector('[data-action="confirm-close"]').addEventListener('click', function () {
    nodes.confirm.close()
    editor.closeDetail(true)
  })
  nodes.conflict.querySelector('[data-action="conflict-keep"]').addEventListener('click', function () { nodes.conflict.close() })
  nodes.conflict.querySelector('[data-action="conflict-reload"]').addEventListener('click', function () {
    nodes.conflict.close()
    editor.reloadLatest()
  })
  var inputs = [nodes.titleInput, nodes.question, nodes.next, nodes.blockers, nodes.target, nodes.dueInput, nodes.stageNote]
  for (var inputAt = 0; inputAt < inputs.length; inputAt += 1) inputs[inputAt].addEventListener('input', function () { editor.onInput() })
  if (nodes.stageSelect !== null) nodes.stageSelect.addEventListener('change', function () { editor.onInput() })

  function consider(size) {
    if (size === null || size === undefined) return
    if (size.placement === 'preview') renderSample()
  }

  applyLabels()
  setTabs()
  nodes.detail.hidden = true
  if (!live) {
    renderSample()
    return
  }
  if (widget.size !== null && widget.size !== undefined && widget.size.placement === 'preview') {
    renderSample()
  } else {
    if (typeof widget.onSize === 'function') widget.onSize(consider)
    if (typeof widget.onProps === 'function') {
      widget.onProps(function () {
        applyLabels()
        setTabs()
      })
    }
    var initial = widget.data
    if (initial !== null && initial !== undefined) {
      renderData(initial)
    } else {
      setNote(t('loading'))
      loadTimer = window.setTimeout(function () {
        if (app.lastData === null) {
          card.dataset.state = 'failed'
          setNote(t('failed'), { retry: true })
        }
      }, LOAD_TIMEOUT)
    }
    if (typeof widget.onData === 'function') {
      widget.onData(function (data) {
        if (loadTimer !== null) { window.clearTimeout(loadTimer); loadTimer = null }
        if (ui.search === '' && (ui.view === 'active' || ui.view === 'finished')) {
          renderData(data)
        } else {
          app.lastData = data
          refreshList()
        }
      })
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
