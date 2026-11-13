/*
 * 横向项目卡的画面零件：一行项目、一行事项 / 交付物 / 沟通 / 节点 / 问题 / 关联记录、材料行与缩略样例。
 *
 * 只造节点与文字；事件、状态与保存都在 rows.js、editor.js 与 main.js。缩略画面与真实列表画同一种行。
 */
;(function (root) {
  'use strict'

  var model = root.ProjectRecords

  function tagOf(text, tone) {
    var tag = document.createElement('span')
    tag.className = 'pj__tag'
    tag.dataset.tone = tone
    tag.textContent = text
    return tag
  }

  /** 事项进度标签：全部完成是 ok，否则是 reading。 */
  function taskTone(done, total) {
    return total > 0 && done === total ? 'ok' : 'reading'
  }

  /** 状态标签的色调。 */
  function statusTone(status) {
    if (status === 'done' || status === 'accepted' || status === 'resolved') return 'ok'
    if (status === 'blocked') return 'question'
    if (status === 'doing' || status === 'draft' || status === 'review' || status === 'delivered') return 'reading'
    return 'neutral'
  }

  /**
   * 一行项目：事项进度、标题、待确认问题与最近验收节点；整行是按钮，进入详情。
   *
   * @param {object} record - 一条横向项目记录。
   * @param {{ t: function(string): string, fill: function(string, object): string }} text - 文案。
   * @returns {HTMLButtonElement} 行按钮。
   */
  function rowOf(record, text) {
    var tasks = model.tasksOf(record)
    var done = 0
    for (var at = 0; at < tasks.length; at += 1) if (tasks[at].status === 'done') done += 1
    var progress = tasks.length === 0
      ? text.t('noTasks')
      : text.fill(text.t('tasksCount'), { done: done, total: tasks.length })
    var row = document.createElement('button')
    row.type = 'button'
    row.className = 'pj__row'
    row.dataset.id = record.id
    row.setAttribute('aria-label', progress + ' · ' + record.title)
    var head = document.createElement('span')
    head.className = 'pj__row-head'
    head.append(tagOf(progress, taskTone(done, tasks.length)), titleOf(record.title))
    row.appendChild(head)
    var sub = document.createElement('span')
    sub.className = 'pj__row-sub'
    var parts = []
    var open = model.openIssues(record)
    if (open > 0) parts.push(text.fill(text.t('issuesCount'), { n: open }))
    parts.push(model.summaryLine(record, text))
    var line = document.createElement('span')
    line.className = 'pj__row-snippet'
    line.textContent = parts.join(' · ')
    sub.appendChild(line)
    var tags = document.createElement('span')
    tags.className = 'pj__tags'
    var deliverable = model.deliverablesOf(record)[0]
    if (deliverable !== undefined) tags.appendChild(tagOf(model.deliverableLine(deliverable, text), 'reading'))
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
    title.className = 'pj__row-title'
    title.textContent = value
    return title
  }

  function inputOf(part, value, placeholder, maxLength) {
    var input = document.createElement('input')
    input.type = 'text'
    input.className = 'pj__input pj__line-' + part
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
    input.className = 'pj__input pj__line-due'
    input.dataset.part = part
    input.value = model.dateInputOf(due)
    input.setAttribute('aria-label', label)
    return input
  }

  function statusOf(value, key, statuses, keyOf, text) {
    var select = document.createElement('select')
    select.className = 'pj__input pj__line-status'
    select.dataset.part = key
    for (var at = 0; at < statuses.length; at += 1) {
      var option = document.createElement('option')
      option.value = statuses[at]
      option.textContent = text.t(keyOf(statuses[at]))
      select.appendChild(option)
    }
    select.value = statuses.indexOf(value) >= 0 ? value : statuses[0]
    return select
  }

  function removeOf(text) {
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'pj__ghost pj__line-remove'
    remove.textContent = text
    return remove
  }

  function lineOf(kind, index) {
    var row = document.createElement('li')
    row.className = 'pj__line'
    row.dataset.kind = kind
    row.dataset.index = String(index)
    return row
  }

  /**
   * 一行负责事项：标题、状态、日期与移除。
   *
   * @param {object} task - `{ title, status, due }`。
   * @param {number} index - 在组里的位置。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 事项行。
   */
  function taskRow(task, index, text) {
    var row = lineOf('tasks', index)
    row.appendChild(inputOf('title', task.title, text.t('taskTitle'), model.TITLE_LENGTH))
    row.appendChild(statusOf(task.status, 'status', model.TASK_STATUSES, model.taskKey, text))
    row.appendChild(dateOf('due', task.due, text.t('taskDue')))
    row.appendChild(removeOf(text.t('removeRow')))
    return row
  }

  /**
   * 一行交付物：名称、版本、状态、日期与移除。
   *
   * @param {object} deliverable - `{ name, version, status, due }`。
   * @param {number} index - 在组里的位置。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 交付物行。
   */
  function deliverableRow(deliverable, index, text) {
    var row = lineOf('deliverables', index)
    row.classList.add('pj__line-deliverable')
    row.appendChild(inputOf('name', deliverable.name, text.t('deliverableName'), model.TITLE_LENGTH))
    row.appendChild(inputOf('version', deliverable.version, text.t('deliverableVersion'), model.VERSION_LENGTH))
    row.appendChild(statusOf(deliverable.status, 'status', model.DELIVERABLE_STATUSES, model.deliverableKey, text))
    row.appendChild(dateOf('due', deliverable.due, text.t('deliverableDue')))
    row.appendChild(removeOf(text.t('removeRow')))
    return row
  }

  /**
   * 一行沟通结论：一句话、日期与移除。
   *
   * @param {object} communication - `{ summary, at }`。
   * @param {number} index - 在组里的位置。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 沟通行。
   */
  function communicationRow(communication, index, text) {
    var row = lineOf('communications', index)
    row.appendChild(inputOf('summary', communication.summary, text.t('communicationSummary'), model.TITLE_LENGTH))
    row.appendChild(dateOf('at', communication.at, text.t('communicationAt')))
    row.appendChild(removeOf(text.t('removeRow')))
    return row
  }

  /**
   * 一行验收节点：名称、日期、状态与移除。
   *
   * @param {object} milestone - `{ label, due, status }`。
   * @param {number} index - 在组里的位置。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 节点行。
   */
  function milestoneRow(milestone, index, text) {
    var row = lineOf('milestones', index)
    row.classList.add('pj__line-milestone')
    row.appendChild(inputOf('label', milestone.label, text.t('milestoneLabel'), model.LABEL_LENGTH))
    row.appendChild(dateOf('due', milestone.due, text.t('milestoneDue')))
    row.appendChild(statusOf(milestone.status, 'status', model.MILESTONE_STATUSES, model.milestoneKey, text))
    row.appendChild(removeOf(text.t('removeRow')))
    return row
  }

  /**
   * 一行待确认问题：标题、状态与移除。
   *
   * @param {object} issue - `{ title, status }`。
   * @param {number} index - 在组里的位置。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 问题行。
   */
  function issueRow(issue, index, text) {
    var row = lineOf('issues', index)
    row.appendChild(inputOf('title', issue.title, text.t('issueTitle'), model.TITLE_LENGTH))
    row.appendChild(statusOf(issue.status, 'status', model.ISSUE_STATUSES, model.issueKey, text))
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
    row.className = 'pj__related-row'
    row.dataset.id = ref.id
    var kind = document.createElement('span')
    kind.className = 'pj__related-state'
    kind.textContent = text.t(model.relatedKey(ref.kind))
    kind.dataset.status = ref.kind
    var title = document.createElement('span')
    title.className = 'pj__related-title'
    title.textContent = record === null ? text.t('relatedMissing') + ' · ' + ref.id : record.title
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'pj__ghost pj__related-remove'
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
    row.className = 'pj__material'
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'pj__material-open'
    open.textContent = typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url)
    open.title = String(material.url)
    open.dataset.url = String(material.url)
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'pj__ghost pj__material-remove'
    remove.textContent = removeText
    remove.dataset.material = String(material.id)
    row.append(open, remove)
    return row
  }

  /** 缩略画面里的静态样例：三条项目，字段形状与真实记录相同。 */
  function sampleRows() {
    var now = new Date().toISOString()
    return [
      {
        id: 'sample-1',
        kind: 'project',
        title: '低轨星座干扰抑制模块合作',
        summary: '为合作方整理干扰抑制模块的可复现实验与阶段交付。',
        tasks: [
          { id: 'p1', title: '搭建链路级仿真', status: 'doing', due: { kind: 'date', date: '2026-11-20', timeZone: 'Asia/Shanghai' } },
          { id: 'p2', title: '整理月度进展', status: 'todo' }
        ],
        deliverables: [
          { id: 'd1', name: '仿真代码包', version: 'v0.3', status: 'delivered' },
          { id: 'd2', name: '阶段报告', version: '草案 1', status: 'draft' }
        ],
        communications: [
          { id: 'n1', summary: '确认本月只做单小区场景', at: { kind: 'date', date: '2026-11-05', timeZone: 'Asia/Shanghai' } }
        ],
        milestones: [
          { id: 'm1', label: '第一次阶段评审', status: 'todo', due: { kind: 'date', date: '2026-12-01', timeZone: 'Asia/Shanghai' } }
        ],
        issues: [{ id: 'i1', title: '测试数据的使用范围待确认', status: 'open' }],
        related: [{ kind: 'meeting', id: 'meeting-1' }],
        materials: [{ id: 'pm1', url: 'https://example.com/brief', title: '需求摘要' }],
        updatedAt: now,
        archived: false
      },
      {
        id: 'sample-2',
        kind: 'project',
        title: '联合申报材料准备',
        tasks: [{ id: 'p1', title: '收集近年结果', status: 'done' }],
        deliverables: [{ id: 'd1', name: '申报书初稿', version: 'v0.1', status: 'review' }],
        communications: [],
        milestones: [{ id: 'm1', label: '内部预审', status: 'doing' }],
        issues: [],
        updatedAt: now,
        archived: false
      },
      {
        id: 'sample-3',
        kind: 'project',
        title: '企业测试数据对接',
        tasks: [],
        deliverables: [],
        communications: [{ id: 'n1', summary: '接口字段沿用上一版' }],
        milestones: [{ id: 'm1', label: '联调通过', status: 'todo', due: { kind: 'date', date: '2027-01-15', timeZone: 'Asia/Shanghai' } }],
        issues: [{ id: 'i1', title: '日志保留时长待确认', status: 'doing' }],
        updatedAt: now,
        archived: false
      }
    ]
  }

  root.ProjectRecordsView = {
    tagOf: tagOf,
    taskTone: taskTone,
    statusTone: statusTone,
    rowOf: rowOf,
    taskRow: taskRow,
    deliverableRow: deliverableRow,
    communicationRow: communicationRow,
    milestoneRow: milestoneRow,
    issueRow: issueRow,
    relatedRow: relatedRow,
    materialRow: materialRow,
    sampleRows: sampleRows
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
