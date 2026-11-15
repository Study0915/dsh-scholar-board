/*
 * 文献阅读卡的材料面板：网页与本地路径两种引用，添加、显示与移除。
 *
 * 本地路径只当文本：不扫描磁盘、不当作地址打开、也不作为命令执行。宿主没有打开本地文件的能力，
 * 所以本地材料给的是「复制路径」，人拿到自己的终端或文件管理器里重新定位。材料记着设备标签，
 * 换一台机器时标出「另一台设备」，避免把旧路径当成本机可用的位置。
 */
;(function (root) {
  'use strict'

  /**
   * 建材料面板。
   *
   * @param {object} ctx - 节点、文案、设备标签与增删回调。
   * @returns {object} 面板对外的动作。
   */
  root.createLiteratureMaterials = function (ctx) {
    var t = ctx.t
    var pure = ctx.pure
    var nodes = ctx.nodes
    var view = ctx.view
    var text = { t: t, fill: pure.fill }

    /** 设备标签在宿主能力回来之后才定；每次用时再读，不等构造那一刻。 */
    function device() {
      return typeof ctx.deviceOf === 'function' ? String(ctx.deviceOf() || '') : ''
    }

    function kind() {
      return nodes.materialKind !== null && nodes.materialKind.value === 'local' ? 'local' : 'web'
    }

    /** 切换来源时只露出这一种要填的坐标，另一种清空。 */
    function syncKind() {
      var local = kind() === 'local'
      if (nodes.materialUrl !== null) {
        nodes.materialUrl.hidden = local
        if (local) nodes.materialUrl.value = ''
      }
      if (nodes.materialPath !== null) {
        nodes.materialPath.hidden = !local
        if (!local) nodes.materialPath.value = ''
      }
      if (nodes.materialDevice !== null) nodes.materialDevice.hidden = !local
      if (nodes.materialError !== null) nodes.materialError.textContent = ''
    }

    function fieldValue(node) {
      return node !== null && node !== undefined && typeof node.value === 'string' ? node.value.trim() : ''
    }

    /** 把表单里的材料加进记录；不合法的留在输入里，并说明哪一处不对。 */
    function add() {
      var checkedAt = fieldValue(nodes.materialCheckedAt)
      if (checkedAt !== '' && !pure.dateTextValid(checkedAt)) {
        if (nodes.materialError !== null) nodes.materialError.textContent = t('materialDateInvalid')
        return
      }
      var material = pure.materialDraft({
        kind: kind(),
        url: fieldValue(nodes.materialUrl),
        path: fieldValue(nodes.materialPath),
        title: fieldValue(nodes.materialTitle),
        purpose: fieldValue(nodes.materialPurpose),
        device: fieldValue(nodes.materialDevice) === '' ? device() : fieldValue(nodes.materialDevice),
        version: fieldValue(nodes.materialVersion),
        checkedAt: fieldValue(nodes.materialCheckedAt)
      }, Date.now(), ctx.count())
      if (material === null) {
        if (nodes.materialError !== null) {
          nodes.materialError.textContent = fieldValue(nodes.materialPath) !== '' || fieldValue(nodes.materialUrl) !== ''
            ? t('materialPathInvalid')
            : t('materialInvalid')
        }
        return
      }
      if (nodes.materialError !== null) nodes.materialError.textContent = ''
      ctx.onAdd(material)
      clear()
    }

    function clear() {
      var inputs = [nodes.materialUrl, nodes.materialPath, nodes.materialTitle, nodes.materialPurpose, nodes.materialDevice, nodes.materialVersion, nodes.materialCheckedAt]
      for (var at = 0; at < inputs.length; at += 1) {
        if (inputs[at] !== null && inputs[at] !== undefined) inputs[at].value = ''
      }
    }

    /** 按当前材料重建列表；设备标签用来标出属于别的机器的本地路径。 */
    function render(materials, readonly) {
      if (nodes.materials === null) return
      var rows = []
      for (var at = 0; at < materials.length; at += 1) {
        var material = materials[at]
        if (material === null || typeof material !== 'object') continue
        rows.push(view.materialRow(material, text, { device: device(), readonly: readonly === true, removeText: t('removeMaterial') }))
      }
      nodes.materials.replaceChildren.apply(nodes.materials, rows)
      if (nodes.materialEmpty !== null) nodes.materialEmpty.hidden = rows.length > 0
    }

    function setReadonly(readonly) {
      var controls = [nodes.materialKind, nodes.materialUrl, nodes.materialPath, nodes.materialTitle, nodes.materialPurpose, nodes.materialDevice, nodes.materialVersion, nodes.materialCheckedAt, nodes.materialAdd]
      for (var at = 0; at < controls.length; at += 1) {
        if (controls[at] !== null && controls[at] !== undefined) controls[at].disabled = readonly
      }
      if (nodes.materialDevice !== null) nodes.materialDevice.placeholder = device() === '' ? t('materialDevice') : device()
    }

    if (nodes.materialKind !== null) nodes.materialKind.addEventListener('change', function () { syncKind() })
    if (nodes.materialAdd !== null) nodes.materialAdd.addEventListener('click', function () { add() })

    return { render: render, add: add, syncKind: syncKind, setReadonly: setReadonly }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)