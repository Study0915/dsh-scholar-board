/*
 * 横向项目卡的深层编辑与追溯：需求、需求变更、交付依据、测试报告、验收记录、冻结材料与追溯区。
 *
 * 只改打开着的这一条记录的数组；保存与冲突在 editor.js。这里不判断合同履约，也不管审批与经费。
 */
;(function (root) {
  'use strict'

  /**
   * 建深层编辑。
   *
   * @param {object} ctx - 状态、节点、文案、判定与保存回调。
   * @returns {object} 深层动作。
   */
  root.createProjectDeepRows = function (ctx) {
    var app = ctx.app
    var nodes = ctx.nodes
    var t = ctx.t
    var pure = ctx.pure
    var widget = ctx.widget
    var live = ctx.live
    var text = { t: t, fill: pure.fill }
    var READ = 'widget-board:records.read'
    var WRITE = 'widget-board:records.write'
    var KIND_PREFIX = { requirements: 'r', tasks: 't', issues: 'i' }
    var SOURCE_KINDS = ['meeting', 'action', 'manuscript', 'research', 'project']
    var SOURCE_KEYS = { meeting: 'sourceKindMeeting', action: 'sourceKindAction', manuscript: 'sourceKindManuscript', research: 'sourceKindResearch', project: 'sourceKindProject' }

    function sourceLabel(kind) {
      return Object.prototype.hasOwnProperty.call(SOURCE_KEYS, kind) ? t(SOURCE_KEYS[kind]) : String(kind)
    }

    function el(tag, className, label) {
      var node = document.createElement(tag)
      if (className !== undefined && className !== '') node.className = className
      if (label !== undefined) node.textContent = label
      return node
    }

    function inputOf(part, value, placeholder, options) {
      var input = el('input', 'pj__input')
      input.type = options !== undefined && options.type !== undefined ? options.type : 'text'
      if (part !== null) input.dataset.part = part
      input.value = typeof value === 'string' ? value : ''
      input.placeholder = placeholder
      input.setAttribute('aria-label', placeholder)
      input.autocomplete = 'off'
      if (options !== undefined && typeof options.max === 'number') input.maxLength = options.max
      return input
    }

    function selectOf(part, options, value) {
      var select = el('select', 'pj__input')
      if (part !== null) select.dataset.part = part
      for (var at = 0; at < options.length; at += 1) {
        var option = el('option', undefined, options[at].label)
        option.value = options[at].value
        select.appendChild(option)
      }
      select.value = value
      return select
    }

    function buttonOf(action, label, data) {
      var button = el('button', 'pj__ghost', label)
      button.type = 'button'
      button.dataset.deepAction = action
      if (data !== undefined) {
        for (var key in data) {
          if (Object.prototype.hasOwnProperty.call(data, key)) button.dataset[key] = String(data[key])
        }
      }
      return button
    }

    function tagged(status, label) {
      var tag = el('span', 'pj__tag', label)
      tag.dataset.tone = status === 'confirmed' || status === 'accepted' || status === 'passed' ? 'ok' : status === 'cancelled' || status === 'failed' ? 'danger' : 'neutral'
      return tag
    }

    function detailsOf(summary) {
      var box = el('details', 'pj__deep')
      box.appendChild(el('summary', 'pj__deep-summary', summary))
      return box
    }

    function pairOf(label, control) {
      var wrap = el('label', 'pj__deep-field')
      wrap.appendChild(el('span', 'pj__deep-label', label))
      wrap.appendChild(control)
      return wrap
    }

    function listOf(className) {
      return el('ul', className === undefined ? 'pj__deep-list' : className)
    }

    function emptyHint(message) {
      return el('li', 'pj__deep-empty', message)
    }

    function requirementOptions() {
      var options = [{ value: '', label: t('requirementPick') }]
      var list = pure.requirementsOf({ requirements: app.requirements })
      for (var at = 0; at < list.length; at += 1) options.push({ value: list[at].id, label: pure.requirementLine(list[at]) })
      return options
    }

    function statusOptions(statuses, keyOf) {
      var options = []
      for (var at = 0; at < statuses.length; at += 1) options.push({ value: statuses[at], label: t(keyOf(statuses[at])) })
      return options
    }

    function materialList(list, kind, index) {
      var box = listOf('pj__material-list')
      if (list.length === 0) box.appendChild(emptyHint(t('noRelated')))
      for (var at = 0; at < list.length; at += 1) {
        var material = list[at]
        var row = el('li', 'pj__material')
        var open = el('button', 'pj__material-open', typeof material.title === 'string' ? material.title : String(material.url))
        open.type = 'button'
        open.dataset.url = String(material.url)
        var remove = buttonOf('remove-report', t('removeRow'), { index: index, kind: kind, id: material.id })
        remove.className = 'pj__ghost pj__material-remove'
        row.append(open, remove)
        box.appendChild(row)
      }
      return box
    }

    function refList(list, kind, index) {
      var box = listOf()
      if (list.length === 0) box.appendChild(emptyHint(t('noRelated')))
      for (var at = 0; at < list.length; at += 1) {
        var ref = list[at]
        var row = el('li', 'pj__deep-item')
        row.appendChild(el('span', 'pj__deep-name', pure.requirementLine(pure.requirementOf({ requirements: app.requirements }, ref.id) || { id: ref.id, title: ref.id, version: ref.version })))
        row.appendChild(el('span', 'pj__deep-meta', t('chainBound').split('{version}').join(String(ref.version))))
        row.appendChild(buttonOf('remove-ref', t('removeRow'), { index: index, kind: kind, id: ref.id }))
        box.appendChild(row)
      }
      return box
    }

    function acceptanceList(list, index) {
      var box = listOf()
      if (list.length === 0) box.appendChild(emptyHint(t('acceptances')))
      for (var at = 0; at < list.length; at += 1) {
        var entry = list[at]
        var row = el('li', 'pj__deep-item')
        row.appendChild(tagged(entry.passed === true ? 'passed' : 'failed', t(entry.passed === true ? 'acceptancePassed' : 'acceptanceFailed')))
        row.appendChild(el('span', 'pj__deep-name', entry.opinion))
        if (typeof entry.pending === 'string' && entry.pending !== '') row.appendChild(el('span', 'pj__deep-meta', entry.pending))
        row.appendChild(buttonOf('remove-acceptance', t('removeRow'), { index: index, id: entry.id }))
        box.appendChild(row)
      }
      return box
    }

    function requirementExtra(requirement, index) {
      var box = detailsOf(t('requirementDescription'))
      var description = el('textarea', 'pj__input pj__textarea')
      description.rows = 2
      description.dataset.part = 'description'
      description.value = typeof requirement.description === 'string' ? requirement.description : ''
      box.appendChild(pairOf(t('requirementDescription'), description))
      var rows = el('div', 'pj__deep-grid')
      rows.appendChild(pairOf(t('requirementMetric'), inputOf('metric', requirement.metric, t('requirementMetric'), { max: 200 })))
      rows.appendChild(pairOf(t('requirementUnit'), inputOf('unit', requirement.unit, t('requirementUnit'), { max: 32 })))
      rows.appendChild(pairOf(t('requirementThreshold'), inputOf('threshold', requirement.threshold, t('requirementThreshold'), { max: 400 })))
      rows.appendChild(pairOf(t('requirementTestMethod'), inputOf('testMethod', requirement.testMethod, t('requirementTestMethod'), { max: 1000 })))
      box.appendChild(rows)
      var template = el('select', 'pj__input')
      template.dataset.deepRole = 'template'
      var shapes = pure.templates()
      for (var at = 0; at < shapes.length; at += 1) {
        var option = el('option', undefined, t(shapes[at].key))
        option.value = String(at)
        template.appendChild(option)
      }
      box.appendChild(pairOf(t('requirementTemplates'), template))
      box.appendChild(buttonOf('apply-template', t('applyTemplate'), { index: index }))
      box.appendChild(el('p', 'pj__deep-title', t('requirementSources')))
      var sources = Array.isArray(requirement.sources) ? requirement.sources : []
      var sourceBox = listOf()
      if (sources.length === 0) sourceBox.appendChild(emptyHint(t('requirementSources')))
      for (var sourceAt = 0; sourceAt < sources.length; sourceAt += 1) {
        var source = sources[sourceAt]
        var sourceRow = el('li', 'pj__deep-item')
        sourceRow.appendChild(el('span', 'pj__deep-name', sourceLabel(source.kind)))
        sourceRow.appendChild(el('span', 'pj__deep-meta', source.id))
        sourceRow.appendChild(buttonOf('remove-source', t('removeRow'), { index: index, id: source.kind + ':' + source.id }))
        sourceBox.appendChild(sourceRow)
      }
      box.appendChild(sourceBox)
      var sourceKind = selectOf(null, SOURCE_KINDS.map(function (kind) { return { value: kind, label: sourceLabel(kind) } }), 'meeting')
      sourceKind.dataset.deepInput = 'source-kind'
      var sourceId = inputOf(null, '', t('requirementSourceId'), { max: 64 })
      sourceId.dataset.deepInput = 'source-id'
      var sourceAdd = el('div', 'pj__deep-grid')
      sourceAdd.append(sourceKind, sourceId, buttonOf('add-source', t('addSource'), { index: index }))
      box.appendChild(sourceAdd)
      box.appendChild(el('p', 'pj__deep-title', t('requirementMaterials')))
      var materials = Array.isArray(requirement.materials) ? requirement.materials : []
      box.appendChild(materialList(materials, 'requirements', index))
      var reportUrl = inputOf(null, '', t('testReportUrl'), { type: 'url', max: 2000 })
      reportUrl.dataset.deepInput = 'url'
      var reportTitle = inputOf(null, '', t('testReportTitle'), { max: 200 })
      reportTitle.dataset.deepInput = 'title'
      var materialAdd = el('div', 'pj__deep-grid')
      materialAdd.append(reportUrl, reportTitle, buttonOf('add-requirement-material', t('addMaterial'), { index: index }))
      box.appendChild(materialAdd)
      box.appendChild(el('p', 'pj__deep-hint', t('requirementTasksHint')))
      box.appendChild(actionOf('requirements', requirement, index))
      return box
    }

    function actionOf(kind, entry, index) {
      if (typeof entry.actionId === 'string' && entry.actionId !== '') return el('p', 'pj__deep-meta', t('actionLinked'))
      return buttonOf('to-action', t('toAction'), { kind: kind, index: index })
    }

    function acceptanceEditor(deliverable, index) {
      var box = el('div', 'pj__deep-grid')
      var opinion = inputOf(null, '', t('acceptanceOpinion'), { max: 1000 })
      opinion.dataset.deepInput = 'opinion'
      var passed = selectOf(null, [{ value: 'true', label: t('acceptancePassed') }, { value: 'false', label: t('acceptanceFailed') }], 'true')
      passed.dataset.deepInput = 'passed'
      var pending = inputOf(null, '', t('acceptancePending'), { max: 1000 })
      pending.dataset.deepInput = 'pending'
      box.append(opinion, passed, pending, buttonOf('add-acceptance', t('addAcceptance'), { index: index }))
      return box
    }

    function deliverableExtra(deliverable, index) {
      var box = detailsOf(t('delivery'))
      box.dataset.deep = 'deliverable'
      box.dataset.index = String(index)
      var refs = Array.isArray(deliverable.requirements) ? deliverable.requirements : []
      box.appendChild(el('p', 'pj__deep-title', t('deliverableRequirements')))
      box.appendChild(refList(refs, 'deliverables', index))
      var pick = selectOf(null, requirementOptions(), '')
      pick.dataset.deepInput = 'requirement'
      var pickRow = el('div', 'pj__deep-grid')
      pickRow.append(pick, buttonOf('add-ref', t('addRelated'), { index: index }))
      box.appendChild(pickRow)
      var reportUrl = inputOf(null, '', t('testReportUrl'), { type: 'url', max: 2000 })
      reportUrl.dataset.deepInput = 'url'
      var reportTitle = inputOf(null, '', t('testReportTitle'), { max: 200 })
      reportTitle.dataset.deepInput = 'title'
      var reportRow = el('div', 'pj__deep-grid')
      reportRow.append(reportUrl, reportTitle, buttonOf('add-report', t('addTestReport'), { index: index }))
      box.appendChild(el('p', 'pj__deep-title', t('testReports')))
      box.appendChild(materialList(Array.isArray(deliverable.testReports) ? deliverable.testReports : [], 'deliverables', index))
      box.appendChild(reportRow)
      var limitations = el('textarea', 'pj__input pj__textarea')
      limitations.rows = 2
      limitations.dataset.part = 'limitations'
      limitations.value = typeof deliverable.limitations === 'string' ? deliverable.limitations : ''
      box.appendChild(pairOf(t('limitations'), limitations))
      box.appendChild(pairOf(t('deliveredAt'), dateInputOf(deliverable.deliveredAt, index)))
      box.appendChild(el('p', 'pj__deep-title', t('acceptances')))
      box.appendChild(acceptanceList(Array.isArray(deliverable.acceptances) ? deliverable.acceptances : [], index))
      box.appendChild(acceptanceEditor(deliverable, index))
      if (deliverable.frozen !== null && typeof deliverable.frozen === 'object') {
        var date = pure.dateInputOf(deliverable.frozen.at)
        box.appendChild(el('p', 'pj__deep-meta', pure.fill(t('frozen'), { date: date })))
      }
      box.appendChild(buttonOf('freeze', t('freeze'), { index: index }))
      return box
    }

    function dateInputOf(value, index) {
      var input = el('input', 'pj__input')
      input.type = 'date'
      input.dataset.part = 'deliveredAt'
      input.value = pure.dateInputOf(value)
      input.setAttribute('aria-label', t('deliveredAt'))
      input.dataset.deliverable = String(index)
      return input
    }

    function changeRow(change, index) {
      var row = el('li', 'pj__line pj__line-change')
      row.dataset.kind = 'requirementChanges'
      row.dataset.index = String(index)
      row.appendChild(selectOf('requirementId', requirementOptions(), typeof change.requirementId === 'string' ? change.requirementId : ''))
      row.appendChild(inputOf('fromVersion', change.fromVersion, t('changeFrom'), { max: 32 }))
      row.appendChild(inputOf('toVersion', change.toVersion, t('changeTo'), { max: 32 }))
      row.appendChild(inputOf('at', pure.dateInputOf(change.at), t('changeAt'), { type: 'date' }))
      row.appendChild(buttonOf('apply-change', t('applyChange'), { index: index }))
      var remove = el('button', 'pj__ghost pj__line-remove', t('removeRow'))
      remove.type = 'button'
      remove.dataset.removeChange = String(index)
      row.appendChild(remove)
      var box = detailsOf(t('changeReason'))
      var reason = el('textarea', 'pj__input pj__textarea')
      reason.rows = 2
      reason.dataset.part = 'reason'
      reason.value = typeof change.reason === 'string' ? change.reason : ''
      box.appendChild(pairOf(t('changeReason'), reason))
      box.appendChild(pairOf(t('changeImpact'), inputOf('impact', change.impact, t('changeImpact'), { max: 2000 })))
      box.appendChild(pairOf(t('changeCommunication'), inputOf('communication', change.communication, t('changeCommunication'), { max: 2000 })))
      box.appendChild(pairOf(t('changeConfirmation'), inputOf('confirmation', change.confirmation, t('changeConfirmation'), { max: 200 })))
      row.appendChild(box)
      return row
    }

    function requirementRow(requirement, index) {
      var row = el('li', 'pj__line pj__line-requirement')
      row.dataset.kind = 'requirements'
      row.dataset.index = String(index)
      row.appendChild(inputOf('no', requirement.no, t('requirementNo'), { max: 40 }))
      row.appendChild(inputOf('title', requirement.title, t('requirementTitle'), { max: 200 }))
      row.appendChild(inputOf('version', requirement.version, t('requirementVersion'), { max: 32 }))
      row.appendChild(selectOf('status', statusOptions(pure.REQUIREMENT_STATUSES, pure.requirementKey), requirement.status))
      row.appendChild(buttonOf('remove-requirement', t('removeRow'), { index: index }))
      row.appendChild(requirementExtra(requirement, index))
      return row
    }

    function renderRequirements() {
      if (nodes.requirements === null) return
      var items = []
      for (var at = 0; at < app.requirements.length; at += 1) items.push(requirementRow(app.requirements[at], at))
      nodes.requirements.replaceChildren.apply(nodes.requirements, items)
    }

    function renderChanges() {
      if (nodes.changes === null) return
      var items = []
      for (var at = 0; at < app.requirementChanges.length; at += 1) items.push(changeRow(app.requirementChanges[at], at))
      nodes.changes.replaceChildren.apply(nodes.changes, items)
    }

    function extraOf(kind, entry, index) {
      if (kind === 'deliverables') return deliverableExtra(entry, index)
      if (kind === 'tasks' || kind === 'issues') return actionOf(kind, entry, index)
      return null
    }

    function addRequirement(templateIndex) {
      var shape = null
      if (typeof templateIndex === 'number') shape = pure.templates()[templateIndex] || null
      var entry = {
        id: 'r-' + String(Date.now()) + '-' + String(app.requirements.length),
        title: shape === null ? '' : t(shape.key),
        version: 'v1',
        status: 'pending'
      }
      if (shape !== null) {
        entry.metric = shape.metric
        entry.unit = shape.unit
        entry.threshold = shape.threshold
        entry.testMethod = shape.testMethod
      }
      app.requirements.push(entry)
      renderRequirements()
      ctx.onInput()
    }

    function addChange() {
      var first = pure.requirementsOf({ requirements: app.requirements })[0]
      app.requirementChanges.push({
        id: 'c-' + String(Date.now()) + '-' + String(app.requirementChanges.length),
        requirementId: first === undefined ? '' : first.id,
        fromVersion: first === undefined ? '' : first.version,
        toVersion: first === undefined ? '' : pure.nextVersion(first.version),
        reason: ''
      })
      renderChanges()
      ctx.onInput()
    }

    function removeAt(kind, index) {
      if (!Array.isArray(app[kind]) || !Number.isInteger(index)) return
      app[kind].splice(index, 1)
      if (kind === 'requirements') renderRequirements()
      else renderChanges()
      renderChain()
      ctx.onInput()
    }

    function applyChange(index) {
      var change = app.requirementChanges[index]
      if (change === null || typeof change !== 'object') return
      if (change.requirementId === '' || change.toVersion === '' || change.toVersion === change.fromVersion) {
        ctx.setStatus(t('versionConflict'), 'error')
        return
      }
      var result = pure.applyChange(app.requirements, change)
      if (result === null) {
        ctx.setStatus(t('versionConflict'), 'error')
        return
      }
      app.requirements = result.requirements
      app.requirementChanges[index] = result.change
      renderRequirements()
      renderChanges()
      renderChain()
      ctx.setStatus(t('changeApplied'), 'ok')
      ctx.onInput()
    }

    function currentRecord() {
      return {
        requirements: app.requirements,
        requirementChanges: app.requirementChanges,
        tasks: app.tasks,
        deliverables: app.deliverables
      }
    }

    function renderChain() {
      if (nodes.chain === null) return
      var record = currentRecord()
      var list = pure.requirementsOf(record)
      var items = []
      var missing = pure.missingReferences(record)
      if (missing.length > 0) items.push(el('p', 'pj__error', pure.fill(t('chainMissing'), { ids: missing.join('、') })))
      if (list.length === 0) items.push(el('p', 'pj__deep-empty', t('chainEmpty')))
      for (var at = 0; at < list.length; at += 1) {
        var chain = pure.chainOf(record, list[at].id)
        if (chain === null) continue
        var block = el('div', 'pj__chain')
        block.appendChild(el('p', 'pj__chain-head', pure.requirementLine(chain.requirement)))
        var tasks = el('p', 'pj__chain-line', t('chainTasks') + '：' + (chain.tasks.length === 0 ? t('chainNoTasks') : chain.tasks.map(function (task) { return task.title }).join('、')))
        block.appendChild(tasks)
        if (chain.missingTasks.length > 0) block.appendChild(el('p', 'pj__error', pure.fill(t('chainMissing'), { ids: chain.missingTasks.join('、') })))
        var deliveries = el('p', 'pj__chain-line', t('chainDeliveries') + '：' + (chain.deliveries.length === 0 ? t('chainNoDeliveries') : chain.deliveries.map(function (item) {
          return item.deliverable.name + ' · ' + item.deliverable.status + ' · ' + t('chainBound').split('{version}').join(item.version) + ' · ' + pure.fill(t('acceptanceCount'), item.acceptance)
        }).join('；')))
        block.appendChild(deliveries)
        var changes = el('p', 'pj__chain-line', t('chainChanges') + '：' + (chain.changes.length === 0 ? t('chainNoChanges') : chain.changes.map(function (change) { return change.fromVersion + '→' + change.toVersion + ' ' + change.reason }).join('；')))
        block.appendChild(changes)
        items.push(block)
      }
      nodes.chain.replaceChildren.apply(nodes.chain, items)
    }

    function requiresSaved() {
      if (app.baseline !== null && typeof app.baseline.id === 'string') return true
      ctx.setStatus(t('saveFirst'), 'error')
      return false
    }

    function toAction(kind, index) {
      var entry = app[kind][index]
      if (entry === null || typeof entry !== 'object' || typeof entry.actionId === 'string' || !requiresSaved() || !live) return
      var title = kind === 'requirements' ? pure.requirementLine(entry) : entry.title
      if (typeof window.confirm === 'function' && !window.confirm(pure.fill(t('convertPreview'), { title: title }))) return
      var sourceEntry = (KIND_PREFIX[kind] + ':' + entry.id).slice(0, 64)
      widget.call(WRITE, {
        op: 'create',
        record: { kind: 'action', title: title, status: 'todo', source: { kind: 'project', id: app.baseline.id }, sourceEntry: sourceEntry }
      }).then(function (result) {
        var record = result !== null && typeof result === 'object' && result.record !== null && typeof result.record === 'object' ? result.record : null
        if (record === null || typeof record.id !== 'string') {
          ctx.setStatus(t('actionFailed'), 'error')
          return
        }
        entry.actionId = record.id
        renderRequirements()
        renderChain()
        ctx.setStatus(t('actionLinked'), 'ok')
        ctx.onInput()
      }, function () {
        ctx.setStatus(t('actionFailed'), 'error')
      })
    }

    function deepContainer(target) {
      if (!(target instanceof Element)) return null
      return target.closest('[data-deep="deliverable"]')
    }

    function readDeep(container, name) {
      var field = container === null ? null : container.querySelector('[data-deep-input="' + name + '"]')
      return field === null || field === undefined ? '' : String(field.value)
    }

    function addRef(index) {
      var deliverable = app.deliverables[index]
      if (deliverable === null || typeof deliverable !== 'object') return
      var details = nodes.deliverables.querySelector('[data-deep="deliverable"][data-index="' + String(index) + '"]')
      var pick = details === null ? null : details.querySelector('[data-deep-input="requirement"]')
      var id = pick === null ? '' : pick.value
      if (id === '') return
      var requirement = pure.requirementOf({ requirements: app.requirements }, id)
      if (requirement === null) return
      var list = Array.isArray(deliverable.requirements) ? deliverable.requirements : []
      for (var at = 0; at < list.length; at += 1) if (list[at].id === id) return
      list.push({ id: id, version: requirement.version })
      deliverable.requirements = list
      refreshDeliverables()
      ctx.onInput()
    }

    function addReport(index) {
      var deliverable = app.deliverables[index]
      if (deliverable === null || typeof deliverable !== 'object') return
      var details = nodes.deliverables.querySelector('[data-deep="deliverable"][data-index="' + String(index) + '"]')
      var url = readDeep(details, 'url').trim()
      var title = readDeep(details, 'title').trim()
      if (!pure.materialValid(url, title)) {
        ctx.setStatus(t('materialInvalid'), 'error')
        return
      }
      if (!Array.isArray(deliverable.testReports)) deliverable.testReports = []
      deliverable.testReports.push({ id: 'tr-' + String(Date.now()) + '-' + String(deliverable.testReports.length), url: url, title: title })
      refreshDeliverables()
      ctx.onInput()
    }

    function addAcceptance(index) {
      var deliverable = app.deliverables[index]
      if (deliverable === null || typeof deliverable !== 'object') return
      var details = nodes.deliverables.querySelector('[data-deep="deliverable"][data-index="' + String(index) + '"]')
      var opinion = readDeep(details, 'opinion').trim()
      if (opinion === '') {
        ctx.setStatus(t('invalidDelivery'), 'error')
        return
      }
      if (!Array.isArray(deliverable.acceptances)) deliverable.acceptances = []
      var entry = { id: 'a-' + String(Date.now()) + '-' + String(deliverable.acceptances.length), opinion: opinion, passed: readDeep(details, 'passed') === 'true' }
      var pending = readDeep(details, 'pending').trim()
      if (pending !== '') entry.pending = pending
      deliverable.acceptances.push(entry)
      refreshDeliverables()
      renderChain()
      ctx.onInput()
    }

    function freeze(index) {
      var deliverable = app.deliverables[index]
      if (deliverable === null || typeof deliverable !== 'object') return
      var frozen = pure.freezeOf(deliverable, new Date().toISOString().slice(0, 10), index)
      if (frozen === null) {
        ctx.setStatus(t('freezeEmpty'), 'error')
        return
      }
      deliverable.frozen = frozen
      refreshDeliverables()
      ctx.onInput()
    }

    function removeReport(index, id) {
      var deliverable = app.deliverables[index]
      if (deliverable === null || typeof deliverable !== 'object') return
      deliverable.testReports = (Array.isArray(deliverable.testReports) ? deliverable.testReports : []).filter(function (material) { return String(material.id) !== String(id) })
      refreshDeliverables()
      ctx.onInput()
    }

    function removeRef(index, id) {
      var deliverable = app.deliverables[index]
      if (deliverable === null || typeof deliverable !== 'object') return
      deliverable.requirements = (Array.isArray(deliverable.requirements) ? deliverable.requirements : []).filter(function (ref) { return ref.id !== id })
      refreshDeliverables()
      renderChain()
      ctx.onInput()
    }

    function removeAcceptance(index, id) {
      var deliverable = app.deliverables[index]
      if (deliverable === null || typeof deliverable !== 'object') return
      deliverable.acceptances = (Array.isArray(deliverable.acceptances) ? deliverable.acceptances : []).filter(function (entry) { return String(entry.id) !== String(id) })
      refreshDeliverables()
      renderChain()
      ctx.onInput()
    }

    function refreshDeliverables() {
      ctx.rows.renderDeliverables()
      renderChain()
    }

    function addSource(index) {
      var requirement = app.requirements[index]
      var container = nodes.requirements.querySelector('[data-kind="requirements"][data-index="' + String(index) + '"]')
      var kind = container === null ? '' : String(container.querySelector('[data-deep-input="source-kind"]').value)
      var id = container === null ? '' : container.querySelector('[data-deep-input="source-id"]').value.trim()
      if (kind === '' || id === '') return
      var list = Array.isArray(requirement.sources) ? requirement.sources : []
      for (var at = 0; at < list.length; at += 1) if (list[at].kind === kind && list[at].id === id) return
      list.push({ kind: kind, id: id })
      requirement.sources = list
      renderRequirements()
      ctx.onInput()
    }

    function addRequirementMaterial(index) {
      var container = nodes.requirements.querySelector('[data-kind="requirements"][data-index="' + String(index) + '"]')
      var url = readDeep(container, 'url').trim()
      var title = readDeep(container, 'title').trim()
      if (!pure.materialValid(url, title)) {
        ctx.setStatus(t('materialInvalid'), 'error')
        return
      }
      var requirement = app.requirements[index]
      if (!Array.isArray(requirement.materials)) requirement.materials = []
      requirement.materials.push({ id: 'rm-' + String(Date.now()) + '-' + String(requirement.materials.length), url: url, title: title })
      renderRequirements()
      ctx.onInput()
    }

    function applyTemplate(index) {
      var container = nodes.requirements.querySelector('[data-kind="requirements"][data-index="' + String(index) + '"]')
      var select = container === null ? null : container.querySelector('[data-deep-role="template"]')
      var shape = select === null ? null : pure.templates()[Number(select.value)]
      if (shape === null || shape === undefined) return
      var requirement = app.requirements[index]
      requirement.title = t(shape.key)
      requirement.metric = shape.metric
      requirement.unit = shape.unit
      requirement.threshold = shape.threshold
      requirement.testMethod = shape.testMethod
      renderRequirements()
      ctx.onInput()
    }

    function onClick(event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var open = target.closest('.pj__material-open')
      if (open !== null && typeof open.dataset.url === 'string' && live && typeof widget.open === 'function') {
        widget.open(open.dataset.url)
        return
      }
      var button = target.closest('[data-deep-action], [data-remove-change]')
      if (button === null) return
      if (button.dataset.removeChange !== undefined) {
        removeAt('requirementChanges', Number(button.dataset.removeChange))
        return
      }
      var action = button.dataset.deepAction
      var index = Number(button.dataset.index)
      if (action === 'remove-requirement') removeAt('requirements', index)
      else if (action === 'apply-change') applyChange(index)
      else if (action === 'apply-template') applyTemplate(index)
      else if (action === 'add-source') addSource(index)
      else if (action === 'remove-source') removeSource(index, button.dataset.id)
      else if (action === 'add-requirement-material') addRequirementMaterial(index)
      else if (action === 'remove-report') removeReport(index, button.dataset.id)
      else if (action === 'add-ref') addRef(index)
      else if (action === 'remove-ref') removeRef(index, button.dataset.id)
      else if (action === 'add-report') addReport(index)
      else if (action === 'add-acceptance') addAcceptance(index)
      else if (action === 'remove-acceptance') removeAcceptance(index, button.dataset.id)
      else if (action === 'freeze') freeze(index)
      else if (action === 'to-action') toAction(button.dataset.kind, index)
    }

    function removeSource(index, key) {
      var requirement = app.requirements[index]
      if (requirement === null || typeof requirement !== 'object') return
      requirement.sources = (Array.isArray(requirement.sources) ? requirement.sources : []).filter(function (source) { return source.kind + ':' + source.id !== key })
      renderRequirements()
      ctx.onInput()
    }

    function onInput(event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var row = target.closest('[data-kind="requirements"], [data-kind="requirementChanges"]')
      if (row === null || target.dataset.part === undefined) return
      var list = app[row.dataset.kind]
      var index = Number(row.dataset.index)
      if (!Array.isArray(list) || list[index] === undefined || typeof list[index] !== 'object') return
      list[index][target.dataset.part] = target.value
      if (row.dataset.kind === 'requirements') renderChain()
      ctx.onInput()
    }

    function wire() {
      if (nodes.requirements !== null) {
        nodes.requirements.addEventListener('click', onClick)
        nodes.requirements.addEventListener('input', onInput)
        nodes.requirements.addEventListener('change', onInput)
      }
      if (nodes.changes !== null) {
        nodes.changes.addEventListener('click', onClick)
        nodes.changes.addEventListener('input', onInput)
        nodes.changes.addEventListener('change', onInput)
      }
      if (nodes.deliverables !== null) nodes.deliverables.addEventListener('click', onClick)
      if (nodes.issues !== null) nodes.issues.addEventListener('click', onClick)
    }

    wire()

    return {
      renderRequirements: renderRequirements,
      renderChanges: renderChanges,
      renderChain: renderChain,
      extraOf: extraOf,
      addRequirement: addRequirement,
      addChange: addChange,
      renderAll: function () {
        renderRequirements()
        renderChanges()
        renderChain()
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
