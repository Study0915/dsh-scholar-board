/*
 * 课程卡的几组行：作业考试、关联记录与材料。
 *
 * 只处理打开着的这一条记录的数组；草稿、保存与冲突在 editor.js。学分与培养规则不在这一份里。
 */
;(function (root) {
  'use strict'

  /**
   * 建几组行的渲染与增删。
   *
   * @param {object} ctx - 状态、节点、文案、判定与输入回调。
   * @returns {object} 行操作。
   */
  root.createCourseRows = function (ctx) {
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
      var row = event.target.closest('.cs__line')
      if (row === null) return null
      var index = Number(row.dataset.index)
      if (!Number.isInteger(index)) return null
      return { row: row, index: index, target: event.target }
    }

    function update(event) {
      var hit = rowOfEvent(event)
      if (hit === null) return
      var part = hit.target.getAttribute('data-part')
      if (part === null) return
      var entry = app.work[hit.index]
      if (entry === undefined) return
      if (part === 'late') entry.late = hit.target.checked === true
      else if (part === 'due') entry.due = hit.target.value === '' ? null : hit.target.value
      else entry[part] = hit.target.value
      ctx.onInput()
    }

    function remove(event) {
      if (!(event.target instanceof Element)) return
      var button = event.target.closest('.cs__line-remove')
      if (button === null) return
      var row = button.closest('.cs__line')
      if (row === null) return
      var index = Number(row.dataset.index)
      if (!Number.isInteger(index) || app.work[index] === undefined) return
      app.work.splice(index, 1)
      renderWork()
      ctx.onInput()
    }

    function newId(prefix) {
      return prefix + '-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000))
    }

    function addWork() {
      if (app.work.length >= pure.MAX_WORK) return
      app.work.push({ id: newId('w'), kind: 'assignment', title: '', status: 'todo', due: null })
      renderWork()
      var rows = nodes.work === null ? [] : nodes.work.querySelectorAll('.cs__line')
      var last = rows[rows.length - 1]
      var first = last === undefined ? null : last.querySelector('input, select')
      if (first !== null) first.focus()
      ctx.onInput()
    }

    function renderWork() {
      if (nodes.work === null) return
      var items = []
      for (var at = 0; at < app.work.length; at += 1) items.push(view.workRow(app.work[at], at, text))
      nodes.work.replaceChildren.apply(nodes.work, items)
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
      var open = event.target.closest('.cs__material-open')
      if (open !== null && typeof open.dataset.url === 'string' && live && typeof widget.open === 'function') {
        widget.open(open.dataset.url)
        return
      }
      var button = event.target.closest('.cs__material-remove')
      if (button !== null) removeMaterial(button.getAttribute('data-material'))
    }

    function onRelatedClick(event) {
      if (!(event.target instanceof Element)) return
      var button = event.target.closest('.cs__related-remove')
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
      app.materials.push({ id: newId('cm'), url: url, title: title })
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
      app.work = copyList(record, 'work')
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
      renderWork()
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
      var work = pure.cleanWork(app.work)
      if (work === null) return null
      var related = []
      for (var at = 0; at < app.related.length; at += 1) {
        var ref = app.related[at]
        if (ref !== null && typeof ref === 'object' && pure.isRelatedKind(ref.kind) && typeof ref.id === 'string' && ref.id !== '') related.push({ kind: ref.kind, id: ref.id })
      }
      return {
        work: orNull(work),
        related: orNull(related),
        materials: orNull(app.materials)
      }
    }

    function wire() {
      if (nodes.work !== null) {
        nodes.work.addEventListener('input', update)
        nodes.work.addEventListener('change', update)
        nodes.work.addEventListener('click', remove)
      }
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
      addWork: addWork,
      addRelated: addRelated,
      addMaterial: addMaterial,
      removeMaterial: removeMaterial,
      cleaned: cleaned
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
