/*
 * 其他事务卡的画面零件：一行事务、材料行与缩略样例。
 *
 * 只造节点与文字；事件、状态与保存都在 rows.js、editor.js 与 main.js。缩略画面与真实列表画同一种行。
 */
;(function (root) {
  'use strict'

  var model = root.ChoreRecords

  function tagOf(text, tone) {
    var tag = document.createElement('span')
    tag.className = 'ch__tag'
    tag.dataset.tone = tone
    tag.textContent = text
    return tag
  }

  /** 状态的色调。 */
  function statusTone(status) {
    if (status === 'done') return 'ok'
    if (status === 'doing') return 'reading'
    return 'neutral'
  }

  /** 期限的色调：逾期与今天用警示色，七天内用提醒色，以后再说是强调色。 */
  function dueTone(state) {
    if (state === 'overdue' || state === 'today') return 'trash'
    if (state === 'soon') return 'question'
    if (state === 'later') return 'reading'
    return 'neutral'
  }

  /** 一行的期限字：填了写日期，没填写「无期限」。 */
  function dueLabel(record, text, now) {
    var date = model.dateInputOf(record.due)
    if (date === '') return text.t('dueNone')
    var state = model.dueState(record, now)
    var prefix = state === 'overdue' ? text.t('dueOverdue') + ' · ' : state === 'today' ? text.t('dueToday') + ' · ' : ''
    return prefix + date
  }

  /**
   * 一行事务：状态、标题、类别、期限与材料；已完成的行右边多一个归档按钮。
   *
   * @param {object} record - 一条事务记录。
   * @param {{ t: function(string): string, fill: function(string, object): string }} text - 文案。
   * @param {number} now - 当前时刻，用来算期限的远近。
   * @returns {HTMLDivElement} 行容器。
   */
  function rowOf(record, text, now) {
    var row = document.createElement('div')
    row.className = 'ch__row'
    row.dataset.id = record.id
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'ch__row-open'
    open.dataset.open = record.id
    var category = model.categoryOf(record)
    var due = dueLabel(record, text, now)
    open.setAttribute('aria-label', (category === '' ? '' : category + ' · ') + record.title + ' · ' + due)
    var head = document.createElement('span')
    head.className = 'ch__row-head'
    head.append(tagOf(text.t(model.statusKey(record.status)), statusTone(record.status)), titleOf(record.title))
    open.appendChild(head)
    var sub = document.createElement('span')
    sub.className = 'ch__row-sub'
    var line = document.createElement('span')
    line.className = 'ch__row-snippet'
    line.textContent = (category === '' ? text.t('unknown') : category) + ' · ' + due
    sub.appendChild(line)
    var tags = document.createElement('span')
    tags.className = 'ch__tags'
    tags.appendChild(tagOf(due, dueTone(model.dueState(record, now))))
    var materials = Array.isArray(record.materials) ? record.materials.length : 0
    if (materials > 0) tags.appendChild(tagOf(text.fill(text.t('materials'), { n: materials }), 'material'))
    var left = model.daysLeft(record, now)
    if (left !== null) tags.appendChild(tagOf(text.fill(text.t('deletedIn'), { n: left }), 'trash'))
    sub.appendChild(tags)
    open.appendChild(sub)
    row.appendChild(open)
    if (record.status === 'done' && record.archived !== true && typeof record.deletedAt !== 'string') {
      var archive = document.createElement('button')
      archive.type = 'button'
      archive.className = 'ch__ghost ch__row-archive'
      archive.textContent = text.t('archiveDone')
      archive.dataset.archive = record.id
      row.appendChild(archive)
    }
    return row
  }

  function titleOf(value) {
    var title = document.createElement('span')
    title.className = 'ch__row-title'
    title.textContent = value
    return title
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
    row.className = 'ch__material'
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'ch__material-open'
    open.textContent = typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url)
    open.title = String(material.url)
    open.dataset.url = String(material.url)
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'ch__ghost ch__material-remove'
    remove.textContent = removeText
    remove.dataset.material = String(material.id)
    row.append(open, remove)
    return row
  }

  /** 缩略画面里的静态样例：三条事务，字段形状与真实记录相同。 */
  function sampleRows() {
    var now = new Date().toISOString()
    return [
      {
        id: 'sample-1',
        kind: 'chore',
        title: '报销十一月差旅',
        category: '报账',
        status: 'doing',
        due: { kind: 'date', date: '2026-11-20', timeZone: 'Asia/Shanghai' },
        note: '发票与行程单已收齐。',
        materials: [{ id: 'tm1', url: 'https://example.com/receipt', title: '发票扫描件' }],
        updatedAt: now,
        archived: false
      },
      {
        id: 'sample-2',
        kind: 'chore',
        title: '年度体检预约',
        category: '体检',
        status: 'todo',
        due: { kind: 'date', date: '2026-12-10', timeZone: 'Asia/Shanghai' },
        updatedAt: now,
        archived: false
      },
      {
        id: 'sample-3',
        kind: 'chore',
        title: '更新借书证',
        category: '证件',
        status: 'done',
        updatedAt: now,
        archived: false
      }
    ]
  }

  root.ChoreRecordsView = {
    tagOf: tagOf,
    statusTone: statusTone,
    dueTone: dueTone,
    dueLabel: dueLabel,
    rowOf: rowOf,
    materialRow: materialRow,
    sampleRows: sampleRows
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
