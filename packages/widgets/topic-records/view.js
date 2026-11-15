/*
 * 课题卡的画面零件：一行课题、一行问题、一行材料与缩略画面的样例数据。
 *
 * 只造节点与文字；事件、状态与保存都在 main.js。这样缩略画面与真实列表画的是同一种行。
 */
;(function (root) {
  'use strict'

  var model = root.TopicRecords

  function tagOf(text, tone) {
    var tag = document.createElement('span')
    tag.className = 'tp__tag'
    tag.dataset.tone = tone
    tag.textContent = text
    return tag
  }

  /** 行动项状态对应的文案键。 */
  function actionStatusKey(status) {
    if (status === 'doing') return 'actionDoing'
    if (status === 'blocked') return 'actionBlocked'
    if (status === 'done') return 'actionDone'
    if (status === 'cancelled') return 'actionCancelled'
    if (status === 'todo') return 'actionTodo'
    return 'actionUnknown'
  }

  /** 行动项状态的色调。 */
  function actionTone(status) {
    return status === 'done' ? 'ok' : status === 'blocked' ? 'error' : status === 'doing' ? 'reading' : 'neutral'
  }

  /**
   * 一行课题：待解问题数、标题、当前判断与关联数量；整行是按钮，进入详情。
   *
   * @param {object} record - 一条课题。
   * @param {{ t: function(string): string, fill: function(string, object): string }} text - 文案。
   * @returns {HTMLButtonElement} 行按钮。
   */
  function rowOf(record, text) {
    var counts = model.questionCounts(record)
    var row = document.createElement('button')
    row.type = 'button'
    row.className = 'tp__row'
    row.dataset.id = record.id
    row.setAttribute('aria-label', record.title)
    var head = document.createElement('span')
    head.className = 'tp__row-head'
    if (counts.open > 0) head.appendChild(tagOf(text.fill(text.t('openQuestions'), { n: counts.open }), 'open'))
    else if (counts.total > 0) head.appendChild(tagOf(text.fill(text.t('linkedActions'), { n: counts.total }), 'neutral'))
    var title = document.createElement('span')
    title.className = 'tp__row-title'
    title.textContent = record.title
    head.append(title)
    row.appendChild(head)
    var sub = document.createElement('span')
    sub.className = 'tp__row-sub'
    var unknown = text.t('unknown')
    var line = document.createElement('span')
    line.className = 'tp__row-snippet'
    var question = model.textOf(record, 'question')
    line.textContent = (question === '' ? '' : question + ' · ') + model.summaryOf(record, unknown)
    sub.appendChild(line)
    var tags = document.createElement('span')
    tags.className = 'tp__tags'
    var linked = 0
    for (var at = 0; at < model.questionsOf(record).length; at += 1) {
      if (typeof model.questionsOf(record)[at].actionId === 'string') linked += 1
    }
    if (linked > 0) tags.appendChild(tagOf(text.fill(text.t('linkedActions'), { n: linked }), 'action'))
    var materials = Array.isArray(record.materials) ? record.materials.length : 0
    if (materials > 0) tags.appendChild(tagOf(text.fill(text.t('materials'), { n: materials }), 'material'))
    var related = Array.isArray(record.related) ? record.related.length : 0
    if (related > 0) tags.appendChild(tagOf(text.fill(text.t('relatedCount'), { n: related }), 'related'))
    var left = model.daysLeft(record)
    if (left !== null) tags.appendChild(tagOf(text.fill(text.t('deletedIn'), { n: left }), 'trash'))
    if (tags.childNodes.length > 0) sub.appendChild(tags)
    row.appendChild(sub)
    return row
  }

  /**
   * 一行问题：内容、状态、行动项按钮与移除。
   *
   * @param {object} question - `{ id, text, status, actionId? }`。
   * @param {number} index - 在组里的位置。
   * @param {object|null} action - 关联到的行动项；读不到时是 null。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 问题行。
   */
  function questionRow(question, index, action, text) {
    var row = document.createElement('li')
    row.className = 'tp__question'
    row.dataset.index = String(index)
    row.dataset.questionId = String(question.id)
    var head = document.createElement('div')
    head.className = 'tp__question-head'
    var input = document.createElement('input')
    input.type = 'text'
    input.className = 'tp__input tp__question-text'
    input.dataset.part = 'text'
    input.value = typeof question.text === 'string' ? question.text : ''
    input.placeholder = text.t('questionText')
    input.setAttribute('aria-label', text.t('questionText'))
    input.autocomplete = 'off'
    input.maxLength = model.QUESTION_TEXT
    var status = document.createElement('select')
    status.className = 'tp__input tp__question-status'
    status.dataset.part = 'status'
    status.setAttribute('aria-label', text.t('questionStatus'))
    for (var at = 0; at < model.STATUSES.length; at += 1) {
      var value = model.STATUSES[at]
      var option = document.createElement('option')
      option.value = value
      option.textContent = text.t(model.statusKey(value))
      if (model.statusOf(question) === value) option.selected = true
      status.appendChild(option)
    }
    head.append(input, status)
    var foot = document.createElement('div')
    foot.className = 'tp__question-foot'
    if (typeof question.actionId === 'string' && question.actionId !== '') {
      if (action !== null && typeof action === 'object') {
        var open = document.createElement('button')
        open.type = 'button'
        open.className = 'tp__ghost tp__question-action'
        open.dataset.action = 'open-action'
        open.dataset.actionId = String(action.id)
        open.textContent = text.t('openAction')
        foot.appendChild(open)
        foot.appendChild(tagOf(text.t(actionStatusKey(action.status)), actionTone(action.status)))
      } else {
        var missing = document.createElement('button')
        missing.type = 'button'
        missing.className = 'tp__ghost tp__danger tp__question-action'
        missing.dataset.action = 'convert'
        missing.dataset.questionId = String(question.id)
        missing.textContent = text.t('actionMissing')
        foot.appendChild(missing)
        foot.appendChild(tagOf(text.t('sourceMissing'), 'error'))
      }
    } else {
      var convert = document.createElement('button')
      convert.type = 'button'
      convert.className = 'tp__ghost tp__question-action'
      convert.dataset.action = 'convert'
      convert.dataset.questionId = String(question.id)
      convert.textContent = text.t('convertAction')
      foot.appendChild(convert)
    }
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'tp__ghost tp__danger tp__question-remove'
    remove.dataset.action = 'remove-question'
    remove.dataset.questionId = String(question.id)
    remove.textContent = text.t('removeQuestion')
    foot.appendChild(remove)
    row.append(head, foot)
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
    row.className = 'tp__material'
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'tp__material-open'
    open.textContent = typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url)
    open.title = String(material.url)
    open.dataset.url = String(material.url)
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'tp__ghost tp__material-remove'
    remove.textContent = removeText
    remove.dataset.material = String(material.id)
    row.append(open, remove)
    return row
  }

  /** 缩略画面里的一份静态样例：三条课题，与真实读到的形状相同。 */
  function sampleRows() {
    var now = new Date().toISOString()
    return [
      { id: 'sample-1', kind: 'topic', title: '非平稳干扰下的多用户检测', question: '干扰功率未知时还能不能写出闭式检测器', goal: '给出可复现的推导与仿真口径', hypothesis: '先把干扰建模成慢变过程，闭式解仍然存在', judgment: '已知功率时有闭式解，未知功率时要迭代', nextStep: '补一组 8 用户、64 天线的仿真', questions: [{ id: 'q1', text: '慢变假设能覆盖多普勒范围吗', status: 'investigating', actionId: 'a1' }, { id: 'q2', text: '迭代收敛次数能否给出上界', status: 'open' }], related: [{ kind: 'manuscript', id: 'sample-manuscript' }], materials: [{ id: 'm1', url: 'https://example.com/notes.pdf', title: '推导笔记' }], updatedAt: now, archived: false },
      { id: 'sample-2', kind: 'topic', title: '语义通信的数据划分口径', question: '训练、验证与测试按什么粒度划分', goal: '让不同信噪比下的结论可比较', hypothesis: '按场景划分比随机划分更接近实际', judgment: '随机划分会把同一场景泄漏到测试集', nextStep: '固定种子后重跑基线', questions: [{ id: 'q3', text: '按场景划分后样本量够不够', status: 'resolved' }], updatedAt: now, archived: false },
      { id: 'sample-3', kind: 'topic', title: '低轨星座干扰的统计模型', question: '干扰到达角是否服从可解析的分布', nextStep: '先画一批经验分布', updatedAt: now, archived: false }
    ]
  }

  root.TopicRecordsView = {
    tagOf: tagOf,
    actionStatusKey: actionStatusKey,
    actionTone: actionTone,
    rowOf: rowOf,
    questionRow: questionRow,
    materialRow: materialRow,
    sampleRows: sampleRows
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
