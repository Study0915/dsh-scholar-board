/*
 * 小论文卡的画面零件：一行稿件、阶段牌、关联项、材料行与缩略画面的样例数据。
 *
 * 只造节点与文字；状态、保存与关联选择都在 main.js 与 editor.js。
 */
;(function (root) {
  'use strict'

  var model = root.Manuscripts

  /**
   * 一行稿件：阶段牌、标题、下一步与目标/期限；行尾没有快捷按钮，点整行进详情。
   *
   * @param {object} record - 一篇稿件。
   * @param {{ t: function(string): string, fill: function(string, object): string, now: number }} text - 文案与时钟。
   * @returns {HTMLButtonElement} 行按钮。
   */
  function rowOf(record, text) {
    var row = document.createElement('button')
    row.type = 'button'
    row.className = 'ms__row'
    row.dataset.id = record.id
    row.setAttribute('aria-label', text.t(model.stageKey(record.stage)) + ' · ' + record.title)
    var head = document.createElement('span')
    head.className = 'ms__row-head'
    var stage = document.createElement('span')
    stage.className = 'ms__stage'
    stage.dataset.stage = record.stage
    stage.textContent = text.t(model.stageKey(record.stage))
    var title = document.createElement('span')
    title.className = 'ms__row-title'
    title.textContent = record.title
    head.append(stage, title)
    row.appendChild(head)

    var sub = document.createElement('span')
    sub.className = 'ms__row-sub'
    var next = typeof record.nextStep === 'string' && record.nextStep.trim() !== '' ? record.nextStep : record.question
    if (typeof next === 'string' && next.trim() !== '') {
      var line = document.createElement('span')
      line.className = 'ms__row-next'
      line.textContent = next.replace(/\s+/g, ' ').trim()
      sub.appendChild(line)
    }
    var tags = document.createElement('span')
    tags.className = 'ms__tags'
    if (typeof record.target === 'string' && record.target.trim() !== '') tags.appendChild(chipOf(record.target.trim(), 'target'))
    var due = model.dueText(record)
    if (due !== '') {
      var dueChip = chipOf(due, 'due')
      dueChip.dataset.tone = model.dueTone(record, text.now)
      tags.appendChild(dueChip)
    }
    var blocks = typeof record.blockers === 'string' && record.blockers.trim() !== ''
    if (blocks) tags.appendChild(chipOf(text.t('blockers'), 'blocked'))
    var materials = Array.isArray(record.materials) ? record.materials.length : 0
    if (materials > 0) tags.appendChild(chipOf(text.fill(text.t('materials'), { n: materials }), 'material'))
    var figures = Array.isArray(record.figures) ? record.figures.length : 0
    if (figures > 0) tags.appendChild(chipOf(text.fill(text.t('figuresChip'), { n: figures }), 'figure'))
    var rounds = Array.isArray(record.submissions) ? record.submissions.length : 0
    if (rounds > 0) tags.appendChild(chipOf(text.fill(text.t('roundsChip'), { n: rounds }), 'rounds'))
    var open = model.openRevisionCount(record)
    if (open > 0) tags.appendChild(chipOf(text.fill(text.t('openRevisionsChip'), { n: open }), 'revision'))
    if (typeof record.deletedAt === 'string') {
      var days = Math.max(0, Math.ceil((Date.parse(record.deletedAt) + 30 * model.DAY - text.now) / model.DAY))
      if (!isNaN(days)) tags.appendChild(chipOf(text.fill(text.t('deletedIn'), { n: days }), 'trash'))
    }
    if (tags.childNodes.length > 0) sub.appendChild(tags)
    if (sub.childNodes.length > 0) row.appendChild(sub)
    return row
  }

  function chipOf(text, tone) {
    var chip = document.createElement('span')
    chip.className = 'ms__tag'
    chip.dataset.tone = tone
    chip.textContent = text
    return chip
  }

  /**
   * 一条关联：类型、标题与移除按钮；找不到记录时写「来源缺失」。
   *
   * @param {object} ref - 关联引用。
   * @param {object|null} record - 读到的记录。
   * @param {{ t: function(string): string, remove: string }} text - 文案。
   * @returns {HTMLLIElement} 关联行。
   */
  function relatedRow(ref, record, text) {
    var row = document.createElement('li')
    row.className = 'ms__related-row'
    row.dataset.id = ref.id
    row.dataset.kind = ref.kind
    var kind = document.createElement('span')
    kind.className = 'ms__related-kind'
    kind.textContent = text.t(ref.kind === 'meeting' ? 'relatedMeeting' : 'relatedAction')
    var title = document.createElement('span')
    title.className = 'ms__related-title'
    title.textContent = record !== null && typeof record === 'object' ? record.title : text.t('sourceMissing')
    if (record === null) title.dataset.tone = 'missing'
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'ms__ghost ms__related-remove'
    remove.textContent = text.remove
    remove.dataset.related = ref.id
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
    row.className = 'ms__material'
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'ms__material-open'
    open.textContent = typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url)
    open.title = String(material.url)
    open.dataset.url = String(material.url)
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'ms__ghost ms__material-remove'
    remove.textContent = removeText
    remove.dataset.material = String(material.id)
    row.append(open, remove)
    return row
  }

  /** 缩略画面里的一份静态样例：三篇稿件，与真实读到的形状相同。 */
  function sampleRows() {
    var now = new Date().toISOString()
    return [
      {
        id: 'sample-1', kind: 'manuscript', title: '低轨星座干扰分析', question: '静态信道假设下的干扰统计',
        stage: 'experiment', nextStep: '补一个基线对比', target: 'IEEE TWC', due: { kind: 'date', date: '2026-12-15', timeZone: 'Asia/Shanghai' },
        figures: [{ id: 'f-1', kind: 'figure', label: '图 1', title: '系统模型' }, { id: 'f-2', kind: 'table', label: '表 1', title: '仿真参数' }],
        submissions: [{ id: 'r-1', venue: 'IEEE TWC', decision: 'major', submittedAt: { kind: 'date', date: '2026-10-01', timeZone: 'Asia/Shanghai' } }],
        revisions: [{ id: 'v-1', roundId: 'r-1', feedback: '补充基线对比', change: '新增一节基线', status: 'doing' }],
        stageHistory: [{ stage: 'idea', at: now }, { stage: 'experiment', at: now }], updatedAt: now, archived: false
      },
      { id: 'sample-2', kind: 'manuscript', title: '稀疏阵列角度估计', question: '宽带条件下的阵列插值', stage: 'writing', nextStep: '统一坐标轴的量纲', stageHistory: [{ stage: 'idea', at: now }, { stage: 'writing', at: now }], updatedAt: now, archived: false },
      {
        id: 'sample-3', kind: 'manuscript', title: '信道建模综述', question: '', stage: 'submitted', nextStep: '等待审稿意见',
        submissions: [{ id: 'r-2', venue: 'IEEE COMST', decision: 'pending' }],
        stageHistory: [{ stage: 'submitted', at: now }], updatedAt: now, archived: false
      }
    ]
  }

  root.ManuscriptsView = {
    rowOf: rowOf,
    relatedRow: relatedRow,
    materialRow: materialRow,
    sampleRows: sampleRows
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
