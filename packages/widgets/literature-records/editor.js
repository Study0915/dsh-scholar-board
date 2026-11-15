/*
 * 文献阅读卡的编辑面板：详情表单、草稿、保存、修订冲突与归档 / 回收站操作。
 *
 * 由 main.js 在启动时用一份上下文建出来；这一份不碰列表与查询，只处理打开着的那一条，
 * 完成后让 main.js 重新取列表。来源地址由宿主打开（D26），组件自己不导航。
 */
;(function (root) {
  'use strict'

  /**
   * 建编辑面板。
   *
   * @param {object} ctx - 节点、状态、文案与列表刷新回调。
   * @returns {object} 面板对外的动作。
   */
  root.createLiteratureEditor = function (ctx) {
    var app = ctx.app
    var ui = ctx.ui
    var nodes = ctx.nodes
    var widget = ctx.widget
    var live = ctx.live
    var t = ctx.t
    var pure = ctx.pure
    var view = ctx.view
    var READ = 'widget-board:records.read'
    var WRITE = 'widget-board:records.write'
    var DRAFT = 'widget-board:records.draft'
    var VERSIONS_LIMIT = 20
    var draftTimer = null
    var relations = widget.createRecordRelations({ container: nodes.detail,
      current: function () { return app.baseline },
      onChange: function (refs) { app.related = refs; onInput() }
    })
    var versions = widget.createRecordRelations({ container: nodes.detail,
      current: function () { return app.baseline },
      onChange: function () { onInput() },
      kinds: ['literature'],
      title: t('versionsTitle')
    })
    var reading = root.createLiteratureReading({
      widget: widget,
      live: live,
      nodes: nodes,
      t: t,
      pure: pure,
      setStatus: ctx.setStatus,
      onInput: function () { onInput() },
      ensureSaved: function () { return ensureSaved() },
      adopt: function (record) { adoptRecord(record) }
    })

    function formOf() {
      return {
        related: relations.value(),
        versions: versions.value(),
        title: nodes.titleInput.value,
        authors: nodes.authorsInput.value,
        venue: nodes.venueInput.value,
        year: nodes.yearInput.value,
        url: nodes.urlInput.value,
        stage: nodes.stageInput.value,
        format: nodes.formatInput.value,
        doi: nodes.doiInput.value,
        arxivId: nodes.arxivInput.value,
        arxivVersion: nodes.arxivVersionInput.value,
        understanding: nodes.understanding.value,
        questions: nodes.questions.value,
        reading: reading.value(),
        materials: app.materials
      }
    }

    /** 记录里的标识字段放回输入框；未填时清空。 */
    function fillIdentifiers(form) {
      nodes.formatInput.value = pure.formatOf({ format: form.format })
      nodes.doiInput.value = typeof form.doi === 'string' ? form.doi : ''
      nodes.arxivInput.value = typeof form.arxivId === 'string' ? form.arxivId : ''
      nodes.arxivVersionInput.value = typeof form.arxivVersion === 'string' ? form.arxivVersion : ''
      if (nodes.identifierError !== null) nodes.identifierError.textContent = ''
    }

    function fillForm(form) {
      relations.load(Array.isArray(form.related) ? form.related : app.related)
      versions.load(Array.isArray(form.versions) ? form.versions : [])
      nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
      nodes.authorsInput.value = typeof form.authors === 'string' ? form.authors : ''
      nodes.venueInput.value = typeof form.venue === 'string' ? form.venue : ''
      nodes.yearInput.value = typeof form.year === 'number' ? String(form.year) : ''
      nodes.urlInput.value = typeof form.url === 'string' ? form.url : ''
      nodes.stageInput.value = pure.STAGES.indexOf(form.stage) >= 0 ? form.stage : 'queued'
      fillIdentifiers(form)
      nodes.understanding.value = typeof form.understanding === 'string' ? form.understanding : ''
      nodes.questions.value = typeof form.questions === 'string' ? form.questions : ''
      reading.load(form.reading)
      if (nodes.urlError !== null) nodes.urlError.textContent = ''
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
      nodes.titleInput.disabled = trashed
      nodes.authorsInput.disabled = trashed
      nodes.venueInput.disabled = trashed
      nodes.yearInput.disabled = trashed
      nodes.urlInput.disabled = trashed
      nodes.formatInput.disabled = trashed
      nodes.doiInput.disabled = trashed
      nodes.arxivInput.disabled = trashed
      nodes.arxivVersionInput.disabled = trashed
      nodes.stageInput.disabled = trashed
      nodes.understanding.disabled = trashed
      nodes.questions.disabled = trashed
      nodes.materialUrl.disabled = trashed
      nodes.materialTitle.disabled = trashed
      var add = ctx.card.querySelector('[data-action="add-material"]')
      if (add !== null) add.disabled = trashed
      var addReading = ctx.card.querySelector('[data-action="add-reading"]')
      if (addReading !== null) addReading.disabled = trashed
      reading.setReadonly(trashed)
      nodes.saveButton.disabled = trashed
      nodes.saveButton.textContent = t('save')
      nodes.openSource.hidden = trashed || (record !== null && !pure.openableUrl(record.url))
      nodes.openSource.disabled = trashed
      if (trashed) {
        nodes.detailHint.textContent = t('trashRestoreHint')
        if (nodes.detailHint !== null) nodes.detailHint.hidden = false
      } else if (nodes.detailHint !== null) {
        nodes.detailHint.hidden = true
      }
      if (focus === true) nodes.titleInput.focus()
    }

    /** 一条记录变成编辑面板的取值；关联与材料由调用方另放。 */
    function formOfRecord(record) {
      return {
        title: record.title,
        authors: record.authors,
        venue: record.venue,
        year: record.year,
        url: record.url,
        stage: pure.stageOf(record),
        format: record.format,
        doi: record.doi,
        arxivId: record.arxivId,
        arxivVersion: record.arxivVersion,
        versions: Array.isArray(record.versions) ? record.versions : [],
        understanding: record.understanding,
        questions: record.questions,
        reading: record.reading
      }
    }

    function openRecord(record) {
      app.related = Array.isArray(record.related) ? record.related.slice() : []
      app.editing = true
      app.baseline = record
      app.draftId = null
      app.dirty = false
      app.saving = false
      app.materials = Array.isArray(record.materials) ? record.materials.slice() : []
      fillForm(formOfRecord(record))
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
      fillForm({ title: '', authors: '', venue: '', year: null, url: '', stage: 'queued', format: '', doi: '', arxivId: '', arxivVersion: '', versions: [], understanding: '', questions: '', reading: [] })
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
        var rows = nodes.list.querySelectorAll('.lt__row')
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
        if (Array.isArray(form.versions)) versions.load(form.versions)
        nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
        nodes.authorsInput.value = typeof form.authors === 'string' ? form.authors : ''
        nodes.venueInput.value = typeof form.venue === 'string' ? form.venue : ''
        nodes.yearInput.value = typeof form.year === 'string' || typeof form.year === 'number' ? String(form.year) : ''
        nodes.urlInput.value = typeof form.url === 'string' ? form.url : ''
        nodes.stageInput.value = pure.STAGES.indexOf(form.stage) >= 0 ? form.stage : 'queued'
        fillIdentifiers(form)
        nodes.understanding.value = typeof form.understanding === 'string' ? form.understanding : ''
        nodes.questions.value = typeof form.questions === 'string' ? form.questions : ''
        reading.load(form.reading)
        app.materials = Array.isArray(form.materials) ? form.materials : []
        renderMaterials()
        app.dirty = true
        return true
      }, function () {
        return false
      })
    }

    function save() {
      if (!live || app.saving) return Promise.resolve(null)
      if (app.baseline !== null && typeof app.baseline.deletedAt === 'string') return Promise.resolve(null)
      var title = nodes.titleInput.value.trim()
      if (title === '') {
        ctx.setStatus(t('titleRequired'), 'error')
        nodes.titleInput.focus()
        return Promise.resolve(null)
      }
      var year = pure.yearValue(nodes.yearInput.value)
      if (!year.ok) {
        ctx.setStatus(t('yearInvalid'), 'error')
        nodes.yearInput.focus()
        return Promise.resolve(null)
      }
      var url = nodes.urlInput.value.trim()
      if (url !== '' && !pure.openableUrl(url)) {
        if (nodes.urlError !== null) nodes.urlError.textContent = t('sourceUrlInvalid')
        ctx.setStatus(t('sourceUrlInvalid'), 'error')
        nodes.urlInput.focus()
        return Promise.resolve(null)
      }
      if (nodes.urlError !== null) nodes.urlError.textContent = ''
      var versionRefs = versions.value()
      if (versionRefs.length > VERSIONS_LIMIT) {
        ctx.setStatus(t('versionsLimit'), 'error')
        return Promise.resolve(null)
      }
      var fields = {
        title: title,
        authors: nodes.authorsInput.value.trim() === '' ? null : nodes.authorsInput.value.trim(),
        venue: nodes.venueInput.value.trim() === '' ? null : nodes.venueInput.value.trim(),
        year: year.value,
        url: url === '' ? null : url,
        stage: pure.STAGES.indexOf(nodes.stageInput.value) >= 0 ? nodes.stageInput.value : 'queued',
        format: pure.FORMATS.indexOf(nodes.formatInput.value) >= 0 ? nodes.formatInput.value : null,
        doi: nodes.doiInput.value.trim() === '' ? null : nodes.doiInput.value.trim(),
        arxivId: nodes.arxivInput.value.trim() === '' ? null : nodes.arxivInput.value.trim(),
        arxivVersion: nodes.arxivVersionInput.value.trim() === '' ? null : nodes.arxivVersionInput.value.trim(),
        versions: versionRefs.length === 0 ? null : versionRefs,
        understanding: nodes.understanding.value.trim() === '' ? null : nodes.understanding.value.trim(),
        questions: nodes.questions.value.trim() === '' ? null : nodes.questions.value.trim(),
        reading: reading.value(),
        materials: app.materials.length === 0 ? null : app.materials
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
      return request.then(function (result) {
        app.saving = false
        app.dirty = false
        if (draftTimer !== null) { window.clearTimeout(draftTimer); draftTimer = null }
        var record = result !== null && typeof result === 'object' && result.record !== null && typeof result.record === 'object' ? result.record : null
        if (record === null || typeof record.id !== 'string') {
          ctx.setStatus(t('saveFailed'), 'error')
          nodes.saveButton.disabled = false
          nodes.saveButton.textContent = t('save')
          return null
        }
        removeDraft(creating ? 'new' : record.id, app.draftId)
        app.baseline = record
        ui.openId = record.id
        ctx.persist({ openId: record.id, draftIds: ui.draftIds })
        app.materials = Array.isArray(record.materials) ? record.materials.slice() : []
        renderMaterials()
        fillIdentifiers(record)
        reading.load(record.reading)
        showDetail(record, false)
        ctx.setStatus(t('saved'), 'ok')
        nodes.saveButton.disabled = false
        nodes.saveButton.textContent = t('save')
        ctx.refreshList()
        return record
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
        return null
      })
    }

    /** 没改过就交出当前记录，改过先保存；保存不成时是 `null`。 */
    function ensureSaved() {
      if (app.baseline !== null && !app.dirty) return Promise.resolve(app.baseline)
      return save()
    }

    /** 关联行动项之后把新记录放回面板，不覆盖用户正在别处输入的内容。 */
    function adoptRecord(record) {
      if (record === null || typeof record !== 'object') return
      app.baseline = record
      app.dirty = false
      ui.openId = record.id
      ctx.persist({ openId: record.id })
      app.materials = Array.isArray(record.materials) ? record.materials.slice() : []
      fillForm(formOfRecord(record))
      showDetail(record, false)
      ctx.refreshList()
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
      fillForm(formOfRecord(latest))
      app.dirty = false
      showDetail(latest, false)
      ctx.setStatus(t('saved'), 'ok')
      ctx.refreshList()
    }

    function openSource() {
      var url = nodes.urlInput.value.trim()
      if (!pure.openableUrl(url) || typeof widget.open !== 'function') return
      widget.open(url)
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
      renderMaterials: renderMaterials,
      addMaterial: addMaterial,
      removeMaterial: removeMaterial,
      addReading: function () { reading.add() },
      reloadLatest: reloadLatest,
      openSource: openSource
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
