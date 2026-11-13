/*
 * 毕业论文卡的画面零件：一行论文、一行章节 / 成果 / 实验 / 节点 / 行动项、材料行与缩略画面样例。
 *
 * 只造节点与文字；事件、状态与保存都在 rows.js、editor.js 与 main.js。缩略画面与真实列表画同一种行。
 */
;(function (root) {
  'use strict'

  var model = root.ThesisRecords

  function tagOf(text, tone) {
    var tag = document.createElement('span')
    tag.className = 'ts__tag'
    tag.dataset.tone = tone
    tag.textContent = text
    return tag
  }

  /** 章节进度标签：全部完成是 ok，否则是 reading。 */
  function chapterTone(done, total) {
    return total > 0 && done === total ? 'ok' : 'reading'
  }

  /** 章节状态标签的色调。 */
  function statusTone(status) {
    return status === 'done' ? 'ok' : status === 'blocked' ? 'question' : status === 'doing' || status === 'drafting' || status === 'revising' ? 'reading' : 'neutral'
  }

  /**
   * 一行论文：章节进度、标题、待补实验与最近节点；整行是按钮，进入详情。
   *
   * @param {object} record - 一条毕业论文记录。
   * @param {{ t: function(string): string, fill: function(string, object): string }} text - 文案。
   * @returns {HTMLButtonElement} 行按钮。
   */
  function rowOf(record, text) {
    var chapters = model.chaptersOf(record)
    var done = 0
    for (var at = 0; at < chapters.length; at += 1) if (chapters[at].status === 'done') done += 1
    var progress = chapters.length === 0
      ? text.t('noChapters')
      : text.fill(text.t('chapterCount'), { done: done, total: chapters.length })
    var row = document.createElement('button')
    row.type = 'button'
    row.className = 'ts__row'
    row.dataset.id = record.id
    row.setAttribute('aria-label', progress + ' · ' + record.title)
    var head = document.createElement('span')
    head.className = 'ts__row-head'
    head.append(tagOf(progress, chapterTone(done, chapters.length)), titleOf(record.title))
    row.appendChild(head)
    var sub = document.createElement('span')
    sub.className = 'ts__row-sub'
    var parts = []
    var open = model.openExperiments(record)
    if (open > 0) parts.push(text.fill(text.t('experimentsCount'), { n: open }))
    parts.push(model.summaryLine(record, text))
    var line = document.createElement('span')
    line.className = 'ts__row-snippet'
    line.textContent = parts.join(' · ')
    sub.appendChild(line)
    var tags = document.createElement('span')
    tags.className = 'ts__tags'
    var results = model.resultsOf(record).length
    if (results > 0) tags.appendChild(tagOf(text.fill(text.t('resultsCount'), { n: results }), 'reading'))
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
    title.className = 'ts__row-title'
    title.textContent = value
    return title
  }

  /** 一行标题输入、状态选择与移除。 */
  function lineOf(kind, index, placeholder, entry, keyOf, statuses, text) {
    var row = document.createElement('li')
    row.className = 'ts__line'
    row.dataset.kind = kind
    row.dataset.index = String(index)
    var input = document.createElement('input')
    input.type = 'text'
    input.className = 'ts__input ts__line-title'
    input.dataset.part = 'title'
    input.value = typeof entry.title === 'string' ? entry.title : ''
    input.placeholder = placeholder
    input.setAttribute('aria-label', placeholder)
    input.autocomplete = 'off'
    row.appendChild(input)
    row.appendChild(statusOf(entry.status, 'status', statuses, keyOf, text))
    row.appendChild(removeOf(text.t('removeRow')))
    return row
  }

  function statusOf(value, key, statuses, keyOf, text) {
    var select = document.createElement('select')
    select.className = 'ts__input ts__line-status'
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
    remove.className = 'ts__ghost ts__line-remove'
    remove.textContent = text
    return remove
  }

  /**
   * 一行章节：标题、状态与移除。
   *
   * @param {object} chapter - `{ title, status }`。
   * @param {number} index - 在组里的位置。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 章节行。
   */
  function chapterRow(chapter, index, text) {
    return lineOf('chapters', index, text.t('chapterTitle'), chapter, model.chapterKey, model.CHAPTER_STATUSES, text)
  }

  /**
   * 一行成果：来源记录下拉、说明与移除；来源不在可选列表里时保留一行「来源缺失」。
   *
   * @param {object} result - `{ kind, recordId, note }`。
   * @param {number} index - 在组里的位置。
   * @param {Array} sources - 可选稿件与研究记录。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 成果行。
   */
  function resultRow(result, index, sources, text) {
    var row = document.createElement('li')
    row.className = 'ts__line ts__line-result'
    row.dataset.kind = 'results'
    row.dataset.index = String(index)
    var select = document.createElement('select')
    select.className = 'ts__input ts__line-source'
    select.dataset.part = 'source'
    select.setAttribute('aria-label', text.t('resultRecord'))
    var placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = text.t('resultRecordPlaceholder')
    select.appendChild(placeholder)
    var found = false
    for (var at = 0; at < sources.length; at += 1) {
      var source = sources[at]
      if (source === null || typeof source !== 'object' || typeof source.id !== 'string') continue
      var option = document.createElement('option')
      option.value = String(source.kind) + ':' + source.id
      option.textContent = sourceTitle(source, text) + ' · ' + text.t(model.resultKey(source.kind))
      if (source.id === result.recordId && source.kind === result.kind) found = true
      select.appendChild(option)
    }
    if (!found && typeof result.recordId === 'string' && result.recordId !== '') {
      var missing = document.createElement('option')
      missing.value = String(result.kind) + ':' + result.recordId
      missing.textContent = text.t('missingSource') + ' · ' + result.recordId
      select.appendChild(missing)
    }
    select.value = typeof result.recordId === 'string' && result.recordId !== '' ? String(result.kind) + ':' + result.recordId : ''
    row.appendChild(select)
    var note = document.createElement('input')
    note.type = 'text'
    note.className = 'ts__input ts__line-note'
    note.dataset.part = 'note'
    note.value = typeof result.note === 'string' ? result.note : ''
    note.placeholder = text.t('resultNote')
    note.setAttribute('aria-label', text.t('resultNote'))
    note.autocomplete = 'off'
    row.appendChild(note)
    row.appendChild(removeOf(text.t('removeRow')))
    return row
  }

  /**
   * 一行待补实验：标题、状态与移除。
   *
   * @param {object} experiment - `{ title, status }`。
   * @param {number} index - 在组里的位置。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 实验行。
   */
  function experimentRow(experiment, index, text) {
    return lineOf('experiments', index, text.t('experimentTitle'), experiment, model.itemKey, model.ITEM_STATUSES, text)
  }

  /**
   * 一行学位节点：名称、日期、状态与移除。
   *
   * @param {object} milestone - `{ label, due, status }`。
   * @param {number} index - 在组里的位置。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 节点行。
   */
  function milestoneRow(milestone, index, text) {
    var row = document.createElement('li')
    row.className = 'ts__line ts__line-milestone'
    row.dataset.kind = 'milestones'
    row.dataset.index = String(index)
    var label = document.createElement('input')
    label.type = 'text'
    label.className = 'ts__input ts__line-title'
    label.dataset.part = 'label'
    label.value = typeof milestone.label === 'string' ? milestone.label : ''
    label.placeholder = text.t('milestoneLabel')
    label.setAttribute('aria-label', text.t('milestoneLabel'))
    label.maxLength = model.LABEL_LENGTH
    label.autocomplete = 'off'
    row.appendChild(label)
    var due = document.createElement('input')
    due.type = 'date'
    due.className = 'ts__input ts__line-due'
    due.dataset.part = 'due'
    due.value = model.dateInputOf(milestone.due)
    due.setAttribute('aria-label', text.t('milestoneDue'))
    row.appendChild(due)
    row.appendChild(statusOf(milestone.status, 'status', model.ITEM_STATUSES, model.itemKey, text))
    row.appendChild(removeOf(text.t('removeRow')))
    return row
  }

  /**
   * 一行关联行动项：状态与标题；行动项不在时直接说明。
   *
   * @param {object} ref - `{ kind, id }`。
   * @param {object|null} action - 读到的行动项。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 行动项行。
   */
  function relatedRow(ref, action, text) {
    var row = document.createElement('li')
    row.className = 'ts__related-row'
    row.dataset.id = ref.id
    var status = document.createElement('span')
    status.className = 'ts__related-state'
    status.textContent = action === null ? text.t('actionMissing') : text.t(statusKey(action.status))
    status.dataset.status = action === null ? 'missing' : String(action.status)
    var title = document.createElement('span')
    title.className = 'ts__related-title'
    title.textContent = action === null ? ref.id : action.title
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'ts__ghost ts__related-remove'
    remove.textContent = text.t('removeRow')
    remove.dataset.related = ref.id
    row.append(status, title, remove)
    return row
  }

  function statusKey(status) {
    return status === 'doing' ? 'itemDoing' : status === 'done' ? 'itemDone' : status === 'blocked' ? 'itemBlocked' : 'itemTodo'
  }

  function sourceTitle(source, text) {
    return typeof source.title === 'string' && source.title !== '' ? source.title : text.t('missingSource')
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
    row.className = 'ts__material'
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'ts__material-open'
    open.textContent = typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url)
    open.title = String(material.url)
    open.dataset.url = String(material.url)
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'ts__ghost ts__material-remove'
    remove.textContent = removeText
    remove.dataset.material = String(material.id)
    row.append(open, remove)
    return row
  }

  /** 缩略画面里的一份静态样例：三条论文，章节与成果来源形状与真实记录相同。 */
  function sampleRows() {
    var now = new Date().toISOString()
    return [
      {
        id: 'sample-1',
        kind: 'thesis',
        title: '低轨星座干扰下的多用户检测',
        question: '把干扰对齐用到低轨星座时，闭式解还成立吗',
        chapters: [
          { id: 'c1', title: '绪论', status: 'done' },
          { id: 'c2', title: '系统模型', status: 'done' },
          { id: 'c3', title: '干扰对齐推导', status: 'revising' },
          { id: 'c4', title: '仿真与实验', status: 'drafting' },
          { id: 'c5', title: '总结与展望', status: 'planned' }
        ],
        results: [
          { id: 'x1', kind: 'manuscript', recordId: 'manuscript-1', note: '第二、三章的主体' },
          { id: 'x2', kind: 'research', recordId: 'research-1', note: '第四章的仿真来源' }
        ],
        experiments: [
          { id: 'e1', title: '补一个基线对比', status: 'doing' },
          { id: 'e2', title: '扩展到多小区场景', status: 'todo' }
        ],
        milestones: [
          { id: 'm1', label: '预答辩', status: 'todo', due: { kind: 'date', date: '2027-03-15', timeZone: 'Asia/Shanghai' } },
          { id: 'm2', label: '送审', status: 'todo', due: { kind: 'date', date: '2027-04-10', timeZone: 'Asia/Shanghai' } }
        ],
        materials: [{ id: 'tm1', url: 'https://example.com/outline.pdf', title: '论文提纲' }],
        updatedAt: now,
        archived: false
      },
      {
        id: 'sample-2',
        kind: 'thesis',
        title: '学位论文写作计划',
        chapters: [
          { id: 'c1', title: '绪论', status: 'drafting' },
          { id: 'c2', title: '相关工作', status: 'planned' }
        ],
        results: [],
        experiments: [{ id: 'e1', title: '整理已有结果', status: 'todo' }],
        milestones: [{ id: 'm1', label: '开题', status: 'done' }],
        updatedAt: now,
        archived: false
      },
      {
        id: 'sample-3',
        kind: 'thesis',
        title: '预答辩后的修回清单',
        chapters: [],
        results: [{ id: 'x1', kind: 'research', recordId: 'research-9' }],
        experiments: [],
        milestones: [{ id: 'm1', label: '答辩', status: 'todo', due: { kind: 'date', date: '2027-05-20', timeZone: 'Asia/Shanghai' } }],
        updatedAt: now,
        archived: false
      }
    ]
  }

  root.ThesisRecordsView = {
    tagOf: tagOf,
    chapterTone: chapterTone,
    statusTone: statusTone,
    rowOf: rowOf,
    chapterRow: chapterRow,
    resultRow: resultRow,
    experimentRow: experimentRow,
    milestoneRow: milestoneRow,
    relatedRow: relatedRow,
    statusKey: statusKey,
    materialRow: materialRow,
    sampleRows: sampleRows
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
