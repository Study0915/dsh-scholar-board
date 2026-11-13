/*
 * 文献阅读卡的画面零件：一行记录、一个阶段标签、一行材料与缩略画面的样例数据。
 *
 * 只造节点与文字；事件、状态与保存都在 main.js。这样缩略画面与真实列表画的是同一种行。
 */
;(function (root) {
  'use strict'

  var model = root.LiteratureRecords

  function tagOf(text, tone) {
    var tag = document.createElement('span')
    tag.className = 'lt__tag'
    tag.dataset.tone = tone
    tag.textContent = text
    return tag
  }

  /**
   * 一行记录：阶段、标题与作者信息；整行是按钮，进入详情。
   *
   * @param {object} record - 一条文献。
   * @param {{ t: function(string): string, fill: function(string, object): string }} text - 文案。
   * @returns {HTMLButtonElement} 行按钮。
   */
  function rowOf(record, text) {
    var stage = model.stageOf(record)
    var stageText = text.t(model.stageKey(stage))
    var row = document.createElement('button')
    row.type = 'button'
    row.className = 'lt__row'
    row.dataset.id = record.id
    row.setAttribute('aria-label', stageText + ' · ' + record.title)
    var head = document.createElement('span')
    head.className = 'lt__row-head'
    var stageTag = tagOf(stageText, stage === 'understood' ? 'ok' : stage === 'reading' ? 'reading' : 'neutral')
    var title = document.createElement('span')
    title.className = 'lt__row-title'
    title.textContent = record.title
    head.append(stageTag, title)
    row.appendChild(head)
    var sub = document.createElement('span')
    sub.className = 'lt__row-sub'
    var meta = model.metaOf(record)
    var snippet = model.snippetOf(record)
    var lineText = meta && snippet ? meta + ' · ' + snippet : meta || snippet
    if (lineText !== '') {
      var line = document.createElement('span')
      line.className = 'lt__row-snippet'
      line.textContent = lineText
      sub.appendChild(line)
    }
    var tags = document.createElement('span')
    tags.className = 'lt__tags'
    var materials = Array.isArray(record.materials) ? record.materials.length : 0
    if (materials > 0) tags.appendChild(tagOf(text.fill(text.t('materials'), { n: materials }), 'material'))
    var left = model.daysLeft(record)
    if (left !== null) tags.appendChild(tagOf(text.fill(text.t('deletedIn'), { n: left }), 'trash'))
    if (tags.childNodes.length > 0) sub.appendChild(tags)
    if (sub.childNodes.length > 0) row.appendChild(sub)
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
    row.className = 'lt__material'
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'lt__material-open'
    open.textContent = typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url)
    open.title = String(material.url)
    open.dataset.url = String(material.url)
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'lt__ghost lt__material-remove'
    remove.textContent = removeText
    remove.dataset.material = String(material.id)
    row.append(open, remove)
    return row
  }

  /** 缩略画面里的一份静态样例：三条文献，与真实读到的形状相同。 */
  function sampleRows() {
    var now = new Date().toISOString()
    return [
      { id: 'sample-1', kind: 'literature', title: '低轨星座干扰下的多用户检测', authors: 'A. Author, B. Author', venue: 'IEEE TWC', year: 2025, stage: 'understood', understanding: '把干扰建模成非平稳过程，基线是匹配滤波与 MMSE', questions: '信道状态更新频率对误码率的影响还没算清', materials: [{ id: 'm1', url: 'https://example.com/paper', title: '论文页' }], updatedAt: now, archived: false },
      { id: 'sample-2', kind: 'literature', title: '稀疏码多址的因子图设计', authors: 'C. Author', venue: 'IEEE JSAC', year: 2024, stage: 'reading', understanding: '', updatedAt: now, archived: false },
      { id: 'sample-3', kind: 'literature', title: '毫米波信道的测量与建模', authors: 'D. Author, E. Author', venue: 'arXiv', year: 2026, stage: 'queued', updatedAt: now, archived: false }
    ]
  }

  root.LiteratureRecordsView = {
    tagOf: tagOf,
    rowOf: rowOf,
    materialRow: materialRow,
    sampleRows: sampleRows
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
