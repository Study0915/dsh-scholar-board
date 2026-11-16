/*
 * 小论文卡的深一层编辑：图表目录、投稿轮次与修回事项。
 *
 * 由 editor.js 建出来，和编辑面板共用同一份打开中的表单状态；图表在这里，投稿与修回在 editor-reviews.js。
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
    var widget = ctx.widget
    var live = ctx.live
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

    /** 图表的扩展字段：运行、数据材料、绘图代码与结论。 */
    var panel = root.createManuscriptFigurePanel({
      app: app,
      widget: widget,
      live: live,
      t: t,
      pure: pure,
      control: controlOf,
      trashed: trashedNow,
      newId: newId,
      rerender: function () { renderFigures() },
      onInput: function () { onInput() },
      setStatus: function (text, tone) { setStatus(text, tone) }
    })

    /** 投稿轮次与修回事项：检查表、冻结、转行动项与导出。 */
    var reviews = root.createManuscriptReviews({
      app: app,
      nodes: nodes,
      widget: widget,
      live: live,
      t: t,
      pure: pure,
      onInput: function () { onInput() },
      setStatus: function (text, tone) { setStatus(text, tone) },
      newId: newId,
      trashed: trashedNow,
      findEntry: findEntry,
      control: controlOf,
      option: optionOf,
      removeButton: removeButtonOf,
      dateField: dateFieldOf,
      dateInput: dateInputOf,
      emptyHint: emptyHint
    })

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
      panel.appendTo(row, figure)
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
      panel.refresh()
    }

    /** 图表、投稿与修回一起重画。 */
    function render() {
      renderFigures()
      reviews.render()
    }

    /** 深一层条目的填写问题；空串表示可以保存。 */
    function problem() {
      for (var figureAt = 0; figureAt < app.figures.length; figureAt += 1) {
        var figure = app.figures[figureAt]
        if (figure === null || typeof figure !== 'object') return t('figureInvalid')
        if (!pure.isFigureKind(figure.kind)) return t('figureInvalid')
        if (typeof figure.label !== 'string' || figure.label.trim() === '' || typeof figure.title !== 'string' || figure.title.trim() === '') return t('figureInvalid')
      }
      return reviews.problem()
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
      if (field === 'figure-material-url' || field === 'figure-material-title') return
      var figure = findEntry(app.figures, id)
      if (figure === null) return
      if (field === 'figure-kind') figure.kind = value
      else if (field === 'figure-label') figure.label = value
      else if (field === 'figure-title') figure.title = value
      else if (field === 'figure-note') {
        if (value.trim() === '') delete figure.note
        else figure.note = value
      } else if (panel.update(figure, id, field, value)) {
        onInput()
        return
      }
      onInput()
    }

    function removeFigure(id) {
      app.figures = app.figures.filter(function (figure) { return figure === null || typeof figure !== 'object' || String(figure.id) !== String(id) })
      renderFigures()
      onInput()
    }

    return {
      render: render,
      problem: problem,
      addFigure: addFigure,
      updateFigure: updateFigure,
      removeFigure: removeFigure,
      addFigureRun: panel.addRun,
      removeFigureRun: panel.removeRun,
      addFigureMaterial: panel.addMaterial,
      removeFigureMaterial: panel.removeMaterial,
      openFigureRun: panel.openRun,
      addRound: reviews.addRound,
      updateRound: reviews.updateRound,
      removeRound: reviews.removeRound,
      toggleFreeze: reviews.toggleFreeze,
      addCheck: reviews.addCheck,
      removeCheck: reviews.removeCheck,
      addRevision: reviews.addRevision,
      updateRevision: reviews.updateRevision,
      removeRevision: reviews.removeRevision,
      addRevisionMaterial: reviews.addRevisionMaterial,
      removeRevisionMaterial: reviews.removeRevisionMaterial,
      convertRevisionToAction: reviews.convertRevisionToAction,
      openExport: reviews.openExport,
      renderExport: reviews.renderExport,
      selectExport: reviews.selectExport
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)