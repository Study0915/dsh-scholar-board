/*
 * 组会记录卡的画面零件：一行记录、一个小标签、一行材料与缩略画面的样例数据。
 *
 * 只造节点与文字；事件、状态与保存都在 main.js。这样缩略画面与真实列表画的是同一种行。
 */
;(function (root) {
  'use strict'

  var model = root.MeetingRecords

  function tagOf(text, tone) {
    var tag = document.createElement('span')
    tag.className = 'mt__tag'
    tag.dataset.tone = tone
    tag.textContent = text
    return tag
  }

  /**
   * 一行记录：日期、标题与一行反馈；整行是按钮，进入详情。
   *
   * @param {object} record - 一条组会。
   * @param {{ t: function(string): string, fill: function(string, object): string, rowDate: function(object): string }} text - 文案。
   * @returns {HTMLButtonElement} 行按钮。
   */
  function rowOf(record, text) {
    var row = document.createElement('button')
    row.type = 'button'
    row.className = 'mt__row'
    row.dataset.id = record.id
    row.setAttribute('aria-label', text.rowDate(record) + ' · ' + record.title)
    var head = document.createElement('span')
    head.className = 'mt__row-head'
    var date = document.createElement('span')
    date.className = 'mt__row-date'
    date.textContent = text.rowDate(record)
    var title = document.createElement('span')
    title.className = 'mt__row-title'
    title.textContent = record.title
    head.append(date, title)
    row.appendChild(head)
    var sub = document.createElement('span')
    sub.className = 'mt__row-sub'
    var snippet = model.snippetOf(record)
    if (snippet !== '') {
      var line = document.createElement('span')
      line.className = 'mt__row-snippet'
      line.textContent = snippet
      sub.appendChild(line)
    }
    var tags = document.createElement('span')
    tags.className = 'mt__tags'
    if (typeof record.openQuestions === 'string' && record.openQuestions.trim() !== '') tags.appendChild(tagOf(text.t('openQuestion'), 'question'))
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
    row.className = 'mt__material'
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'mt__material-open'
    open.textContent = typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url)
    open.title = String(material.url)
    open.dataset.url = String(material.url)
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'mt__ghost mt__material-remove'
    remove.textContent = removeText
    remove.dataset.material = String(material.id)
    row.append(open, remove)
    return row
  }

  /** 缩略画面里的一份静态样例：三条组会，与真实读到的形状相同。 */
  function sampleRows() {
    var now = new Date().toISOString()
    return [
      { id: 'sample-1', kind: 'meeting', title: '第 6 次组会：低轨星座干扰分析', date: { kind: 'date', date: '2026-11-06', timeZone: 'Asia/Shanghai' }, topics: '汇报本周的仿真进展', feedback: '补充一个基线对比，并把信道条件的假设写清楚', openQuestions: '静态信道假设是否需要放宽', materials: [{ id: 'm1', url: 'https://example.com/slides', title: '组会幻灯片' }], updatedAt: now, archived: false },
      { id: 'sample-2', kind: 'meeting', title: '第 5 次组会：论文初稿结构', date: { kind: 'date', date: '2026-10-30', timeZone: 'Asia/Shanghai' }, topics: '讨论引言与系统模型', feedback: '相关工作再收一轮，突出与已有方法的差别', updatedAt: now, archived: false },
      { id: 'sample-3', kind: 'meeting', title: '第 4 次组会：实验结果', date: { kind: 'date', date: '2026-10-23', timeZone: 'Asia/Shanghai' }, topics: '结果图表与指标', feedback: '统一坐标轴的量纲，补一张误差随信噪比变化的图', updatedAt: now, archived: false }
    ]
  }

  root.MeetingRecordsView = {
    tagOf: tagOf,
    rowOf: rowOf,
    materialRow: materialRow,
    sampleRows: sampleRows
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
