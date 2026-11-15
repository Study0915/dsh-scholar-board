/*
 * 研究记录卡的编辑面板：详情表单、参数与指标、草稿、保存、修订冲突与归档 / 回收站操作。
 *
 * 由 main.js 在启动时用一份上下文建出来；这一份不碰列表与查询，只处理打开着的那一条，
 * 完成后让 main.js 重新取列表。这里不执行任何实验程序，参数、环境、种子与指标都只是写下来的值。
 */
;(function (root) {
  'use strict'

  /**
   * 建编辑面板。
   *
   * @param {object} ctx - 节点、状态、文案与列表刷新回调。
   * @returns {object} 面板对外的动作。
   */
  root.createResearchEditor = function (ctx) {
    var app = ctx.app
    var ui = ctx.ui
    var nodes = ctx.nodes
    var widget = ctx.widget
    var live = ctx.live
    var t = ctx.t
    var pure = ctx.pure
    var view = ctx.view
    var text = { t: t }
    var READ = 'widget-board:records.read'
    var WRITE = 'widget-board:records.write'
    var DRAFT = 'widget-board:records.draft'
    var draftTimer = null
    var creatingRun = false
    var relations = widget.createRecordRelations({ container: nodes.detail,
      current: function () { return app.baseline },
      onChange: function (refs) { app.related = refs; onInput() }
    })
    var templatePanel = nodes.template === null ? null : widget.createTemplatePanel({
      container: nodes.template,
      current: templateValues,
      manage: true,
      onApply: applyTemplate
    })
    var evidence = root.createResearchEvidence({
      app: app,
      widget: widget,
      live: live,
      t: t,
      container: nodes.evidence,
      onChange: function () { onInput() }
    })

    /** 记录里已有的值，按显示名索引；预览据此默认保留同名值。 */
    function templateValues() {
      return widget.templateCurrent([app.parameters, app.metrics], { '种子': nodes.seedInput.value, '随机种子': nodes.seedInput.value, '环境': nodes.environmentInput.value })
    }

    /** 应用模板：输入项进参数、观测项进指标，种子与环境落到各自的输入框。 */
    function applyTemplate(snapshot, fields) {
      var applied = widget.templateApplication(fields, widget.templateValuesOf(snapshot), { inputs: app.parameters, metrics: app.metrics })
      app.parameters = applied.inputs
      app.metrics = applied.metrics
      if (typeof applied.seed === 'string') nodes.seedInput.value = applied.seed
      if (typeof applied.environment === 'string') nodes.environmentInput.value = applied.environment
      app.template = snapshot
      renderEntries('parameters')
      renderEntries('metrics')
      onInput()
    }

    function formOf() {
      return {
        related: relations.value(),
        title: nodes.titleInput.value,
        method: nodes.methodInput.value,
        question: nodes.question.value,
        purpose: nodes.purpose.value,
        hypothesis: nodes.hypothesis.value,
        steps: nodes.steps.value,
        environment: nodes.environmentInput.value,
        seed: nodes.seedInput.value,
        parameters: app.parameters,
        metrics: app.metrics,
        conclusion: nodes.conclusion.value,
        conclusionBasis: nodes.conclusionBasis.value,
        conclusionScope: nodes.conclusionScope.value,
        conclusionEvidence: evidence.value(),
        materials: app.materials,
        template: app.template
      }
    }

    function fillForm(form) {
      relations.load(Array.isArray(form.related) ? form.related : app.related)
      nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
      nodes.methodInput.value = pure.METHODS.indexOf(form.method) >= 0 ? form.method : 'simulation'
      nodes.question.value = typeof form.question === 'string' ? form.question : ''
      nodes.purpose.value = typeof form.purpose === 'string' ? form.purpose : ''
      nodes.hypothesis.value = typeof form.hypothesis === 'string' ? form.hypothesis : ''
      nodes.steps.value = typeof form.steps === 'string' ? form.steps : ''
      nodes.environmentInput.value = typeof form.environment === 'string' ? form.environment : ''
      nodes.seedInput.value = typeof form.seed === 'string' ? form.seed : ''
      nodes.conclusion.value = typeof form.conclusion === 'string' ? form.conclusion : ''
      nodes.conclusionBasis.value = typeof form.conclusionBasis === 'string' ? form.conclusionBasis : ''
      nodes.conclusionScope.value = typeof form.conclusionScope === 'string' ? form.conclusionScope : ''
      evidence.load(Array.isArray(form.conclusionEvidence) ? form.conclusionEvidence : [])
      app.parameters = Array.isArray(form.parameters) ? form.parameters.slice() : []
      app.metrics = Array.isArray(form.metrics) ? form.metrics.slice() : []
      app.template = form.template !== null && typeof form.template === 'object' ? form.template : null
      renderEntries('parameters')
      renderEntries('metrics')
      if (nodes.entryError !== null) nodes.entryError.textContent = ''
      renderMaterials()
      ctx.setStatus('', 'neutral')
      if (nodes.detailHint !== null) nodes.detailHint.hidden = true
    }

    function showDetail(record, focus) {
      if (nodes.detail === null) return
      nodes.detail.hidden = false
      ctx.card.dataset.editing = 'true'
      if (nodes.list !== null) nodes.list.hidden = true
      if (nodes.noteWrap !== null) nodes.noteWrap.hidden = true
      var trashed = record !== null && typeof record.deletedAt === 'string'
      nodes.archiveAction.hidden = record === null || trashed || record.archived === true
      nodes.restoreAction.hidden = record === null || (!trashed && record.archived !== true)
      nodes.trashAction.hidden = record === null || trashed
      if (nodes.planRuns !== null) nodes.planRuns.hidden = record === null
      if (nodes.template !== null) nodes.template.hidden = trashed
      var fields = [nodes.titleInput, nodes.methodInput, nodes.question, nodes.purpose, nodes.hypothesis, nodes.steps, nodes.environmentInput, nodes.seedInput, nodes.conclusion, nodes.conclusionBasis, nodes.conclusionScope, nodes.materialUrl, nodes.materialTitle]
      for (var at = 0; at < fields.length; at += 1) fields[at].disabled = trashed
      evidence.setDisabled(trashed)
      var buttons = [ctx.card.querySelector('[data-action="add-material"]'), ctx.card.querySelector('[data-action="add-parameter"]'), ctx.card.querySelector('[data-action="add-metric"]')]
      for (var buttonAt = 0; buttonAt < buttons.length; buttonAt += 1) {
        if (buttons[buttonAt] !== null) buttons[buttonAt].disabled = trashed
      }
      var entryInputs = ctx.card.querySelectorAll('.rs__entry input, .rs__entry-remove')
      for (var entryAt = 0; entryAt < entryInputs.length; entryAt += 1) entryInputs[entryAt].disabled = trashed
      nodes.saveButton.disabled = trashed
      nodes.saveButton.textContent = t('save')
      if (nodes.newRunButton !== null) nodes.newRunButton.disabled = trashed
      if (trashed) {
        nodes.detailHint.textContent = t('trashRestoreHint')
        if (nodes.detailHint !== null) nodes.detailHint.hidden = false
      } else if (nodes.detailHint !== null) {
        nodes.detailHint.hidden = true
      }
      refreshPlanRuns()
      if (focus === true) nodes.titleInput.focus()
    }

    function openRecord(record) {
      app.related = Array.isArray(record.related) ? record.related.slice() : []
      app.editing = true
      app.baseline = record
      app.draftId = null
      app.dirty = false
      app.saving = false
      app.materials = Array.isArray(record.materials) ? record.materials.slice() : []
      fillForm({
        title: record.title,
        method: pure.methodOf(record),
        question: record.question,
        purpose: record.purpose,
        hypothesis: record.hypothesis,
        steps: record.steps,
        environment: record.environment,
        seed: record.seed,
        parameters: pure.entriesOf(record, 'parameters'),
        metrics: pure.entriesOf(record, 'metrics'),
        conclusion: record.conclusion,
        conclusionBasis: record.conclusionBasis,
        conclusionScope: record.conclusionScope,
        conclusionEvidence: pure.evidenceOf(record),
        template: record.template
      })
      showDetail(record, true)
      restoreDraft(record.id).then(function (restored) {
        if (restored) ctx.setStatus(t('draftRestored'), 'neutral')
      })
    }

    function openNew() {
      app.related = []
      app.editing = true
      app.baseline = null
      app.draftId = null
      app.dirty = false
      app.saving = false
      app.materials = []
      fillForm({ title: '', method: 'simulation', question: '', purpose: '', hypothesis: '', steps: '', environment: '', seed: '', parameters: [], metrics: [], conclusion: '', conclusionBasis: '', conclusionScope: '', conclusionEvidence: [], template: null })
      showDetail(null, true)
      restoreDraft('new').then(function (restored) {
        if (restored) ctx.setStatus(t('draftRestored'), 'neutral')
      })
    }

    function closeDetail(keepDraft) {
      if (nodes.detail === null) return
      if (app.dirty && keepDraft !== true) {
        nodes.confirmText.textContent = t('unsavedClose')
        if (typeof nodes.confirm.showModal === 'function') nodes.confirm.showModal()
        return
      }
      if (app.dirty) flushDraft()
      nodes.detail.hidden = true
      if (nodes.noteWrap !== null) nodes.noteWrap.hidden = false
      delete ctx.card.dataset.editing
      if (nodes.list !== null) nodes.list.hidden = app.rows.length === 0
      app.editing = false
      app.dirty = false
      ui.openId = null
      ui.restoreOpen = false
      ctx.persist({ openId: null })
      ctx.refreshList()
      focusTrigger()
    }

    function focusTrigger() {
      if (app.triggerId !== null && nodes.list !== null) {
        var rows = nodes.list.querySelectorAll('.rs__row')
        for (var at = 0; at < rows.length; at += 1) {
          if (rows[at].getAttribute('data-id') === app.triggerId) {
            rows[at].focus()
            return
          }
        }
      }
      if (nodes.newButton !== null && !nodes.newButton.disabled) nodes.newButton.focus()
    }

    function onInput() {
      if (!app.editing) return
      app.dirty = true
      if (draftTimer !== null) window.clearTimeout(draftTimer)
      draftTimer = window.setTimeout(function () { flushDraft() }, pure.DRAFT_DELAY)
    }

    function flushDraft() {
      if (draftTimer !== null) {
        window.clearTimeout(draftTimer)
        draftTimer = null
      }
      if (!live || !app.editing || !app.dirty) return
      var key = app.baseline === null ? 'new' : app.baseline.id
      var payload = { op: 'save', form: formOf() }
      if (app.draftId !== null) payload.draftId = app.draftId
      if (app.baseline !== null) payload.recordId = app.baseline.id
      widget.call(DRAFT, payload).then(function (result) {
        if (result === null || typeof result !== 'object' || typeof result.draftId !== 'string') return
        app.draftId = result.draftId
        ui.draftIds[key] = result.draftId
        ctx.persist({ draftIds: ui.draftIds })
        if (app.editing && !app.saving) ctx.setStatus(t('draftSaved'), 'neutral')
      }, function () {
        // 草稿存不下时不覆盖输入；保存按钮仍然可用，失败由保存那条路告诉人。
      })
    }

    function removeDraft(key, id) {
      var draftId = typeof id === 'string' ? id : ui.draftIds[key]
      if (typeof draftId !== 'string') return
      delete ui.draftIds[key]
      app.draftId = null
      ctx.persist({ draftIds: ui.draftIds })
      if (live) widget.call(DRAFT, { op: 'remove', draftId: draftId }).catch(function () {})
    }

    function restoreDraft(key) {
      var id = ui.draftIds[key]
      if (!live || typeof id !== 'string') return Promise.resolve(false)
      return widget.call(DRAFT, { op: 'load', draftId: id }).then(function (result) {
        var draft = result !== null && typeof result === 'object' ? result.draft : null
        if (draft === null || typeof draft !== 'object' || draft.form === null || typeof draft.form !== 'object') return false
        app.draftId = id
        var form = draft.form
        if (Array.isArray(form.related)) { app.related = form.related; relations.load(form.related) }
        nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
        nodes.methodInput.value = pure.METHODS.indexOf(form.method) >= 0 ? form.method : 'simulation'
        nodes.question.value = typeof form.question === 'string' ? form.question : ''
        nodes.purpose.value = typeof form.purpose === 'string' ? form.purpose : ''
        nodes.hypothesis.value = typeof form.hypothesis === 'string' ? form.hypothesis : ''
        nodes.steps.value = typeof form.steps === 'string' ? form.steps : ''
        nodes.environmentInput.value = typeof form.environment === 'string' ? form.environment : ''
        nodes.seedInput.value = typeof form.seed === 'string' ? form.seed : ''
        nodes.conclusion.value = typeof form.conclusion === 'string' ? form.conclusion : ''
        nodes.conclusionBasis.value = typeof form.conclusionBasis === 'string' ? form.conclusionBasis : ''
        nodes.conclusionScope.value = typeof form.conclusionScope === 'string' ? form.conclusionScope : ''
        evidence.load(Array.isArray(form.conclusionEvidence) ? form.conclusionEvidence : [])
        app.parameters = Array.isArray(form.parameters) ? form.parameters : []
        app.metrics = Array.isArray(form.metrics) ? form.metrics : []
        renderEntries('parameters')
        renderEntries('metrics')
        app.materials = Array.isArray(form.materials) ? form.materials : []
        app.template = form.template !== null && typeof form.template === 'object' ? form.template : null
        renderMaterials()
        app.dirty = true
        return true
      }, function () {
        return false
      })
    }

    function save() {
      if (!live || app.saving) return
      if (app.baseline !== null && typeof app.baseline.deletedAt === 'string') return
      var title = nodes.titleInput.value.trim()
      if (title === '') {
        ctx.setStatus(t('titleRequired'), 'error')
        nodes.titleInput.focus()
        return
      }
      var parameters = pure.cleanEntries(app.parameters)
      var metrics = pure.cleanEntries(app.metrics)
      if (parameters === null || metrics === null) {
        nodes.entryError.textContent = t('entryInvalid')
        ctx.setStatus(t('entryInvalid'), 'error')
        return
      }
      nodes.entryError.textContent = ''
      var conclusionEvidence = pure.cleanEvidence(evidence.value())
      if (conclusionEvidence === null) {
        ctx.setStatus(t('evidenceInvalid'), 'error')
        return
      }
      var fields = {
        title: title,
        method: pure.METHODS.indexOf(nodes.methodInput.value) >= 0 ? nodes.methodInput.value : 'simulation',
        question: nodes.question.value.trim() === '' ? null : nodes.question.value.trim(),
        purpose: nodes.purpose.value.trim() === '' ? null : nodes.purpose.value.trim(),
        hypothesis: nodes.hypothesis.value.trim() === '' ? null : nodes.hypothesis.value.trim(),
        steps: nodes.steps.value.trim() === '' ? null : nodes.steps.value.trim(),
        environment: nodes.environmentInput.value.trim() === '' ? null : nodes.environmentInput.value.trim(),
        seed: nodes.seedInput.value.trim() === '' ? null : nodes.seedInput.value.trim(),
        parameters: parameters.length === 0 ? null : parameters,
        metrics: metrics.length === 0 ? null : metrics,
        conclusion: nodes.conclusion.value.trim() === '' ? null : nodes.conclusion.value.trim(),
        conclusionBasis: nodes.conclusionBasis.value.trim() === '' ? null : nodes.conclusionBasis.value.trim(),
        conclusionScope: nodes.conclusionScope.value.trim() === '' ? null : nodes.conclusionScope.value.trim(),
        conclusionEvidence: conclusionEvidence.length === 0 ? null : conclusionEvidence,
        materials: app.materials.length === 0 ? null : app.materials,
        template: app.template
      }
      var expected = app.baseline === null ? null : app.baseline.revision
      fields.related = relations.value().length ? relations.value() : null
      var creating = app.baseline === null
      app.saving = true
      nodes.saveButton.disabled = true
      nodes.saveButton.textContent = t('saving')
      ctx.setStatus(t('saving'), 'neutral')
      var request = creating
        ? widget.call(WRITE, { op: 'create', record: { kind: pure.KIND, ...fields } })
        : widget.call(WRITE, { op: 'update', id: app.baseline.id, expectedRevision: expected, patch: fields })
      request.then(function (result) {
        app.saving = false
        app.dirty = false
        if (draftTimer !== null) { window.clearTimeout(draftTimer); draftTimer = null }
        var record = result !== null && typeof result === 'object' && result.record !== null && typeof result.record === 'object' ? result.record : null
        if (record === null || typeof record.id !== 'string') {
          ctx.setStatus(t('saveFailed'), 'error')
          nodes.saveButton.disabled = false
          nodes.saveButton.textContent = t('save')
          return
        }
        removeDraft(creating ? 'new' : record.id, app.draftId)
        app.baseline = record
        ui.openId = record.id
        ctx.persist({ openId: record.id, draftIds: ui.draftIds })
        app.materials = Array.isArray(record.materials) ? record.materials.slice() : []
        renderMaterials()
        showDetail(record, false)
        ctx.setStatus(t('saved'), 'ok')
        nodes.saveButton.disabled = false
        nodes.saveButton.textContent = t('save')
        ctx.refreshList()
      }, function (error) {
        app.saving = false
        nodes.saveButton.disabled = false
        nodes.saveButton.textContent = t('save')
        ctx.setStatus(t('saveFailed') + '：' + messageOf(error), 'error')
        if (app.baseline !== null) {
          // 错误里没有结构化字段；重读一次当前记录，修订号与请求时不同就是冲突。
          widget.call(READ, { ids: [app.baseline.id], includeTrashed: true, includeArchived: true }).then(function (result) {
            var current = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records[0] : null
            if (current === null || typeof current !== 'object') {
              ctx.setStatus(t('recordMissing'), 'error')
              return
            }
            if (current.revision !== expected) {
              nodes.conflictText.textContent = t('conflict')
              app.pendingLatest = current
              if (typeof nodes.conflict.showModal === 'function') nodes.conflict.showModal()
            }
          }, function () {})
        }
      })
    }

    function lifeOp(op) {
      if (!live || app.baseline === null || app.saving) return
      var recordId = app.baseline.id
      var draftId = app.draftId
      if (app.dirty) flushDraft()
      app.saving = true
      widget.call(WRITE, { op: op, id: recordId, expectedRevision: app.baseline.revision }).then(function () {
        app.saving = false
        if (op === 'trash') removeDraft(recordId, draftId)
        app.dirty = false
        app.baseline = null
        ui.openId = null
        ui.restoreOpen = false
        ctx.persist({ openId: null })
        if (nodes.detail !== null) nodes.detail.hidden = true
        if (nodes.noteWrap !== null) nodes.noteWrap.hidden = false
        delete ctx.card.dataset.editing
        app.editing = false
        ctx.refreshList()
        ctx.setStatus('', 'neutral')
        focusTrigger()
      }, function (error) {
        app.saving = false
        ctx.setStatus(t('saveFailed') + '：' + messageOf(error), 'error')
      })
    }

    function reloadLatest() {
      var latest = app.pendingLatest
      if (latest === null || typeof latest !== 'object') return
      removeDraft(app.baseline === null ? 'new' : app.baseline.id, app.draftId)
      app.baseline = latest
      app.related = Array.isArray(latest.related) ? latest.related.slice() : []
      app.pendingLatest = null
      app.materials = Array.isArray(latest.materials) ? latest.materials.slice() : []
      fillForm({
        title: latest.title,
        method: pure.methodOf(latest),
        question: latest.question,
        purpose: latest.purpose,
        hypothesis: latest.hypothesis,
        steps: latest.steps,
        environment: latest.environment,
        seed: latest.seed,
        parameters: pure.entriesOf(latest, 'parameters'),
        metrics: pure.entriesOf(latest, 'metrics'),
        conclusion: latest.conclusion,
        conclusionBasis: latest.conclusionBasis,
        conclusionScope: latest.conclusionScope,
        conclusionEvidence: pure.evidenceOf(latest)
      })
      app.dirty = false
      showDetail(latest, false)
      ctx.setStatus(t('saved'), 'ok')
      ctx.refreshList()
    }

    function refreshPlanRuns() {
      if (nodes.runs === null) return
      var baseline = app.baseline
      if (baseline === null || typeof baseline !== 'object') {
        nodes.runs.replaceChildren()
        if (nodes.runError !== null) nodes.runError.textContent = ''
        return
      }
      if (!live) {
        nodes.runs.replaceChildren()
        return
      }
      var wanted = baseline.id
      widget.call(READ, { kind: 'run', references: { kind: 'research', id: wanted }, includeArchived: true }).then(function (result) {
        if (app.baseline === null || app.baseline.id !== wanted) return
        var records = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records : []
        var runs = pure.planRuns(records)
        var items = []
        for (var at = 0; at < runs.length; at += 1) items.push(view.planRunRow(runs[at], text))
        if (items.length === 0) {
          var empty = document.createElement('li')
          empty.className = 'rs__run-empty'
          empty.textContent = t('planRunsEmpty')
          items.push(empty)
        }
        nodes.runs.replaceChildren.apply(nodes.runs, items)
        if (nodes.runError !== null) nodes.runError.textContent = ''
      }, function () {
        if (nodes.runError !== null) nodes.runError.textContent = t('runsFailed')
      })
    }

    function createRun() {
      if (!live || creatingRun || app.baseline === null || typeof app.baseline.deletedAt === 'string') return
      var plan = app.baseline
      creatingRun = true
      if (nodes.newRunButton !== null) nodes.newRunButton.disabled = true
      ctx.setStatus(t('creatingRun'), 'neutral')
      widget.call(WRITE, {
        op: 'create',
        record: { kind: 'run', title: pure.runTitleOf(plan), plan: { kind: 'research', id: plan.id }, status: 'planned' }
      }).then(function (result) {
        creatingRun = false
        if (nodes.newRunButton !== null) nodes.newRunButton.disabled = false
        var record = result !== null && typeof result === 'object' && result.record !== null && typeof result.record === 'object' ? result.record : null
        if (record === null || typeof record.id !== 'string') {
          if (nodes.runError !== null) nodes.runError.textContent = t('runCreateFailed')
          ctx.setStatus(t('runCreateFailed'), 'error')
          return
        }
        if (nodes.runError !== null) nodes.runError.textContent = ''
        ctx.setStatus(t('runCreated'), 'ok')
        refreshPlanRuns()
      }, function (error) {
        creatingRun = false
        if (nodes.newRunButton !== null) nodes.newRunButton.disabled = false
        var message = t('runCreateFailed') + '：' + messageOf(error)
        if (nodes.runError !== null) nodes.runError.textContent = message
        ctx.setStatus(message, 'error')
      })
    }

    function renderEntries(kind) {
      var list = kind === 'parameters' ? nodes.parameters : nodes.metrics
      if (list === null) return
      var entries = kind === 'parameters' ? app.parameters : app.metrics
      var items = []
      for (var at = 0; at < entries.length; at += 1) items.push(view.entryRow(entries[at], at, kind, text))
      list.replaceChildren.apply(list, items)
      var inputs = list.querySelectorAll('input')
      for (var inputAt = 0; inputAt < inputs.length; inputAt += 1) {
        inputs[inputAt].addEventListener('input', function (event) {
          updateEntry(event.target)
        })
      }
    }

    function updateEntry(target) {
      if (!(target instanceof Element)) return
      var row = target.closest('.rs__entry')
      if (row === null) return
      var kind = row.dataset.kind
      var index = Number(row.dataset.index)
      var entries = kind === 'metrics' ? app.metrics : app.parameters
      if (!Number.isInteger(index) || entries[index] === undefined) return
      var part = target.getAttribute('data-part')
      if (part !== 'name' && part !== 'value' && part !== 'unit') return
      entries[index][part] = target.value
      onInput()
    }

    function addEntry(kind) {
      var entries = kind === 'metrics' ? app.metrics : app.parameters
      if (entries.length >= pure.MAX_ENTRIES) return
      entries.push({ name: '', value: '', unit: '' })
      renderEntries(kind)
      var list = kind === 'parameters' ? nodes.parameters : nodes.metrics
      var rows = list.querySelectorAll('.rs__entry')
      var last = rows[rows.length - 1]
      if (last !== undefined) {
        var first = last.querySelector('input')
        if (first !== null) first.focus()
      }
      onInput()
    }

    function removeEntry(kind, index) {
      var entries = kind === 'metrics' ? app.metrics : app.parameters
      if (!Number.isInteger(index) || entries[index] === undefined) return
      entries.splice(index, 1)
      renderEntries(kind)
      onInput()
    }

    function renderMaterials() {
      if (nodes.materials === null) return
      var items = []
      for (var at = 0; at < app.materials.length; at += 1) {
        var material = app.materials[at]
        if (material === null || typeof material !== 'object') continue
        items.push(view.materialRow(material, t('removeMaterial')))
      }
      nodes.materials.replaceChildren.apply(nodes.materials, items)
    }

    function addMaterial() {
      var url = nodes.materialUrl.value.trim()
      var title = nodes.materialTitle.value.trim()
      if (!pure.materialValid(url, title)) {
        nodes.materialError.textContent = t('materialInvalid')
        return
      }
      nodes.materialError.textContent = ''
      app.materials.push({ id: 'm-' + String(Date.now()) + '-' + String(app.materials.length), url: url, title: title })
      nodes.materialUrl.value = ''
      nodes.materialTitle.value = ''
      renderMaterials()
      onInput()
    }

    function removeMaterial(id) {
      app.materials = app.materials.filter(function (entry) { return entry !== null && typeof entry === 'object' && String(entry.id) !== String(id) })
      renderMaterials()
      onInput()
    }

    function messageOf(error) {
      return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
    }

    return {
      openRecord: openRecord,
      openNew: openNew,
      closeDetail: closeDetail,
      save: save,
      lifeOp: lifeOp,
      onInput: onInput,
      renderEntries: renderEntries,
      addEntry: addEntry,
      removeEntry: removeEntry,
      renderMaterials: renderMaterials,
      addMaterial: addMaterial,
      removeMaterial: removeMaterial,
      reloadLatest: reloadLatest,
      refreshPlanRuns: refreshPlanRuns,
      createRun: createRun
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
