/*
 * 毕业论文卡的编辑面板：详情表单、几组行、来源记录、草稿、保存、修订冲突与归档 / 回收站操作。
 *
 * 由 main.js 在启动时用一份上下文建出来；这一份不碰列表与查询，只处理打开着的那一条。
 * 学位节点与实验进度只是写下来的值：这里不预设学校规则，也不判断毕业资格。
 */
;(function (root) {
  'use strict'

  /**
   * 建编辑面板。
   *
   * @param {object} ctx - 节点、状态、文案与列表刷新回调。
   * @returns {object} 面板对外的动作。
   */
  root.createThesisEditor = function (ctx) {
    var app = ctx.app
    var ui = ctx.ui
    var nodes = ctx.nodes
    var widget = ctx.widget
    var live = ctx.live
    var t = ctx.t
    var pure = ctx.pure
    var rows = ctx.rows
    var READ = 'widget-board:records.read'
    var WRITE = 'widget-board:records.write'
    var DRAFT = 'widget-board:records.draft'
    var draftTimer = null

    function formOf() {
      return {
        title: nodes.titleInput.value,
        question: nodes.question.value,
        chapters: app.chapters,
        results: app.results,
        experiments: app.experiments,
        milestones: app.milestones,
        related: app.related,
        materials: app.materials
      }
    }

    function fillForm(form) {
      nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
      nodes.question.value = typeof form.question === 'string' ? form.question : ''
      rows.fill(form)
      if (nodes.rowsError !== null) nodes.rowsError.textContent = ''
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
      var fields = [nodes.titleInput, nodes.question, nodes.materialUrl, nodes.materialTitle, nodes.actionSelect]
      for (var at = 0; at < fields.length; at += 1) if (fields[at] !== null) fields[at].disabled = trashed
      var buttons = ctx.card.querySelectorAll('[data-action="add-chapter"], [data-action="add-result"], [data-action="add-experiment"], [data-action="add-milestone"], [data-action="add-action"], [data-action="add-material"]')
      for (var buttonAt = 0; buttonAt < buttons.length; buttonAt += 1) buttons[buttonAt].disabled = trashed
      var nested = ctx.card.querySelectorAll('.ts__line input, .ts__line select, .ts__line-remove, .ts__related-remove, .ts__material-remove')
      for (var nestedAt = 0; nestedAt < nested.length; nestedAt += 1) nested[nestedAt].disabled = trashed
      nodes.saveButton.disabled = trashed
      nodes.saveButton.textContent = t('save')
      if (trashed) {
        nodes.detailHint.textContent = t('trashRestoreHint')
        nodes.detailHint.hidden = false
      } else {
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
      fillForm(record)
      showDetail(record, true)
      loadSources()
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
      fillForm({ title: '', question: '' })
      showDetail(null, true)
      loadSources()
      restoreDraft('new').then(function (restored) {
        if (restored) ctx.setStatus(t('draftRestored'), 'neutral')
      })
    }

    /** 可选的稿件、研究记录与行动项；读不到时保留空列表，成果来源会显式显示缺失。 */
    function loadSources() {
      if (!live) return
      var kinds = ['manuscript', 'research', 'action']
      var requests = kinds.map(function (kind) {
        return widget.call(READ, { kind: kind, includeArchived: true })
      })
      Promise.all(requests).then(function (results) {
        var sources = []
        var actions = []
        var manuscripts = results[0] !== null && typeof results[0] === 'object' && Array.isArray(results[0].records) ? results[0].records : []
        var research = results[1] !== null && typeof results[1] === 'object' && Array.isArray(results[1].records) ? results[1].records : []
        actions = results[2] !== null && typeof results[2] === 'object' && Array.isArray(results[2].records) ? results[2].records : []
        sources = manuscripts.concat(research)
        app.sources = sources.filter(function (entry) {
          return entry !== null && typeof entry === 'object' && typeof entry.id === 'string'
        })
        app.actions = actions.filter(function (entry) {
          return entry !== null && typeof entry === 'object' && typeof entry.id === 'string'
        })
        rows.renderResults()
        rows.renderActionOptions()
        rows.renderRelated()
        showDetail(app.baseline, false)
      }, function () {})
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
        var rowsFound = nodes.list.querySelectorAll('.ts__row')
        for (var at = 0; at < rowsFound.length; at += 1) {
          if (rowsFound[at].getAttribute('data-id') === app.triggerId) {
            rowsFound[at].focus()
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
        nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
        nodes.question.value = typeof form.question === 'string' ? form.question : ''
        rows.fill(form)
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
      var cleaned = rows.cleaned()
      if (cleaned === null) {
        nodes.rowsError.textContent = t('invalidRows')
        ctx.setStatus(t('invalidRows'), 'error')
        return
      }
      nodes.rowsError.textContent = ''
      var fields = {
        title: title,
        question: nodes.question.value.trim() === '' ? null : nodes.question.value.trim(),
        chapters: cleaned.chapters,
        results: cleaned.results,
        experiments: cleaned.experiments,
        milestones: cleaned.milestones,
        related: cleaned.related,
        materials: cleaned.materials
      }
      var expected = app.baseline === null ? null : app.baseline.revision
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
        fillForm(record)
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
      app.pendingLatest = null
      fillForm(latest)
      app.dirty = false
      showDetail(latest, false)
      ctx.setStatus(t('saved'), 'ok')
      ctx.refreshList()
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
      addRelated: rows.addRelated,
      addMaterial: rows.addMaterial,
      reloadLatest: reloadLatest
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
