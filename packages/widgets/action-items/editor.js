/*
 * 行动项卡的编辑面板：详情表单、状态、来源、草稿、保存、修订冲突与生命周期操作。
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
  root.createActionEditor = function (ctx) {
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

    function statuses() {
      return ctx.card.querySelectorAll('.at__status')
    }

    function setStatusButtons() {
      var buttons = statuses()
      for (var at = 0; at < buttons.length; at += 1) {
        var button = buttons[at]
        button.setAttribute('aria-pressed', button.getAttribute('data-status') === app.status ? 'true' : 'false')
        button.dataset.active = button.getAttribute('data-status') === app.status ? 'true' : 'false'
      }
      if (nodes.blockedField !== null) nodes.blockedField.hidden = app.status !== 'blocked'
      if (nodes.doneField !== null) nodes.doneField.hidden = app.status !== 'done'
    }

    function fillForm(form) {
      nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
      nodes.dueInput.value = typeof form.due === 'string' ? form.due : ''
      nodes.blocked.value = typeof form.blocked === 'string' ? form.blocked : ''
      nodes.done.value = typeof form.done === 'string' ? form.done : ''
      app.status = pure.isStatus(form.status) ? form.status : 'todo'
      app.materials = Array.isArray(form.materials) ? form.materials : []
      setStatusButtons()
      renderMaterials()
      ctx.setStatus('', 'neutral')
      if (nodes.detailHint !== null) nodes.detailHint.hidden = true
    }

    function showSource(record) {
      if (nodes.source === null) return
      if (record === null || record.source === null || record.source === undefined || typeof record.source !== 'object') {
        nodes.source.textContent = t('noSource')
        nodes.source.dataset.tone = 'none'
        return
      }
      var source = record.source
      nodes.source.textContent = t('source') + '：' + (source.kind === 'meeting' ? '…' : String(source.kind))
      nodes.source.dataset.tone = 'open'
      if (!live) return
      widget.call(READ, { ids: [source.id], includeTrashed: true, includeArchived: true }).then(function (result) {
        var found = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records[0] : null
        if (app.baseline !== record) return
        if (found === null || typeof found !== 'object') {
          nodes.source.textContent = t('source') + '：' + t('sourceMissing')
          nodes.source.dataset.tone = 'error'
          return
        }
        var trashed = typeof found.deletedAt === 'string'
        nodes.source.textContent = t('source') + '：' + found.title + (trashed ? '（' + t('sourceTrashed') + '）' : '')
        nodes.source.dataset.tone = trashed ? 'error' : 'open'
      }, function () {
        if (app.baseline !== record) return
        nodes.source.textContent = t('source') + '：' + t('sourceMissing')
        nodes.source.dataset.tone = 'error'
      })
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
      nodes.dueInput.disabled = trashed
      nodes.blocked.disabled = trashed
      nodes.done.disabled = trashed
      nodes.materialUrl.disabled = trashed
      nodes.materialTitle.disabled = trashed
      var add = ctx.card.querySelector('[data-action="add-material"]')
      if (add !== null) add.disabled = trashed
      var buttons = statuses()
      for (var at = 0; at < buttons.length; at += 1) buttons[at].disabled = trashed
      nodes.saveButton.disabled = trashed
      nodes.saveButton.textContent = t('save')
      if (trashed) {
        nodes.detailHint.textContent = t('trashRestoreHint')
        if (nodes.detailHint !== null) nodes.detailHint.hidden = false
      } else if (nodes.detailHint !== null) {
        nodes.detailHint.hidden = true
      }
      showSource(record)
      if (focus === true) nodes.titleInput.focus()
    }

    function openRecord(record) {
      app.editing = true
      app.baseline = record
      app.draftId = null
      app.dirty = false
      app.saving = false
      fillForm({
        title: record.title,
        status: record.status,
        due: dueInputOf(record),
        blocked: record.blockedNote,
        done: record.doneNote,
        materials: Array.isArray(record.materials) ? record.materials.slice() : []
      })
      showDetail(record, true)
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
      fillForm({ title: '', status: 'todo', due: '', blocked: '', done: '', materials: [] })
      showDetail(null, true)
      restoreDraft('new').then(function (restored) {
        if (restored) ctx.setStatus(t('draftRestored'), 'neutral')
      })
    }

    /** 期限里的日期部分：时刻按记录时区取那一天。 */
    function dueInputOf(record) {
      var due = record.due
      if (due === null || due === undefined || typeof due !== 'object') return ''
      if (due.kind === 'date' && typeof due.date === 'string') return due.date
      if (due.kind === 'instant' && typeof due.at === 'string') {
        var stamp = Date.parse(due.at)
        if (isNaN(stamp)) return ''
        var zone = typeof due.timeZone === 'string' && due.timeZone !== '' ? due.timeZone : 'UTC'
        return pure.dateIn(stamp, zone)
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
        var rows = nodes.list.querySelectorAll('.at__row')
        for (var at = 0; at < rows.length; at += 1) {
          if (rows[at].getAttribute('data-id') === app.triggerId) {
            var open = rows[at].querySelector('.at__open')
            if (open !== null) open.focus()
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
        status: app.status,
        due: nodes.dueInput.value,
        blocked: nodes.blocked.value,
        done: nodes.done.value,
        materials: app.materials
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
          status: form.status,
          due: form.due,
          blocked: form.blocked,
          done: form.done,
          materials: form.materials
        })
        app.dirty = true
        return true
      }, function () {
        return false
      })
    }

    /** 保存：新建或更新；失败保留输入，修订冲突给出载入最新或继续编辑。 */
    function save() {
      if (!live || app.saving) return
      if (app.baseline !== null && typeof app.baseline.deletedAt === 'string') return
      var title = nodes.titleInput.value.trim()
      if (title === '') {
        ctx.setStatus(t('titleRequired'), 'error')
        nodes.titleInput.focus()
        return
      }
      var fields = {
        title: title,
        status: app.status,
        due: nodes.dueInput.value === '' ? null : pure.dateValue(nodes.dueInput.value, pure.zone()),
        blockedNote: app.status === 'blocked' && nodes.blocked.value.trim() !== '' ? nodes.blocked.value.trim() : null,
        doneNote: app.status === 'done' && nodes.done.value.trim() !== '' ? nodes.done.value.trim() : null,
        materials: app.materials.length === 0 ? null : app.materials
      }
      var expected = app.baseline === null ? null : app.baseline.revision
      var creating = app.baseline === null
      app.saving = true
      nodes.saveButton.disabled = true
      nodes.saveButton.textContent = t('saving')
      ctx.setStatus(t('saving'), 'neutral')
      var request = creating
        ? widget.call(WRITE, { op: 'create', record: { kind: 'action', title: fields.title, status: fields.status, due: fields.due, blockedNote: fields.blockedNote, doneNote: fields.doneNote, materials: fields.materials } })
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
        fillForm({
          title: record.title,
          status: record.status,
          due: dueInputOf(record),
          blocked: record.blockedNote,
          done: record.doneNote,
          materials: Array.isArray(record.materials) ? record.materials.slice() : []
        })
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

    /** 生命周期操作：归档、恢复、移入回收站。 */
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

    /** 列表上的快捷完成 / 重开：不动详情，失败时刷新列表并说明原因。 */
    function quickSet(record, status) {
      if (!live || !pure.isStatus(status)) return
      widget.call(WRITE, { op: 'update', id: record.id, expectedRevision: record.revision, patch: { status: status } }).then(function () {
        ctx.setBanner('')
        ctx.refreshList()
      }, function (error) {
        ctx.setBanner(pure.fill(t('quickFailed'), { reason: messageOf(error) }))
        ctx.refreshList()
      })
    }

    function reloadLatest() {
      var latest = app.pendingLatest
      if (latest === null || typeof latest !== 'object') return
      removeDraft(app.baseline === null ? 'new' : app.baseline.id, app.draftId)
      app.baseline = latest
      app.pendingLatest = null
      fillForm({
        title: latest.title,
        status: latest.status,
        due: dueInputOf(latest),
        blocked: latest.blockedNote,
        done: latest.doneNote,
        materials: Array.isArray(latest.materials) ? latest.materials.slice() : []
      })
      app.dirty = false
      showDetail(latest, false)
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

    function setStatus(status) {
      if (!app.editing || !pure.isStatus(status)) return
      app.status = status
      setStatusButtons()
      onInput()
      if (status === 'blocked' && nodes.blocked !== null) nodes.blocked.focus()
      if (status === 'done' && nodes.done !== null) nodes.done.focus()
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
      quickSet: quickSet,
      onInput: onInput,
      setStatus: setStatus,
      addMaterial: addMaterial,
      removeMaterial: removeMaterial,
      reloadLatest: reloadLatest
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
