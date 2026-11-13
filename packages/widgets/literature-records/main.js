/*
 * 文献阅读卡的主脚本：列表、范围、阅读阶段与搜索、详情打开关闭与事件接线（D36）。
 *
 * 列表来自数据源 `widget-board:records`，任一记录变化时宿主重推；搜索、阅读阶段筛选、归档与回收站
 * 视图走 `records.read`，这样条数与错误都按查询来。详情与保存面板在 editor.js：输入防抖后存草稿，
 * 保存走 `records.write` 并带 expectedRevision，失败保留输入，冲突给出载入最新或继续编辑。
 *
 * 判定在 records-model.js，文案在 copy.js，画面零件在 view.js；这一份只管列表与接线。
 */
;(function (root) {
  'use strict'

  var copy = root.LiteratureRecordsCopy
  var view = root.LiteratureRecordsView
  var pure = root.LiteratureRecords

  /* 没有 DOM 的环境（单元测试）只载入判定那一份。 */
  if (typeof document === 'undefined') return

  var card = document.querySelector('.lt')
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
    stage: card.querySelector('[data-role="stage"]'),
    list: card.querySelector('[data-role="list"]'),
    note: card.querySelector('[data-role="note"]'),
    noteWrap: card.querySelector('.lt__note-wrap'),
    retry: card.querySelector('[data-action="retry"]'),
    newButton: card.querySelector('[data-action="new"]'),
    tabs: card.querySelectorAll('.lt__tab'),
    detail: card.querySelector('[data-role="detail"]'),
    detailState: card.querySelector('[data-role="detail-state"]'),
    detailHint: card.querySelector('[data-role="detail-hint"]'),
    materials: card.querySelector('[data-role="materials"]'),
    materialError: card.querySelector('[data-role="material-error"]'),
    urlError: card.querySelector('[data-role="url-error"]'),
    titleInput: card.querySelector('[data-field="title-input"]'),
    authorsInput: card.querySelector('[data-field="authors-input"]'),
    venueInput: card.querySelector('[data-field="venue-input"]'),
    yearInput: card.querySelector('[data-field="year-input"]'),
    stageInput: card.querySelector('[data-field="stage-input"]'),
    urlInput: card.querySelector('[data-field="url-input"]'),
    understanding: card.querySelector('[data-field="understanding"]'),
    questions: card.querySelector('[data-field="questions"]'),
    materialUrl: card.querySelector('[data-field="material-url"]'),
    materialTitle: card.querySelector('[data-field="material-title"]'),
    openSource: card.querySelector('[data-action="open-source"]'),
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
    authors: card.querySelector('[data-role="label-authors"]'),
    venue: card.querySelector('[data-role="label-venue"]'),
    year: card.querySelector('[data-role="label-year"]'),
    stage: card.querySelector('[data-role="label-stage"]'),
    url: card.querySelector('[data-role="label-url"]'),
    understanding: card.querySelector('[data-role="label-understanding"]'),
    questions: card.querySelector('[data-role="label-questions"]'),
    materials: card.querySelector('[data-role="label-materials"]')
  }

  var live = widget !== undefined && typeof widget.call === 'function'
  var saved = widget !== undefined && widget.state !== null && typeof widget.state === 'object' ? widget.state : {}
  var ui = {
    view: saved.view === 'archived' || saved.view === 'trash' ? saved.view : 'active',
    stage: pure.STAGES.indexOf(saved.stage) >= 0 ? saved.stage : '',
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

  function setStageOptions(select, allText) {
    if (select === null) return
    var options = select.querySelectorAll('option')
    for (var at = 0; at < options.length; at += 1) {
      var value = options[at].getAttribute('value')
      if (value === null || value === '') {
        put(options[at], allText)
        continue
      }
      if (pure.STAGES.indexOf(value) >= 0) put(options[at], t(pure.stageKey(value)))
    }
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
    for (var at = 0; at < nodes.tabs.length; at += 1) {
      put(nodes.tabs[at], t(nodes.tabs[at].getAttribute('data-view')))
    }
    put(nodes.retry, t('retry'))
    setStageOptions(nodes.stage, t('stageAll'))
    setStageOptions(nodes.stageInput, t('stageAll'))
    if (nodes.stage !== null) nodes.stage.setAttribute('aria-label', t('stage'))
    put(labels.title, t('fieldTitle'))
    put(labels.authors, t('authors'))
    put(labels.venue, t('venue'))
    put(labels.year, t('year'))
    put(labels.stage, t('stage'))
    put(labels.url, t('sourceUrl'))
    put(labels.understanding, t('understanding'))
    put(labels.questions, t('questions'))
    put(labels.materials, t('material'))
    put(card.querySelector('.lt__understanding-hint'), t('understandingHint'))
    put(nodes.openSource, t('openSource'))
    put(card.querySelector('[data-action="close"]'), t('close'))
    put(card.querySelector('[data-action="add-material"]'), t('addMaterial'))
    put(nodes.saveButton, t('save'))
    put(nodes.archiveAction, t('archive'))
    put(nodes.restoreAction, t('restore'))
    put(nodes.trashAction, t('trashAction'))
    nodes.materialUrl.setAttribute('placeholder', t('materialUrl'))
    nodes.materialTitle.setAttribute('placeholder', t('materialTitle'))
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
    if (nodes.stage !== null) {
      nodes.stage.value = ui.stage
      nodes.stage.disabled = ui.view !== 'active'
    }
  }

  function renderData(data) {
    var records = data !== null && typeof data === 'object' && Array.isArray(data.records) ? data.records : []
    app.lastData = data !== null && typeof data === 'object' ? data : null
    app.quota = data !== null && typeof data === 'object' && data.quota !== null && typeof data.quota === 'object' ? data.quota : null
    app.total = data !== null && typeof data === 'object' && typeof data.total === 'number' ? data.total : records.length
    app.truncated = data !== null && typeof data === 'object' && data.truncated === true
    app.rows = pure.viewRows(records, ui.view, ui.stage)
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
            : ui.stage !== ''
              ? t('emptyStage')
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

  var editor = root.createLiteratureEditor({
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

  function renderSample() {
    applyLabels()
    var rows = view.sampleRows()
    app.rows = rows
    var buttons = []
    for (var at = 0; at < rows.length; at += 1) buttons.push(view.rowOf(rows[at], text))
    if (nodes.list !== null) {
      nodes.list.replaceChildren.apply(nodes.list, buttons)
      nodes.list.hidden = false
    }
    setNote('')
    put(nodes.count, isZh() ? '3 条' : '3')
    card.dataset.state = 'ready'
    nodes.newButton.disabled = true
    nodes.search.disabled = true
    if (nodes.stage !== null) nodes.stage.disabled = true
  }

  nodes.search.addEventListener('input', function () {
    ui.search = nodes.search.value.trim()
    refreshList()
  })
  if (nodes.stage !== null) {
    nodes.stage.addEventListener('change', function () {
      ui.stage = pure.STAGES.indexOf(nodes.stage.value) >= 0 ? nodes.stage.value : ''
      persist({ stage: ui.stage })
      if (app.lastData !== null && ui.view === 'active' && ui.search === '') renderData(app.lastData)
      else refreshList()
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
      var row = target.closest('.lt__row')
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
  nodes.openSource.addEventListener('click', function () { editor.openSource() })
  nodes.saveButton.addEventListener('click', function () { editor.save() })
  nodes.archiveAction.addEventListener('click', function () { editor.lifeOp('archive') })
  nodes.restoreAction.addEventListener('click', function () { editor.lifeOp('restore') })
  nodes.trashAction.addEventListener('click', function () { editor.lifeOp('trash') })
  card.querySelector('[data-action="add-material"]').addEventListener('click', function () { editor.addMaterial() })
  if (nodes.materials !== null) {
    nodes.materials.addEventListener('click', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var open = target.closest('.lt__material-open')
      if (open !== null && typeof open.dataset.url === 'string' && live && typeof widget.open === 'function') {
        widget.open(open.dataset.url)
        return
      }
      var remove = target.closest('.lt__material-remove')
      if (remove !== null) editor.removeMaterial(remove.getAttribute('data-material'))
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
  var inputs = [nodes.titleInput, nodes.authorsInput, nodes.venueInput, nodes.yearInput, nodes.urlInput, nodes.understanding, nodes.questions]
  for (var inputAt = 0; inputAt < inputs.length; inputAt += 1) inputs[inputAt].addEventListener('input', function () { editor.onInput() })
  nodes.stageInput.addEventListener('change', function () { editor.onInput() })

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
