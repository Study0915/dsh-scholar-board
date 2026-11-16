/*
 * 成员卡的编辑面板：称呼、角色、启用状态、备注、保存、修订冲突与归档 / 恢复 / 回收站。
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
  root.createMemberEditor = function (ctx) {
    var app = ctx.app
    var ui = ctx.ui
    var nodes = ctx.nodes
    var widget = ctx.widget
    var live = ctx.live
    var t = ctx.t
    var pure = ctx.pure
    var READ = 'widget-board:records.read'
    var WRITE = 'widget-board:records.write'

    function formOf() {
      return {
        title: nodes.titleInput.value,
        role: nodes.role.value,
        enabled: nodes.enabled.checked,
        note: nodes.noteField.value
      }
    }

    function fillForm(form) {
      nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
      nodes.role.value = typeof form.role === 'string' ? form.role : ''
      nodes.noteField.value = typeof form.note === 'string' ? form.note : ''
      nodes.enabled.checked = form.enabled !== false
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
      var fields = [nodes.titleInput, nodes.role, nodes.noteField, nodes.enabled]
      for (var at = 0; at < fields.length; at += 1) fields[at].disabled = trashed
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
      app.dirty = false
      app.saving = false
      fillForm(record)
      showDetail(record, true)
    }

    function openNew() {
      app.editing = true
      app.baseline = null
      app.dirty = false
      app.saving = false
      fillForm({ title: '', enabled: true })
      showDetail(null, true)
    }

    function closeDetail(keepDraft) {
      if (nodes.detail === null) return
      if (app.dirty && keepDraft !== true) {
        nodes.confirmText.textContent = t('unsavedClose')
        if (typeof nodes.confirm.showModal === 'function') nodes.confirm.showModal()
        return
      }
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
        var entries = nodes.list.querySelectorAll('.mb__row')
        for (var at = 0; at < entries.length; at += 1) {
          if (entries[at].getAttribute('data-id') === app.triggerId) {
            entries[at].focus()
            return
          }
        }
      }
      if (nodes.newButton !== null && !nodes.newButton.disabled) nodes.newButton.focus()
    }

    function onInput() {
      if (!app.editing) return
      app.dirty = true
    }

    function save() {
      if (!live || app.saving) return
      if (app.baseline !== null && typeof app.baseline.deletedAt === 'string') return
      var title = pure.cleanTitle(nodes.titleInput.value)
      if (title === null) {
        ctx.setStatus(t('titleRequired'), 'error')
        nodes.titleInput.focus()
        return
      }
      var role = pure.cleanRole(nodes.role.value)
      var note = pure.cleanNote(nodes.noteField.value)
      if (role === null || note === null) {
        ctx.setStatus(t('invalidText'), 'error')
        return
      }
      var fields = {
        title: title,
        role: role,
        note: note,
        enabled: nodes.enabled.checked
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
        var record = result !== null && typeof result === 'object' && result.record !== null && typeof result.record === 'object' ? result.record : null
        if (record === null || typeof record.id !== 'string') {
          ctx.setStatus(t('saveFailed'), 'error')
          nodes.saveButton.disabled = false
          nodes.saveButton.textContent = t('save')
          return
        }
        app.baseline = record
        ui.openId = record.id
        ctx.persist({ openId: record.id })
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
      app.saving = true
      widget.call(WRITE, { op: op, id: app.baseline.id, expectedRevision: app.baseline.revision }).then(function () {
        app.saving = false
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
      reloadLatest: reloadLatest
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
