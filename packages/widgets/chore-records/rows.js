/*
 * 其他事务卡的材料行：一条记录的材料表。
 *
 * 只有材料一组；标题、类别、状态与期限在 editor.js 直接读表单。期限只用于排序与筛选。
 */
;(function (root) {
  'use strict'

  /**
   * 建材料行的渲染与增删。
   *
   * @param {object} ctx - 状态、节点、文案与输入回调。
   * @returns {object} 材料操作。
   */
  root.createChoreRows = function (ctx) {
    var app = ctx.app
    var nodes = ctx.nodes
    var widget = ctx.widget
    var live = ctx.live
    var t = ctx.t
    var pure = ctx.pure
    var view = ctx.view

    function newId(prefix) {
      return prefix + '-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000))
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
      var open = event.target.closest('.ch__material-open')
      if (open !== null && typeof open.dataset.url === 'string' && live && typeof widget.open === 'function') {
        widget.open(open.dataset.url)
        return
      }
      var button = event.target.closest('.ch__material-remove')
      if (button !== null) removeMaterial(button.getAttribute('data-material'))
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
      app.materials = copyList(record, 'materials')
      renderMaterials()
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

    if (nodes.materials !== null) nodes.materials.addEventListener('click', onMaterialClick)

    return {
      fill: fill,
      renderMaterials: renderMaterials,
      addMaterial: addMaterial,
      removeMaterial: removeMaterial
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
