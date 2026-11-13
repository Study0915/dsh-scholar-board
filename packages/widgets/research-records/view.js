/*
 * 研究记录卡的画面零件：一行记录、一个做法标签、一行参数或指标、一行材料与缩略画面的样例数据。
 *
 * 只造节点与文字；事件、状态与保存都在 main.js。这样缩略画面与真实列表画的是同一种行。
 */
;(function (root) {
  'use strict'

  var model = root.ResearchRecords

  function tagOf(text, tone) {
    var tag = document.createElement('span')
    tag.className = 'rs__tag'
    tag.dataset.tone = tone
    tag.textContent = text
    return tag
  }

  /** 做法标签的色调。 */
  function methodTone(method) {
    return method === 'experiment' ? 'ok' : method === 'simulation' ? 'reading' : 'neutral'
  }

  /**
   * 一行记录：做法、标题与环境 / 结论；整行是按钮，进入详情。
   *
   * @param {object} record - 一条研究记录。
   * @param {{ t: function(string): string, fill: function(string, object): string }} text - 文案。
   * @returns {HTMLButtonElement} 行按钮。
   */
  function rowOf(record, text) {
    var method = model.methodOf(record)
    var methodText = text.t(model.methodKey(method))
    var row = document.createElement('button')
    row.type = 'button'
    row.className = 'rs__row'
    row.dataset.id = record.id
    row.setAttribute('aria-label', methodText + ' · ' + record.title)
    var head = document.createElement('span')
    head.className = 'rs__row-head'
    var methodTag = tagOf(methodText, methodTone(method))
    var title = document.createElement('span')
    title.className = 'rs__row-title'
    title.textContent = record.title
    head.append(methodTag, title)
    row.appendChild(head)
    var sub = document.createElement('span')
    sub.className = 'rs__row-sub'
    var unknown = text.t('unknown')
    var environment = model.labelledOf(record, 'environment', text.t('environment'), unknown)
    var summary = model.summaryOf(record, unknown)
    var line = document.createElement('span')
    line.className = 'rs__row-snippet'
    line.textContent = environment + ' · ' + summary
    sub.appendChild(line)
    var tags = document.createElement('span')
    tags.className = 'rs__tags'
    var materials = Array.isArray(record.materials) ? record.materials.length : 0
    if (materials > 0) tags.appendChild(tagOf(text.fill(text.t('materials'), { n: materials }), 'material'))
    var left = model.daysLeft(record)
    if (left !== null) tags.appendChild(tagOf(text.fill(text.t('deletedIn'), { n: left }), 'trash'))
    if (tags.childNodes.length > 0) sub.appendChild(tags)
    row.appendChild(sub)
    return row
  }

  /**
   * 一行参数或指标：名称、数值、单位各一个输入，右边是移除。
   *
   * @param {object} entry - `{ name, value, unit }`。
   * @param {number} index - 在组里的位置。
   * @param {string} kind - `parameters` 或 `metrics`。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 条目行。
   */
  function entryRow(entry, index, kind, text) {
    var row = document.createElement('li')
    row.className = 'rs__entry'
    row.dataset.kind = kind
    row.dataset.index = String(index)
    var name = document.createElement('input')
    name.type = 'text'
    name.className = 'rs__input rs__entry-name'
    name.dataset.part = 'name'
    name.value = typeof entry.name === 'string' ? entry.name : ''
    name.placeholder = text.t('entryName')
    name.setAttribute('aria-label', text.t('entryName'))
    name.autocomplete = 'off'
    var value = document.createElement('input')
    value.type = 'text'
    value.className = 'rs__input rs__entry-value'
    value.dataset.part = 'value'
    value.value = typeof entry.value === 'string' ? entry.value : ''
    value.placeholder = text.t('entryValue')
    value.setAttribute('aria-label', text.t('entryValue'))
    value.autocomplete = 'off'
    var unit = document.createElement('input')
    unit.type = 'text'
    unit.className = 'rs__input rs__entry-unit'
    unit.dataset.part = 'unit'
    unit.value = typeof entry.unit === 'string' ? entry.unit : ''
    unit.placeholder = text.t('entryUnit')
    unit.setAttribute('aria-label', text.t('entryUnit'))
    unit.autocomplete = 'off'
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'rs__ghost rs__entry-remove'
    remove.textContent = text.t('removeEntry')
    remove.dataset.kind = kind
    remove.dataset.index = String(index)
    row.append(name, value, unit, remove)
    return row
  }

  /**
   * 一行材料：打开按钮是一段带下划线的标题，右边是移除。
   *
   * @param {object} material - 一条材料引用。
   * @param {string} removeText - 「移除」的文案。
   * @returns {HTMLLIElement} 材料行。
   */
  function materialRow(material, removeText) {
    var row = document.createElement('li')
    row.className = 'rs__material'
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'rs__material-open'
    open.textContent = typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url)
    open.title = String(material.url)
    open.dataset.url = String(material.url)
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'rs__ghost rs__material-remove'
    remove.textContent = removeText
    remove.dataset.material = String(material.id)
    row.append(open, remove)
    return row
  }

  /** 缩略画面里的一份静态样例：三条记录，与真实读到的形状相同。 */
  function sampleRows() {
    var now = new Date().toISOString()
    return [
      { id: 'sample-1', kind: 'research', title: '多用户检测的闭式解推导', method: 'derivation', question: '非平稳干扰下能否写出闭式解', environment: '纸笔推导 · 数值验证', seed: '20261101', parameters: [{ name: '用户数', value: '8' }, { name: '天线数', value: '64' }], metrics: [], conclusion: '在干扰功率已知时闭式解存在，未知时要迭代', materials: [{ id: 'm1', url: 'https://example.com/derivation.pdf', title: '推导稿' }], updatedAt: now, archived: false },
      { id: 'sample-2', kind: 'research', title: '低轨星座干扰仿真', method: 'simulation', parameters: [{ name: '载频', value: '3.5', unit: 'GHz' }, { name: '带宽', value: '40', unit: 'MHz' }], metrics: [{ name: '误码率', value: '1e-3', unit: 'BER' }], updatedAt: now, archived: false },
      { id: 'sample-3', kind: 'research', title: '桌面平台上的接收机实验', method: 'experiment', environment: 'USRP X310 · GNU Radio 3.10', seed: '1, 2, 3', conclusion: '采样率提高到 20 MHz 后误码率下降', updatedAt: now, archived: false }
    ]
  }

  root.ResearchRecordsView = {
    tagOf: tagOf,
    methodTone: methodTone,
    rowOf: rowOf,
    entryRow: entryRow,
    materialRow: materialRow,
    sampleRows: sampleRows
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
