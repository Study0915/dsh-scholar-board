/*
 * 课程卡的主脚本：列表、学期分组、近期事项、范围、搜索、详情打开关闭与事件接线（D36）。
 *
 * 列表来自数据源 `widget-board:records`，任一记录变化时宿主重推；搜索、归档与回收站视图走
 * `records.read`。详情与保存面板在 editor.js：输入防抖后存草稿，保存走 `records.write` 并带
 * expectedRevision，失败保留输入，冲突给出载入最新或继续编辑。
 *
 * 判定在 course-model.js，文案在 copy.js，画面零件在 view.js，几组行在 rows.js；这一份只管列表与接线。
 */
;(function (root) {
  'use strict'

  var copy = root.CourseRecordsCopy
  var view = root.CourseRecordsView
  var pure = root.CourseRecords

  /* 没有 DOM 的环境（单元测试）只载入判定那一份。 */
  if (typeof document === 'undefined') return

  var card = document.querySelector('.cs')
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
    recent: card.querySelector('[data-role="recent"]'),
    recentLabel: card.querySelector('[data-role="recent-label"]'),
    recentMore: card.querySelector('[data-role="recent-more"]'),
    recentList: card.querySelector('[data-role="recent-list"]'),
    list: card.querySelector('[data-role="list"]'),
    note: card.querySelector('[data-role="note"]'),
    noteWrap: card.querySelector('.cs__note-wrap'),
    retry: card.querySelector('[data-action="retry"]'),
    newButton: card.querySelector('[data-action="new"]'),
    tabs: card.querySelectorAll('.cs__tab'),
    detail: card.querySelector('[data-role="detail"]'),
    detailState: card.querySelector('[data-role="detail-state"]'),
    detailHint: card.querySelector('[data-role="detail-hint"]'),
    work: card.querySelector('[data-role="work"]'),
    related: card.querySelector('[data-role="related"]'),
    relatedSelect: card.querySelector('[data-role="related-select"]'),
    rowsError: card.querySelector('[data-role="rows-error"]'),
    materials: card.querySelector('[data-role="materials"]'),
    materialError: card.querySelector('[data-role="material-error"]'),
    titleInput: card.querySelector('[data-field="title-input"]'),
    termLabel: card.querySelector('[data-field="term-label"]'),
    termStart: card.querySelector('[data-field="term-start"]'),
    termEnd: card.querySelector('[data-field="term-end"]'),
    code: card.querySelector('[data-field="code"]'),
    teacher: card.querySelector('[data-field="teacher"]'),
    schedule: card.querySelector('[data-field="schedule"]'),
    notes: card.querySelector('[data-field="notes"]'),
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
    term: card.querySelector('[data-role="label-term"]'),
    termStart: card.querySelector('[data-role="label-term-start"]'),
    termEnd: card.querySelector('[data-role="label-term-end"]'),
    code: card.querySelector('[data-role="label-code"]'),
    teacher: card.querySelector('[data-role="label-teacher"]'),
    schedule: card.querySelector('[data-role="label-schedule"]'),
    notes: card.querySelector('[data-role="label-notes"]'),
    work: card.querySelector('[data-role="label-work"]'),
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
    work: [],
    related: [],
    materials: [],
    records: [],
    dirty: false,
    saving: false,
    editing: false,
    lastData: null,
    restoreOpen: ui.openId !== null,
    triggerId: null
  }
  var loadTimer = null

  var rows = root.createCourseRows({
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
    if (nodes.recent !== null) nodes.recent.setAttribute('aria-label', t('recent'))
    put(nodes.newButton, t('new'))
    nodes.search.setAttribute('placeholder', t('search'))
    nodes.search.setAttribute('aria-label', t('search'))
    for (var at = 0; at < nodes.tabs.length; at += 1) put(nodes.tabs[at], t(nodes.tabs[at].getAttribute('data-view')))
    put(nodes.retry, t('retry'))
    put(nodes.recentLabel, t('recent'))
    put(labels.title, t('fieldTitle'))
    put(labels.term, t('term'))
    put(labels.termStart, t('termStart'))
    put(labels.termEnd, t('termEnd'))
    put(labels.code, t('code'))
    put(labels.teacher, t('teacher'))
    put(labels.schedule, t('schedule'))
    put(labels.notes, t('notes'))
    put(labels.work, t('work'))
    put(labels.related, t('related'))
    put(labels.materials, t('material'))
    put(card.querySelector('[data-action="close"]'), t('close'))
    put(card.querySelector('[data-action="add-work"]'), t('addWork'))
    put(card.querySelector('[data-action="add-related"]'), t('addRelated'))
    put(card.querySelector('[data-action="add-material"]'), t('addMaterial'))
    put(nodes.saveButton, t('save'))
    put(nodes.archiveAction, t('archive'))
    put(nodes.restoreAction, t('restore'))
    put(nodes.trashAction, t('trashAction'))
    nodes.termLabel.setAttribute('placeholder', t('termLabel'))
    nodes.termLabel.setAttribute('aria-label', t('termLabel'))
    nodes.materialUrl.setAttribute('placeholder', t('materialUrl'))
    nodes.materialTitle.setAttribute('placeholder', t('materialTitle'))
    if (nodes.relatedSelect !== null) nodes.relatedSelect.setAttribute('aria-label', t('related'))
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

  /** 活跃视图按学期分组，其它视图是一串平铺的行。 */
  function listNodes() {
    if (ui.view !== 'active') {
      var flat = []
      for (var at = 0; at < app.rows.length; at += 1) flat.push(view.rowOf(app.rows[at], text))
      return flat
    }
    var nodesOut = []
    var groups = pure.termGroups(app.rows)
    for (var groupAt = 0; groupAt < groups.length; groupAt += 1) {
      nodesOut.push(view.groupHead(groups[groupAt], text))
      for (var rowAt = 0; rowAt < groups[groupAt].records.length; rowAt += 1) {
        nodesOut.push(view.rowOf(groups[groupAt].records[rowAt], text))
      }
    }
    return nodesOut
  }

  /** 近期事项只在活跃视图且没有搜索时出现。 */
  function renderRecent(records) {
    if (nodes.recent === null || nodes.recentList === null) return
    if (ui.view !== 'active' || ui.search !== '') {
      nodes.recent.hidden = true
      nodes.recentList.replaceChildren()
      return
    }
    var recent = pure.recentWork(records, Date.now(), pure.RECENT_LIMIT)
    if (recent.rows.length === 0) {
      nodes.recent.hidden = true
      nodes.recentList.replaceChildren()
      return
    }
    var items = []
    for (var at = 0; at < recent.rows.length; at += 1) items.push(view.recentRow(recent.rows[at], text))
    nodes.recentList.replaceChildren.apply(nodes.recentList, items)
    nodes.recent.hidden = false
    put(nodes.recentMore, recent.total > recent.rows.length ? pure.fill(t('recentMore'), { n: recent.total - recent.rows.length }) : '')
  }

  function renderData(data) {
    var records = data !== null && typeof data === 'object' && Array.isArray(data.records) ? data.records : []
    app.lastData = data !== null && typeof data === 'object' ? data : null
    app.quota = data !== null && typeof data === 'object' && data.quota !== null && typeof data.quota === 'object' ? data.quota : null
    app.total = data !== null && typeof data === 'object' && typeof data.total === 'number' ? data.total : records.length
    app.truncated = data !== null && typeof data === 'object' && data.truncated === true
    app.rows = pure.viewRows(records, ui.view)
    var buttons = listNodes()
    if (nodes.list !== null) {
      nodes.list.replaceChildren.apply(nodes.list, buttons)
      nodes.list.hidden = buttons.length === 0
    }
    renderRecent(records)
    countLine(app.rows)
    if (app.rows.length === 0) {
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

  var editor = root.createCourseEditor({
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
    var buttons = listNodes()
    if (nodes.list !== null) {
      nodes.list.replaceChildren.apply(nodes.list, buttons)
      nodes.list.hidden = false
    }
    if (nodes.recent !== null) nodes.recent.hidden = true
    setNote('')
    put(nodes.count, isZh() ? '3 条' : '3')
    card.dataset.state = 'ready'
    nodes.newButton.disabled = true
    nodes.search.disabled = true
  }

  function openCourse(id) {
    for (var at = 0; at < app.rows.length; at += 1) {
      if (app.rows[at].id === id) {
        app.triggerId = id
        editor.openRecord(app.rows[at])
        return
      }
    }
    for (var index = 0; index < (app.lastData !== null && Array.isArray(app.lastData.records) ? app.lastData.records.length : 0); index += 1) {
      var record = app.lastData.records[index]
      if (record !== null && typeof record === 'object' && record.id === id) {
        app.triggerId = id
        editor.openRecord(record)
        return
      }
    }
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
      var row = target.closest('.cs__row')
      if (row === null) return
      var id = row.getAttribute('data-id')
      if (typeof id === 'string') openCourse(id)
    })
  }
  if (nodes.recentList !== null) {
    nodes.recentList.addEventListener('click', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var row = target.closest('.cs__recent-row')
      if (row === null) return
      var id = row.getAttribute('data-id')
      if (typeof id === 'string') openCourse(id)
    })
  }
  card.querySelector('[data-action="back"]').addEventListener('click', function () { editor.closeDetail(false) })
  card.querySelector('[data-action="close"]').addEventListener('click', function () { editor.closeDetail(false) })
  nodes.saveButton.addEventListener('click', function () { editor.save() })
  nodes.archiveAction.addEventListener('click', function () { editor.lifeOp('archive') })
  nodes.restoreAction.addEventListener('click', function () { editor.lifeOp('restore') })
  nodes.trashAction.addEventListener('click', function () { editor.lifeOp('trash') })
  card.querySelector('[data-action="add-work"]').addEventListener('click', function () { rows.addWork() })
  card.querySelector('[data-action="add-related"]').addEventListener('click', function () { editor.addRelated() })
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
  var formFields = [nodes.titleInput, nodes.termLabel, nodes.termStart, nodes.termEnd, nodes.code, nodes.teacher, nodes.schedule, nodes.notes]
  for (var fieldAt = 0; fieldAt < formFields.length; fieldAt += 1) {
    if (formFields[fieldAt] === null) continue
    formFields[fieldAt].addEventListener('input', function () { editor.onInput() })
    formFields[fieldAt].addEventListener('change', function () { editor.onInput() })
  }

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
