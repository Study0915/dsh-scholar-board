/*
 * 课题卡的主脚本：列表、范围与搜索、详情打开关闭与事件接线（S11）。
 *
 * 列表来自数据源 `widget-board:records`，任一课题变化时宿主重推；搜索与归档、回收站视图走
 * `records.read`，这样条数与错误都按查询来。详情与保存面板在 editor.js：输入防抖后存草稿，
 * 保存走 `records.write` 并带 expectedRevision，失败保留输入，冲突给出载入最新或继续编辑。
 * 问题里引用的行动项单独按 id 读回，只用来显示状态，不影响问题自己的状态。
 *
 * 判定在 topic-model.js，文案在 copy.js，画面零件在 view.js；这一份只管列表与接线。
 */
;(function (root) {
  'use strict'

  var copy = root.TopicRecordsCopy
  var view = root.TopicRecordsView
  var pure = root.TopicRecords

  /* 没有 DOM 的环境（单元测试）只载入判定那一份。 */
  if (typeof document === 'undefined') return

  var card = document.querySelector('.tp')
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
    noteWrap: card.querySelector('.tp__note-wrap'),
    retry: card.querySelector('[data-action="retry"]'),
    newButton: card.querySelector('[data-action="new"]'),
    tabs: card.querySelectorAll('.tp__tab'),
    detail: card.querySelector('[data-role="detail"]'),
    detailState: card.querySelector('[data-role="detail-state"]'),
    detailHint: card.querySelector('[data-role="detail-hint"]'),
    materials: card.querySelector('[data-role="materials"]'),
    materialError: card.querySelector('[data-role="material-error"]'),
    questions: card.querySelector('[data-role="questions"]'),
    questionError: card.querySelector('[data-role="question-error"]'),
    titleInput: card.querySelector('[data-field="title-input"]'),
    question: card.querySelector('[data-field="question"]'),
    goal: card.querySelector('[data-field="goal"]'),
    hypothesis: card.querySelector('[data-field="hypothesis"]'),
    judgment: card.querySelector('[data-field="judgment"]'),
    nextStep: card.querySelector('[data-field="next-step"]'),
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
    goal: card.querySelector('[data-role="label-goal"]'),
    hypothesis: card.querySelector('[data-role="label-hypothesis"]'),
    judgment: card.querySelector('[data-role="label-judgment"]'),
    nextStep: card.querySelector('[data-role="label-next-step"]'),
    questions: card.querySelector('[data-role="label-questions"]'),
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
    questions: [],
    materials: [],
    actions: {},
    dirty: false,
    saving: false,
    converting: false,
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
    put(labels.title, t('fieldTitle'))
    put(labels.question, t('question'))
    put(labels.goal, t('goal'))
    put(labels.hypothesis, t('hypothesis'))
    put(labels.judgment, t('judgment'))
    put(labels.nextStep, t('nextStep'))
    put(labels.questions, t('questions'))
    put(labels.materials, t('material'))
    put(card.querySelector('[data-role="question-hint"]'), t('questionHint'))
    put(card.querySelector('[data-role="action-hint"]'), t('questionActionHint'))
    put(card.querySelector('[data-action="close"]'), t('close'))
    put(card.querySelector('[data-action="add-material"]'), t('addMaterial'))
    put(card.querySelector('[data-action="add-question"]'), t('addQuestion'))
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
  }

  function messageOf(error) {
    return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
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

  /** 一次读回当前问题引用到的行动项，分页直到读完；只用于显示状态。 */
  function readActions(ids, offset, acc) {
    var query = { ids: ids, includeArchived: true, includeTrashed: true }
    if (offset !== undefined) query.offset = offset
    return widget.call(READ, query).then(function (data) {
      if (data !== null && typeof data === 'object' && Array.isArray(data.records)) {
        for (var at = 0; at < data.records.length; at += 1) acc.push(data.records[at])
      }
      var next = data !== null && typeof data === 'object' ? data.nextOffset : undefined
      if (typeof next === 'number' && next > (offset === undefined ? 0 : offset)) return readActions(ids, next, acc)
      return acc
    })
  }

  function refreshActions() {
    if (!live) return
    var ids = editor.actionIds()
    if (ids.length === 0) {
      editor.setActions({})
      return
    }
    readActions(ids, undefined, []).then(function (records) {
      var map = {}
      for (var at = 0; at < records.length; at += 1) {
        if (records[at] !== null && typeof records[at] === 'object' && typeof records[at].id === 'string') map[records[at].id] = records[at]
      }
      editor.setActions(map)
    }, function () {
      // 读不到行动项时保留上一次的状态，问题条目本身不受影响。
    })
  }

  var editor = root.createTopicEditor({
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
    refreshList: function () { refreshList() },
    refreshActions: function () { refreshActions() }
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
      var row = target.closest('.tp__row')
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
  card.querySelector('[data-action="add-question"]').addEventListener('click', function () { editor.addQuestion() })
  if (nodes.questions !== null) {
    nodes.questions.addEventListener('input', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      if (!target.classList.contains('tp__question-text')) return
      var row = target.closest('.tp__question')
      if (row === null) return
      editor.updateQuestionText(row.getAttribute('data-question-id'), target.value)
    })
    nodes.questions.addEventListener('change', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      if (!target.classList.contains('tp__question-status')) return
      var row = target.closest('.tp__question')
      if (row === null) return
      editor.updateQuestionStatus(row.getAttribute('data-question-id'), target.value)
    })
    nodes.questions.addEventListener('click', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var button = target.closest('.tp__question-action')
      if (button !== null) {
        if (button.getAttribute('data-action') === 'open-action') editor.openAction(button.getAttribute('data-action-id'))
        else editor.convertQuestion(button.getAttribute('data-question-id'))
        return
      }
      var remove = target.closest('.tp__question-remove')
      if (remove !== null) editor.removeQuestion(remove.getAttribute('data-question-id'))
    })
  }
  if (nodes.materials !== null) {
    nodes.materials.addEventListener('click', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var open = target.closest('.tp__material-open')
      if (open !== null && typeof open.dataset.url === 'string' && live && typeof widget.open === 'function') {
        widget.open(open.dataset.url)
        return
      }
      var remove = target.closest('.tp__material-remove')
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
  var inputs = [nodes.titleInput, nodes.question, nodes.goal, nodes.hypothesis, nodes.judgment, nodes.nextStep]
  for (var inputAt = 0; inputAt < inputs.length; inputAt += 1) inputs[inputAt].addEventListener('input', function () { editor.onInput() })

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
