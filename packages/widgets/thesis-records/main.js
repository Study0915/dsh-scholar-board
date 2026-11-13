/*
 * 毕业论文卡的主脚本：列表、范围、搜索、详情打开关闭与事件接线（D36）。
 *
 * 列表来自数据源 `widget-board:records`，任一记录变化时宿主重推；搜索、归档与回收站视图走
 * `records.read`。详情与保存面板在 editor.js：输入防抖后存草稿，保存走 `records.write` 并带
 * expectedRevision，失败保留输入，冲突给出载入最新或继续编辑。
 *
 * 判定在 thesis-model.js，文案在 copy.js，画面零件在 view.js，几组行在 rows.js；这一份只管列表与接线。
 */
;(function (root) {
  'use strict'

  var copy = root.ThesisRecordsCopy
  var view = root.ThesisRecordsView
  var pure = root.ThesisRecords

  /* 没有 DOM 的环境（单元测试）只载入判定那一份。 */
  if (typeof document === 'undefined') return

  var card = document.querySelector('.ts')
  if (card === null) return

  var widget = window.widget
  var READ = 'widget-board:records.read'
  var KIND = pure.KIND
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

  var text = { t: t, fill: pure.fill }

  var nodes = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    count: card.querySelector('[data-field="count"]'),
    search: card.querySelector('[data-role="search"]'),
    list: card.querySelector('[data-role="list"]'),
    note: card.querySelector('[data-role="note"]'),
    noteWrap: card.querySelector('.ts__note-wrap'),
    retry: card.querySelector('[data-action="retry"]'),
    newButton: card.querySelector('[data-action="new"]'),
    tabs: card.querySelectorAll('.ts__tab'),
    detail: card.querySelector('[data-role="detail"]'),
    detailState: card.querySelector('[data-role="detail-state"]'),
    detailHint: card.querySelector('[data-role="detail-hint"]'),
    chapters: card.querySelector('[data-role="chapters"]'),
    results: card.querySelector('[data-role="results"]'),
    experiments: card.querySelector('[data-role="experiments"]'),
    milestones: card.querySelector('[data-role="milestones"]'),
    related: card.querySelector('[data-role="related"]'),
    actionSelect: card.querySelector('[data-role="action-select"]'),
    rowsError: card.querySelector('[data-role="rows-error"]'),
    materials: card.querySelector('[data-role="materials"]'),
    materialError: card.querySelector('[data-role="material-error"]'),
    titleInput: card.querySelector('[data-field="title-input"]'),
    question: card.querySelector('[data-field="question"]'),
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
    chapters: card.querySelector('[data-role="label-chapters"]'),
    results: card.querySelector('[data-role="label-results"]'),
    experiments: card.querySelector('[data-role="label-experiments"]'),
    milestones: card.querySelector('[data-role="label-milestones"]'),
    related: card.querySelector('[data-role="label-related"]'),
    materials: card.querySelector('[data-role="label-materials"]')
  }

  var live = widget !== undefined && typeof widget.call === 'function'
  var saved = widget !== undefined && widget.state !== null && typeof widget.state === 'object' ? widget.state : {}
  var ui = {
    view: saved.view === 'archived' || saved.view === 'trash' ? saved.view : 'active',
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
    chapters: [],
    results: [],
    experiments: [],
    milestones: [],
    related: [],
    materials: [],
    sources: [],
    actions: [],
    dirty: false,
    saving: false,
    editing: false,
    lastData: null,
    restoreOpen: ui.openId !== null,
    triggerId: null
  }
  var loadTimer = null

  var rows = root.createThesisRows({
    app: app,
    nodes: nodes,
    widget: widget,
    live: live,
    t: t,
    pure: pure,
    view: view,
    onInput: function () { editor.onInput() }
  })

  function persist(patch) {
    if (widget !== undefined && typeof widget.setState === 'function') widget.setState(patch)
  }

  function setStatus(message, tone) {
    if (nodes.detailState === null) return
    put(nodes.detailState, message)
    nodes.detailState.dataset.tone = tone || 'neutral'
    put(nodes.sr, message)
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
    put(nodes.retry, t('retry'))
    put(labels.title, t('fieldTitle'))
    put(labels.question, t('question'))
    put(labels.chapters, t('chapters'))
    put(labels.results, t('results'))
    put(labels.experiments, t('experiments'))
    put(labels.milestones, t('milestones'))
    put(labels.related, t('related'))
    put(labels.materials, t('material'))
    put(card.querySelector('[data-role="results-hint"]'), t('missingSourceHint'))
    put(card.querySelector('[data-role="milestone-hint"]'), t('milestoneHint'))
    put(card.querySelector('[data-action="close"]'), t('close'))
    put(card.querySelector('[data-action="add-chapter"]'), t('addChapter'))
    put(card.querySelector('[data-action="add-result"]'), t('addResult'))
    put(card.querySelector('[data-action="add-experiment"]'), t('addExperiment'))
    put(card.querySelector('[data-action="add-milestone"]'), t('addMilestone'))
    put(card.querySelector('[data-action="add-action"]'), t('addAction'))
    put(card.querySelector('[data-action="add-material"]'), t('addMaterial'))
    put(nodes.saveButton, t('save'))
    put(nodes.archiveAction, t('archive'))
    put(nodes.restoreAction, t('restore'))
    put(nodes.trashAction, t('trashAction'))
    nodes.materialUrl.setAttribute('placeholder', t('materialUrl'))
    nodes.materialTitle.setAttribute('placeholder', t('materialTitle'))
    if (nodes.actionSelect !== null) nodes.actionSelect.setAttribute('aria-label', t('related'))
    put(nodes.confirm.querySelector('[data-action="confirm-keep"]'), t('keepEditing'))
    put(nodes.confirm.querySelector('[data-action="confirm-close"]'), t('closeKeepDraft'))
    put(nodes.conflict.querySelector('[data-action="conflict-keep"]'), t('keepEditing'))
    put(nodes.conflict.querySelector('[data-action="conflict-reload"]'), t('loadLatest'))
  }

  function countLine(lineRows) {
    if (nodes.count === null) return
    var line = lineRows.length === 0 ? '' : (isZh() ? String(lineRows.length) + ' 条' : String(lineRows.length))
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
  }

  function renderData(data) {
    var records = data !== null && typeof data === 'object' && Array.isArray(data.records) ? data.records : []
    app.lastData = data !== null && typeof data === 'object' ? data : null
    app.quota = data !== null && typeof data === 'object' && data.quota !== null && typeof data.quota === 'object' ? data.quota : null
    app.total = data !== null && typeof data === 'object' && typeof data.total === 'number' ? data.total : records.length
    app.truncated = data !== null && typeof data === 'object' && data.truncated === true
    app.rows = pure.viewRows(records, ui.view)
    var buttons = []
    for (var index = 0; index < app.rows.length; index += 1) buttons.push(view.rowOf(app.rows[index], text))
    if (nodes.list !== null) {
      nodes.list.replaceChildren.apply(nodes.list, buttons)
      nodes.list.hidden = buttons.length === 0
    }
    countLine(app.rows)
    if (buttons.length === 0) {
      setNote(ui.search !== ''
        ? t('emptySearch')
        : ui.view === 'archived'
          ? t('emptyArchived')
          : ui.view === 'trash'
            ? t('emptyTrash')
            : t('emptyActive'))
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
    if (ui.view === 'active' && ui.search === '' && app.lastData !== null) {
      renderData(app.lastData)
      return
    }
    var query = { kind: KIND }
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

  var editor = root.createThesisEditor({
    card: card,
    widget: widget,
    live: live,
    nodes: nodes,
    ui: ui,
    app: app,
    rows: rows,
    t: t,
    pure: pure,
    view: view,
    setStatus: setStatus,
    persist: persist,
    refreshList: function () { refreshList() }
  })

  function renderSample() {
    applyLabels()
    var sample = view.sampleRows()
    app.rows = sample
    var buttons = []
    for (var at = 0; at < sample.length; at += 1) buttons.push(view.rowOf(sample[at], text))
    if (nodes.list !== null) {
      nodes.list.replaceChildren.apply(nodes.list, buttons)
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
      var row = target.closest('.ts__row')
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
  card.querySelector('[data-action="add-chapter"]').addEventListener('click', function () { rows.add('chapters') })
  card.querySelector('[data-action="add-result"]').addEventListener('click', function () { rows.add('results') })
  card.querySelector('[data-action="add-experiment"]').addEventListener('click', function () { rows.add('experiments') })
  card.querySelector('[data-action="add-milestone"]').addEventListener('click', function () { rows.add('milestones') })
  card.querySelector('[data-action="add-action"]').addEventListener('click', function () { editor.addRelated() })
  card.querySelector('[data-action="add-material"]').addEventListener('click', function () { editor.addMaterial() })
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
  nodes.titleInput.addEventListener('input', function () { editor.onInput() })
  nodes.question.addEventListener('input', function () { editor.onInput() })

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
        if (ui.view === 'active' && ui.search === '') {
          renderData(data)
        } else {
          app.lastData = data
          refreshList()
        }
      })
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
