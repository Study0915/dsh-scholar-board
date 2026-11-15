/*
 * 运行比较卡的主脚本：选运行、标角色、列口径与指标，确认后才算差值。
 *
 * 比较只读记录：`records.read` 取运行与方案标题，`records.open` 打开来源。差值判定都在
 * compare-model.js：单位、定义、统计方式不一致时不给差值，零基线不给相对变化，也不排名。
 */
;(function (root) {
  'use strict'

  var copy = root.RunComparisonCopy
  var pure = root.RunComparison

  /* 没有 DOM 的环境（单元测试）只载入判定那一份。 */
  if (typeof document === 'undefined') return

  var card = document.querySelector('.rc')
  if (card === null) return

  var widget = window.widget
  var READ = 'widget-board:records.read'
  var OPEN = 'widget-board:records.open'
  var ROLES = pure.ROLES

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

  function format(template, values) {
    var out = String(template)
    for (var key in values) {
      if (Object.prototype.hasOwnProperty.call(values, key)) out = out.replace('{' + key + '}', String(values[key]))
    }
    return out
  }

  var nodes = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    banner: card.querySelector('[data-role="banner"]'),
    choose: card.querySelector('[data-action="choose"]'),
    selectedWrap: card.querySelector('[data-role="selected-wrap"]'),
    selectedLabel: card.querySelector('[data-role="label-selected"]'),
    selected: card.querySelector('[data-role="selected"]'),
    selectedHint: card.querySelector('[data-role="selected-hint"]'),
    confirmWrap: card.querySelector('[data-role="confirm-wrap"]'),
    confirmLabel: card.querySelector('[data-role="label-confirm"]'),
    confirmText: card.querySelector('[data-role="label-confirm-text"]'),
    confirm: card.querySelector('[data-role="confirm"]'),
    directionLabel: card.querySelector('[data-role="label-direction"]'),
    direction: card.querySelector('[data-role="direction"]'),
    conditionsWrap: card.querySelector('[data-role="conditions-wrap"]'),
    conditionsLabel: card.querySelector('[data-role="label-conditions"]'),
    conditionsHint: card.querySelector('[data-role="conditions-hint"]'),
    conditionsHead: card.querySelector('[data-role="conditions-head"]'),
    conditionsBody: card.querySelector('[data-role="conditions-body"]'),
    metricsWrap: card.querySelector('[data-role="metrics-wrap"]'),
    metricsLabel: card.querySelector('[data-role="label-metrics"]'),
    metricsHint: card.querySelector('[data-role="metrics-hint"]'),
    metricsHead: card.querySelector('[data-role="metrics-head"]'),
    metricsBody: card.querySelector('[data-role="metrics-body"]'),
    metricsEmpty: card.querySelector('[data-role="metrics-empty"]'),
    empty: card.querySelector('[data-role="empty"]'),
    note: card.querySelector('[data-role="note"]'),
    noteWrap: card.querySelector('.rc__note-wrap'),
    retry: card.querySelector('[data-action="retry"]'),
    dialog: card.querySelector('[data-role="pick-dialog"]'),
    pickTitle: card.querySelector('[data-role="pick-title"]'),
    pickHint: card.querySelector('[data-role="pick-hint"]'),
    search: card.querySelector('[data-role="search"]'),
    pickSearch: card.querySelector('[data-action="pick-search"]'),
    candidates: card.querySelector('[data-role="candidates"]'),
    pickStatus: card.querySelector('[data-role="pick-status"]'),
    pickMore: card.querySelector('[data-action="pick-more"]'),
    pickDone: card.querySelector('[data-action="pick-done"]'),
    sr: card.querySelector('[data-role="sr"]')
  }

  var ui = { selection: [], direction: 'target-minus-baseline', confirmed: false }
  var app = {
    runs: {},
    plans: {},
    nextOffset: undefined,
    lastData: null,
    sample: false,
    hasRuns: false,
    loading: false,
    timer: null,
    query: 0
  }
  var loadTimer = null

  function persist(patch) {
    if (widget !== undefined && typeof widget.setState === 'function') widget.setState(patch)
  }

  function announce(message) {
    put(nodes.sr, message)
  }

  function setBanner(message) {
    if (nodes.banner === null) return
    put(nodes.banner, message === null || message === undefined ? '' : message)
    nodes.banner.hidden = message === null || message === undefined || message === ''
    announce(message || '')
  }

  function roleLabel(role) {
    return role === 'baseline' ? t('roleBaseline') : role === 'ablation' ? t('roleAblation') : t('roleOther')
  }

  function statusText(status) {
    return status === 'same' ? t('same') : status === 'different' ? t('different') : t('unknown')
  }

  function itemOf(id) {
    for (var at = 0; at < ui.selection.length; at += 1) {
      if (ui.selection[at].id === id) return ui.selection[at]
    }
    return null
  }

  function titleOf(run) {
    if (run === null || typeof run !== 'object') return ''
    return typeof run.title === 'string' ? run.title : ''
  }

  function runOf(id) {
    var run = app.runs[id]
    if (run === undefined) return { id: id, title: '', role: 'other', missing: true }
    return {
      id: id,
      title: titleOf(run),
      archived: run.archived === true,
      deletedAt: typeof run.deletedAt === 'string',
      role: itemOf(id) === null ? 'other' : itemOf(id).role
    }
  }

  function orderedRuns() {
    var records = []
    for (var at = 0; at < ui.selection.length; at += 1) {
      var item = ui.selection[at]
      var run = app.runs[item.id]
      if (run === undefined || run === null) {
        records.push({ id: item.id, title: '', role: item.role, missing: true })
        continue
      }
      var merged = {}
      for (var key in run) {
        if (Object.prototype.hasOwnProperty.call(run, key)) merged[key] = run[key]
      }
      merged.role = item.role
      records.push(merged)
    }
    return records
  }

  function readPage(query) {
    return widget.call(READ, query).then(function (value) {
      if (value === null || typeof value !== 'object' || !Array.isArray(value.records)) throw new Error('记录响应不完整')
      if (value.truncated && (!Number.isInteger(value.nextOffset) || value.nextOffset <= 0)) throw new Error('记录分页信息缺失')
      for (var at = 0; at < value.records.length; at += 1) {
        var record = value.records[at]
        if (record !== null && typeof record === 'object' && typeof record.id === 'string') app.runs[record.id] = record
      }
      return value
    })
  }

  function readAll(query) {
    function step(offset, pages) {
      var pageQuery = offset === undefined ? Object.assign({}, query) : Object.assign({}, query, { offset: offset })
      return readPage(pageQuery).then(function (page) {
        pages.push(page)
        if (page.nextOffset === undefined || pages.length >= 20) return pages
        return step(page.nextOffset, pages)
      })
    }
    return step(undefined, [])
  }

  function loadPlans() {
    var ids = []
    for (var at = 0; at < ui.selection.length; at += 1) {
      var run = app.runs[ui.selection[at].id]
      if (run === null || typeof run !== 'object' || run.plan === null || typeof run.plan !== 'object') continue
      if (typeof run.plan.id === 'string' && run.plan.id !== '' && ids.indexOf(run.plan.id) < 0) ids.push(run.plan.id)
    }
    if (ids.length === 0) return Promise.resolve()
    return readAll({ ids: ids, includeArchived: true }).then(function () {
      for (var page = 0; page < ids.length; page += 1) {
        var record = app.runs[ids[page]]
        if (record !== undefined && typeof record.title === 'string') app.plans[ids[page]] = record.title
      }
    })
  }

  function resetConfirm() {
    ui.confirmed = false
    if (nodes.confirm !== null) nodes.confirm.checked = false
  }

  function applyLabels() {
    var props = widget !== undefined && widget.props !== null && typeof widget.props === 'object' ? widget.props : {}
    var title = typeof props.title === 'string' && props.title.trim() !== '' ? props.title.trim() : t('title')
    var kicker = typeof props.kicker === 'string' ? props.kicker.trim() : t('kicker')
    put(nodes.title, title)
    put(nodes.kicker, kicker)
    if (nodes.kicker !== null) nodes.kicker.hidden = kicker === ''
    put(nodes.choose, t('choose'))
    put(nodes.retry, t('retry'))
    put(nodes.selectedLabel, t('selected'))
    put(nodes.selectedHint, t('hint'))
    put(nodes.confirmLabel, t('confirmTitle'))
    put(nodes.confirmText, t('confirmLabel'))
    put(nodes.directionLabel, t('direction'))
    put(nodes.conditionsLabel, t('conditions'))
    put(nodes.metricsLabel, t('metrics'))
    put(nodes.conditionsHint, t('conditionsHint'))
    put(nodes.metricsHint, t('metricsHint'))
    put(nodes.metricsEmpty, t('noMetrics'))
    put(nodes.empty, t('empty'))
    put(nodes.pickTitle, t('choose'))
    put(nodes.pickHint, t('selectHint'))
    put(nodes.pickMore, t('loadMore'))
    put(nodes.pickDone, t('done'))
    if (nodes.search !== null) {
      nodes.search.setAttribute('placeholder', t('search'))
      nodes.search.setAttribute('aria-label', t('searchLabel'))
    }
    if (nodes.pickSearch !== null) put(nodes.pickSearch, t('search'))
    if (nodes.direction !== null) {
      var options = nodes.direction.querySelectorAll('option')
      for (var at = 0; at < options.length; at += 1) {
        put(options[at], options[at].getAttribute('value') === 'baseline-minus-target' ? t('directionBaseline') : t('directionTarget'))
      }
      nodes.direction.value = pure.directionOf(ui.direction)
    }
    if (nodes.selectedLabel !== null) nodes.selectedLabel.textContent = format(t('selected'), { n: ui.selection.length })
  }

  function renderSelected() {
    if (nodes.selected === null) return
    nodes.selected.replaceChildren()
    if (nodes.selectedLabel !== null) nodes.selectedLabel.textContent = format(t('selected'), { n: ui.selection.length })
    if (nodes.selectedWrap !== null) nodes.selectedWrap.hidden = ui.selection.length === 0 || app.sample
    for (var at = 0; at < ui.selection.length; at += 1) {
      var item = ui.selection[at]
      var run = runOf(item.id)
      var row = document.createElement('li')
      row.className = 'rc__selected-row'
      var open = document.createElement('button')
      open.type = 'button'
      open.className = 'rc__run-title'
      var extra = run.missing ? ' · ' + t('missingRun') : run.deletedAt ? ' · ' + t('trashedRun') : run.archived ? ' · ' + t('archivedRun') : ''
      put(open, (titleOf(run) || item.id) + extra)
      ;(function (id, missing) {
        if (!missing) open.addEventListener('click', function () {
          widget.call(OPEN, { kind: 'run', id: id }).catch(function () {})
        })
      })(item.id, run.missing === true)
      var role = document.createElement('select')
      role.className = 'rc__role'
      role.setAttribute('aria-label', t('roleLabel'))
      for (var index = 0; index < ROLES.length; index += 1) {
        var option = document.createElement('option')
        option.value = ROLES[index]
        option.textContent = roleLabel(ROLES[index])
        role.append(option)
      }
      role.value = item.role
      ;(function (id) {
        role.addEventListener('change', function () {
          ui.selection = pure.selectionWithRole(ui.selection, id, role.value)
          persist({ selection: ui.selection })
          resetConfirm()
          renderSelected()
          renderTables()
        })
      })(item.id)
      var remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'rc__ghost rc__remove'
      put(remove, t('remove'))
      ;(function (id) {
        remove.addEventListener('click', function () {
          ui.selection = ui.selection.filter(function (entry) { return entry.id !== id })
          persist({ selection: ui.selection })
          resetConfirm()
          renderSelected()
          renderTables()
        })
      })(item.id)
      row.append(open, role, remove)
      nodes.selected.append(row)
    }
    if (nodes.selectedHint !== null) nodes.selectedHint.hidden = ui.selection.length === 0 || app.sample
  }

  function cellFor(cell, run) {
    if (run !== undefined && run.missing === true) return t('sourceMissing')
    if (cell === null || cell.text === null) return cell !== null && cell.missing === true ? t('sourceMissing') : t('unknownValue')
    return cell.unknown === true ? cell.text + ' · ' + t('unknownValue') : cell.text
  }

  function headCell(text, role) {
    var th = document.createElement('th')
    th.scope = 'col'
    var title = document.createElement('span')
    title.textContent = text
    th.append(title)
    if (role !== undefined) {
      var badge = document.createElement('span')
      badge.className = 'rc__badge'
      badge.dataset.role = role
      badge.textContent = roleLabel(role)
      th.append(badge)
    }
    return th
  }

  function headRow(runs, withDelta) {
    var row = document.createElement('tr')
    row.append(headCell(t('conditions')))
    for (var at = 0; at < runs.length; at += 1) row.append(headCell(titleOf(runs[at]) || runs[at].id, runs[at].role))
    if (withDelta) row.append(headCell(t('delta')))
    return row
  }

  function renderConditions(runs, rows) {
    if (nodes.conditionsHead === null || nodes.conditionsBody === null) return
    nodes.conditionsHead.replaceChildren(headRow(runs, false))
    nodes.conditionsBody.replaceChildren()
    for (var at = 0; at < rows.length; at += 1) {
      var row = document.createElement('tr')
      row.dataset.status = rows[at].status
      var label = document.createElement('th')
      label.scope = 'row'
      label.textContent = t('dim' + rows[at].id.charAt(0).toUpperCase() + rows[at].id.slice(1))
      var state = document.createElement('span')
      state.className = 'rc__state'
      state.dataset.status = rows[at].status
      state.textContent = statusText(rows[at].status)
      label.append(state)
      row.append(label)
      for (var cellAt = 0; cellAt < rows[at].cells.length; cellAt += 1) {
        var td = document.createElement('td')
        td.textContent = cellFor(rows[at].cells[cellAt], runs[cellAt])
        if (rows[at].cells[cellAt].text === null) td.dataset.tone = 'muted'
        row.append(td)
      }
      nodes.conditionsBody.append(row)
    }
    var differences = pure.differencesOf(rows).length
    var unknowns = pure.unknownsOf(rows).length
    if (nodes.conditionsHint !== null) {
      put(nodes.conditionsHint, t('conditionsHint') + ' · ' + format(t('different') + ' {d} · ' + t('unknown') + ' {u}', { d: differences, u: unknowns }))
    }
  }

  function targetRuns(runs) {
    var targets = []
    for (var at = 0; at < runs.length; at += 1) if (runs[at].role !== 'baseline') targets.push(runs[at])
    return targets
  }

  function baselineOf(runs) {
    for (var at = 0; at < runs.length; at += 1) if (runs[at].role === 'baseline') return runs[at]
    return null
  }

  function deltaReasonText(reason) {
    if (reason === 'unconfirmed') return t('deltaUnconfirmed')
    if (reason === 'no-baseline') return t('deltaNoBaseline')
    if (reason === 'unit') return t('deltaUnit')
    if (reason === 'definition') return t('deltaDefinition')
    if (reason === 'missing') return t('deltaMissing')
    if (reason === 'text') return t('deltaText')
    if (reason === 'value') return t('deltaText')
    if (reason === 'aggregate') return t('deltaAggregate')
    if (reason === 'statistics') return t('deltaStatistics')
    return t('unknown')
  }

  function deltaCell(row, baseline, target) {
    var td = document.createElement('td')
    td.className = 'rc__delta'
    var delta = pure.deltaOf(row, baseline, target, { confirmed: ui.confirmed, direction: ui.direction })
    if (delta.ok !== true) {
      td.textContent = deltaReasonText(delta.reason)
      td.dataset.tone = 'muted'
      return td
    }
    var sign = delta.difference > 0 ? '+' : ''
    var line = t('differenceValue').replace('{value}', sign + pure.numberText(delta.difference)).replace('{unit}', delta.unit)
    var text = document.createElement('span')
    td.append(text)
    put(text, line)
    var relative = document.createElement('span')
    relative.className = 'rc__relative'
    if (delta.relative === null) put(relative, t('zeroBaseline'))
    else put(relative, format(t('relative'), { value: pure.percentText(delta.relative) }))
    td.append(relative)
    return td
  }

  function renderMetrics(runs, rows) {
    if (nodes.metricsHead === null || nodes.metricsBody === null) return
    var baseline = baselineOf(runs)
    var targets = targetRuns(runs)
    var head = document.createElement('tr')
    head.append(headCell(t('metrics')))
    for (var at = 0; at < runs.length; at += 1) head.append(headCell(titleOf(runs[at]) || runs[at].id, runs[at].role))
    for (var targetAt = 0; targetAt < targets.length; targetAt += 1) {
      if (baseline === null) continue
      head.append(headCell(t('delta') + ' · ' + (titleOf(targets[targetAt]) || targets[targetAt].id)))
    }
    nodes.metricsHead.replaceChildren(head)
    nodes.metricsBody.replaceChildren()
    for (var rowAt = 0; rowAt < rows.length; rowAt += 1) {
      var row = document.createElement('tr')
      row.dataset.status = rows[rowAt].status
      var name = document.createElement('th')
      name.scope = 'row'
      name.textContent = rows[rowAt].name
      var state = document.createElement('span')
      state.className = 'rc__state'
      state.dataset.status = rows[rowAt].status
      state.textContent = rows[rowAt].status === 'comparable' ? t('comparable') : rows[rowAt].status === 'text' ? t('textValue') : statusText(rows[rowAt].status)
      name.append(state)
      row.append(name)
      for (var cellAt = 0; cellAt < rows[rowAt].cells.length; cellAt += 1) {
        var cell = rows[rowAt].cells[cellAt]
        var td = document.createElement('td')
        if (cell.missing === true) {
          td.textContent = runs[cellAt].missing === true ? t('sourceMissing') : t('notRecorded')
          td.dataset.tone = 'muted'
        } else {
          td.textContent = cell.value + (cell.unit === '' ? '' : ' ' + cell.unit)
          if (cell.definition !== '') td.title = cell.definition
        }
        row.append(td)
      }
      if (baseline !== null) {
        for (var deltaAt = 0; deltaAt < targets.length; deltaAt += 1) row.append(deltaCell(rows[rowAt], baseline, targets[deltaAt]))
      }
      nodes.metricsBody.append(row)
    }
    if (nodes.metricsEmpty !== null) nodes.metricsEmpty.hidden = rows.length > 0
  }

  function renderTables() {
    var runs = orderedRuns()
    var ready = runs.length >= 2
    if (nodes.confirmWrap !== null) nodes.confirmWrap.hidden = !ready || app.sample
    if (nodes.conditionsWrap !== null) nodes.conditionsWrap.hidden = !ready
    if (nodes.metricsWrap !== null) nodes.metricsWrap.hidden = !ready
    if (!ready) {
      if (nodes.metricsEmpty !== null) nodes.metricsEmpty.hidden = true
      if (ui.selection.length === 1) setBanner(t('hint'))
      return
    }
    var baseline = baselineOf(runs)
    if (baseline === null) setBanner(t('needBaseline'))
    else if (app.sample) setBanner(t('sampleNote'))
    else setBanner(ui.confirmed ? '' : t('hint'))
    var conditions = pure.conditionRows(runs, app.plans)
    renderConditions(runs, conditions)
    renderMetrics(runs, pure.metricRows(runs))
  }

  function renderSample() {
    app.sample = true
    ui.confirmed = true
    ui.selection = [
      { id: 'sample-baseline', role: 'baseline' },
      { id: 'sample-ablation', role: 'ablation' }
    ]
    app.runs = {
      'sample-baseline': {
        id: 'sample-baseline',
        kind: 'run',
        title: t('sampleBaseline'),
        plan: { kind: 'research', id: 'sample-plan' },
        status: 'succeeded',
        code: { repository: 'https://example.com/sim', commit: 'a1b2c3d' },
        datasets: [{ id: 'd1', name: '合成信道', split: 'test', version: 'v1' }],
        config: [{ name: 'batch', value: '64' }, { name: 'epochs', value: '120' }],
        checkpoints: [{ name: 'best', value: '120', unit: 'epoch' }],
        environment: 'Ubuntu 24.04 / PyTorch 2.5 / CUDA 12.4',
        seed: '11',
        evaluation: '阈值校准：偶数帧；评估：奇数帧',
        metrics: [{ name: 'p_det', value: '0.82', unit: '1' }, { name: 'p_fa', value: '0.01', unit: '1' }, { name: 'latency', value: '12', unit: 'ms' }],
        results: [{ id: 'r1', kind: 'single' }]
      },
      'sample-ablation': {
        id: 'sample-ablation',
        kind: 'run',
        title: t('sampleAblation'),
        plan: { kind: 'research', id: 'sample-plan' },
        status: 'succeeded',
        code: { repository: 'https://example.com/sim', commit: 'a1b2c3d' },
        datasets: [{ id: 'd1', name: '合成信道', split: 'test', version: 'v1' }],
        config: [{ name: 'batch', value: '64' }, { name: 'epochs', value: '120' }],
        checkpoints: [{ name: 'best', value: '120', unit: 'epoch' }],
        environment: 'Ubuntu 24.04 / PyTorch 2.6 / CUDA 12.4',
        seed: '11',
        evaluation: '阈值校准：偶数帧；评估：奇数帧',
        metrics: [{ name: 'p_det', value: '0.86', unit: '1' }, { name: 'p_fa', value: '0.012', unit: '1' }, { name: 'latency', value: '11', unit: 'ms' }],
        results: [{ id: 'r2', kind: 'single' }]
      },
      'sample-plan': { id: 'sample-plan', kind: 'research', title: '干扰对齐仿真' }
    }
    app.plans = { 'sample-plan': '干扰对齐仿真' }
    if (nodes.choose !== null) nodes.choose.hidden = true
    if (nodes.noteWrap !== null) nodes.noteWrap.hidden = true
    if (nodes.empty !== null) nodes.empty.hidden = true
    if (nodes.selectedWrap !== null) nodes.selectedWrap.hidden = true
    renderTables()
    card.dataset.state = 'ready'
  }

  function finishLoading() {
    if (loadTimer !== null) { window.clearTimeout(loadTimer); loadTimer = null }
    card.dataset.state = 'ready'
    if (nodes.noteWrap !== null) nodes.noteWrap.hidden = true
  }

  function showFailure() {
    card.dataset.state = 'failed'
    if (nodes.noteWrap !== null) nodes.noteWrap.hidden = false
    put(nodes.note, t('failed'))
    if (nodes.retry !== null) nodes.retry.hidden = false
  }

  function loadSelected() {
    if (ui.selection.length === 0) {
      finishLoading()
      renderSelected()
      renderTables()
      if (nodes.empty !== null) {
        nodes.empty.hidden = app.hasRuns === true
        if (app.hasRuns !== true) put(nodes.empty, t('empty'))
      }
      setBanner(app.hasRuns === true ? t('hint') : '')
      return
    }
    app.loading = true
    var ids = ui.selection.map(function (item) { return item.id })
    readAll({ ids: ids, includeArchived: true, includeTrashed: true }).then(function () {
      return loadPlans()
    }).then(function () {
      app.loading = false
      finishLoading()
      if (nodes.empty !== null) nodes.empty.hidden = true
      renderSelected()
      renderTables()
    }).catch(function () {
      app.loading = false
      showFailure()
    })
  }

  function refreshRuns() {
    if (widget === undefined || typeof widget.call !== 'function') {
      renderSample()
      return
    }
    readPage({ kind: 'run', includeArchived: true }).then(function (page) {
      app.hasRuns = page.records.length > 0
      if (page.records.length === 0 && ui.selection.length === 0) {
        finishLoading()
        put(nodes.empty, t('empty'))
        if (nodes.empty !== null) nodes.empty.hidden = false
        setBanner('')
        card.dataset.state = 'empty'
        return
      }
      loadSelected()
    }).catch(function () {
      showFailure()
    })
  }

  function candidateRow(run) {
    var row = document.createElement('li')
    row.className = 'rc__candidate'
    var check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = itemOf(run.id) !== null
    check.disabled = !check.checked && ui.selection.length >= pure.LIMIT
    var label = document.createElement('label')
    var title = document.createElement('span')
    put(title, titleOf(run) || run.id)
    label.append(check, title)
    if (run.archived === true) {
      var archived = document.createElement('span')
      archived.className = 'rc__tag'
      put(archived, t('archivedRun'))
      label.append(archived)
    }
    check.addEventListener('change', function () {
      if (check.checked) {
        if (ui.selection.length >= pure.LIMIT) {
          check.checked = false
          put(nodes.pickStatus, t('limitReached'))
          return
        }
        var role = ui.selection.length === 0 || baselineOf(orderedRuns()) === null ? 'baseline' : 'other'
        ui.selection = pure.normalizeSelection(ui.selection.concat([{ id: run.id, role: role }]))
        put(nodes.pickStatus, format(t('selected'), { n: ui.selection.length }))
      } else {
        ui.selection = ui.selection.filter(function (item) { return item.id !== run.id })
      }
      persist({ selection: ui.selection })
      resetConfirm()
      renderSelected()
      renderTables()
    })
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'rc__ghost'
    put(open, t('choose'))
    open.addEventListener('click', function () {
      widget.call(OPEN, { kind: 'run', id: run.id }).catch(function () {})
    })
    row.append(label, open)
    return row
  }

  function lookup(offset) {
    var sequence = ++app.query
    put(nodes.pickStatus, t('loading'))
    if (nodes.pickMore !== null) nodes.pickMore.hidden = true
    var query = { kind: 'run', includeArchived: true }
    var text = nodes.search !== null ? nodes.search.value.trim() : ''
    if (text !== '') query.search = text
    if (offset !== undefined) query.offset = offset
    readPage(query).then(function (page) {
      if (sequence !== app.query) return
      if (offset === undefined) nodes.candidates.replaceChildren()
      for (var at = 0; at < page.records.length; at += 1) nodes.candidates.append(candidateRow(page.records[at]))
      app.nextOffset = page.nextOffset
      if (nodes.pickMore !== null) nodes.pickMore.hidden = app.nextOffset === undefined
      put(nodes.pickStatus, page.records.length === 0 ? t('noMatches') : format(t('selected'), { n: ui.selection.length }))
    }).catch(function () {
      if (sequence === app.query) put(nodes.pickStatus, t('failed'))
    })
  }

  function openPicker() {
    if (nodes.dialog === null) return
    if (typeof nodes.dialog.showModal === 'function') nodes.dialog.showModal()
    else nodes.dialog.hidden = false
    lookup()
  }

  function closePicker() {
    if (nodes.dialog === null) return
    if (typeof nodes.dialog.close === 'function') nodes.dialog.close()
    else nodes.dialog.hidden = true
  }

  if (nodes.choose !== null) nodes.choose.addEventListener('click', openPicker)
  if (nodes.retry !== null) nodes.retry.addEventListener('click', function () {
    if (ui.selection.length > 0) loadSelected()
    else refreshRuns()
  })
  if (nodes.confirm !== null) nodes.confirm.addEventListener('change', function () {
    ui.confirmed = nodes.confirm.checked === true
    renderTables()
  })
  if (nodes.direction !== null) nodes.direction.addEventListener('change', function () {
    ui.direction = pure.directionOf(nodes.direction.value)
    persist({ direction: ui.direction })
    resetConfirm()
    renderTables()
  })
  if (nodes.pickSearch !== null) nodes.pickSearch.addEventListener('click', function () { lookup() })
  if (nodes.search !== null) nodes.search.addEventListener('input', function () {
    if (app.timer !== null) window.clearTimeout(app.timer)
    app.timer = window.setTimeout(function () { lookup() }, 250)
  })
  if (nodes.pickMore !== null) nodes.pickMore.addEventListener('click', function () {
    if (ui.selection.length >= pure.LIMIT) {
      put(nodes.pickStatus, t('limitReached'))
      return
    }
    // 读取更多时把已有候选保留；offset 必须前进。
    if (app.nextOffset !== undefined) lookup(app.nextOffset)
  })
  if (nodes.pickDone !== null) nodes.pickDone.addEventListener('click', closePicker)

  if (nodes.kicker !== null) nodes.kicker.hidden = true
  applyLabels()
  var saved = widget !== undefined && widget.state !== null && typeof widget.state === 'object' ? widget.state : {}
  ui.selection = pure.normalizeSelection(saved.selection)
  ui.direction = pure.directionOf(saved.direction)
  ui.confirmed = false
  if (nodes.direction !== null) nodes.direction.value = ui.direction
  renderSelected()
  if (widget.size !== null && widget.size !== undefined && widget.size.placement === 'preview') {
    renderSample()
  } else {
    if (typeof widget.onProps === 'function') {
      widget.onProps(function () {
        applyLabels()
        renderSelected()
        renderTables()
      })
    }
    if (typeof widget.onData === 'function') {
      widget.onData(function (data) {
        app.lastData = data
        if (!app.sample) loadSelected()
      })
    }
    put(nodes.note, t('loading'))
    loadTimer = window.setTimeout(function () {
      if (card.dataset.state === 'loading') showFailure()
    }, pure.LOAD_TIMEOUT)
    if (ui.selection.length > 0) loadSelected()
    else refreshRuns()
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)