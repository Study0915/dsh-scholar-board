/*
 * 运行记录卡的画面零件：一行记录、一个状态标签、一行数据集、一行配置 / 检查点 / 指标、一条结果、一份产物与样例数据。
 *
 * 只造节点与文字；事件、状态与保存都在 main.js。缩略画面与真实列表画的是同一种行。
 */
;(function (root) {
  'use strict'

  var model = root.RunRecords

  function tagOf(text, tone) {
    var tag = document.createElement('span')
    tag.className = 'rr__tag'
    tag.dataset.tone = tone
    tag.textContent = text
    return tag
  }

  /** 运行状态的色调。 */
  function statusTone(status) {
    return status === 'succeeded' ? 'ok' : status === 'failed' ? 'trash' : status === 'running' ? 'reading' : status === 'cancelled' ? 'warn' : 'neutral'
  }

  function textInput(part, value, placeholder, aria, className) {
    var input = document.createElement('input')
    input.type = 'text'
    input.className = 'rr__input ' + className
    input.dataset.part = part
    input.value = typeof value === 'string' ? value : ''
    input.placeholder = placeholder
    input.setAttribute('aria-label', aria)
    input.autocomplete = 'off'
    return input
  }

  /**
   * 一行记录：状态、标题与方案 / 时间或数据集；整行是按钮，进入详情。
   *
   * @param {object} record - 一条运行记录。
   * @param {{ t: function(string): string, fill: function(string, object): string }} text - 文案。
   * @param {object} plansById - 方案 id 到研究记录的映射。
   * @returns {HTMLButtonElement} 行按钮。
   */
  function rowOf(record, text, plansById) {
    var status = model.statusOf(record)
    var statusText = text.t(model.statusKey(status))
    var title = typeof record.title === 'string' && record.title !== '' ? record.title : String(record.id)
    var row = document.createElement('button')
    row.type = 'button'
    row.className = 'rr__row'
    row.dataset.id = record.id
    row.setAttribute('aria-label', statusText + ' · ' + title)
    var head = document.createElement('span')
    head.className = 'rr__row-head'
    var titleNode = document.createElement('span')
    titleNode.className = 'rr__row-title'
    titleNode.textContent = title
    head.append(tagOf(statusText, statusTone(status)), titleNode)
    row.appendChild(head)
    var sub = document.createElement('span')
    sub.className = 'rr__row-sub'
    var unknown = text.t('unknown')
    var plan = model.planLabelOf(record, plansById, text.t('planNone'), text.t('planMissing'))
    var time = model.timeLine(record)
    var detail = time !== '' ? time : model.datasetRows(record).length > 0 ? model.datasetsLine(record, unknown) : model.resultsLine(record, unknown)
    var line = document.createElement('span')
    line.className = 'rr__row-snippet'
    line.textContent = plan + ' · ' + detail
    sub.appendChild(line)
    var tags = document.createElement('span')
    tags.className = 'rr__tags'
    var artifacts = Array.isArray(record.artifacts) ? record.artifacts.length : 0
    if (artifacts > 0) tags.appendChild(tagOf(text.fill(text.t('artifactsCount'), { n: artifacts }), 'material'))
    var left = model.daysLeft(record)
    if (left !== null) tags.appendChild(tagOf(text.fill(text.t('deletedIn'), { n: left }), 'trash'))
    if (tags.childNodes.length > 0) sub.appendChild(tags)
    row.appendChild(sub)
    return row
  }

  /**
   * 一行配置、检查点或指标：名称、数值、单位、定义各一个输入，右边是移除。
   *
   * @param {object} entry - `{ name, value, unit, definition }`。
   * @param {number} index - 在组里的位置。
   * @param {string} kind - `checkpoints`、`config` 或 `metrics`。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 条目行。
   */
  function entryRow(entry, index, kind, text) {
    var row = document.createElement('li')
    row.className = 'rr__entry'
    row.dataset.kind = kind
    row.dataset.index = String(index)
    var name = textInput('name', entry.name, text.t('entryName'), text.t('entryName'), 'rr__entry-name')
    var value = textInput('value', entry.value, text.t('entryValue'), text.t('entryValue'), 'rr__entry-value')
    var unit = textInput('unit', entry.unit, text.t('entryUnit'), text.t('entryUnit'), 'rr__entry-unit')
    var definition = textInput('definition', entry.definition, text.t('entryDefinition'), text.t('entryDefinition'), 'rr__entry-definition')
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'rr__ghost rr__entry-remove'
    remove.textContent = text.t('removeEntry')
    remove.dataset.kind = kind
    remove.dataset.index = String(index)
    row.append(name, value, unit, definition, remove)
    return row
  }

  /**
   * 一行数据集：名称、划分、版本各一个输入，右边是移除。
   *
   * @param {object} dataset - `{ id, name, split, version }`。
   * @param {number} index - 在组里的位置。
   * @param {{ t: function(string): string }} text - 文案。
   * @returns {HTMLLIElement} 数据集行。
   */
  function datasetRow(dataset, index, text) {
    var row = document.createElement('li')
    row.className = 'rr__entry rr__dataset'
    row.dataset.kind = 'datasets'
    row.dataset.index = String(index)
    row.dataset.datasetId = typeof dataset.id === 'string' ? dataset.id : ''
    var name = textInput('name', dataset.name, text.t('datasetName'), text.t('datasetName'), 'rr__entry-name')
    var split = textInput('split', dataset.split, text.t('datasetSplit'), text.t('datasetSplit'), 'rr__entry-unit')
    var version = textInput('version', dataset.version, text.t('datasetVersion'), text.t('datasetVersion'), 'rr__entry-unit')
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'rr__ghost rr__entry-remove'
    remove.textContent = text.t('removeDataset')
    remove.dataset.kind = 'datasets'
    remove.dataset.index = String(index)
    row.append(name, split, version, remove)
    return row
  }

  /**
   * 一条结果：类型、内容、方法、样本数、离散度、手工汇总与来源运行。
   *
   * @param {object} result - 一条运行结果。
   * @param {number} index - 在组里的位置。
   * @param {{ t: function(string): string }} text - 文案。
   * @param {Array} runs - 可选的来源运行 `{ id, title }`。
   * @returns {HTMLLIElement} 结果行。
   */
  function resultRow(result, index, text, runs) {
    var kind = model.resultKindOf(result)
    var row = document.createElement('li')
    row.className = 'rr__result'
    row.dataset.kind = kind
    row.dataset.index = String(index)
    var head = document.createElement('div')
    head.className = 'rr__result-head'
    var kindLabel = document.createElement('span')
    kindLabel.className = 'rr__label'
    kindLabel.textContent = text.t('resultKind')
    var kindSelect = document.createElement('select')
    kindSelect.className = 'rr__input rr__result-kind'
    kindSelect.dataset.part = 'kind'
    kindSelect.setAttribute('aria-label', text.t('resultKind'))
    var single = document.createElement('option')
    single.value = 'single'
    single.textContent = text.t(model.resultKindKey('single'))
    var aggregate = document.createElement('option')
    aggregate.value = 'aggregate'
    aggregate.textContent = text.t(model.resultKindKey('aggregate'))
    kindSelect.append(single, aggregate)
    kindSelect.value = kind
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'rr__ghost rr__result-remove'
    remove.textContent = text.t('removeResult')
    remove.dataset.kind = 'results'
    remove.dataset.index = String(index)
    head.append(kindLabel, kindSelect, remove)
    var body = textInput('text', result.text, text.t('resultText'), text.t('resultText'), 'rr__result-text')
    body.type = 'text'
    body.maxLength = model.RESULT_TEXT_LENGTH
    var extras = document.createElement('div')
    extras.className = 'rr__result-extras'
    var method = textInput('method', result.method, text.t('resultMethod'), text.t('resultMethod'), 'rr__result-method')
    method.maxLength = model.RESULT_METHOD_LENGTH
    var sample = textInput('sampleSize', result.sampleSize === undefined || result.sampleSize === null ? '' : String(result.sampleSize), text.t('resultSampleSize'), text.t('resultSampleSize'), 'rr__result-sample')
    sample.inputMode = 'numeric'
    var dispersion = textInput('dispersion', result.dispersion, text.t('resultDispersion'), text.t('resultDispersion'), 'rr__result-dispersion')
    dispersion.maxLength = model.RESULT_DISPERSION_LENGTH
    extras.append(method, sample, dispersion)
    var manual = document.createElement('label')
    manual.className = 'rr__manual'
    var manualCheck = document.createElement('input')
    manualCheck.type = 'checkbox'
    manualCheck.dataset.part = 'manual'
    manualCheck.checked = result.manual === true
    manual.append(manualCheck, document.createTextNode(text.t('resultManual')))
    var sources = document.createElement('label')
    sources.className = 'rr__sources'
    var sourcesLabel = document.createElement('span')
    sourcesLabel.className = 'rr__label'
    sourcesLabel.textContent = text.t('resultSources')
    var picker = document.createElement('select')
    picker.className = 'rr__input rr__sources-picker'
    picker.dataset.part = 'sources'
    picker.multiple = true
    picker.size = 3
    picker.setAttribute('aria-label', text.t('resultSources'))
    var chosen = model.resultSourcesOf(result)
    var listed = {}
    var options = Array.isArray(runs) ? runs.slice() : []
    for (var at = 0; at < options.length; at += 1) {
      if (options[at] === null || typeof options[at] !== 'object' || listed[options[at].id] === true) continue
      listed[options[at].id] = true
      var option = document.createElement('option')
      option.value = options[at].id
      option.textContent = typeof options[at].title === 'string' && options[at].title !== '' ? options[at].title : options[at].id
      option.selected = chosen.indexOf(options[at].id) >= 0
      picker.append(option)
    }
    for (var chosenAt = 0; chosenAt < chosen.length; chosenAt += 1) {
      if (listed[chosen[chosenAt]] === true) continue
      listed[chosen[chosenAt]] = true
      var missing = document.createElement('option')
      missing.value = chosen[chosenAt]
      missing.textContent = chosen[chosenAt] + ' · ' + text.t('planMissing')
      missing.selected = true
      picker.append(missing)
    }
    sources.append(sourcesLabel, picker)
    row.append(head, body, extras, manual, sources)
    setResultKind(row)
    return row
  }

  /** 单次结果不显示来源与手工汇总；切换类型时跟着收放。 */
  function setResultKind(row) {
    var aggregate = row.dataset.kind === 'aggregate'
    var sources = row.querySelector('.rr__sources')
    if (sources !== null) sources.hidden = !aggregate
    var manual = row.querySelector('.rr__manual')
    if (manual !== null) manual.hidden = !aggregate
  }

  /**
   * 一行产物：打开按钮是一段带下划线的标题，右边是移除。
   *
   * @param {object} artifact - 一条产物引用。
   * @param {string} removeText - 「移除」的文案。
   * @returns {HTMLLIElement} 产物行。
   */
  function artifactRow(artifact, removeText) {
    var row = document.createElement('li')
    row.className = 'rr__material'
    var open = document.createElement('button')
    open.type = 'button'
    open.className = 'rr__material-open'
    open.textContent = typeof artifact.title === 'string' && artifact.title !== '' ? artifact.title : String(artifact.url)
    open.title = String(artifact.url)
    open.dataset.url = String(artifact.url)
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'rr__ghost rr__material-remove'
    remove.textContent = removeText
    remove.dataset.artifact = String(artifact.id)
    row.append(open, remove)
    return row
  }

  /** 缩略画面里的一份静态样例：三条运行，与真实读到的形状相同。 */
  function sampleRows() {
    var now = new Date().toISOString()
    return [
      { id: 'sample-1', kind: 'run', title: '种子 11 的干扰对齐仿真', status: 'succeeded', plan: { kind: 'research', id: 'sample-plan' }, datasets: [{ id: 'd1', name: '合成信道', split: 'test', version: 'v1' }], startedAt: '2026-11-15T08:00:00.000Z', endedAt: '2026-11-15T10:00:00.000Z', artifacts: [{ id: 'a1', url: 'https://example.com/log', title: '训练日志' }], updatedAt: now, archived: false },
      { id: 'sample-2', kind: 'run', title: '种子 42 的干扰对齐仿真', status: 'failed', plan: { kind: 'research', id: 'sample-plan' }, datasets: [{ id: 'd1', name: '合成信道', split: 'test', version: 'v1' }], startedAt: '2026-11-15T05:00:00.000Z', updatedAt: now, archived: false },
      { id: 'sample-3', kind: 'run', title: '真实信道回归', status: 'running', plan: { kind: 'research', id: 'sample-plan' }, datasets: [{ id: 'd2', name: '真实信道', split: 'train', version: 'v2' }], updatedAt: now, archived: false }
    ]
  }

  root.RunRecordsView = {
    tagOf: tagOf,
    statusTone: statusTone,
    rowOf: rowOf,
    entryRow: entryRow,
    datasetRow: datasetRow,
    resultRow: resultRow,
    setResultKind: setResultKind,
    artifactRow: artifactRow,
    sampleRows: sampleRows
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
