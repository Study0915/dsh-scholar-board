/*
 * 成员卡的画面零件：一行成员与缩略样例。
 *
 * 一行是称呼、启用标记、角色与备注摘要；整行是按钮，进入详情。停用成员仍列出并标明状态。
 */
;(function (root) {
  'use strict'

  var model = root.MemberRecords

  function tagOf(text, tone) {
    var tag = document.createElement('span')
    tag.className = 'mb__tag'
    tag.dataset.tone = tone
    tag.textContent = text
    return tag
  }

  /**
   * 一行成员。
   *
   * @param {object} record - 一条成员记录。
   * @param {{ t: function(string): string, fill: function(string, object): string }} text - 文案。
   * @param {number} now - 当前时间，用于回收站倒计时。
   * @returns {HTMLButtonElement} 行按钮。
   */
  function rowOf(record, text, now) {
    var enabled = model.enabledOf(record)
    var row = document.createElement('button')
    row.type = 'button'
    row.className = 'mb__row'
    row.dataset.id = record.id
    row.setAttribute('data-open', record.id)
    row.setAttribute('aria-label', model.nameOf(record))
    var head = document.createElement('span')
    head.className = 'mb__row-head'
    var name = document.createElement('span')
    name.className = 'mb__row-title'
    name.textContent = model.nameOf(record)
    head.append(name, tagOf(enabled ? text.t('enabledTag') : text.t('disabledTag'), enabled ? 'ok' : 'muted'))
    row.appendChild(head)
    var sub = document.createElement('span')
    sub.className = 'mb__row-sub'
    var summary = model.summaryOf(record)
    var line = document.createElement('span')
    line.className = 'mb__row-snippet'
    line.textContent = summary === '' ? text.t('summaryEmpty') : summary
    sub.appendChild(line)
    var left = model.daysLeft(record, now)
    if (left !== null) sub.appendChild(tagOf(text.fill(text.t('deletedIn'), { n: left }), 'trash'))
    row.appendChild(sub)
    return row
  }

  /** 缩略放置或没有宿主时用的三名成员。 */
  function sampleRows() {
    return [
      { id: 'sample-1', kind: 'member', title: '张老师', role: '指导教师', enabled: true },
      { id: 'sample-2', kind: 'member', title: '李同学', role: '负责仿真与数据', enabled: true },
      { id: 'sample-3', kind: 'member', title: '王同学', role: '已交接，保留历史评审', enabled: false }
    ]
  }

  root.MemberRecordsView = { rowOf: rowOf, sampleRows: sampleRows }
})(typeof globalThis !== 'undefined' ? globalThis : this)
