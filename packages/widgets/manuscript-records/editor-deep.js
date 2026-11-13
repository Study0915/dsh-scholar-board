/*
 * 小论文卡的深一层编辑：图表目录、投稿轮次与修回事项。
 *
 * 由 editor.js 建出来，和编辑面板共用同一份打开中的表单状态；渲染、增删与校验都在这里。
 */
;(function (root) {
  'use strict'

  /**
   * 建深一层编辑。
   *
   * @param {object} ctx - 表单状态、节点、文案、保存回调与状态提示。
   * @returns {object} 渲染、校验与增删动作。
   */
  root.createManuscriptDeep = function (ctx) {
    var app = ctx.app
    var nodes = ctx.nodes
    var t = ctx.t
    var pure = ctx.pure
    var onInput = ctx.onInput
    var setStatus = ctx.setStatus
    var deepSeq = 0

    function newId(prefix) {
      deepSeq += 1
      return prefix + '-' + String(Date.now()) + '-' + String(deepSeq)
    }

    function trashedNow() {
      return app.baseline !== null && typeof app.baseline.deletedAt === 'string'
    }

    function dateInputOf(value) {
      if (value === null || typeof value !== 'object' || value.kind !== 'date' || typeof value.date !== 'string') return ''
      return value.date
    }

    function findEntry(list, id) {
      for (var at = 0; at < list.length; at += 1) {
        if (list[at] !== null && typeof list[at] === 'object' && String(list[at].id) === String(id)) return list[at]
      }
      return null
    }

    function controlOf(tag, className, field) {
      var node = document.createElement(tag)
      node.className = className
      if (field !== undefined) node.dataset.field = field
      node.dataset.deep = 'true'
      if (trashedNow()) node.disabled = true
      return node
    }

    function optionOf(value, label) {
      var option = document.createElement('option')
      option.value = value
      option.textContent = label
      return option
    }

    function removeButtonOf(action, key, id, text) {
      var button = controlOf('button', 'ms__ghost ms__deep-remove')
      button.type = 'button'
      button.dataset.action = action
      button.dataset[key] = String(id)
      button.textContent = text
      return button
    }

    function emptyHint(node, empty) {
      if (node !== null) node.hidden = !empty
    }

    function dateFieldOf(label, field, value) {
      var wrap = document.createElement('label')
      wrap.className = 'ms__deep-date'
      var span = document.createElement('span')
      span.className = 'ms__label'
      span.textContent = label
      var input = controlOf('input', 'ms__input', field)
      input.type = 'date'
      input.value = value
      wrap.append(span, input)
      return wrap
    }

    function figureRow(figure) {
      var row = document.createElement('li')
      row.className = 'ms__deep-row'
      row.dataset.figure = String(figure.id)
      var line = document.createElement('div')
      line.className = 'ms__deep-line'
      var kind = controlOf('select', 'ms__select', 'figure-kind')
      for (var at = 0; at < pure.FIGURE_KINDS.length; at += 1) kind.appendChild(optionOf(pure.FIGURE_KINDS[at], t(pure.figureKey(pure.FIGURE_KINDS[at]))))
      kind.value = pure.isFigureKind(figure.kind) ? figure.kind : 'figure'
      var label = controlOf('input', 'ms__input ms__deep-label', 'figure-label')
      label.type = 'text'
      label.maxLength = pure.FIGURE_LABEL_LENGTH
      label.placeholder = t('figureLabel')
      label.setAttribute('aria-label', t('figureLabel'))
      label.value = typeof figure.label === 'string' ? figure.label : ''
      var title = controlOf('input', 'ms__input ms__deep-title', 'figure-title')
      title.type = 'text'
      title.maxLength = 200
      title.placeholder = t('figureTitle')
      title.setAttribute('aria-label', t('figureTitle'))
      title.value = typeof figure.title === 'string' ? figure.title : ''
      line.append(kind, label, title, removeButtonOf('remove-figure', 'figure', figure.id, t('remove')))
      row.appendChild(line)
      var note = controlOf('input', 'ms__input ms__deep-note', 'figure-note')
      note.type = 'text'
      note.maxLength = pure.REVISION_TEXT
      note.placeholder = t('figureNote')
      note.setAttribute('aria-label', t('figureNote'))
      note.value = typeof figure.note === 'string' ? figure.note : ''
      row.appendChild(note)
      return row
    }

    function roundRow(round, index) {
      var row = document.createElement('li')
      row.className = 'ms__deep-row ms__round'
      row.dataset.round = String(round.id)
      var head = document.createElement('div')
      head.className = 'ms__deep-head'
      var name = document.createElement('span')
      name.className = 'ms__deep-name'
      name.textContent = pure.fill(t('submission'), { n: index + 1 })
      head.append(name, removeButtonOf('remove-round', 'round', round.id, t('remove')))
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
        dateFieldOf(t('decidedAt'), 'round-decided', dateInputOf(round.decidedAt))
      )
      var note = controlOf('input', 'ms__input ms__deep-note', 'round-note')
      note.type = 'text'
      note.maxLength = pure.REVISION_TEXT
      note.placeholder = t('roundNote')
      note.setAttribute('aria-label', t('roundNote'))
      note.value = typeof round.note === 'string' ? round.note : ''
      row.append(head, line, dates, note)
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
      head.appendChild(removeButtonOf('remove-revision', 'revision', revision.id, t('remove')))
      var feedback = controlOf('textarea', 'ms__input ms__textarea', 'revision-feedback')
      feedback.rows = 2
      feedback.maxLength = pure.REVISION_TEXT
      feedback.placeholder = t('revisionFeedback')
      feedback.setAttribute('aria-label', t('revisionFeedback'))
      feedback.value = typeof revision.feedback === 'string' ? revision.feedback : ''
      var change = controlOf('textarea', 'ms__input ms__textarea', 'revision-change')
      change.rows = 2
      change.maxLength = pure.REVISION_TEXT
      change.placeholder = t('revisionChange')
      change.setAttribute('aria-label', t('revisionChange'))
      change.value = typeof revision.change === 'string' ? revision.change : ''
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
      row.append(head, feedback, change, evidenceLabel, evidenceOf(revision), add, error)
      return row
    }

    function renderFigures() {
      if (nodes.figures === null) return
      var rows = []
      for (var at = 0; at < app.figures.length; at += 1) {
        if (app.figures[at] !== null && typeof app.figures[at] === 'object') rows.push(figureRow(app.figures[at]))
      }
      nodes.figures.replaceChildren.apply(nodes.figures, rows)
      emptyHint(nodes.figuresEmpty, rows.length === 0)
      if (nodes.addFigure !== null) nodes.addFigure.disabled = trashedNow() || app.figures.length >= pure.MAX_FIGURES
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

    /** 三块一起重画。 */
    function render() {
      renderFigures()
      renderRounds()
      renderRevisions()
    }

    /** 深一层条目的填写问题；空串表示可以保存。 */
    function problem() {
      for (var figureAt = 0; figureAt < app.figures.length; figureAt += 1) {
        var figure = app.figures[figureAt]
        if (figure === null || typeof figure !== 'object') return t('figureInvalid')
        if (!pure.isFigureKind(figure.kind)) return t('figureInvalid')
        if (typeof figure.label !== 'string' || figure.label.trim() === '' || typeof figure.title !== 'string' || figure.title.trim() === '') return t('figureInvalid')
      }
      var roundIds = {}
      for (var roundAt = 0; roundAt < app.submissions.length; roundAt += 1) {
        var round = app.submissions[roundAt]
        if (round === null || typeof round !== 'object') return t('roundInvalid')
        if (typeof round.venue !== 'string' || round.venue.trim() === '' || !pure.isDecision(round.decision)) return t('roundInvalid')
        if (typeof round.id === 'string') roundIds[round.id] = true
      }
      for (var revisionAt = 0; revisionAt < app.revisions.length; revisionAt += 1) {
        var revision = app.revisions[revisionAt]
        if (revision === null || typeof revision !== 'object') return t('revisionInvalid')
        if (typeof revision.feedback !== 'string' || revision.feedback.trim() === '') return t('revisionInvalid')
        if (!pure.isRevisionStatus(revision.status)) return t('revisionInvalid')
        if (typeof revision.roundId !== 'string' || roundIds[revision.roundId] !== true) return t('revisionInvalid')
      }
      return ''
    }

    function addFigure() {
      if (trashedNow()) return
      if (app.figures.length >= pure.MAX_FIGURES) {
        setStatus(t('deepLimit'), 'error')
        return
      }
      app.figures.push({ id: newId('f'), kind: 'figure', label: '', title: '' })
      renderFigures()
      onInput()
      var input = nodes.figures !== null ? nodes.figures.querySelector('[data-field="figure-label"]') : null
      if (input !== null) input.focus()
    }

    function updateFigure(id, field, value) {
      var figure = findEntry(app.figures, id)
      if (figure === null) return
      if (field === 'figure-kind') figure.kind = value
      else if (field === 'figure-label') figure.label = value
      else if (field === 'figure-title') figure.title = value
      else if (field === 'figure-note') {
        if (value.trim() === '') delete figure.note
        else figure.note = value
      }
      onInput()
    }

    function removeFigure(id) {
      app.figures = app.figures.filter(function (figure) { return figure === null || typeof figure !== 'object' || String(figure.id) !== String(id) })
      renderFigures()
      onInput()
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

    function updateRound(id, field, value) {
      var round = findEntry(app.submissions, id)
      if (round === null) return
      if (field === 'round-venue') round.venue = value
      else if (field === 'round-decision') round.decision = value
      else if (field === 'round-submitted') {
        if (value === '') delete round.submittedAt
        else round.submittedAt = pure.dateValue(value, pure.zone())
      } else if (field === 'round-decided') {
        if (value === '') delete round.decidedAt
        else round.decidedAt = pure.dateValue(value, pure.zone())
      } else if (field === 'round-note') {
        if (value.trim() === '') delete round.note
        else round.note = value
      }
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
      else if (field === 'revision-change') {
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

    return {
      render: render,
      problem: problem,
      addFigure: addFigure,
      updateFigure: updateFigure,
      removeFigure: removeFigure,
      addRound: addRound,
      updateRound: updateRound,
      removeRound: removeRound,
      addRevision: addRevision,
      updateRevision: updateRevision,
      removeRevision: removeRevision,
      addRevisionMaterial: addRevisionMaterial,
      removeRevisionMaterial: removeRevisionMaterial
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
