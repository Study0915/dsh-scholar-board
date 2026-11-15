/*
 * 课题卡的编辑面板：目标、假设、判断与下一步，问题条目、材料、草稿、保存、修订冲突与生命周期。
 *
 * 由 main.js 在启动时用一份上下文建出来；这一份只管打开着的那一条。问题转成行动项时先保存课题，
 * 再用 `source` 与 `sourceEntry` 建行动项（宿主按来源与条目幂等），最后把行动项 id 写回问题条目。
 * 问题是否解决由用户填写，行动项完成与否单独记录，两边不互相推断。
 */
;(function (root) {
  'use strict'

  /**
   * 建编辑面板。
   *
   * @param {object} ctx - 节点、状态、文案与列表刷新回调。
   * @returns {object} 面板对外的动作。
   */
  root.createTopicEditor = function (ctx) {
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
    var OPEN = 'widget-board:records.open'
    var draftTimer = null
    var sequence = 0
    if (app.actions === null || typeof app.actions !== 'object') app.actions = {}
    var relations = widget.createRecordRelations({ container: nodes.detail,
      current: function () { return app.baseline },
      onChange: function (refs) { app.related = refs; onInput() }
    })

    /** 一条记录里的问题表：保留空内容行，便于在表单里补完。 */
    function editableQuestions(value) {
      var list = Array.isArray(value) ? value : []
      var out = []
      for (var at = 0; at < list.length; at += 1) {
        var question = list[at]
        if (question === null || typeof question !== 'object') continue
        if (typeof question.id !== 'string' || question.id === '') continue
        var entry = {
          id: question.id,
          text: typeof question.text === 'string' ? question.text : '',
          status: pure.statusOf(question)
        }
        if (typeof question.actionId === 'string' && question.actionId !== '') entry.actionId = question.actionId
        out.push(entry)
      }
      return out
    }

    function formOf() {
      return {
        related: relations.value(),
        title: nodes.titleInput.value,
        question: nodes.question.value,
        goal: nodes.goal.value,
        hypothesis: nodes.hypothesis.value,
        judgment: nodes.judgment.value,
        nextStep: nodes.nextStep.value,
        questions: app.questions,
        materials: app.materials
      }
    }

    function fillForm(form) {
      relations.load(Array.isArray(form.related) ? form.related : app.related)
      nodes.titleInput.value = typeof form.title === 'string' ? form.title : ''
      nodes.question.value = typeof form.question === 'string' ? form.question : ''
      nodes.goal.value = typeof form.goal === 'string' ? form.goal : ''
      nodes.hypothesis.value = typeof form.hypothesis === 'string' ? form.hypothesis : ''
      nodes.judgment.value = typeof form.judgment === 'string' ? form.judgment : ''
      nodes.nextStep.value = typeof form.nextStep === 'string' ? form.nextStep : ''
      app.questions = editableQuestions(form.questions)
      renderQuestions()
      if (nodes.questionError !== null) nodes.questionError.textContent = ''
      renderMaterials()
      ctx.setStatus('', 'neutral')
      if (nodes.detailHint !== null) nodes.detailHint.hidden = true
    }

    function formOfRecord(record) {
      return {
        related: Array.isArray(record.related) ? record.related.slice() : [],
        title: record.title,
        question: record.question,
        goal: record.goal,
        hypothesis: record.hypothesis,
        judgment: record.judgment,
        nextStep: record.nextStep,
        questions: editableQuestions(record.questions),
        materials: Array.isArray(record.materials) ? record.materials.slice() : []
      }
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
      var fields = [nodes.titleInput, nodes.question, nodes.goal, nodes.hypothesis, nodes.judgment, nodes.nextStep, nodes.materialUrl, nodes.materialTitle]
      for (var at = 0; at < fields.length; at += 1) fields[at].disabled = trashed
      var buttons = [ctx.card.querySelector('[data-action="add-material"]'), ctx.card.querySelector('[data-action="add-question"]')]
      for (var buttonAt = 0; buttonAt < buttons.length; buttonAt += 1) {
        if (buttons[buttonAt] !== null) buttons[buttonAt].disabled = trashed
      }
      var questionInputs = ctx.card.querySelectorAll('.tp__question input, .tp__question select, .tp__question button')
      for (var questionAt = 0; questionAt < questionInputs.length; questionAt += 1) questionInputs[questionAt].disabled = trashed
      nodes.saveButton.disabled = trashed
      nodes.saveButton.textContent = t('save')
      if (trashed) {
        if (nodes.detailHint !== null) {
          nodes.detailHint.textContent = t('trashRestoreHint')
          nodes.detailHint.hidden = false
        }
      } else if (nodes.detailHint !== null) {
        nodes.detailHint.hidden = true
      }
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
      fillForm(formOfRecord(record))
      showDetail(record, true)
      if (typeof ctx.refreshActions === 'function') ctx.refreshActions()
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
      fillForm({ title: '', question: '', goal: '', hypothesis: '', judgment: '', nextStep: '', questions: [], materials: [] })
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
        var rows = nodes.list.querySelectorAll('.tp__row')
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
        nodes.question.value = typeof form.question === 'string' ? form.question : ''
        nodes.goal.value = typeof form.goal === 'string' ? form.goal : ''
        nodes.hypothesis.value = typeof form.hypothesis === 'string' ? form.hypothesis : ''
        nodes.judgment.value = typeof form.judgment === 'string' ? form.judgment : ''
        nodes.nextStep.value = typeof form.nextStep === 'string' ? form.nextStep : ''
        app.questions = editableQuestions(form.questions)
        renderQuestions()
        app.materials = Array.isArray(form.materials) ? form.materials : []
        renderMaterials()
        app.dirty = true
        return true
      }, function () {
        return false
      })
    }

    function messageOf(error) {
      return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
    }

    function commit() {
      if (!live || app.saving) return Promise.resolve(null)
      if (app.baseline !== null && typeof app.baseline.deletedAt === 'string') return Promise.resolve(null)
      var title = nodes.titleInput.value.trim()
      if (title === '') {
        ctx.setStatus(t('titleRequired'), 'error')
        nodes.titleInput.focus()
        return Promise.resolve(null)
      }
      var questions = pure.cleanQuestions(app.questions)
      if (questions === null) {
        if (nodes.questionError !== null) nodes.questionError.textContent = t('invalidQuestions')
        ctx.setStatus(t('invalidQuestions'), 'error')
        return Promise.resolve(null)
      }
      if (nodes.questionError !== null) nodes.questionError.textContent = ''
      var fields = {
        title: title,
        question: nodes.question.value.trim() === '' ? null : nodes.question.value.trim(),
        goal: nodes.goal.value.trim() === '' ? null : nodes.goal.value.trim(),
        hypothesis: nodes.hypothesis.value.trim() === '' ? null : nodes.hypothesis.value.trim(),
        judgment: nodes.judgment.value.trim() === '' ? null : nodes.judgment.value.trim(),
        nextStep: nodes.nextStep.value.trim() === '' ? null : nodes.nextStep.value.trim(),
        questions: questions.length === 0 ? null : questions,
        materials: app.materials.length === 0 ? null : app.materials,
        related: relations.value().length === 0 ? null : relations.value()
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
        app.questions = editableQuestions(record.questions)
        renderQuestions()
        ui.openId = record.id
        ctx.persist({ openId: record.id, draftIds: ui.draftIds })
        app.materials = Array.isArray(record.materials) ? record.materials.slice() : []
        renderMaterials()
        showDetail(record, false)
        ctx.setStatus(t('saved'), 'ok')
        nodes.saveButton.disabled = false
        nodes.saveButton.textContent = t('save')
        ctx.refreshList()
        if (typeof ctx.refreshActions === 'function') ctx.refreshActions()
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

    function save() {
      void commit()
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
      if (typeof ctx.refreshActions === 'function') ctx.refreshActions()
    }

    function actionOf(question) {
      if (question === null || typeof question !== 'object') return null
      if (typeof question.actionId !== 'string') return null
      var action = app.actions[question.actionId]
      if (action === null || typeof action !== 'object') return null
      if (typeof action.deletedAt === 'string') return null
      return action
    }

    function renderQuestions() {
      if (nodes.questions === null) return
      var items = []
      for (var at = 0; at < app.questions.length; at += 1) {
        items.push(view.questionRow(app.questions[at], at, actionOf(app.questions[at]), text))
      }
      nodes.questions.replaceChildren.apply(nodes.questions, items)
    }

    /** 宿主重推数据或换过行动项之后，只更新状态标签，不打断正在输入的格子。 */
    function setActions(map) {
      app.actions = map !== null && typeof map === 'object' ? map : {}
      if (nodes.questions === null || !app.editing) return
      var active = document.activeElement
      if (active !== null && typeof active.closest === 'function' && active.closest('.tp__question') !== null) return
      renderQuestions()
    }

    /** 当前打开的问题里引用到的行动项 id，供 main.js 一次读回。 */
    function actionIds() {
      var ids = []
      var seen = {}
      for (var at = 0; at < app.questions.length; at += 1) {
        var question = app.questions[at]
        if (question === null || typeof question !== 'object') continue
        if (typeof question.actionId !== 'string' || question.actionId === '') continue
        if (seen[question.actionId] === true) continue
        seen[question.actionId] = true
        ids.push(question.actionId)
      }
      return ids
    }

    function newQuestionId() {
      sequence += 1
      return 'q-' + Date.now().toString(36) + '-' + String(sequence)
    }

    function addQuestion() {
      if (app.questions.length >= pure.MAX_QUESTIONS) return
      app.questions.push({ id: newQuestionId(), text: '', status: 'open' })
      renderQuestions()
      var rows = nodes.questions.querySelectorAll('.tp__question')
      var last = rows[rows.length - 1]
      if (last !== undefined) {
        var input = last.querySelector('input')
        if (input !== null) input.focus()
      }
      onInput()
    }

    function findQuestion(id) {
      for (var at = 0; at < app.questions.length; at += 1) {
        if (app.questions[at].id === id) return app.questions[at]
      }
      return null
    }

    function updateQuestionText(id, value) {
      var question = findQuestion(id)
      if (question === null) return
      question.text = value
      onInput()
    }

    function updateQuestionStatus(id, status) {
      var question = findQuestion(id)
      if (question === null) return
      question.status = pure.STATUSES.indexOf(status) >= 0 ? status : 'open'
      onInput()
    }

    function removeQuestion(id) {
      var before = app.questions.length
      app.questions = app.questions.filter(function (question) { return question.id !== id })
      if (app.questions.length === before) return
      renderQuestions()
      onInput()
    }

    /** 把问题写回课题：读最新修订后只补这一条的 actionId，冲突时重试。 */
    function linkAction(topicId, questionId, actionId, attempt) {
      return widget.call(READ, { ids: [topicId], includeArchived: true, includeTrashed: true }).then(function (result) {
        var current = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records[0] : null
        if (current === null || typeof current !== 'object') throw new Error(t('recordMissing'))
        if (typeof current.deletedAt === 'string') throw new Error(t('recordMissing'))
        var questions = editableQuestions(current.questions)
        var found = null
        for (var at = 0; at < questions.length; at += 1) {
          if (questions[at].id === questionId) found = questions[at]
        }
        if (found === null) return null
        if (found.actionId === actionId) return current
        found.actionId = actionId
        var clean = pure.cleanQuestions(questions)
        if (clean === null) throw new Error(t('invalidQuestions'))
        return widget.call(WRITE, { op: 'update', id: topicId, expectedRevision: current.revision, patch: { questions: clean } }).then(function (written) {
          return written !== null && typeof written === 'object' && written.record !== null && typeof written.record === 'object' ? written.record : null
        }, function (error) {
          if (attempt >= 2) throw error
          return linkAction(topicId, questionId, actionId, attempt + 1)
        })
      })
    }

    function adoptRecord(record) {
      if (record === null || typeof record !== 'object') return
      app.baseline = record
      app.questions = editableQuestions(record.questions)
      renderQuestions()
      app.dirty = false
      ui.openId = record.id
      ctx.persist({ openId: record.id })
      ctx.refreshList()
    }

    function convertQuestion(questionId) {
      if (!live || app.saving) return
      if (app.converting === true) return
      if (app.baseline === null) {
        ctx.setStatus(t('questionSaveFirst'), 'error')
        return
      }
      var question = findQuestion(questionId)
      if (question === null) return
      var value = typeof question.text === 'string' ? question.text.trim() : ''
      if (value === '') {
        ctx.setStatus(t('invalidQuestions'), 'error')
        return
      }
      var text = [...value].slice(0, 200).join('')
      app.converting = true
      ctx.setStatus(t('converting'), 'neutral')
      var ready = app.dirty ? commit() : Promise.resolve(app.baseline)
      ready.then(function (record) {
        if (record === null || typeof record !== 'object') {
          app.converting = false
          return null
        }
        return widget.call(WRITE, {
          op: 'create',
          record: {
            kind: 'action',
            title: text,
            status: 'todo',
            source: { kind: 'topic', id: record.id },
            sourceEntry: questionId
          }
        }).then(function (result) {
          var action = result !== null && typeof result === 'object' && result.record !== null && typeof result.record === 'object' ? result.record : null
          if (action === null || typeof action.id !== 'string') throw new Error(t('saveFailed'))
          app.actions[action.id] = action
          return linkAction(record.id, questionId, action.id, 0)
        }).then(function (latest) {
          app.converting = false
          if (latest === null) {
            ctx.setStatus(t('recordMissing'), 'error')
            return
          }
          adoptRecord(latest)
          ctx.setStatus(t('actionLinked'), 'ok')
        }, function (error) {
          app.converting = false
          ctx.setStatus(t('saveFailed') + '：' + messageOf(error), 'error')
        })
      })
    }

    function openAction(id) {
      if (!live || typeof id !== 'string' || id === '') return
      widget.call(OPEN, { kind: 'action', id: id }).catch(function (error) {
        ctx.setStatus(t('saveFailed') + '：' + messageOf(error), 'error')
      })
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

    return {
      openRecord: openRecord,
      openNew: openNew,
      closeDetail: closeDetail,
      save: save,
      lifeOp: lifeOp,
      onInput: onInput,
      renderQuestions: renderQuestions,
      setActions: setActions,
      actionIds: actionIds,
      addQuestion: addQuestion,
      updateQuestionText: updateQuestionText,
      updateQuestionStatus: updateQuestionStatus,
      removeQuestion: removeQuestion,
      convertQuestion: convertQuestion,
      openAction: openAction,
      renderMaterials: renderMaterials,
      addMaterial: addMaterial,
      removeMaterial: removeMaterial,
      reloadLatest: reloadLatest
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
