/*
 * 横向项目卡的几组行：负责事项、交付物、沟通结论、验收节点、待确认问题、关联记录与材料。
 *
 * 只处理打开着的这一条记录的数组；草稿、保存与冲突在 editor.js。审批与经费不在这一份里。
 */
;(function (root) {
  'use strict'

  /**
   * 建几组行的渲染与增删。
   *
   * @param {object} ctx - 状态、节点、文案、判定与输入回调。
   * @returns {object} 行操作。
   */
  root.createProjectRows = function (ctx) {
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
      var row = event.target.closest('.pj__line')
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
      if (part === 'due' || part === 'at') entry[part] = hit.target.value === '' ? null : hit.target.value
      else entry[part] = hit.target.value
      ctx.onInput()
    }

    function remove(event) {
      if (!(event.target instanceof Element)) return
      var button = event.target.closest('.pj__line-remove')
      if (button === null) return
      var row = button.closest('.pj__line')
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
      if (kind === 'tasks') list.push({ id: newId('p'), title: '', status: 'todo', due: null })
      else if (kind === 'deliverables') list.push({ id: newId('d'), name: '', version: '', status: 'draft', due: null })
      else if (kind === 'communications') list.push({ id: newId('n'), summary: '', at: null })
      else if (kind === 'milestones') list.push({ id: newId('m'), label: '', status: 'todo', due: null })
      else if (kind === 'issues') list.push({ id: newId('i'), title: '', status: 'open' })
      render(kind)
      var listNode = nodes[kind]
      if (listNode !== null) {
        var rows = listNode.querySelectorAll('.pj__line')
        var last = rows[rows.length - 1]
        var first = last === undefined ? null : last.querySelector('input, select')
        if (first !== null) first.focus()
      }
      ctx.onInput()
    }

    function render(kind) {
      if (kind === 'tasks') return renderTasks()
      if (kind === 'deliverables') return renderDeliverables()
      if (kind === 'communications') return renderCommunications()
      if (kind === 'milestones') return renderMilestones()
      if (kind === 'issues') return renderIssues()
      return undefined
    }

    function wireRowList(list) {
      if (list === null) return
      list.addEventListener('input', update)
      list.addEventListener('change', update)
      list.addEventListener('click', remove)
    }

    function each(kind, node, make) {
      if (node === null) return
      var items = []
      for (var at = 0; at < app[kind].length; at += 1) items.push(make(app[kind][at], at, text))
      node.replaceChildren.apply(node, items)
    }

    function renderTasks() {
      each('tasks', nodes.tasks, view.taskRow)
    }

    function renderDeliverables() {
      each('deliverables', nodes.deliverables, view.deliverableRow)
    }

    function renderCommunications() {
      each('communications', nodes.communications, view.communicationRow)
    }

    function renderMilestones() {
      each('milestones', nodes.milestones, view.milestoneRow)
    }

    function renderIssues() {
      each('issues', nodes.issues, view.issueRow)
    }

    function renderRelated() {
      var list = nodes.related
      if (list === null) return
      var items = []
      for (var at = 0; at < app.related.length; at += 1) {
        var ref = app.related[at]
        items.push(view.relatedRow(ref, recordOf(ref), text))
      }
      list.replaceChildren.apply(list, items)
    }

    function recordOf(ref) {
      for (var at = 0; at < app.records.length; at += 1) {
        var record = app.records[at]
        if (record !== null && typeof record === 'object' && record.kind === ref.kind && record.id === ref.id) return record
      }
      return null
    }

    function renderRelatedOptions() {
      var select = nodes.relatedSelect
      if (select === null) return
      var items = []
      var placeholder = document.createElement('option')
      placeholder.value = ''
      placeholder.textContent = t('relatedPlaceholder')
      items.push(placeholder)
      for (var at = 0; at < app.records.length; at += 1) {
        var record = app.records[at]
        if (record === null || typeof record !== 'object' || typeof record.id !== 'string') continue
        if (!pure.isRelatedKind(record.kind)) continue
        var option = document.createElement('option')
        option.value = record.kind + ':' + record.id
        option.textContent = t(pure.relatedKey(record.kind)) + ' · ' + (typeof record.title === 'string' && record.title !== '' ? record.title : record.id)
        items.push(option)
      }
      select.replaceChildren.apply(select, items)
    }

    function addRelated() {
      var select = nodes.relatedSelect
      if (select === null) return
      var value = select.value
      if (value === '') return
      var at = value.indexOf(':')
      if (at <= 0) return
      var ref = { kind: value.slice(0, at), id: value.slice(at + 1) }
      for (var index = 0; index < app.related.length; index += 1) {
        if (app.related[index].kind === ref.kind && app.related[index].id === ref.id) return
      }
      app.related.push(ref)
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
      var open = event.target.closest('.pj__material-open')
      if (open !== null && typeof open.dataset.url === 'string' && live && typeof widget.open === 'function') {
        widget.open(open.dataset.url)
        return
      }
      var button = event.target.closest('.pj__material-remove')
      if (button !== null) removeMaterial(button.getAttribute('data-material'))
    }

    function onRelatedClick(event) {
      if (!(event.target instanceof Element)) return
      var button = event.target.closest('.pj__related-remove')
      if (button === null) return
      var value = String(button.dataset.related)
      app.related = app.related.filter(function (ref) { return ref.kind + ':' + ref.id !== value })
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
      app.materials.push({ id: newId('pm'), url: url, title: title })
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
      app.tasks = copyList(record, 'tasks')
      app.deliverables = copyList(record, 'deliverables')
      app.communications = copyList(record, 'communications')
      app.milestones = copyList(record, 'milestones')
      app.issues = copyList(record, 'issues')
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
      renderTasks()
      renderDeliverables()
      renderCommunications()
      renderMilestones()
      renderIssues()
      renderRelated()
      renderRelatedOptions()
      renderMaterials()
    }

    function orNull(list) {
      return list.length === 0 ? null : list
    }

    /**
     * 把当前几组行整理成可保存的字段；有一处不完整就返回 null。
     *
     * @returns {object|null} 归一后的字段，或 null。
     */
    function cleaned() {
      var tasks = pure.cleanTasks(app.tasks)
      var deliverables = pure.cleanDeliverables(app.deliverables)
      var communications = pure.cleanCommunications(app.communications)
      var milestones = pure.cleanMilestones(app.milestones)
      var issues = pure.cleanIssues(app.issues)
      if (tasks === null || deliverables === null || communications === null || milestones === null || issues === null) return null
      var related = []
      for (var at = 0; at < app.related.length; at += 1) {
        var ref = app.related[at]
        if (ref !== null && typeof ref === 'object' && pure.isRelatedKind(ref.kind) && typeof ref.id === 'string' && ref.id !== '') related.push({ kind: ref.kind, id: ref.id })
      }
      return {
        tasks: orNull(tasks),
        deliverables: orNull(deliverables),
        communications: orNull(communications),
        milestones: orNull(milestones),
        issues: orNull(issues),
        related: orNull(related),
        materials: orNull(app.materials)
      }
    }

    function wire() {
      wireRowList(nodes.tasks)
      wireRowList(nodes.deliverables)
      wireRowList(nodes.communications)
      wireRowList(nodes.milestones)
      wireRowList(nodes.issues)
      if (nodes.related !== null) nodes.related.addEventListener('click', onRelatedClick)
      if (nodes.materials !== null) nodes.materials.addEventListener('click', onMaterialClick)
    }

    wire()

    return {
      fill: fill,
      renderAll: renderAll,
      renderRelated: renderRelated,
      renderRelatedOptions: renderRelatedOptions,
      renderMaterials: renderMaterials,
      add: add,
      addRelated: addRelated,
      addMaterial: addMaterial,
      removeMaterial: removeMaterial,
      cleaned: cleaned
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
