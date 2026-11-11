/*
 * 行动项卡的画面零件：一行行动项、状态点、材料行与缩略画面的样例数据。
 *
 * 行里是一个打开详情的按钮与一个「完成 / 重开」的快捷按钮；只造节点与文字，状态与保存都在 main.js。
 */
;(function (root) {
  'use strict'

  var model = root.ActionItems

  function statusKey(status) {
    if (status === 'doing') return 'statusDoing'
    if (status === 'blocked') return 'statusBlocked'
    if (status === 'done') return 'statusDone'
    if (status === 'cancelled') return 'statusCancelled'
    return 'statusTodo'
  }

  /**
   * 一行行动项：状态点、标题与一行副文，右边是期限；行尾是快捷按钮。
   *
   * @param {object} record - 一条行动项。
   * @param {{ t: function(string): string, fill: function(string, object): string, now: number }} text - 文案与时钟。
   * @returns {HTMLDivElement} 行。
   */
  function rowOf(record, text) {
    var row = document.createElement('div')
    row.className = 'at__row'
    row.dataset.id = record.id
    row.dataset.status = record.status
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'at__open'
    open.setAttribute('aria-label', text.t(statusKey(record.status)) + ' · ' + record.title)

    var dot = document.createElement('span')
    dot.className = 'at__dot'
    dot.dataset.status = record.status
    dot.setAttribute('aria-hidden', 'true')

    var body = document.createElement('span')
    body.className = 'at__row-body'
    var title = document.createElement('span')
    title.className = 'at__row-title'
    title.textContent = record.title
    body.appendChild(title)

    var sub = document.createElement('span')
    sub.className = 'at__row-sub'
    var tone = model.dueTone(record, text.now)
    var due = model.dueText(record)
    var dueChip = document.createElement('span')
    dueChip.className = 'at__due'
    dueChip.dataset.tone = tone
    dueChip.textContent = due === '' ? text.t('dueNone') : due
    sub.appendChild(dueChip)
    if (tone === 'overdue') sub.appendChild(chipOf(text.t('overdue'), 'overdue'))
    if (tone === 'today') sub.appendChild(chipOf(text.t('dueToday'), 'today'))
    if (record.status === 'blocked' && typeof record.blockedNote === 'string' && record.blockedNote.trim() !== '') {
      sub.appendChild(chipOf(record.blockedNote.trim().replace(/\s+/g, ' '), 'blocked'))
    }
    if (record.status === 'done' && typeof record.doneNote === 'string' && record.doneNote.trim() !== '') {
      sub.appendChild(chipOf(record.doneNote.trim().replace(/\s+/g, ' '), 'done'))
    }
    if (record.source !== null && record.source !== undefined && typeof record.source === 'object') {
      sub.appendChild(chipOf(text.t('source'), 'source'))
    }
    var materials = Array.isArray(record.materials) ? record.materials.length : 0
    if (materials > 0) sub.appendChild(chipOf(text.fill(text.t('materials'), { n: materials }), 'material'))
    if (typeof record.deletedAt === 'string') {
      var days = Math.max(0, Math.ceil((Date.parse(record.deletedAt) + 30 * model.DAY - text.now) / model.DAY))
      if (!isNaN(days)) sub.appendChild(chipOf(text.fill(text.t('deletedIn'), { n: days }), 'trash'))
    }
    body.appendChild(sub)
    open.append(dot, body)
    row.appendChild(open)

    var quick = document.createElement('button')
    quick.type = 'button'
    quick.className = 'at__quick'
    quick.dataset.quick = record.status === 'done' || record.status === 'cancelled' ? 'todo' : 'done'
    quick.textContent = quick.dataset.quick === 'done' ? text.t('quickDone') : text.t('quickReopen')
    row.appendChild(quick)
    return row
  }

  function chipOf(text, tone) {
    var chip = document.createElement('span')
    chip.className = 'at__chip-tag'
    chip.dataset.tone = tone
    chip.textContent = text
    return chip
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
    row.className = 'at__material'
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'at__material-open'
    open.textContent = typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url)
    open.title = String(material.url)
    open.dataset.url = String(material.url)
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'at__ghost at__material-remove'
    remove.textContent = removeText
    remove.dataset.material = String(material.id)
    row.append(open, remove)
    return row
  }

  /** 缩略画面里的一份静态样例：四条行动项，与真实读到的形状相同。 */
  function sampleRows() {
    var now = new Date().toISOString()
    return [
      { id: 'sample-1', kind: 'action', title: '补一个基线对比', status: 'doing', due: { kind: 'date', date: '2026-11-13', timeZone: 'Asia/Shanghai' }, source: { kind: 'meeting', id: 'sample-meeting' }, updatedAt: now, archived: false },
      { id: 'sample-2', kind: 'action', title: '统一坐标轴的量纲', status: 'blocked', blockedNote: '等仿真环境重装', due: { kind: 'date', date: '2026-11-10', timeZone: 'Asia/Shanghai' }, updatedAt: now, archived: false },
      { id: 'sample-3', kind: 'action', title: '相关工作再收一轮', status: 'todo', updatedAt: now, archived: false },
      { id: 'sample-4', kind: 'action', title: '整理论文初稿结构', status: 'done', doneNote: '按组会意见改完引言', updatedAt: now, archived: false }
    ]
  }

  root.ActionItemsView = {
    statusKey: statusKey,
    rowOf: rowOf,
    materialRow: materialRow,
    sampleRows: sampleRows
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
