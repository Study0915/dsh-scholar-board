/*
 * 毕业论文卡的几组行：章节、成果来源、待补实验、学位节点、关联行动项与材料。
 *
 * 只处理打开着的这一条记录的数组；草稿、保存与冲突在 editor.js。学位节点完全由用户维护，
 * 这里不判断是否达到毕业要求，也不替用户补学校规则。
 */
;(function (root) {
  'use strict'

  /**
   * 建几组行的渲染与增删。
   *
   * @param {object} ctx - 状态、节点、文案、判定与输入回调。
   * @returns {object} 行操作。
   */
  root.createThesisRows = function (ctx) {
    var app = ctx.app
    var nodes = ctx.nodes
    var widget = ctx.widget
    var live = ctx.live
    var t = ctx.t
    var pure = ctx.pure
    var view = ctx.view
    var text = { t: t }

    function rowOfEvent(event) {
      if (!(event.target instanceof Element)) return null
      var row = event.target.closest('.ts__line')
      if (row === null) return null
      var index = Number(row.dataset.index)
      if (!Number.isInteger(index)) return null
      return { row: row, index: index, kind: row.dataset.kind, target: event.target }
    }

    function update(event) {
      var hit = rowOfEvent(event)
      if (hit === null) return
      var part = hit.target.getAttribute('data-part')
      if (part === null) return
      var list = app[hit.kind]
      if (!Array.isArray(list) || list[hit.index] === undefined) return
      var entry = list[hit.index]
      if (part === 'source') {
        var value = hit.target.value
        if (value === '') {
          entry.recordId = ''
        } else {
          var at = value.indexOf(':')
          if (at > 0) {
            entry.kind = value.slice(0, at)
            entry.recordId = value.slice(at + 1)
          }
        }
      } else if (part === 'due') {
        entry.due = hit.target.value === '' ? null : hit.target.value
      } else {
        entry[part] = hit.target.value
      }
      ctx.onInput()
    }

    function remove(event) {
      if (!(event.target instanceof Element)) return
      var button = event.target.closest('.ts__line-remove')
      if (button === null) return
      var row = button.closest('.ts__line')
      if (row === null) return
      var list = app[row.dataset.kind]
      var index = Number(row.dataset.index)
      if (!Array.isArray(list) || !Number.isInteger(index) || list[index] === undefined) return
      list.splice(index, 1)
      render(row.dataset.kind)
      ctx.onInput()
    }

    function newId(prefix) {
      return prefix + '-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000))
    }

    function add(kind) {
      var list = app[kind]
      if (!Array.isArray(list)) return
      var limit = kind === 'milestones' ? pure.MAX_MILESTONES : pure.MAX_ITEMS
      if (list.length >= limit) return
      if (kind === 'chapters') list.push({ id: newId('c'), title: '', status: 'planned' })
      else if (kind === 'results') list.push({ id: newId('x'), kind: 'manuscript', recordId: '', note: '' })
      else if (kind === 'experiments') list.push({ id: newId('e'), title: '', status: 'todo' })
      else if (kind === 'milestones') list.push({ id: newId('m'), label: '', status: 'todo', due: null })
      render(kind)
      var listNode = nodes[kind]
      if (listNode !== null) {
        var rows = listNode.querySelectorAll('.ts__line')
        var last = rows[rows.length - 1]
        var first = last === undefined ? null : last.querySelector('input, select')
        if (first !== null) first.focus()
      }
      ctx.onInput()
    }

    function render(kind) {
      if (kind === 'chapters') return renderChapters()
      if (kind === 'results') return renderResults()
      if (kind === 'experiments') return renderExperiments()
      if (kind === 'milestones') return renderMilestones()
      return undefined
    }

    function wireRowList(list) {
      if (list === null) return
      list.addEventListener('input', update)
      list.addEventListener('change', update)
      list.addEventListener('click', remove)
    }

    function renderChapters() {
      var list = nodes.chapters
      if (list === null) return
      var items = []
      for (var at = 0; at < app.chapters.length; at += 1) items.push(view.chapterRow(app.chapters[at], at, text))
      list.replaceChildren.apply(list, items)
    }

    function renderResults() {
      var list = nodes.results
      if (list === null) return
      var items = []
      for (var at = 0; at < app.results.length; at += 1) items.push(view.resultRow(app.results[at], at, app.sources, text))
      list.replaceChildren.apply(list, items)
    }

    function renderExperiments() {
      var list = nodes.experiments
      if (list === null) return
      var items = []
      for (var at = 0; at < app.experiments.length; at += 1) items.push(view.experimentRow(app.experiments[at], at, text))
      list.replaceChildren.apply(list, items)
    }

    function renderMilestones() {
      var list = nodes.milestones
      if (list === null) return
      var items = []
      for (var at = 0; at < app.milestones.length; at += 1) items.push(view.milestoneRow(app.milestones[at], at, text))
      list.replaceChildren.apply(list, items)
    }

    function renderRelated() {
      var list = nodes.related
      if (list === null) return
      var items = []
      for (var at = 0; at < app.related.length; at += 1) {
        var ref = app.related[at]
        items.push(view.relatedRow(ref, actionOf(ref.id), text))
      }
      list.replaceChildren.apply(list, items)
    }

    function actionOf(id) {
      for (var at = 0; at < app.actions.length; at += 1) {
        if (app.actions[at] !== null && typeof app.actions[at] === 'object' && app.actions[at].id === id) return app.actions[at]
      }
      return null
    }

    function renderActionOptions() {
      var select = nodes.actionSelect
      if (select === null) return
      var items = []
      var placeholder = document.createElement('option')
      placeholder.value = ''
      placeholder.textContent = t('actionPlaceholder')
      items.push(placeholder)
      for (var at = 0; at < app.actions.length; at += 1) {
        var action = app.actions[at]
        if (action === null || typeof action !== 'object' || typeof action.id !== 'string') continue
        var option = document.createElement('option')
        option.value = action.id
        option.textContent = typeof action.title === 'string' && action.title !== '' ? action.title : action.id
        items.push(option)
      }
      select.replaceChildren.apply(select, items)
    }

    function addRelated() {
      var select = nodes.actionSelect
      if (select === null) return
      var id = select.value
      if (id === '') return
      for (var at = 0; at < app.related.length; at += 1) if (app.related[at].id === id) return
      app.related.push({ kind: 'action', id: id })
      select.value = ''
      renderRelated()
      ctx.onInput()
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

    function onMaterialClick(event) {
      if (!(event.target instanceof Element)) return
      var open = event.target.closest('.ts__material-open')
      if (open !== null && typeof open.dataset.url === 'string' && live && typeof widget.open === 'function') {
        widget.open(open.dataset.url)
        return
      }
      var button = event.target.closest('.ts__material-remove')
      if (button !== null) removeMaterial(button.getAttribute('data-material'))
    }

    function onRelatedClick(event) {
      if (!(event.target instanceof Element)) return
      var button = event.target.closest('.ts__related-remove')
      if (button === null) return
      app.related = app.related.filter(function (ref) { return ref.id !== button.dataset.related })
      renderRelated()
      ctx.onInput()
    }

    function addMaterial() {
      var url = nodes.materialUrl.value.trim()
      var title = nodes.materialTitle.value.trim()
      if (!pure.materialValid(url, title)) {
        nodes.materialError.textContent = t('materialInvalid')
        return
      }
      nodes.materialError.textContent = ''
      app.materials.push({ id: newId('tm'), url: url, title: title })
      nodes.materialUrl.value = ''
      nodes.materialTitle.value = ''
      renderMaterials()
      ctx.onInput()
    }

    function removeMaterial(id) {
      app.materials = app.materials.filter(function (entry) {
        return entry !== null && typeof entry === 'object' && String(entry.id) !== String(id)
      })
      renderMaterials()
      ctx.onInput()
    }

    function fill(record) {
      app.chapters = copyList(record, 'chapters')
      app.results = copyList(record, 'results')
      app.experiments = copyList(record, 'experiments')
      app.milestones = copyList(record, 'milestones')
      app.related = copyList(record, 'related')
      app.materials = copyList(record, 'materials')
      renderAll()
    }

    function copyList(record, field) {
      if (record === null || typeof record !== 'object' || !Array.isArray(record[field])) return []
      var out = []
      for (var at = 0; at < record[field].length; at += 1) {
        var entry = record[field][at]
        if (entry !== null && typeof entry === 'object') out.push(Object.assign({}, entry))
      }
      return out
    }

    function renderAll() {
      renderChapters()
      renderResults()
      renderExperiments()
      renderMilestones()
      renderRelated()
      renderActionOptions()
      renderMaterials()
    }

    /**
     * 把当前几组行整理成可保存的字段；有一处不完整就返回 null。
     *
     * @returns {object|null} 归一后的字段，或 null。
     */
    function cleaned() {
      var chapters = pure.cleanChapters(app.chapters)
      var results = pure.cleanResults(app.results)
      var experiments = pure.cleanExperiments(app.experiments)
      var milestones = pure.cleanMilestones(app.milestones)
      if (chapters === null || results === null || experiments === null || milestones === null) return null
      var related = []
      for (var at = 0; at < app.related.length; at += 1) {
        var ref = app.related[at]
        if (ref !== null && typeof ref === 'object' && ref.kind === 'action' && typeof ref.id === 'string' && ref.id !== '') related.push({ kind: 'action', id: ref.id })
      }
      return {
        chapters: chapters.length === 0 ? null : chapters,
        results: results.length === 0 ? null : results,
        experiments: experiments.length === 0 ? null : experiments,
        milestones: milestones.length === 0 ? null : milestones,
        related: related.length === 0 ? null : related,
        materials: app.materials.length === 0 ? null : app.materials
      }
    }

    function wire() {
      wireRowList(nodes.chapters)
      wireRowList(nodes.results)
      wireRowList(nodes.experiments)
      wireRowList(nodes.milestones)
      if (nodes.related !== null) nodes.related.addEventListener('click', onRelatedClick)
      if (nodes.materials !== null) nodes.materials.addEventListener('click', onMaterialClick)
    }

    wire()

    return {
      fill: fill,
      renderAll: renderAll,
      renderResults: renderResults,
      renderRelated: renderRelated,
      renderActionOptions: renderActionOptions,
      renderMaterials: renderMaterials,
      add: add,
      addRelated: addRelated,
      addMaterial: addMaterial,
      removeMaterial: removeMaterial,
      cleaned: cleaned
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
