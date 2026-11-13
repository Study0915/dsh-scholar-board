/*
 * 课程卡的画面零件：一行课程、一行近期事项、一行作业或考试、关联记录、材料行与缩略样例。
 *
 * 只造节点与文字；事件、状态与保存都在 rows.js、editor.js 与 main.js。缩略画面与真实列表画同一种行。
 */
;(function (root) {
  'use strict'

  var model = root.CourseRecords

  function tagOf(text, tone) {
    var tag = document.createElement('span')
    tag.className = 'cs__tag'
    tag.dataset.tone = tone
    tag.textContent = text
    return tag
  }

  /** 作业进度的色调：全部完成是 ok，否则是 reading。 */
  function workTone(done, total) {
    return total > 0 && done === total ? 'ok' : 'reading'
  }

  /** 作业与考试状态的色调。 */
  function statusTone(status) {
    if (status === 'done') return 'ok'
    if (status === 'doing') return 'reading'
    return 'neutral'
  }

  /**
   * 一行课程：作业进度、课程名、学期与最近一项未完成事项；整行是按钮，进入详情。
   *
   * @param {object} record - 一条课程记录。
   * @param {{ t: function(string): string, fill: function(string, object): string }} text - 文案。
   * @returns {HTMLButtonElement} 行按钮。
   */
  function rowOf(record, text) {
    var work = model.workOf(record)
    var done = 0
    for (var at = 0; at < work.length; at += 1) if (work[at].status === 'done') done += 1
    var progress = work.length === 0
      ? text.t('noWork')
      : text.fill(text.t('workCount'), { done: done, total: work.length })
    var term = model.termOf(record)
    var termLabel = term === null ? '' : model.textOf(term.label)
    var row = document.createElement('button')
    row.type = 'button'
    row.className = 'cs__row'
    row.dataset.id = record.id
    row.setAttribute('aria-label', (termLabel === '' ? '' : termLabel + ' · ') + progress + ' · ' + record.title)
    var head = document.createElement('span')
    head.className = 'cs__row-head'
    head.append(tagOf(progress, workTone(done, work.length)), titleOf(record.title))
    row.appendChild(head)
    var sub = document.createElement('span')
    sub.className = 'cs__row-sub'
    var parts = []
    if (termLabel !== '') parts.push(termLabel)
    parts.push(model.summaryLine(record, text))
    var line = document.createElement('span')
    line.className = 'cs__row-snippet'
    line.textContent = parts.join(' · ')
    sub.appendChild(line)
    var tags = document.createElement('span')
    tags.className = 'cs__tags'
    var materials = Array.isArray(record.materials) ? record.materials.length : 0
    if (materials > 0) tags.appendChild(tagOf(text.fill(text.t('materials'), { n: materials }), 'material'))
    var left = model.daysLeft(record)
    if (left !== null) tags.appendChild(tagOf(text.fill(text.t('deletedIn'), { n: left }), 'trash'))
    if (tags.childNodes.length > 0) sub.appendChild(tags)
    row.appendChild(sub)
    return row
  }

  function titleOf(value) {
    var title = document.createElement('span')
    title.className = 'cs__row-title'
    title.textContent = value
    return title
  }

  /**
   * 一条学期分组的标题：学期名与起止日期；没有日期时只写名称。
   *
   * @param {object} group - `{ label, range }`。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLDivElement} 分组标题。
   */
  function groupHead(group, text) {
    var head = document.createElement('div')
    head.className = 'cs__group-head'
    var label = document.createElement('span')
    label.textContent = group.label === '' ? text.t('unknown') : group.label
    head.appendChild(label)
    if (group.range !== '') {
      var range = document.createElement('span')
      range.className = 'cs__group-rail'
      range.textContent = group.range
      head.appendChild(range)
    }
    return head
  }

  /**
   * 一行近期事项：课程名与那一项的类型、题目、日期；点一行进入那门课。
   *
   * @param {{ record: object, work: object }} item - 一条近期事项。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 行。
   */
  function recentRow(item, text) {
    var row = document.createElement('li')
    var button = document.createElement('button')
    button.type = 'button'
    button.className = 'cs__recent-row'
    button.dataset.id = item.record.id
    var course = document.createElement('span')
    course.className = 'cs__recent-course'
    course.textContent = item.record.title
    var line = document.createElement('span')
    line.className = 'cs__recent-line'
    line.textContent = model.workLine(item.work, text)
    button.setAttribute('aria-label', item.record.title + ' · ' + line.textContent)
    button.append(course, line)
    row.appendChild(button)
    return row
  }

  function inputOf(part, value, placeholder, maxLength) {
    var input = document.createElement('input')
    input.type = 'text'
    input.className = 'cs__input cs__line-' + part
    input.dataset.part = part
    input.value = typeof value === 'string' ? value : ''
    input.placeholder = placeholder
    input.setAttribute('aria-label', placeholder)
    input.autocomplete = 'off'
    if (typeof maxLength === 'number') input.maxLength = maxLength
    return input
  }

  function dateOf(part, due, label) {
    var input = document.createElement('input')
    input.type = 'date'
    input.className = 'cs__input cs__line-due'
    input.dataset.part = part
    input.value = model.dateInputOf(due)
    input.setAttribute('aria-label', label)
    return input
  }

  function selectOf(value, key, values, keyOf, text, extraClass) {
    var select = document.createElement('select')
    select.className = 'cs__input ' + extraClass
    select.dataset.part = key
    for (var at = 0; at < values.length; at += 1) {
      var option = document.createElement('option')
      option.value = values[at]
      option.textContent = text.t(keyOf(values[at]))
      select.appendChild(option)
    }
    select.value = values.indexOf(value) >= 0 ? value : values[0]
    return select
  }

  function removeOf(text) {
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'cs__ghost cs__line-remove'
    remove.textContent = text
    return remove
  }

  function lateOf(work, text) {
    var label = document.createElement('label')
    label.className = 'cs__line-late'
    var box = document.createElement('input')
    box.type = 'checkbox'
    box.dataset.part = 'late'
    box.checked = work.late === true
    label.append(box, document.createTextNode(text.t('workLate')))
    return label
  }

  function lineOf(index) {
    var row = document.createElement('li')
    row.className = 'cs__line'
    row.dataset.kind = 'work'
    row.dataset.index = String(index)
    return row
  }

  /**
   * 一行作业或考试：类型、题目、状态、截止日期、补交与移除。
   *
   * @param {object} work - `{ kind, title, status, due, late }`。
   * @param {number} index - 在组里的位置。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 事项行。
   */
  function workRow(work, index, text) {
    var row = lineOf(index)
    row.appendChild(selectOf(work.kind, 'kind', model.WORK_KINDS, model.workKindKey, text, 'cs__line-kind'))
    row.appendChild(inputOf('title', work.title, text.t('workTitle'), model.TITLE_LENGTH))
    row.appendChild(selectOf(work.status, 'status', model.WORK_STATUSES, model.workKey, text, 'cs__line-status'))
    row.appendChild(dateOf('due', work.due, text.t('workDue')))
    row.appendChild(lateOf(work, text))
    row.appendChild(removeOf(text.t('removeRow')))
    return row
  }

  /**
   * 一行关联记录：类型与标题；记录不在时直接说明。
   *
   * @param {object} ref - `{ kind, id }`。
   * @param {object|null} record - 读到的记录。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 关联行。
   */
  function relatedRow(ref, record, text) {
    var row = document.createElement('li')
    row.className = 'cs__related-row'
    row.dataset.id = ref.id
    var kind = document.createElement('span')
    kind.className = 'cs__related-state'
    kind.textContent = text.t(model.relatedKey(ref.kind))
    kind.dataset.status = ref.kind
    var title = document.createElement('span')
    title.className = 'cs__related-title'
    title.textContent = record === null ? text.t('relatedMissing') + ' · ' + ref.id : record.title
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'cs__ghost cs__related-remove'
    remove.textContent = text.t('removeRow')
    remove.dataset.related = ref.kind + ':' + ref.id
    row.append(kind, title, remove)
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
    row.className = 'cs__material'
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'cs__material-open'
    open.textContent = typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url)
    open.title = String(material.url)
    open.dataset.url = String(material.url)
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'cs__ghost cs__material-remove'
    remove.textContent = removeText
    remove.dataset.material = String(material.id)
    row.append(open, remove)
    return row
  }

  /** 缩略画面里的静态样例：三门课，字段形状与真实记录相同。 */
  function sampleRows() {
    var now = new Date().toISOString()
    var term = { label: '2026 秋', start: { kind: 'date', date: '2026-09-07', timeZone: 'Asia/Shanghai' }, end: { kind: 'date', date: '2027-01-15', timeZone: 'Asia/Shanghai' } }
    return [
      {
        id: 'sample-1',
        kind: 'course',
        title: '数字信号处理',
        term: term,
        code: 'DSP-501',
        teacher: '任课教师',
        schedule: '周二 3-4 节',
        notes: '重点整理多速率系统的等价变换。',
        work: [
          { id: 'w1', kind: 'assignment', title: '第 4 次作业', status: 'doing', due: { kind: 'date', date: '2026-11-18', timeZone: 'Asia/Shanghai' } },
          { id: 'w2', kind: 'exam', title: '期中考试', status: 'todo', due: { kind: 'date', date: '2026-11-28', timeZone: 'Asia/Shanghai' } }
        ],
        related: [{ kind: 'meeting', id: 'meeting-1' }],
        materials: [{ id: 'cm1', url: 'https://example.com/dsp', title: '课程主页' }],
        updatedAt: now,
        archived: false
      },
      {
        id: 'sample-2',
        kind: 'course',
        title: '最优化方法',
        term: term,
        work: [{ id: 'w1', kind: 'assignment', title: '编程作业 3', status: 'done' }],
        updatedAt: now,
        archived: false
      },
      {
        id: 'sample-3',
        kind: 'course',
        title: '学术写作',
        term: { label: '2027 春', start: { kind: 'date', date: '2027-02-22', timeZone: 'Asia/Shanghai' } },
        work: [{ id: 'w1', kind: 'assignment', title: '提纲初稿', status: 'todo', due: { kind: 'date', date: '2026-12-05', timeZone: 'Asia/Shanghai' } }],
        updatedAt: now,
        archived: false
      }
    ]
  }

  root.CourseRecordsView = {
    tagOf: tagOf,
    workTone: workTone,
    statusTone: statusTone,
    rowOf: rowOf,
    groupHead: groupHead,
    recentRow: recentRow,
    workRow: workRow,
    relatedRow: relatedRow,
    materialRow: materialRow,
    sampleRows: sampleRows
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
