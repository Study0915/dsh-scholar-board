/*
 * 小论文卡的编辑面板：阶段与历史、下一步与阻碍、关联、材料、草稿、保存与修订冲突。
 *
 * 由 main.js 启动时用一份上下文建出来；这一份只处理打开着的那一条，完成后让 main.js 重新取列表。
 */
;(function (root) {
  'use strict'

  /**
   * 建编辑面板。
   *
   * @param {object} ctx - 节点、状态、文案与列表刷新回调。
   * @returns {object} 面板对外的动作。
   */
  root.createManuscriptEditor = function (ctx) {
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
    var draftTimer = null

    /** 两个选择框的候选：最近会议与活跃行动项。 */
    var candidates = { meetings: [], actions: [] }
    /** 关联项的标题缓存，按 id。 */
    var relatedRecords = {}

    function fillStageSelects() {
      var list = nodes.stageSelect
      if (list !== null) {
        var options = []
        for (var at = 0; at < pure.STAGES.length; at += 1) {
          var option = document.createElement('option')
          option.value = pure.STAGES[at]
          option.textContent = t(pure.stageKey(pure.STAGES[at]))
          options.push(option)
        }
        list.replaceChildren.apply(list, options)
      }
    }

    function fillForm(form) {
      nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
      nodes.question.value = typeof form.question === 'string' ? form.question : ''
      nodes.stageNote.value = typeof form.stageNote === 'string' ? form.stageNote : ''
      nodes.next.value = typeof form.next === 'string' ? form.next : ''
      nodes.blockers.value = typeof form.blockers === 'string' ? form.blockers : ''
      nodes.target.value = typeof form.target === 'string' ? form.target : ''
      nodes.dueInput.value = typeof form.due === 'string' ? form.due : ''
      if (nodes.stageSelect !== null) nodes.stageSelect.value = pure.isStage(form.stage) ? form.stage : 'idea'
      app.materials = Array.isArray(form.materials) ? form.materials : []
      app.related = Array.isArray(form.related) ? form.related : []
      renderMaterials()
      renderRelated()
      renderHistory(app.baseline)
      ctx.setStatus('', 'neutral')
      if (nodes.detailHint !== null) nodes.detailHint.hidden = true
    }

    function renderHistory(record) {
      if (nodes.historySection === null || nodes.history === null) return
      var entries = pure.historyOf(record)
      if (entries.length === 0) {
        nodes.historySection.hidden = true
        return
      }
      var rows = []
      for (var at = 0; at < entries.length; at += 1) {
        var entry = entries[at]
        var row = document.createElement('li')
        row.className = 'ms__history-row'
        var stage = document.createElement('span')
        stage.className = 'ms__history-stage'
        stage.dataset.stage = entry.stage
        stage.textContent = t(pure.stageKey(entry.stage))
        var when = document.createElement('span')
        when.className = 'ms__history-date'
        when.textContent = pure.dateOf(entry.at)
        row.append(stage, when)
        if (typeof entry.note === 'string' && entry.note !== '') {
          var note = document.createElement('span')
          note.className = 'ms__history-note'
          note.textContent = entry.note
          row.appendChild(note)
        }
        rows.push(row)
      }
      nodes.history.replaceChildren.apply(nodes.history, rows)
      nodes.historySection.hidden = false
    }

    function renderRelated() {
      if (nodes.related === null) return
      var rows = []
      for (var at = 0; at < app.related.length; at += 1) {
        var ref = app.related[at]
        if (ref === null || typeof ref !== 'object' || typeof ref.id !== 'string') continue
        rows.push(view.relatedRow(ref, relatedRecords[ref.id] ?? null, { t: t, remove: t('remove') }))
      }
      nodes.related.replaceChildren.apply(nodes.related, rows)
    }

    function fillPickers() {
      fillPicker(nodes.meetingPicker, candidates.meetings)
      fillPicker(nodes.actionPicker, candidates.actions)
    }

    function fillPicker(select, records) {
      if (select === null) return
      var options = []
      var placeholder = document.createElement('option')
      placeholder.value = ''
      placeholder.textContent = records.length === 0 ? t('noCandidates') : t('choose')
      options.push(placeholder)
      for (var at = 0; at < records.length; at += 1) {
        var record = records[at]
        var option = document.createElement('option')
        option.value = record.id
        option.textContent = record.title
        options.push(option)
      }
      select.replaceChildren.apply(select, options)
    }

    function loadCandidates() {
      if (!live) return
      widget.call(READ, { kind: 'meeting' }).then(function (result) {
        candidates.meetings = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records : []
        fillPickers()
      }, function () {})
      widget.call(READ, { kind: 'action' }).then(function (result) {
        candidates.actions = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records : []
        fillPickers()
      }, function () {})
    }

    function loadRelatedTitles() {
      if (!live) return
      var ids = []
      for (var at = 0; at < app.related.length; at += 1) {
        if (app.related[at] !== null && typeof app.related[at] === 'object' && typeof app.related[at].id === 'string') ids.push(app.related[at].id)
      }
      if (ids.length === 0) {
        relatedRecords = {}
        renderRelated()
        return
      }
      widget.call(READ, { ids: ids, includeArchived: true, includeTrashed: true }).then(function (result) {
        var records = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records : []
        var map = {}
        for (var index = 0; index < records.length; index += 1) map[records[index].id] = records[index]
        relatedRecords = map
        renderRelated()
      }, function () {})
    }

    function showDetail(record, focus) {
      if (nodes.detail === null) return
      nodes.detail.hidden = false
      ctx.card.dataset.editing = 'true'
      if (nodes.list !== null) nodes.list.hidden = true
      if (nodes.noteWrap !== null) nodes.noteWrap.hidden = true
      var trashed = record !== null && typeof record.deletedAt === 'string'
      nodes.archiveAction.hidden = trashed || (record !== null && record.archived === true)
      nodes.restoreAction.hidden = record === null || (!trashed && record.archived !== true)
      nodes.trashAction.hidden = trashed
      nodes.titleInput.disabled = trashed
      nodes.question.disabled = trashed
      nodes.stageSelect.disabled = trashed
      nodes.stageNote.disabled = trashed
      nodes.next.disabled = trashed
      nodes.blockers.disabled = trashed
      nodes.target.disabled = trashed
      nodes.dueInput.disabled = trashed
      nodes.materialUrl.disabled = trashed
      nodes.materialTitle.disabled = trashed
      var addMaterial = ctx.card.querySelector('[data-action="add-material"]')
      if (addMaterial !== null) addMaterial.disabled = trashed
      var addMeeting = ctx.card.querySelector('[data-action="add-meeting"]')
      var addAction = ctx.card.querySelector('[data-action="add-action"]')
      if (addMeeting !== null) addMeeting.disabled = trashed
      if (addAction !== null) addAction.disabled = trashed
      if (nodes.meetingPicker !== null) nodes.meetingPicker.disabled = trashed
      if (nodes.actionPicker !== null) nodes.actionPicker.disabled = trashed
      nodes.saveButton.disabled = trashed
      nodes.saveButton.textContent = t('save')
      if (trashed) {
        nodes.detailHint.textContent = t('trashRestoreHint')
        if (nodes.detailHint !== null) nodes.detailHint.hidden = false
      } else if (nodes.detailHint !== null) {
        nodes.detailHint.hidden = true
      }
      if (focus === true) nodes.titleInput.focus()
    }

    function openRecord(record) {
      app.editing = true
      app.baseline = record
      app.draftId = null
      app.dirty = false
      app.saving = false
      app.materials = Array.isArray(record.materials) ? record.materials.slice() : []
      app.related = Array.isArray(record.related) ? record.related.slice() : []
      relatedRecords = {}
      fillForm({
        title: record.title,
        question: record.question,
        stage: record.stage,
        next: record.nextStep,
        blockers: record.blockers,
        target: record.target,
        due: dueInputOf(record),
        materials: app.materials,
        related: app.related
      })
      showDetail(record, true)
      loadRelatedTitles()
      loadCandidates()
      restoreDraft(record.id).then(function (restored) {
        if (restored) ctx.setStatus(t('draftRestored'), 'neutral')
      })
    }

    function openNew() {
      app.editing = true
      app.baseline = null
      app.draftId = null
      app.dirty = false
      app.saving = false
      app.materials = []
      app.related = []
      relatedRecords = {}
      fillForm({ title: '', question: '', stage: 'idea', next: '', blockers: '', target: '', due: '', materials: [], related: [] })
      showDetail(null, true)
      loadCandidates()
      restoreDraft('new').then(function (restored) {
        if (restored) ctx.setStatus(t('draftRestored'), 'neutral')
      })
    }

    function dueInputOf(record) {
      var due = record.due
      if (due === null || due === undefined || typeof due !== 'object') return ''
      if (due.kind === 'date' && typeof due.date === 'string') return due.date
      if (due.kind === 'instant' && typeof due.at === 'string') {
        var stamp = Date.parse(due.at)
        if (isNaN(stamp)) return ''
        var zone = typeof due.timeZone === 'string' && due.timeZone !== '' ? due.timeZone : 'UTC'
        try {
          return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(stamp))
        } catch (error) {
          return due.at.slice(0, 10)
        }
      }
      return ''
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
        var rows = nodes.list.querySelectorAll('.ms__row')
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

    function formOf() {
      return {
        title: nodes.titleInput.value,
        question: nodes.question.value,
        stage: nodes.stageSelect !== null ? nodes.stageSelect.value : 'idea',
        stageNote: nodes.stageNote.value,
        next: nodes.next.value,
        blockers: nodes.blockers.value,
        target: nodes.target.value,
        due: nodes.dueInput.value,
        materials: app.materials,
        related: app.related
      }
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
        fillForm({
          title: form.title,
          question: form.question,
          stage: form.stage,
          stageNote: form.stageNote,
          next: form.next,
          blockers: form.blockers,
          target: form.target,
          due: form.due,
          materials: form.materials,
          related: form.related
        })
        loadRelatedTitles()
        app.dirty = true
        return true
      }, function () {
        return false
      })
    }

    /** 保存：阶段变化时把说明一并交给宿主记进历史。 */
    function save() {
      if (!live || app.saving) return
      if (app.baseline !== null && typeof app.baseline.deletedAt === 'string') return
      var title = nodes.titleInput.value.trim()
      if (title === '') {
        ctx.setStatus(t('titleRequired'), 'error')
        nodes.titleInput.focus()
        return
      }
      var stage = nodes.stageSelect !== null && pure.isStage(nodes.stageSelect.value) ? nodes.stageSelect.value : 'idea'
      var changedStage = app.baseline === null ? stage !== 'idea' : stage !== app.baseline.stage
      var fields = {
        title: title,
        question: nodes.question.value.trim() === '' ? null : nodes.question.value.trim(),
        stage: stage,
        nextStep: nodes.next.value.trim() === '' ? null : nodes.next.value.trim(),
        blockers: nodes.blockers.value.trim() === '' ? null : nodes.blockers.value.trim(),
        target: nodes.target.value.trim() === '' ? null : nodes.target.value.trim(),
        due: nodes.dueInput.value === '' ? null : pure.dateValue(nodes.dueInput.value, pure.zone()),
        materials: app.materials.length === 0 ? null : app.materials,
        related: app.related.length === 0 ? null : app.related,
      }
      if (changedStage && nodes.stageNote.value.trim() !== '') fields.stageNote = nodes.stageNote.value.trim()
      var expected = app.baseline === null ? null : app.baseline.revision
      var creating = app.baseline === null
      app.saving = true
      nodes.saveButton.disabled = true
      nodes.saveButton.textContent = t('saving')
      ctx.setStatus(t('saving'), 'neutral')
      var request = creating
        ? widget.call(WRITE, { op: 'create', record: { kind: 'manuscript', ...fields } })
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
        app.related = Array.isArray(record.related) ? record.related.slice() : []
        fillForm({
          title: record.title,
          question: record.question,
          stage: record.stage,
          stageNote: '',
          next: record.nextStep,
          blockers: record.blockers,
          target: record.target,
          due: dueInputOf(record),
          materials: app.materials,
          related: app.related
        })
        showDetail(record, false)
        loadRelatedTitles()
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
      app.pendingLatest = null
      app.materials = Array.isArray(latest.materials) ? latest.materials.slice() : []
      app.related = Array.isArray(latest.related) ? latest.related.slice() : []
      fillForm({
        title: latest.title,
        question: latest.question,
        stage: latest.stage,
        stageNote: '',
        next: latest.nextStep,
        blockers: latest.blockers,
        target: latest.target,
        due: dueInputOf(latest),
        materials: app.materials,
        related: app.related
      })
      app.dirty = false
      showDetail(latest, false)
      loadRelatedTitles()
      ctx.setStatus(t('saved'), 'ok')
      ctx.refreshList()
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

    function addRelated(ref) {
      if (ref === null || typeof ref !== 'object' || typeof ref.id !== 'string') return
      for (var at = 0; at < app.related.length; at += 1) {
        if (app.related[at].kind === ref.kind && app.related[at].id === ref.id) return
      }
      app.related.push({ kind: ref.kind, id: ref.id })
      renderRelated()
      loadRelatedTitles()
      onInput()
    }

    function addRelatedFrom(kind) {
      var select = kind === 'meeting' ? nodes.meetingPicker : nodes.actionPicker
      if (select === null || typeof select.value !== 'string' || select.value === '') return
      var id = select.value
      var list = kind === 'meeting' ? candidates.meetings : candidates.actions
      var record = null
      for (var at = 0; at < list.length; at += 1) {
        if (list[at].id === id) {
          record = list[at]
          break
        }
      }
      if (record !== null) relatedRecords[record.id] = record
      addRelated({ kind: kind, id: id })
      select.value = ''
    }

    function removeRelated(id) {
      app.related = app.related.filter(function (ref) { return ref === null || typeof ref !== 'object' || String(ref.id) !== String(id) })
      renderRelated()
      onInput()
    }

    function messageOf(error) {
      return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
    }

    fillStageSelects()

    return {
      openRecord: openRecord,
      openNew: openNew,
      closeDetail: closeDetail,
      save: save,
      lifeOp: lifeOp,
      onInput: onInput,
      addMaterial: addMaterial,
      removeMaterial: removeMaterial,
      addRelated: addRelatedFrom,
      removeRelated: removeRelated,
      reloadLatest: reloadLatest
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
