/*
 * 组会记录卡的编辑面板：详情表单、草稿、保存、修订冲突与归档 / 回收站操作。
 *
 * 由 main.js 在启动时用一份上下文建出来；这一份不碰列表与查询，只处理打开着的那一条，
 * 完成后让 main.js 重新取列表。
 */
;(function (root) {
  'use strict'

  /**
   * 建编辑面板。
   *
   * @param {object} ctx - 节点、状态、文案与列表刷新回调。
   * @returns {object} 面板对外的动作。
   */
  root.createMeetingEditor = function (ctx) {
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
    var directory = widget !== undefined && typeof widget.createMemberDirectory === 'function' ? widget.createMemberDirectory() : null
    var membersReady = null
    var relations = widget.createRecordRelations({ container: nodes.detail,
      current: function () { return app.baseline },
      onChange: function (refs) { app.related = refs; onInput() }
    })
    /** 组会之外的那几块：来源、生成的行动项、上次会议遗留与两个对话框。 */
    var extra = {
      derive: ctx.card.querySelector('[data-action="derive"]'),
      generate: ctx.card.querySelector('[data-action="generate"]'),
      outline: ctx.card.querySelector('[data-action="outline"]'),
      derived: ctx.card.querySelector('[data-role="derived"]'),
      generatedSection: ctx.card.querySelector('[data-role="generated-section"]'),
      generated: ctx.card.querySelector('[data-role="generated"]'),
      unfinishedSection: ctx.card.querySelector('[data-role="unfinished-section"]'),
      unfinished: ctx.card.querySelector('[data-role="unfinished"]'),
      actionDialog: ctx.card.querySelector('[data-role="action-dialog"]'),
      actionHint: ctx.card.querySelector('[data-role="action-hint"]'),
      actionTitle: ctx.card.querySelector('[data-field="action-title"]'),
      actionCreate: ctx.card.querySelector('[data-action="action-create"]'),
      actionCancel: ctx.card.querySelector('[data-action="action-cancel"]'),
      outlineDialog: ctx.card.querySelector('[data-role="outline-dialog"]'),
      outlineHint: ctx.card.querySelector('[data-role="outline-hint"]'),
      outlineText: ctx.card.querySelector('[data-field="outline"]'),
      outlineSelect: ctx.card.querySelector('[data-action="outline-select"]'),
      outlineClose: ctx.card.querySelector('[data-action="outline-close"]')
    }

    var STATUS_KEYS = { todo: 'actionTodo', doing: 'actionDoing', blocked: 'actionBlocked', done: 'actionDone', cancelled: 'actionCancelled' }

    /** 成员目录读一次；读失败时下次打开再试，已选的 id 不丢。 */
    function loadMembers() {
      if (directory === null) return Promise.resolve(false)
      if (membersReady === null) {
        membersReady = directory.load().then(function () {
          return true
        }, function () {
          membersReady = null
          return false
        })
      }
      return membersReady
    }

    /** 参与者多选：先按缓存画，目录到了再补全；没有目录能力时只显示已记录的 id。 */
    function renderParticipants() {
      var select = nodes.participants
      if (select === null) return
      if (directory === null) {
        var items = []
        for (var at = 0; at < app.participants.length; at += 1) {
          var option = document.createElement('option')
          option.value = app.participants[at]
          option.textContent = app.participants[at]
          option.selected = true
          items.push(option)
        }
        select.replaceChildren.apply(select, items)
        return
      }
      directory.fill(select, app.participants, t('participantsEmpty'))
      if (select.options.length === 0) {
        var empty = document.createElement('option')
        empty.value = ''
        empty.textContent = t('participantsEmpty')
        empty.disabled = true
        select.append(empty)
      }
    }

    function fillParticipants(list) {
      app.participants = list.slice()
      renderParticipants()
      loadMembers().then(function (loaded) {
        if (loaded) renderParticipants()
      })
    }

    /** 读多选框当前选中的成员 id。 */
    function chosenParticipants() {
      var select = nodes.participants
      if (select === null) return []
      var out = []
      for (var at = 0; at < select.selectedOptions.length; at += 1) {
        var value = select.selectedOptions[at].value
        if (value !== '') out.push(value)
      }
      return out
    }

    if (nodes.participants !== null) {
      nodes.participants.addEventListener('change', function () {
        app.participants = chosenParticipants()
        onInput()
      })
    }

    /** 一条行动项的引用行：状态与标题，只读。 */
    function relatedRow(record) {
      var row = document.createElement('li')
      row.className = 'mt__related-row'
      var state = document.createElement('span')
      state.className = 'mt__related-state'
      state.dataset.status = record.status
      state.textContent = t(STATUS_KEYS[record.status] ?? 'actionTodo')
      var title = document.createElement('span')
      title.className = 'mt__related-title'
      title.textContent = record.title
      row.append(state, title)
      return row
    }

    /** 读一组行动项，按给的回调画出来；读失败时把那一节收起。 */
    function loadActions(sourceId, element, section, keep) {
      if (element === null || section === null) return
      if (!live) return
      widget.call(READ, { kind: 'action', source: { kind: 'meeting', id: sourceId } }).then(function (result) {
        var records = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records : []
        if (keep !== undefined) records = records.filter(keep)
        var rows = []
        for (var at = 0; at < records.length; at += 1) rows.push(relatedRow(records[at]))
        element.replaceChildren.apply(element, rows)
        section.hidden = rows.length === 0
      }, function () {
        section.hidden = true
      })
    }

    /** 生成行动项的那一条：从反馈或未决问题起个标题。 */
    function suggestTitle() {
      var source = nodes.feedback.value.trim() !== '' ? nodes.feedback.value : nodes.questions.value !== '' ? nodes.questions.value : nodes.topics.value
      var line = source.split('\n')[0].trim()
      return line.length > 200 ? line.slice(0, 200) : line
    }

    function openActionDialog() {
      if (!live || !app.editing || app.baseline === null) return
      if (typeof extra.actionDialog.showModal !== 'function') return
      extra.actionHint.textContent = t('generateHint')
      extra.actionTitle.value = suggestTitle()
      extra.actionDialog.showModal()
      extra.actionTitle.focus()
    }

    function closeActionDialog() {
      if (extra.actionDialog.open) extra.actionDialog.close()
    }

    function createAction() {
      if (!live || app.baseline === null) return
      var title = extra.actionTitle.value.trim()
      if (title === '') {
        extra.actionHint.textContent = t('titleRequired')
        extra.actionTitle.focus()
        return
      }
      extra.actionCreate.disabled = true
      var meetingId = app.baseline.id
      widget.call(WRITE, { op: 'create', record: { kind: 'action', title: title, status: 'todo', source: { kind: 'meeting', id: meetingId } } }).then(function () {
        extra.actionCreate.disabled = false
        closeActionDialog()
        ctx.setStatus(t('generatedDone'), 'ok')
        loadActions(meetingId, extra.generated, extra.generatedSection)
      }, function (error) {
        extra.actionCreate.disabled = false
        extra.actionHint.textContent = t('generateFailed') + '：' + messageOf(error)
      })
    }

    /** 从上次会议准备新提纲：沿用未决问题，未完成事项只列出来。 */
    function deriveFromLast() {
      if (!live || app.baseline !== null) return
      widget.call(READ, { kind: 'meeting' }).then(function (result) {
        var records = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records : []
        var latest = records[0]
        if (latest === undefined) {
          ctx.setStatus(t('derivedNone'), 'error')
          return
        }
        app.derivedFrom = latest.id
        app.derivedTitle = latest.title
        if (nodes.topics.value.trim() === '' && typeof latest.openQuestions === 'string' && latest.openQuestions.trim() !== '') {
          nodes.topics.value = latest.openQuestions
        }
        renderDerived()
        loadActions(latest.id, extra.unfinished, extra.unfinishedSection, function (record) {
          return record.status !== 'done' && record.status !== 'cancelled'
        })
        onInput()
        ctx.setStatus(t('derivedHint'), 'neutral')
      }, function (error) {
        ctx.setStatus(t('generateFailed') + '：' + messageOf(error), 'error')
      })
    }

    function renderDerived() {
      if (extra.derived === null) return
      if (app.derivedFrom === null || app.derivedFrom === undefined) {
        extra.derived.hidden = true
        return
      }
      extra.derived.hidden = false
      extra.derived.textContent = t('derivedFrom') + '：' + (app.derivedTitle !== null ? app.derivedTitle : '…')
    }

    /** 复制提纲：把当前表单与生成的行动项拼成 Markdown，放进可全选的文本框。 */
    function openOutline() {
      if (!live) return
      var form = formOf()
      form.materials = app.materials
      var headings = {
        untitled: t('title'),
        date: t('date'),
        topics: t('topics'),
        feedback: t('feedback'),
        questions: t('openQuestions'),
        materials: t('material'),
        actions: t('mdActions')
      }
      var show = function (actions) {
        extra.outlineText.value = pure.outlineOf(form, actions, headings)
        extra.outlineHint.textContent = t('copyHint')
        if (typeof extra.outlineDialog.showModal === 'function') extra.outlineDialog.showModal()
      }
      if (app.baseline === null) {
        if (app.derivedFrom === null) {
          show([])
          return
        }
        // 新组会沿用上次会议：把未完成事项作为引用列进提纲，不复制成新任务。
        widget.call(READ, { kind: 'action', source: { kind: 'meeting', id: app.derivedFrom } }).then(function (result) {
          var records = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records : []
          show(records.filter(function (record) { return record.status !== 'done' && record.status !== 'cancelled' }))
        }, function () {
          show([])
        })
        return
      }
      widget.call(READ, { kind: 'action', source: { kind: 'meeting', id: app.baseline.id } }).then(function (result) {
        show(result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records : [])
      }, function () {
        show([])
      })
    }

    function fillForm(form) {
      relations.load(Array.isArray(form.related) ? form.related : app.related)
      nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
      nodes.dateInput.value = typeof form.date === 'string' ? form.date : ''
      fillParticipants(Array.isArray(form.participants) ? form.participants : [])
      nodes.topics.value = typeof form.topics === 'string' ? form.topics : ''
      nodes.feedback.value = typeof form.feedback === 'string' ? form.feedback : ''
      nodes.questions.value = typeof form.questions === 'string' ? form.questions : ''
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
      nodes.archiveAction.hidden = trashed || (record !== null && record.archived === true)
      nodes.restoreAction.hidden = record === null || (!trashed && record.archived !== true)
      nodes.trashAction.hidden = trashed
      nodes.titleInput.disabled = trashed
      nodes.dateInput.disabled = trashed
      if (nodes.participants !== null) nodes.participants.disabled = trashed
      nodes.topics.disabled = trashed
      nodes.feedback.disabled = trashed
      nodes.questions.disabled = trashed
      nodes.materialUrl.disabled = trashed
      nodes.materialTitle.disabled = trashed
      var add = ctx.card.querySelector('[data-action="add-material"]')
      if (add !== null) add.disabled = trashed
      nodes.saveButton.disabled = trashed
      nodes.saveButton.textContent = t('save')
      extra.derive.hidden = record !== null
      extra.generate.hidden = record === null
      extra.outline.hidden = false
      extra.derive.disabled = trashed
      extra.generate.disabled = trashed
      extra.outline.disabled = trashed
      if (trashed) {
        nodes.detailHint.textContent = t('trashRestoreHint')
        if (nodes.detailHint !== null) nodes.detailHint.hidden = false
      } else if (nodes.detailHint !== null) {
        nodes.detailHint.hidden = true
      }
      if (focus === true) nodes.titleInput.focus()
    }

    function openRecord(record) {
      app.related = Array.isArray(record.related) ? record.related.slice() : []
      app.participants = Array.isArray(record.participants) ? record.participants.slice() : []
      app.editing = true
      app.baseline = record
      app.draftId = null
      app.dirty = false
      app.saving = false
      app.derivedFrom = typeof record.derivedFrom === 'string' ? record.derivedFrom : null
      app.derivedTitle = null
      app.materials = Array.isArray(record.materials) ? record.materials.slice() : []
      fillForm({
        title: record.title,
        date: pure.dateText(record),
        participants: Array.isArray(record.participants) ? record.participants : [],
        topics: record.topics,
        feedback: record.feedback,
        questions: record.openQuestions
      })
      showDetail(record, true)
      renderDerived()
      loadActions(record.id, extra.generated, extra.generatedSection)
      if (app.derivedFrom !== null) {
        widget.call(READ, { ids: [app.derivedFrom], includeArchived: true, includeTrashed: true }).then(function (result) {
          var source = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records[0] : null
          if (app.baseline !== record || source === null || typeof source !== 'object') return
          app.derivedTitle = source.title
          renderDerived()
        }, function () {})
        loadActions(app.derivedFrom, extra.unfinished, extra.unfinishedSection, function (action) {
          return action.status !== 'done' && action.status !== 'cancelled'
        })
      } else if (extra.unfinishedSection !== null) {
        extra.unfinishedSection.hidden = true
      }
      restoreDraft(record.id).then(function (restored) {
        if (restored) ctx.setStatus(t('draftRestored'), 'neutral')
      })
    }

    function openNew() {
      app.related = []
      app.participants = []
      app.editing = true
      app.baseline = null
      app.draftId = null
      app.dirty = false
      app.saving = false
      app.derivedFrom = null
      app.derivedTitle = null
      app.materials = []
      fillForm({ title: '', date: '', participants: [], topics: '', feedback: '', questions: '' })
      showDetail(null, true)
      renderDerived()
      if (extra.generatedSection !== null) extra.generatedSection.hidden = true
      if (extra.unfinishedSection !== null) extra.unfinishedSection.hidden = true
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
        var rows = nodes.list.querySelectorAll('.mt__row')
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
        related: relations.value(),
        title: nodes.titleInput.value,
        date: nodes.dateInput.value,
        participants: app.participants,
        topics: nodes.topics.value,
        feedback: nodes.feedback.value,
        questions: nodes.questions.value,
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
        if (Array.isArray(form.related)) { app.related = form.related; relations.load(form.related) }
        nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
        nodes.dateInput.value = typeof form.date === 'string' ? form.date : ''
        if (Array.isArray(form.participants)) fillParticipants(form.participants)
        nodes.topics.value = typeof form.topics === 'string' ? form.topics : ''
        nodes.feedback.value = typeof form.feedback === 'string' ? form.feedback : ''
        nodes.questions.value = typeof form.questions === 'string' ? form.questions : ''
        app.materials = Array.isArray(form.materials) ? form.materials : []
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
      var fields = {
        title: title,
        date: nodes.dateInput.value === '' ? null : pure.dateValue(nodes.dateInput.value, pure.zone()),
        participants: app.participants.length === 0 ? null : app.participants.slice(),
        topics: nodes.topics.value.trim() === '' ? null : nodes.topics.value.trim(),
        feedback: nodes.feedback.value.trim() === '' ? null : nodes.feedback.value.trim(),
        openQuestions: nodes.questions.value.trim() === '' ? null : nodes.questions.value.trim(),
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
        ? widget.call(WRITE, { op: 'create', record: { kind: pure.KIND, ...fields, derivedFrom: app.derivedFrom } })
        : widget.call(WRITE, { op: 'update', id: app.baseline.id, expectedRevision: expected, patch: { ...fields, derivedFrom: app.derivedFrom } })
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
        app.derivedFrom = typeof record.derivedFrom === 'string' ? record.derivedFrom : null
        renderDerived()
        ui.openId = record.id
        ctx.persist({ openId: record.id, draftIds: ui.draftIds })
        app.materials = Array.isArray(record.materials) ? record.materials.slice() : []
        renderMaterials()
        showDetail(record, false)
        loadActions(record.id, extra.generated, extra.generatedSection)
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
        date: pure.dateText(latest),
        participants: Array.isArray(latest.participants) ? latest.participants : [],
        topics: latest.topics,
        feedback: latest.feedback,
        questions: latest.openQuestions
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

    function messageOf(error) {
      return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
    }

    function selectOutline() {
      if (extra.outlineText === null) return
      extra.outlineText.focus()
      extra.outlineText.select()
    }

    function closeOutline() {
      if (extra.outlineDialog.open) extra.outlineDialog.close()
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
      reloadLatest: reloadLatest,
      openActionDialog: openActionDialog,
      closeActionDialog: closeActionDialog,
      createAction: createAction,
      deriveFromLast: deriveFromLast,
      openOutline: openOutline,
      selectOutline: selectOutline,
      closeOutline: closeOutline
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
