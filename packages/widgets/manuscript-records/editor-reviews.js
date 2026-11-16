/*
 * 小论文卡的投稿轮次与修回事项：检查表、冻结、转行动项与导出 Markdown。
 *
 * 由 editor-deep.js 建出来，和编辑面板共用同一份打开中的表单状态；渲染、增删与校验都在这里。
 */
;(function (root) {
  'use strict'

  /**
   * 建投稿与修回编辑。
   *
   * @param {object} ctx - 表单状态、节点、文案、保存回调、状态提示与共用小工具。
   * @returns {object} 渲染、校验与增删动作。
   */
  root.createManuscriptReviews = function (ctx) {
    var app = ctx.app
    var nodes = ctx.nodes
    var widget = ctx.widget
    var live = ctx.live
    var t = ctx.t
    var pure = ctx.pure
    var onInput = ctx.onInput
    var setStatus = ctx.setStatus
    var newId = ctx.newId
    var trashedNow = ctx.trashed
    var findEntry = ctx.findEntry
    var controlOf = ctx.control
    var optionOf = ctx.option
    var removeButtonOf = ctx.removeButton
    var dateFieldOf = ctx.dateField
    var emptyHint = ctx.emptyHint
    var dateInputOf = ctx.dateInput
    var WRITE = 'widget-board:records.write'
    var converting = {}

    /** 冻结的一轮把整轮控件锁住，只留解冻按钮。 */
    function lockRound(row, frozen) {
      if (!frozen) return
      var controls = row.querySelectorAll('input, select, textarea')
      for (var at = 0; at < controls.length; at += 1) controls[at].disabled = true
      var actions = row.querySelectorAll('button[data-action="remove-round"], button[data-action="remove-check"], button[data-action="add-check"]')
      for (var actionAt = 0; actionAt < actions.length; actionAt += 1) actions[actionAt].disabled = true
    }

    function frozenRound(round) {
      return round !== null && typeof round === 'object' && round.frozenAt !== null && typeof round.frozenAt === 'object' && round.frozenAt.kind === 'date'
    }

    /** 一行检查项：名称、已备或待备、版本说明与移除。 */
    function checkRow(round, check) {
      var row = document.createElement('li')
      row.className = 'ms__deep-line ms__check'
      row.dataset.round = String(round.id)
      row.dataset.check = String(check.id)
      var label = controlOf('input', 'ms__input ms__deep-grow', 'check-label')
      label.type = 'text'
      label.maxLength = pure.CHECK_LABEL_LENGTH
      label.placeholder = t('checkLabel')
      label.setAttribute('aria-label', t('checkLabel'))
      label.value = typeof check.label === 'string' ? check.label : ''
      var status = controlOf('select', 'ms__select', 'check-status')
      status.setAttribute('aria-label', t('checkStatus'))
      for (var at = 0; at < pure.CHECK_STATUSES.length; at += 1) {
        status.appendChild(optionOf(pure.CHECK_STATUSES[at], t(pure.checkStatusKey(pure.CHECK_STATUSES[at]))))
      }
      status.value = pure.CHECK_STATUSES.indexOf(check.status) === -1 ? 'missing' : check.status
      var version = controlOf('input', 'ms__input ms__check-version', 'check-version')
      version.type = 'text'
      version.maxLength = pure.CHECK_VERSION_LENGTH
      version.placeholder = t('checkVersion')
      version.setAttribute('aria-label', t('checkVersion'))
      version.value = typeof check.version === 'string' ? check.version : ''
      var remove = controlOf('button', 'ms__ghost ms__deep-remove')
      remove.type = 'button'
      remove.dataset.action = 'remove-check'
      remove.dataset.round = String(round.id)
      remove.dataset.check = String(check.id)
      remove.textContent = t('remove')
      row.append(label, status, version, remove)
      return row
    }

    /** 一轮投稿的检查表：逐项编辑，末尾是添加按钮。 */
    function checklistOf(round) {
      var list = document.createElement('ul')
      list.className = 'ms__checklist'
      var checks = Array.isArray(round.checklist) ? round.checklist : []
      for (var at = 0; at < checks.length; at += 1) {
        if (checks[at] !== null && typeof checks[at] === 'object') list.appendChild(checkRow(round, checks[at]))
      }
      var addLine = document.createElement('li')
      addLine.className = 'ms__check-add'
      var add = controlOf('button', 'ms__ghost')
      add.type = 'button'
      add.dataset.action = 'add-check'
      add.dataset.round = String(round.id)
      add.textContent = t('checkAdd')
      addLine.appendChild(add)
      list.appendChild(addLine)
      return list
    }

    function roundRow(round, index) {
      var row = document.createElement('li')
      row.className = 'ms__deep-row ms__round'
      row.dataset.round = String(round.id)
      var frozen = frozenRound(round)
      var checks = Array.isArray(round.checklist) ? round.checklist : []
      var missing = 0
      for (var checkAt = 0; checkAt < checks.length; checkAt += 1) {
        if (checks[checkAt] !== null && typeof checks[checkAt] === 'object' && checks[checkAt].status === 'missing') missing += 1
      }
      var head = document.createElement('div')
      head.className = 'ms__deep-head'
      var name = document.createElement('span')
      name.className = 'ms__deep-name'
      name.textContent = pure.fill(t('submission'), { n: index + 1 })
      head.appendChild(name)
      if (frozen) {
        var frozenTag = document.createElement('span')
        frozenTag.className = 'ms__tag'
        frozenTag.textContent = pure.fill(t('frozenTag'), { date: dateInputOf(round.frozenAt) })
        head.appendChild(frozenTag)
      }
      if (missing > 0) {
        var missingTag = document.createElement('span')
        missingTag.className = 'ms__tag'
        missingTag.dataset.tone = 'missing'
        missingTag.textContent = pure.fill(t('checkMissingCount'), { n: missing })
        head.appendChild(missingTag)
      }
      var freeze = controlOf('button', 'ms__ghost')
      freeze.type = 'button'
      freeze.dataset.action = 'freeze-round'
      freeze.dataset.round = String(round.id)
      freeze.textContent = frozen ? t('unfreezeRound') : t('freezeRound')
      head.append(freeze, removeButtonOf('remove-round', 'round', round.id, t('remove')))
      var line = document.createElement('div')
      line.className = 'ms__deep-line'
      var venue = controlOf('input', 'ms__input ms__deep-grow', 'round-venue')
      venue.type = 'text'
      venue.maxLength = 120
      venue.placeholder = t('venue')
      venue.setAttribute('aria-label', t('venue'))
      venue.value = typeof round.venue === 'string' ? round.venue : ''
      var decision = controlOf('select', 'ms__select', 'round-decision')
      for (var at = 0; at < pure.DECISIONS.length; at += 1) decision.appendChild(optionOf(pure.DECISIONS[at], t(pure.decisionKey(pure.DECISIONS[at]))))
      decision.setAttribute('aria-label', t('decision'))
      decision.value = pure.isDecision(round.decision) ? round.decision : 'pending'
      line.append(venue, decision)
      var dates = document.createElement('div')
      dates.className = 'ms__deep-line'
      dates.append(
        dateFieldOf(t('submittedAt'), 'round-submitted', dateInputOf(round.submittedAt)),
        dateFieldOf(t('decidedAt'), 'round-decided', dateInputOf(round.decidedAt)),
        dateFieldOf(t('roundDeadline'), 'round-deadline', dateInputOf(round.deadline))
      )
      var note = controlOf('input', 'ms__input ms__deep-note', 'round-note')
      note.type = 'text'
      note.maxLength = pure.REVISION_TEXT
      note.placeholder = t('roundNote')
      note.setAttribute('aria-label', t('roundNote'))
      note.value = typeof round.note === 'string' ? round.note : ''
      var checklistLabel = document.createElement('span')
      checklistLabel.className = 'ms__label'
      checklistLabel.textContent = t('checklist')
      var checkError = document.createElement('p')
      checkError.className = 'ms__error'
      checkError.dataset.role = 'check-error'
      checkError.setAttribute('role', 'status')
      row.append(head, line, dates, note, checklistLabel, checklistOf(round), checkError)
      lockRound(row, frozen)
      return row
    }

    function evidenceOf(revision) {
      var list = document.createElement('ul')
      list.className = 'ms__material-list'
      var materials = Array.isArray(revision.materials) ? revision.materials : []
      if (materials.length === 0) {
        var none = document.createElement('li')
        none.className = 'ms__deep-hint'
        none.dataset.tone = 'missing'
        none.textContent = t('noEvidence')
        list.appendChild(none)
        return list
      }
      for (var at = 0; at < materials.length; at += 1) {
        var material = materials[at]
        if (material === null || typeof material !== 'object') continue
        var row = document.createElement('li')
        row.className = 'ms__material'
        var open = document.createElement('button')
        open.type = 'button'
        open.className = 'ms__material-open'
        open.textContent = typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url)
        open.title = String(material.url)
        open.dataset.url = String(material.url)
        var remove = controlOf('button', 'ms__ghost ms__material-remove')
        remove.type = 'button'
        remove.dataset.action = 'remove-revision-material'
        remove.dataset.revision = String(revision.id)
        remove.dataset.material = String(material.id)
        remove.textContent = t('removeMaterial')
        row.append(open, remove)
        list.appendChild(row)
      }
      return list
    }

    function revisionRow(revision) {
      var row = document.createElement('li')
      row.className = 'ms__deep-row ms__revision'
      row.dataset.revision = String(revision.id)
      var head = document.createElement('div')
      head.className = 'ms__deep-head'
      var roundSelect = controlOf('select', 'ms__select', 'revision-round')
      roundSelect.setAttribute('aria-label', t('revisionRound'))
      var found = false
      for (var at = 0; at < app.submissions.length; at += 1) {
        var round = app.submissions[at]
        if (round === null || typeof round !== 'object' || typeof round.id !== 'string') continue
        var venue = typeof round.venue === 'string' && round.venue !== '' ? round.venue : t('unknown')
        roundSelect.appendChild(optionOf(round.id, pure.fill(t('submission'), { n: at + 1 }) + ' · ' + venue))
        if (round.id === revision.roundId) found = true
      }
      if (!found) roundSelect.appendChild(optionOf('', t('unknown')))
      roundSelect.value = found ? revision.roundId : ''
      var status = controlOf('select', 'ms__select', 'revision-status')
      status.setAttribute('aria-label', t('revisionStatus'))
      for (var statusAt = 0; statusAt < pure.REVISION_STATUSES.length; statusAt += 1) {
        status.appendChild(optionOf(pure.REVISION_STATUSES[statusAt], t(pure.revisionKey(pure.REVISION_STATUSES[statusAt]))))
      }
      status.value = pure.isRevisionStatus(revision.status) ? revision.status : 'todo'
      head.append(roundSelect, status)
      if (revision.status === 'done' && (typeof revision.change !== 'string' || revision.change.trim() === '')) {
        var missing = document.createElement('span')
        missing.className = 'ms__tag'
        missing.dataset.tone = 'missing'
        missing.textContent = t('changeMissing')
        head.appendChild(missing)
      }
      if (revision.status === 'declined' && (typeof revision.reason !== 'string' || revision.reason.trim() === '')) {
        var noReason = document.createElement('span')
        noReason.className = 'ms__tag'
        noReason.dataset.tone = 'missing'
        noReason.textContent = t('revisionDeclinedReason')
        head.appendChild(noReason)
      }
      head.appendChild(removeButtonOf('remove-revision', 'revision', revision.id, t('remove')))
      var meta = document.createElement('div')
      meta.className = 'ms__deep-line'
      var reviewer = controlOf('input', 'ms__input ms__deep-grow', 'revision-reviewer')
      reviewer.type = 'text'
      reviewer.maxLength = pure.REVIEWER_LENGTH
      reviewer.placeholder = t('revisionReviewer')
      reviewer.setAttribute('aria-label', t('revisionReviewer'))
      reviewer.value = typeof revision.reviewer === 'string' ? revision.reviewer : ''
      var commentNo = controlOf('input', 'ms__input ms__comment-no', 'revision-comment-no')
      commentNo.type = 'text'
      commentNo.maxLength = pure.COMMENT_NO_LENGTH
      commentNo.placeholder = t('revisionCommentNo')
      commentNo.setAttribute('aria-label', t('revisionCommentNo'))
      commentNo.value = typeof revision.commentNo === 'string' ? revision.commentNo : ''
      meta.append(reviewer, commentNo)
      var feedback = controlOf('textarea', 'ms__input ms__textarea', 'revision-feedback')
      feedback.rows = 2
      feedback.maxLength = pure.REVISION_TEXT
      feedback.placeholder = t('revisionFeedback')
      feedback.setAttribute('aria-label', t('revisionFeedback'))
      feedback.value = typeof revision.feedback === 'string' ? revision.feedback : ''
      var location = controlOf('input', 'ms__input ms__input', 'revision-location')
      location.type = 'text'
      location.maxLength = pure.LOCATION_LENGTH
      location.placeholder = t('revisionLocation')
      location.setAttribute('aria-label', t('revisionLocation'))
      location.value = typeof revision.location === 'string' ? revision.location : ''
      var change = controlOf('textarea', 'ms__input ms__textarea', 'revision-change')
      change.rows = 2
      change.maxLength = pure.REVISION_TEXT
      change.placeholder = t('revisionChange')
      change.setAttribute('aria-label', t('revisionChange'))
      change.value = typeof revision.change === 'string' ? revision.change : ''
      var reply = controlOf('textarea', 'ms__input ms__textarea', 'revision-reply')
      reply.rows = 2
      reply.maxLength = pure.REVISION_TEXT
      reply.placeholder = t('revisionReply')
      reply.setAttribute('aria-label', t('revisionReply'))
      reply.value = typeof revision.reply === 'string' ? revision.reply : ''
      var reason = controlOf('textarea', 'ms__input ms__textarea', 'revision-reason')
      reason.rows = 2
      reason.maxLength = pure.REVISION_TEXT
      reason.placeholder = t('revisionReason')
      reason.setAttribute('aria-label', t('revisionReason'))
      reason.value = typeof revision.reason === 'string' ? revision.reason : ''
      var actions = document.createElement('div')
      actions.className = 'ms__deep-line'
      var linked = typeof revision.actionId === 'string' && revision.actionId !== ''
      var toAction = controlOf('button', 'ms__ghost')
      toAction.type = 'button'
      toAction.dataset.action = 'revision-to-action'
      toAction.dataset.revision = String(revision.id)
      toAction.textContent = linked ? t('revisionActionLinked') : t('revisionActionCreate')
      toAction.disabled = linked
      actions.appendChild(toAction)
      if (linked) {
        var actionId = document.createElement('span')
        actionId.className = 'ms__deep-hint'
        actionId.textContent = revision.actionId
        actions.appendChild(actionId)
      }
      var evidenceLabel = document.createElement('span')
      evidenceLabel.className = 'ms__label'
      evidenceLabel.textContent = t('evidence')
      var add = document.createElement('div')
      add.className = 'ms__material-add'
      var url = controlOf('input', 'ms__input', 'revision-material-url')
      url.type = 'url'
      url.placeholder = t('materialUrl')
      url.setAttribute('aria-label', t('materialUrl'))
      var title = controlOf('input', 'ms__input', 'revision-material-title')
      title.type = 'text'
      title.maxLength = 200
      title.placeholder = t('materialTitle')
      title.setAttribute('aria-label', t('materialTitle'))
      var addButton = controlOf('button', 'ms__ghost')
      addButton.type = 'button'
      addButton.dataset.action = 'add-revision-material'
      addButton.dataset.revision = String(revision.id)
      addButton.textContent = t('addMaterial')
      add.append(url, title, addButton)
      var error = document.createElement('p')
      error.className = 'ms__error'
      error.dataset.role = 'revision-material-error'
      error.setAttribute('role', 'status')
      row.append(head, meta, feedback, location, change, reply, reason, actions, evidenceLabel, evidenceOf(revision), add, error)
      return row
    }

    function renderRounds() {
      if (nodes.submissions === null) return
      var rows = []
      for (var at = 0; at < app.submissions.length; at += 1) {
        if (app.submissions[at] !== null && typeof app.submissions[at] === 'object') rows.push(roundRow(app.submissions[at], at))
      }
      nodes.submissions.replaceChildren.apply(nodes.submissions, rows)
      emptyHint(nodes.submissionsEmpty, rows.length === 0)
      if (nodes.addRound !== null) nodes.addRound.disabled = trashedNow() || app.submissions.length >= pure.MAX_ROUNDS
    }

    function renderRevisions() {
      if (nodes.revisions === null) return
      var rows = []
      for (var at = 0; at < app.revisions.length; at += 1) {
        if (app.revisions[at] !== null && typeof app.revisions[at] === 'object') rows.push(revisionRow(app.revisions[at]))
      }
      nodes.revisions.replaceChildren.apply(nodes.revisions, rows)
      emptyHint(nodes.revisionsEmpty, rows.length === 0)
      if (nodes.addRevision !== null) nodes.addRevision.disabled = trashedNow() || app.revisions.length >= pure.MAX_REVISIONS
    }

    /** 投稿轮次与修回事项一起重画。 */
    function render() {
      renderRounds()
      renderRevisions()
    }

    /** 投稿与修回的填写问题；空串表示可以保存。 */
    function problem() {
      var roundIds = {}
      for (var roundAt = 0; roundAt < app.submissions.length; roundAt += 1) {
        var round = app.submissions[roundAt]
        if (round === null || typeof round !== 'object') return t('roundInvalid')
        if (typeof round.venue !== 'string' || round.venue.trim() === '' || !pure.isDecision(round.decision)) return t('roundInvalid')
        if (typeof round.id === 'string') roundIds[round.id] = true
        var checks = Array.isArray(round.checklist) ? round.checklist : []
        if (checks.length > pure.MAX_CHECKLIST) return t('checkLimit')
        for (var checkAt = 0; checkAt < checks.length; checkAt += 1) {
          var check = checks[checkAt]
          if (check === null || typeof check !== 'object') return t('checkInvalid')
          if (typeof check.label !== 'string' || check.label.trim() === '') return t('checkInvalid')
          if (pure.CHECK_STATUSES.indexOf(check.status) === -1) return t('checkInvalid')
        }
      }
      for (var revisionAt = 0; revisionAt < app.revisions.length; revisionAt += 1) {
        var revision = app.revisions[revisionAt]
        if (revision === null || typeof revision !== 'object') return t('revisionInvalid')
        if (typeof revision.feedback !== 'string' || revision.feedback.trim() === '') return t('revisionInvalid')
        if (!pure.isRevisionStatus(revision.status)) return t('revisionInvalid')
        if (typeof revision.roundId !== 'string' || roundIds[revision.roundId] !== true) return t('revisionInvalid')
        if (revision.status === 'declined' && (typeof revision.reason !== 'string' || revision.reason.trim() === '')) return t('revisionDeclinedRequired')
      }
      return ''
    }

    function addRound() {
      if (trashedNow()) return
      if (app.submissions.length >= pure.MAX_ROUNDS) {
        setStatus(t('deepLimit'), 'error')
        return
      }
      app.submissions.push({ id: newId('r'), venue: '', decision: 'pending' })
      renderRounds()
      renderRevisions()
      onInput()
      var input = nodes.submissions !== null ? nodes.submissions.querySelector('[data-field="round-venue"]') : null
      if (input !== null) input.focus()
    }

    function updateRound(id, field, value, checkId) {
      var round = findEntry(app.submissions, id)
      if (round === null) return
      if (typeof field === 'string' && field.indexOf('check-') === 0) {
        var check = findEntry(Array.isArray(round.checklist) ? round.checklist : [], checkId)
        if (check === null) return
        if (field === 'check-label') check.label = value
        else if (field === 'check-status') check.status = value
        else if (field === 'check-version') {
          if (value.trim() === '') delete check.version
          else check.version = value
        } else return
        onInput()
        return
      }
      if (field === 'round-venue') round.venue = value
      else if (field === 'round-decision') round.decision = value
      else if (field === 'round-submitted') {
        if (value === '') delete round.submittedAt
        else round.submittedAt = pure.dateValue(value, pure.zone())
      } else if (field === 'round-decided') {
        if (value === '') delete round.decidedAt
        else round.decidedAt = pure.dateValue(value, pure.zone())
      } else if (field === 'round-deadline') {
        if (value === '') delete round.deadline
        else round.deadline = pure.dateValue(value, pure.zone())
      } else if (field === 'round-note') {
        if (value.trim() === '') delete round.note
        else round.note = value
      }
      onInput()
    }

    /** 冻结一轮投稿：检查表与材料版本定下来，再解释冻才改。 */
    function toggleFreeze(id) {
      if (trashedNow()) return
      var round = findEntry(app.submissions, id)
      if (round === null) return
      if (frozenRound(round)) delete round.frozenAt
      else round.frozenAt = pure.dateValue(pure.todayIn(pure.zone()), pure.zone())
      renderRounds()
      onInput()
    }

    function addCheck(id) {
      if (trashedNow()) return
      var round = findEntry(app.submissions, id)
      if (round === null) return
      if (frozenRound(round)) {
        setStatus(t('roundFrozenHint'), 'error')
        return
      }
      if (!Array.isArray(round.checklist)) round.checklist = []
      if (round.checklist.length >= pure.MAX_CHECKLIST) {
        setStatus(t('deepLimit'), 'error')
        return
      }
      round.checklist.push({ id: newId('c'), label: '', status: 'missing' })
      renderRounds()
      onInput()
      if (nodes.submissions !== null) {
        var labels = nodes.submissions.querySelectorAll('[data-check] [data-field="check-label"]')
        if (labels.length > 0) labels[labels.length - 1].focus()
      }
    }

    function removeCheck(roundId, checkId) {
      var round = findEntry(app.submissions, roundId)
      if (round === null || !Array.isArray(round.checklist)) return
      round.checklist = round.checklist.filter(function (check) { return check === null || typeof check !== 'object' || String(check.id) !== String(checkId) })
      if (round.checklist.length === 0) delete round.checklist
      renderRounds()
      onInput()
    }

    function removeRound(id) {
      var removed = 0
      app.revisions = app.revisions.filter(function (revision) {
        if (revision !== null && typeof revision === 'object' && String(revision.roundId) === String(id)) {
          removed += 1
          return false
        }
        return true
      })
      app.submissions = app.submissions.filter(function (round) { return round === null || typeof round !== 'object' || String(round.id) !== String(id) })
      renderRounds()
      renderRevisions()
      onInput()
      if (removed > 0) setStatus(pure.fill(t('roundRemoved'), { n: removed }), 'neutral')
    }

    function addRevision() {
      if (trashedNow()) return
      if (app.submissions.length === 0) {
        setStatus(t('roundRequired'), 'error')
        return
      }
      if (app.revisions.length >= pure.MAX_REVISIONS) {
        setStatus(t('deepLimit'), 'error')
        return
      }
      var last = app.submissions[app.submissions.length - 1]
      app.revisions.push({ id: newId('v'), roundId: typeof last.id === 'string' ? last.id : '', feedback: '', status: 'todo' })
      renderRevisions()
      onInput()
      var input = nodes.revisions !== null ? nodes.revisions.querySelector('[data-field="revision-feedback"]') : null
      if (input !== null) input.focus()
    }

    function updateRevision(id, field, value) {
      var revision = findEntry(app.revisions, id)
      if (revision === null) return
      if (field === 'revision-round') revision.roundId = value
      else if (field === 'revision-status') revision.status = value
      else if (field === 'revision-feedback') revision.feedback = value
      else if (field === 'revision-reviewer') {
        if (value.trim() === '') delete revision.reviewer
        else revision.reviewer = value
      } else if (field === 'revision-comment-no') {
        if (value.trim() === '') delete revision.commentNo
        else revision.commentNo = value
      } else if (field === 'revision-location') {
        if (value.trim() === '') delete revision.location
        else revision.location = value
      } else if (field === 'revision-reply') {
        if (value.trim() === '') delete revision.reply
        else revision.reply = value
      } else if (field === 'revision-reason') {
        if (value.trim() === '') delete revision.reason
        else revision.reason = value
      } else if (field === 'revision-change') {
        if (value.trim() === '') delete revision.change
        else revision.change = value
      } else {
        return
      }
      onInput()
      if (field === 'revision-status') renderRevisions()
    }

    function removeRevision(id) {
      app.revisions = app.revisions.filter(function (revision) { return revision === null || typeof revision !== 'object' || String(revision.id) !== String(id) })
      renderRevisions()
      onInput()
    }

    function revisionRowOf(id) {
      if (nodes.revisions === null) return null
      var rows = nodes.revisions.querySelectorAll('.ms__revision')
      for (var at = 0; at < rows.length; at += 1) {
        if (rows[at].getAttribute('data-revision') === String(id)) return rows[at]
      }
      return null
    }

    function addRevisionMaterial(id) {
      var revision = findEntry(app.revisions, id)
      var row = revisionRowOf(id)
      if (revision === null || row === null) return
      var urlNode = row.querySelector('[data-field="revision-material-url"]')
      var titleNode = row.querySelector('[data-field="revision-material-title"]')
      var errorNode = row.querySelector('[data-role="revision-material-error"]')
      var url = urlNode !== null ? urlNode.value.trim() : ''
      var title = titleNode !== null ? titleNode.value.trim() : ''
      if (!pure.materialValid(url, title)) {
        if (errorNode !== null) errorNode.textContent = t('materialInvalid')
        return
      }
      if (errorNode !== null) errorNode.textContent = ''
      if (!Array.isArray(revision.materials)) revision.materials = []
      revision.materials.push({ id: newId('e'), url: url, title: title })
      renderRevisions()
      onInput()
    }

    function removeRevisionMaterial(id, materialId) {
      var revision = findEntry(app.revisions, id)
      if (revision === null || !Array.isArray(revision.materials)) return
      revision.materials = revision.materials.filter(function (material) { return material === null || typeof material !== 'object' || String(material.id) !== String(materialId) })
      if (revision.materials.length === 0) delete revision.materials
      renderRevisions()
      onInput()
    }

    function messageOf(error) {
      return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
    }

    /**
     * 把一条修回意见转成行动项：源记录与本条修回的 id 一起写进行动项，同一修回只建一次。
     *
     * @param {string} id - 修回条目 id。
     */
    function convertRevisionToAction(id) {
      if (!live || trashedNow()) return
      var revision = findEntry(app.revisions, id)
      if (revision === null) return
      if (typeof revision.actionId === 'string' && revision.actionId !== '') {
        setStatus(t('revisionActionLinked'), 'neutral')
        return
      }
      if (app.baseline === null) {
        setStatus(t('revisionActionNeedsSave'), 'error')
        return
      }
      var feedback = typeof revision.feedback === 'string' ? revision.feedback.trim() : ''
      if (feedback === '') {
        setStatus(t('revisionInvalid'), 'error')
        return
      }
      if (converting[id] === true) return
      converting[id] = true
      var title = feedback.split('\n')[0].trim()
      if (title.length > 120) title = title.slice(0, 120)
      widget.call(WRITE, {
        op: 'create',
        record: {
          kind: 'action',
          title: title,
          status: 'todo',
          source: { kind: 'manuscript', id: app.baseline.id },
          sourceEntry: revision.id
        }
      }).then(function (result) {
        converting[id] = false
        var record = result !== null && typeof result === 'object' && result.record !== null && typeof result.record === 'object' ? result.record : null
        if (record === null || typeof record.id !== 'string') {
          setStatus(t('revisionActionFailed'), 'error')
          return
        }
        revision.actionId = record.id
        renderRevisions()
        onInput()
        setStatus(t('revisionActionCreated'), 'ok')
      }, function (error) {
        converting[id] = false
        setStatus(t('revisionActionFailed') + '：' + messageOf(error), 'error')
      })
    }

    /** 导出对话：选一轮投稿，把这一轮的检查表与修回写成可复制的 Markdown。 */
    function openExport() {
      if (nodes.exportDialog === null || nodes.exportRound === null || nodes.exportText === null) return
      var options = []
      for (var at = 0; at < app.submissions.length; at += 1) {
        var round = app.submissions[at]
        if (round === null || typeof round !== 'object' || typeof round.id !== 'string') continue
        var venue = typeof round.venue === 'string' && round.venue !== '' ? round.venue : t('unknown')
        options.push(optionOf(round.id, pure.fill(t('submission'), { n: at + 1 }) + ' · ' + venue))
      }
      nodes.exportRound.replaceChildren.apply(nodes.exportRound, options)
      if (options.length === 0) {
        nodes.exportText.value = ''
        if (nodes.exportHint !== null) nodes.exportHint.textContent = t('exportEmpty')
        if (nodes.exportSelectButton !== null) nodes.exportSelectButton.disabled = true
      } else {
        nodes.exportRound.value = options[options.length - 1].value
        if (nodes.exportHint !== null) nodes.exportHint.textContent = t('exportHint')
        if (nodes.exportSelectButton !== null) nodes.exportSelectButton.disabled = false
        renderExport()
      }
      if (typeof nodes.exportDialog.showModal === 'function') nodes.exportDialog.showModal()
    }

    function renderExport() {
      if (nodes.exportRound === null || nodes.exportText === null) return
      var record = {
        title: nodes.titleInput !== null ? nodes.titleInput.value : '',
        submissions: app.submissions,
        revisions: app.revisions
      }
      nodes.exportText.value = pure.roundMarkdown(record, nodes.exportRound.value, { t: t })
    }

    function selectExport() {
      if (nodes.exportText === null) return
      nodes.exportText.focus()
      nodes.exportText.select()
    }

    return {
      render: render,
      problem: problem,
      addRound: addRound,
      updateRound: updateRound,
      removeRound: removeRound,
      toggleFreeze: toggleFreeze,
      addCheck: addCheck,
      removeCheck: removeCheck,
      addRevision: addRevision,
      updateRevision: updateRevision,
      removeRevision: removeRevision,
      addRevisionMaterial: addRevisionMaterial,
      removeRevisionMaterial: removeRevisionMaterial,
      convertRevisionToAction: convertRevisionToAction,
      openExport: openExport,
      renderExport: renderExport,
      selectExport: selectExport
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)