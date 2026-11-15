/*
 * 运行记录卡的编辑面板：详情表单、数据集与结果、草稿、保存、修订冲突、归档 / 回收站与复制为新计划。
 *
 * 由 main.js 在启动时用一份上下文建出来；这一份只处理打开着的那一条，完成后让 main.js 重新取列表。
 * 这里不执行任何脚本，代码、配置、指标、结果与产物都只是写下来的值。
 */
;(function (root) {
  'use strict'

  /**
   * 建编辑面板。
   *
   * @param {object} ctx - 节点、状态、文案与列表刷新回调。
   * @returns {object} 面板对外的动作。
   */
  root.createRunEditor = function (ctx) {
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
    var duplicating = false
    var relations = widget.createRecordRelations({ container: nodes.detail,
      current: function () { return app.baseline },
      onChange: function (refs) { app.related = refs; onInput() }
    })
    var templatePanel = nodes.template === null ? null : widget.createTemplatePanel({
      container: nodes.template,
      current: function () {
        return widget.templateCurrent([app.config, app.metrics], { '种子': nodes.seedInput.value, '随机种子': nodes.seedInput.value, '评估集合': nodes.evaluationInput.value, '评价集合': nodes.evaluationInput.value, '环境': nodes.environmentInput.value })
      },
      onApply: function (snapshot, fields) {
        var applied = widget.templateApplication(fields, widget.templateValuesOf(snapshot), { inputs: app.config, metrics: app.metrics })
        app.config = applied.inputs
        app.metrics = applied.metrics
        if (typeof applied.seed === 'string') nodes.seedInput.value = applied.seed
        if (typeof applied.evaluation === 'string') nodes.evaluationInput.value = applied.evaluation
        if (typeof applied.environment === 'string') nodes.environmentInput.value = applied.environment
        app.template = snapshot
        renderEntries('config')
        renderEntries('metrics')
        onInput()
      }
    })

    function formOf() {
      return {
        related: relations.value(),
        title: nodes.titleInput.value,
        status: nodes.statusInput.value,
        plan: nodes.planInput.value,
        repository: nodes.repositoryInput.value,
        commit: nodes.commitInput.value,
        datasets: app.datasets,
        checkpoints: app.checkpoints,
        config: app.config,
        metrics: app.metrics,
        environment: nodes.environmentInput.value,
        seed: nodes.seedInput.value,
        evaluation: nodes.evaluationInput.value,
        startedAt: nodes.startedInput.value,
        endedAt: nodes.endedInput.value,
        results: app.results,
        artifacts: app.artifacts,
        failure: nodes.failure.value,
        note: nodes.noteField.value,
        template: app.template
      }
    }

    /** 一条已保存记录写成表单的值；打开与载入最新共用。 */
    function formOfRecord(record) {
      var code = record.code !== null && typeof record.code === 'object' ? record.code : {}
      return {
        title: record.title,
        status: pure.statusOf(record),
        plan: pure.planIdOf(record),
        repository: code.repository,
        commit: code.commit,
        datasets: Array.isArray(record.datasets) ? record.datasets : [],
        checkpoints: pure.entriesOf(record, 'checkpoints'),
        config: pure.entriesOf(record, 'config'),
        metrics: pure.entriesOf(record, 'metrics'),
        environment: record.environment,
        seed: record.seed,
        evaluation: record.evaluation,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        results: pure.resultRows(record),
        artifacts: Array.isArray(record.artifacts) ? record.artifacts : [],
        failure: record.failure,
        note: record.note,
        template: record.template
      }
    }

    /** 方案下拉：未指定、现有研究记录，以及已经不在列表里的旧方案。 */
    function fillPlanOptions(selected) {
      var wanted = typeof selected === 'string' ? selected : ''
      var list = Array.isArray(ctx.plans()) ? ctx.plans() : []
      var items = []
      var none = document.createElement('option')
      none.value = ''
      none.textContent = t('planNone')
      items.push(none)
      var present = false
      for (var at = 0; at < list.length; at += 1) {
        var plan = list[at]
        if (plan === null || typeof plan !== 'object' || typeof plan.id !== 'string') continue
        var option = document.createElement('option')
        option.value = plan.id
        option.textContent = typeof plan.title === 'string' && plan.title !== '' ? plan.title : plan.id
        if (plan.id === wanted) present = true
        items.push(option)
      }
      if (wanted !== '' && !present) {
        var missing = document.createElement('option')
        missing.value = wanted
        missing.textContent = wanted + ' · ' + t('planMissing')
        items.push(missing)
      }
      nodes.planInput.replaceChildren.apply(nodes.planInput, items)
      nodes.planInput.value = wanted
    }

    function fillForm(form) {
      relations.load(Array.isArray(form.related) ? form.related : app.related)
      nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
      nodes.statusInput.value = pure.STATUSES.indexOf(form.status) >= 0 ? form.status : 'planned'
      fillPlanOptions(typeof form.plan === 'string' ? form.plan : '')
      nodes.repositoryInput.value = typeof form.repository === 'string' ? form.repository : ''
      nodes.commitInput.value = typeof form.commit === 'string' ? form.commit : ''
      nodes.startedInput.value = pure.timeValue(form.startedAt)
      nodes.endedInput.value = pure.timeValue(form.endedAt)
      nodes.environmentInput.value = typeof form.environment === 'string' ? form.environment : ''
      nodes.seedInput.value = typeof form.seed === 'string' ? form.seed : ''
      nodes.evaluationInput.value = typeof form.evaluation === 'string' ? form.evaluation : ''
      nodes.failure.value = typeof form.failure === 'string' ? form.failure : ''
      nodes.noteField.value = typeof form.note === 'string' ? form.note : ''
      app.datasets = Array.isArray(form.datasets) ? form.datasets.map(pure.copyRow) : []
      app.checkpoints = Array.isArray(form.checkpoints) ? form.checkpoints.map(pure.copyRow) : []
      app.config = Array.isArray(form.config) ? form.config.map(pure.copyRow) : []
      app.metrics = Array.isArray(form.metrics) ? form.metrics.map(pure.copyRow) : []
      app.results = Array.isArray(form.results) ? form.results.map(pure.copyResult) : []
      app.artifacts = Array.isArray(form.artifacts) ? form.artifacts.map(pure.copyRow) : []
      app.template = form.template !== null && typeof form.template === 'object' ? form.template : null
      renderDatasets()
      renderEntries('checkpoints')
      renderEntries('config')
      renderEntries('metrics')
      renderResults()
      renderArtifacts()
      if (nodes.datasetError !== null) nodes.datasetError.textContent = ''
      if (nodes.entryError !== null) nodes.entryError.textContent = ''
      if (nodes.resultError !== null) nodes.resultError.textContent = ''
      if (nodes.timeError !== null) nodes.timeError.textContent = ''
      ctx.setStatus('', 'neutral')
      if (nodes.detailHint !== null) nodes.detailHint.hidden = true
    }

    function showDetail(record, focus) {
      if (nodes.detail === null) return
      var trashed = record !== null && typeof record.deletedAt === 'string'
      nodes.detail.hidden = false
      ctx.card.dataset.editing = 'true'
      if (nodes.list !== null) nodes.list.hidden = true
      if (nodes.noteWrap !== null) nodes.noteWrap.hidden = true
      nodes.archiveAction.hidden = record === null || trashed || record.archived === true
      nodes.restoreAction.hidden = record === null || (!trashed && record.archived !== true)
      nodes.trashAction.hidden = record === null || trashed
      nodes.duplicateButton.hidden = record === null || trashed
      var fields = [nodes.titleInput, nodes.statusInput, nodes.planInput, nodes.repositoryInput, nodes.commitInput, nodes.environmentInput, nodes.seedInput, nodes.evaluationInput, nodes.startedInput, nodes.endedInput, nodes.failure, nodes.noteField, nodes.artifactUrl, nodes.artifactTitle]
      for (var at = 0; at < fields.length; at += 1) fields[at].disabled = trashed
      setDisabled(trashed)
      nodes.saveButton.disabled = trashed
      nodes.saveButton.textContent = t('save')
      if (nodes.duplicateButton !== null) nodes.duplicateButton.disabled = trashed
      nodes.detailHint.textContent = trashed ? t('trashRestoreHint') : ''
      nodes.detailHint.hidden = !trashed
      if (nodes.template !== null) nodes.template.hidden = trashed
      if (focus === true) nodes.titleInput.focus()
    }

    /** 回收站里的记录只能读：所有能改内容的控件一起停用。 */
    function setDisabled(trashed) {
      var controls = nodes.detail.querySelectorAll('.rr__input, .rr__entry-remove, .rr__result-remove, .rr__manual input, .rr__sources-picker, [data-action^="add-"]')
      for (var at = 0; at < controls.length; at += 1) controls[at].disabled = trashed
    }

    function openRecord(record) {
      app.related = Array.isArray(record.related) ? record.related.slice() : []
      app.editing = true
      app.baseline = record
      app.draftId = null
      app.dirty = false
      app.saving = false
      fillForm(formOfRecord(record))
      showDetail(record, true)
      void loadSources()
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
      fillForm({ title: pure.newRunTitle(), status: 'planned', plan: '', repository: '', commit: '', datasets: [], checkpoints: [], config: [], metrics: [], environment: '', seed: '', evaluation: '', startedAt: '', endedAt: '', results: [], artifacts: [], failure: '', note: '', template: null })
      showDetail(null, true)
      void loadSources()
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
        var rows = nodes.list.querySelectorAll('.rr__row')
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
        if (Array.isArray(form.related)) app.related = form.related
        fillForm(form)
        void loadSources()
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
      var datasets = pure.cleanDatasets(app.datasets, String(Date.now()))
      if (datasets === null) {
        nodes.datasetError.textContent = t('datasetInvalid')
        ctx.setStatus(t('datasetInvalid'), 'error')
        return
      }
      var checkpoints = pure.cleanEntries(app.checkpoints)
      var config = pure.cleanEntries(app.config)
      var metrics = pure.cleanEntries(app.metrics)
      if (checkpoints === null || config === null || metrics === null) {
        nodes.entryError.textContent = t('entryInvalid')
        ctx.setStatus(t('entryInvalid'), 'error')
        return
      }
      var started = pure.timeOut(nodes.startedInput.value)
      var ended = pure.timeOut(nodes.endedInput.value)
      if (!started.ok || !ended.ok) {
        nodes.timeError.textContent = t('timeInvalid')
        ctx.setStatus(t('timeInvalid'), 'error')
        return
      }
      var results = pure.cleanResults(app.results, String(Date.now()))
      if (results === null) {
        nodes.resultError.textContent = t('resultInvalid')
        ctx.setStatus(t('resultInvalid'), 'error')
        return
      }
      nodes.datasetError.textContent = ''
      nodes.entryError.textContent = ''
      nodes.timeError.textContent = ''
      nodes.resultError.textContent = ''
      var plan = nodes.planInput.value
      var repository = nodes.repositoryInput.value.trim()
      var commit = nodes.commitInput.value.trim()
      var fields = {
        title: title,
        status: pure.STATUSES.indexOf(nodes.statusInput.value) >= 0 ? nodes.statusInput.value : 'planned',
        plan: plan === '' ? null : { kind: 'research', id: plan },
        code: repository === '' && commit === '' ? null : { ...(repository === '' ? {} : { repository: repository }), ...(commit === '' ? {} : { commit: commit }) },
        datasets: datasets.length === 0 ? null : datasets,
        checkpoints: checkpoints.length === 0 ? null : checkpoints,
        config: config.length === 0 ? null : config,
        metrics: metrics.length === 0 ? null : metrics,
        environment: nodes.environmentInput.value.trim() === '' ? null : nodes.environmentInput.value.trim(),
        seed: nodes.seedInput.value.trim() === '' ? null : nodes.seedInput.value.trim(),
        evaluation: nodes.evaluationInput.value.trim() === '' ? null : nodes.evaluationInput.value.trim(),
        startedAt: started.value,
        endedAt: ended.value,
        results: results.length === 0 ? null : results,
        artifacts: app.artifacts.length === 0 ? null : app.artifacts,
        failure: nodes.failure.value.trim() === '' ? null : nodes.failure.value.trim(),
        note: nodes.noteField.value.trim() === '' ? null : nodes.noteField.value.trim(),
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
        nodes.saveButton.disabled = false
        nodes.saveButton.textContent = t('save')
        showDetail(record, false)
        ctx.setStatus(t('saved'), 'ok')
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
      fillForm(formOfRecord(latest))
      app.dirty = false
      showDetail(latest, false)
      void loadSources()
      ctx.setStatus(t('saved'), 'ok')
      ctx.refreshList()
    }

    /** 读取来源运行：同一方案下的其他运行；没有方案时给全部运行。读不到时保留已选来源。 */
    function loadSources() {
      if (!live) { app.sourceRuns = []; return Promise.resolve() }
      var plan = nodes.planInput.value
      var query = plan === ''
        ? { kind: 'run', includeArchived: true }
        : { kind: 'run', includeArchived: true, references: { kind: 'research', id: plan } }
      return widget.call(READ, query).then(function (result) {
        if (nodes.planInput.value !== plan) return
        var records = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records : []
        var own = app.baseline === null ? null : app.baseline.id
        var out = []
        for (var at = 0; at < records.length; at += 1) {
          var record = records[at]
          if (record === null || typeof record !== 'object' || record.id === own) continue
          out.push({ id: record.id, title: typeof record.title === 'string' ? record.title : record.id })
        }
        app.sourceRuns = out
        renderResults()
      }, function () {
        app.sourceRuns = app.sourceRuns || []
      })
    }

    function duplicate() {
      if (!live || duplicating || app.baseline === null || typeof app.baseline.deletedAt === 'string') return
      var record = pure.duplicateAsPlanned(app.baseline, pure.duplicateTitle(app.baseline))
      duplicating = true
      if (nodes.duplicateButton !== null) nodes.duplicateButton.disabled = true
      ctx.setStatus(t('saving'), 'neutral')
      widget.call(WRITE, { op: 'create', record: record }).then(function (result) {
        duplicating = false
        if (nodes.duplicateButton !== null) nodes.duplicateButton.disabled = false
        var created = result !== null && typeof result === 'object' && result.record !== null && typeof result.record === 'object' ? result.record : null
        if (created === null || typeof created.id !== 'string') {
          ctx.setStatus(t('duplicateFailed'), 'error')
          return
        }
        ctx.setStatus(t('duplicated'), 'ok')
        ctx.refreshList()
      }, function (error) {
        duplicating = false
        if (nodes.duplicateButton !== null) nodes.duplicateButton.disabled = false
        ctx.setStatus(t('duplicateFailed') + '：' + messageOf(error), 'error')
      })
    }

    function entriesOfKind(kind) {
      return kind === 'checkpoints' ? app.checkpoints : kind === 'config' ? app.config : app.metrics
    }

    function renderEntries(kind) {
      var list = nodes[kind]
      if (list === null) return
      var entries = entriesOfKind(kind)
      var items = []
      for (var at = 0; at < entries.length; at += 1) items.push(view.entryRow(entries[at], at, kind, text))
      list.replaceChildren.apply(list, items)
      var trashed = app.baseline !== null && typeof app.baseline.deletedAt === 'string'
      if (trashed) setDisabled(true)
    }

    function syncEntry(row) {
      if (row === null) return
      var kind = row.dataset.kind
      var index = Number(row.dataset.index)
      var entries = entriesOfKind(kind)
      if (!Number.isInteger(index) || entries[index] === undefined) return
      var inputs = row.querySelectorAll('[data-part]')
      var entry = entries[index]
      for (var at = 0; at < inputs.length; at += 1) {
        var part = inputs[at].getAttribute('data-part')
        if (part === 'name' || part === 'value' || part === 'unit' || part === 'definition') entry[part] = inputs[at].value
      }
    }

    function addEntry(kind) {
      var entries = entriesOfKind(kind)
      if (entries.length >= pure.MAX_ENTRIES) return
      entries.push({ name: '', value: '', unit: '', definition: '' })
      renderEntries(kind)
      var list = nodes[kind]
      var rows = list.querySelectorAll('.rr__entry')
      var last = rows[rows.length - 1]
      if (last !== undefined) {
        var first = last.querySelector('input')
        if (first !== null) first.focus()
      }
      onInput()
    }

    function removeEntry(kind, index) {
      var entries = entriesOfKind(kind)
      if (!Number.isInteger(index) || entries[index] === undefined) return
      entries.splice(index, 1)
      renderEntries(kind)
      onInput()
    }

    function renderDatasets() {
      if (nodes.datasets === null) return
      var items = []
      for (var at = 0; at < app.datasets.length; at += 1) items.push(view.datasetRow(app.datasets[at], at, text))
      nodes.datasets.replaceChildren.apply(nodes.datasets, items)
      var trashed = app.baseline !== null && typeof app.baseline.deletedAt === 'string'
      if (trashed) setDisabled(true)
    }

    function syncDataset(row) {
      if (row === null) return
      var index = Number(row.dataset.index)
      if (!Number.isInteger(index) || app.datasets[index] === undefined) return
      var dataset = app.datasets[index]
      var inputs = row.querySelectorAll('[data-part]')
      for (var at = 0; at < inputs.length; at += 1) {
        var part = inputs[at].getAttribute('data-part')
        if (part === 'name' || part === 'split' || part === 'version') dataset[part] = inputs[at].value
      }
      if (typeof dataset.id !== 'string' || dataset.id === '') dataset.id = 'dataset-' + String(Date.now()) + '-' + String(index)
      row.dataset.datasetId = dataset.id
    }

    function addDataset() {
      if (app.datasets.length >= pure.MAX_DATASETS) return
      app.datasets.push({ id: 'dataset-' + String(Date.now()) + '-' + String(app.datasets.length), name: '', split: '', version: '' })
      renderDatasets()
      var rows = nodes.datasets.querySelectorAll('.rr__dataset')
      var last = rows[rows.length - 1]
      if (last !== undefined) {
        var first = last.querySelector('input')
        if (first !== null) first.focus()
      }
      onInput()
    }

    function removeDataset(index) {
      if (!Number.isInteger(index) || app.datasets[index] === undefined) return
      app.datasets.splice(index, 1)
      renderDatasets()
      onInput()
    }

    function renderResults() {
      if (nodes.results === null) return
      var items = []
      var runs = Array.isArray(app.sourceRuns) ? app.sourceRuns : []
      for (var at = 0; at < app.results.length; at += 1) items.push(view.resultRow(app.results[at], at, text, runs))
      nodes.results.replaceChildren.apply(nodes.results, items)
      var trashed = app.baseline !== null && typeof app.baseline.deletedAt === 'string'
      if (trashed) setDisabled(true)
    }

    function syncResult(row) {
      if (row === null) return
      var index = Number(row.dataset.index)
      if (!Number.isInteger(index) || app.results[index] === undefined) return
      var result = app.results[index]
      var kindNode = row.querySelector('[data-part="kind"]')
      if (kindNode !== null) {
        result.kind = kindNode.value === 'aggregate' ? 'aggregate' : 'single'
        row.dataset.kind = result.kind
        view.setResultKind(row)
      }
      var textNode = row.querySelector('[data-part="text"]')
      if (textNode !== null) result.text = textNode.value
      var methodNode = row.querySelector('[data-part="method"]')
      if (methodNode !== null) result.method = methodNode.value
      var sampleNode = row.querySelector('[data-part="sampleSize"]')
      if (sampleNode !== null) result.sampleSize = sampleNode.value
      var dispersionNode = row.querySelector('[data-part="dispersion"]')
      if (dispersionNode !== null) result.dispersion = dispersionNode.value
      var manualNode = row.querySelector('[data-part="manual"]')
      if (manualNode !== null) result.manual = manualNode.checked
      var picker = row.querySelector('[data-part="sources"]')
      if (picker !== null) {
        var sources = []
        for (var at = 0; at < picker.options.length; at += 1) if (picker.options[at].selected) sources.push(picker.options[at].value)
        result.sources = sources
      }
    }

    function addResult() {
      if (app.results.length >= pure.MAX_RESULTS) return
      app.results.push({ id: 'result-' + String(Date.now()) + '-' + String(app.results.length), kind: 'single', text: '', method: '', sampleSize: '', dispersion: '', manual: false, sources: [] })
      renderResults()
      var rows = nodes.results.querySelectorAll('.rr__result')
      var last = rows[rows.length - 1]
      if (last !== undefined) {
        var input = last.querySelector('[data-part="text"]')
        if (input !== null) input.focus()
      }
      onInput()
    }

    function removeResult(index) {
      if (!Number.isInteger(index) || app.results[index] === undefined) return
      app.results.splice(index, 1)
      renderResults()
      onInput()
    }

    function renderArtifacts() {
      if (nodes.artifacts === null) return
      var items = []
      for (var at = 0; at < app.artifacts.length; at += 1) {
        var artifact = app.artifacts[at]
        if (artifact === null || typeof artifact !== 'object') continue
        items.push(view.artifactRow(artifact, t('removeArtifact')))
      }
      nodes.artifacts.replaceChildren.apply(nodes.artifacts, items)
    }

    function addArtifact() {
      var url = nodes.artifactUrl.value.trim()
      var title = nodes.artifactTitle.value.trim()
      if (!pure.artifactValid(url, title)) {
        nodes.artifactError.textContent = t('artifactInvalid')
        return
      }
      nodes.artifactError.textContent = ''
      app.artifacts.push({ id: 'a-' + String(Date.now()) + '-' + String(app.artifacts.length), url: url, title: title })
      nodes.artifactUrl.value = ''
      nodes.artifactTitle.value = ''
      renderArtifacts()
      onInput()
    }

    function removeArtifact(id) {
      app.artifacts = app.artifacts.filter(function (entry) { return entry !== null && typeof entry === 'object' && String(entry.id) !== String(id) })
      renderArtifacts()
      onInput()
    }

    function messageOf(error) { return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '' ? error.message : String(error) }

    return {
      openRecord: openRecord,
      openNew: openNew,
      closeDetail: closeDetail,
      save: save,
      lifeOp: lifeOp,
      duplicate: duplicate,
      onInput: onInput,
      renderEntries: renderEntries,
      syncEntry: syncEntry,
      addEntry: addEntry,
      removeEntry: removeEntry,
      renderDatasets: renderDatasets,
      syncDataset: syncDataset,
      addDataset: addDataset,
      removeDataset: removeDataset,
      renderResults: renderResults,
      syncResult: syncResult,
      addResult: addResult,
      removeResult: removeResult,
      renderArtifacts: renderArtifacts,
      addArtifact: addArtifact,
      removeArtifact: removeArtifact,
      loadSources: loadSources,
      refreshPlans: function () {
        if (nodes.detail === null || nodes.detail.hidden) return
        fillPlanOptions(nodes.planInput.value)
      },
      reloadLatest: reloadLatest
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
