/*
 * 运行记录卡的不碰 DOM 判定：状态、方案、时间、条目、数据集、结果、重复与视图过滤。
 *
 * 挂在全局的 RunRecords 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 * 这一份不执行任何脚本：代码、配置、指标、结果与产物都只是记录下来的文字与地址。
 */
;(function (root) {
  'use strict'

  var KIND = 'run'
  var STATUSES = ['planned', 'running', 'succeeded', 'failed', 'cancelled']
  var RESULT_KINDS = ['single', 'aggregate']
  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000
  var MAX_ENTRIES = 64
  var MAX_DATASETS = 32
  var MAX_RESULTS = 50
  var UNIT_LENGTH = 32
  var RESULT_TEXT_LENGTH = 2000
  var RESULT_METHOD_LENGTH = 200
  var RESULT_DISPERSION_LENGTH = 200

  /** 记录里的状态：不认识的值按计划中算。 */
  function statusOf(record) {
    if (record === null || typeof record !== 'object') return 'planned'
    return STATUSES.indexOf(record.status) >= 0 ? record.status : 'planned'
  }

  /** 状态对应的文案键。 */
  function statusKey(status) {
    return status === 'running'
      ? 'statusRunning'
      : status === 'succeeded'
        ? 'statusSucceeded'
        : status === 'failed'
          ? 'statusFailed'
          : status === 'cancelled'
            ? 'statusCancelled'
            : 'statusPlanned'
  }

  /** 一段非空文字；空白或不是文字时是空串。 */
  function textOf(record, field) {
    if (record === null || typeof record !== 'object') return ''
    var value = record[field]
    if (typeof value !== 'string') return ''
    return value.trim()
  }

  /** 缺了内容时给出的说法：默认「未知」，不猜也不留白。 */
  function shownText(record, field, unknown) {
    var value = textOf(record, field)
    return value === '' ? String(unknown) : value
  }

  /** 环境（或别的单行字段）的一行提示；缺失时显式说明未知。 */
  function labelledOf(record, field, label, unknown) {
    return String(label) + '：' + shownText(record, field, unknown)
  }

  /** 一条运行所属方案的 id；没有方案时是空串。 */
  function planIdOf(record) {
    if (record === null || typeof record !== 'object' || record.plan === null || typeof record.plan !== 'object') return ''
    return typeof record.plan.id === 'string' ? record.plan.id : ''
  }

  /** 方案在列表里的说法：找得到标题就用标题，找不到时说明来源缺失。 */
  function planLabelOf(record, plansById, unknown, missing) {
    var id = planIdOf(record)
    if (id === '') return String(unknown)
    var plan = plansById !== null && typeof plansById === 'object' ? plansById[id] : null
    if (plan === null || typeof plan !== 'object') return String(missing)
    return typeof plan.title === 'string' && plan.title !== '' ? plan.title : String(missing)
  }

  /** 一组配置或指标里真正有名称与数值的条目。 */
  function entriesOf(record, field) {
    if (record === null || typeof record !== 'object' || !Array.isArray(record[field])) return []
    var out = []
    for (var at = 0; at < record[field].length; at += 1) {
      var entry = record[field][at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.name !== 'string' || entry.name.trim() === '') continue
      if (typeof entry.value !== 'string' || entry.value.trim() === '') continue
      out.push(entry)
    }
    return out
  }

  /** 一行条目：名称、数值与单位；没有单位就不补。 */
  function entryLine(entry) {
    if (entry === null || typeof entry !== 'object') return ''
    var line = String(entry.name).trim() + ' ' + String(entry.value).trim()
    if (typeof entry.unit === 'string' && entry.unit.trim() !== '') line += ' ' + entry.unit.trim()
    return line
  }

  /** 一组条目的一行摘要；一条都没有时说明未知。 */
  function entriesLine(record, field, unknown) {
    var entries = entriesOf(record, field)
    if (entries.length === 0) return String(unknown)
    var parts = []
    for (var at = 0; at < entries.length && at < 3; at += 1) parts.push(entryLine(entries[at]))
    return parts.join(' · ')
  }

  /** 数据集里真正有名称的条目。 */
  function datasetRows(record) {
    if (record === null || typeof record !== 'object' || !Array.isArray(record.datasets)) return []
    var out = []
    for (var at = 0; at < record.datasets.length; at += 1) {
      var dataset = record.datasets[at]
      if (dataset === null || typeof dataset !== 'object') continue
      if (typeof dataset.name !== 'string' || dataset.name.trim() === '') continue
      out.push(dataset)
    }
    return out
  }

  /** 一个数据集的一行说法：名称、划分与版本。 */
  function datasetLine(dataset) {
    if (dataset === null || typeof dataset !== 'object') return ''
    var line = String(dataset.name).trim()
    if (typeof dataset.split === 'string' && dataset.split.trim() !== '') line += ' · ' + dataset.split.trim()
    if (typeof dataset.version === 'string' && dataset.version.trim() !== '') line += ' · ' + dataset.version.trim()
    return line
  }

  /** 数据集的一行摘要；一条都没有时说明未知。 */
  function datasetsLine(record, unknown) {
    var datasets = datasetRows(record)
    if (datasets.length === 0) return String(unknown)
    var parts = []
    for (var at = 0; at < datasets.length && at < 2; at += 1) parts.push(datasetLine(datasets[at]))
    return parts.join(' · ')
  }

  /** 一条结果的类型：不认识的值按单次运行算。 */
  function resultKindOf(result) {
    if (result === null || typeof result !== 'object') return 'single'
    return RESULT_KINDS.indexOf(result.kind) >= 0 ? result.kind : 'single'
  }

  /** 一条结果的类型文案键。 */
  function resultKindKey(kind) {
    return kind === 'aggregate' ? 'resultAggregate' : 'resultSingle'
  }

  /** 结果里真正有内容的条目。 */
  function resultRows(record) {
    if (record === null || typeof record !== 'object' || !Array.isArray(record.results)) return []
    var out = []
    for (var at = 0; at < record.results.length; at += 1) {
      var result = record.results[at]
      if (result === null || typeof result !== 'object') continue
      if (typeof result.text !== 'string' || result.text.trim() === '') continue
      out.push(result)
    }
    return out
  }

  /** 一条结果的来源运行 id。 */
  function resultSourcesOf(result) {
    if (result === null || typeof result !== 'object' || !Array.isArray(result.sources)) return []
    var out = []
    for (var at = 0; at < result.sources.length; at += 1) {
      if (typeof result.sources[at] === 'string' && result.sources[at] !== '') out.push(result.sources[at])
    }
    return out
  }

  /** 结果列表的一行摘要：条数与单次 / 汇总各多少。 */
  function resultsLine(record, unknown) {
    var results = resultRows(record)
    if (results.length === 0) return String(unknown)
    var single = 0
    for (var at = 0; at < results.length; at += 1) if (resultKindOf(results[at]) === 'single') single += 1
    return String(results.length) + ' 条（单次 ' + String(single) + ' / 汇总 ' + String(results.length - single) + '）'
  }

  /** 回收站里还剩几天：不认识的 deletedAt 不给倒计时。 */
  function daysLeft(record, now) {
    if (record === null || typeof record !== 'object' || typeof record.deletedAt !== 'string') return null
    var stamp = Date.parse(record.deletedAt)
    if (isNaN(stamp)) return null
    return Math.max(0, Math.ceil((stamp + 30 * DAY - (typeof now === 'number' ? now : Date.now())) / DAY))
  }

  /** 时间可以留空；填了就要能解析。 */
  function timeValid(value) {
    if (typeof value !== 'string' || value.trim() === '') return true
    return !isNaN(Date.parse(value))
  }

  /** 一条运行的时间说法：起止都有时写成一段，只有一个时写那一个。 */
  function timeLine(record) {
    if (record === null || typeof record !== 'object') return ''
    var started = typeof record.startedAt === 'string' ? record.startedAt.slice(0, 16).replace('T', ' ') : ''
    var ended = typeof record.endedAt === 'string' ? record.endedAt.slice(0, 16).replace('T', ' ') : ''
    if (started !== '' && ended !== '') return started + ' → ' + ended
    return started !== '' ? started : ended
  }

  /** 一个视图里的行：先按回收与归档状态筛，再按状态筛，按最近更新从新到旧。 */
  function viewRows(records, view, status) {
    var list = Array.isArray(records) ? records : []
    var rows = []
    for (var at = 0; at < list.length; at += 1) {
      var record = list[at]
      if (record === null || typeof record !== 'object') continue
      var trashed = typeof record.deletedAt === 'string'
      if (view === 'trash') {
        if (!trashed) continue
      } else if (trashed) {
        continue
      }
      if (view === 'archived' && record.archived !== true) continue
      if (view !== 'archived' && view !== 'trash' && record.archived === true) continue
      if (view === 'active' && typeof status === 'string' && STATUSES.indexOf(status) >= 0 && statusOf(record) !== status) continue
      rows.push(record)
    }
    rows.sort(function (left, right) {
      return String(right.updatedAt).localeCompare(String(left.updatedAt))
    })
    return rows
  }

  /**
   * 把编辑面板里的条目行整理成可保存的样子。
   *
   * 整行都空的行丢掉；只填了一半（缺名称或缺数值）时返回 null，由界面提示。
   *
   * @param {Array} rows - `{ name, value, unit, definition }` 行。
   * @returns {Array|null} 归一后的条目；有半填行时是 null。
   */
  function cleanEntries(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') continue
      var name = typeof row.name === 'string' ? row.name.trim() : ''
      var value = typeof row.value === 'string' ? row.value.trim() : ''
      var unit = typeof row.unit === 'string' ? row.unit.trim() : ''
      var definition = typeof row.definition === 'string' ? row.definition.trim() : ''
      if (name === '' && value === '' && unit === '' && definition === '') continue
      if (name === '' || value === '') return null
      if (unit.length > UNIT_LENGTH) return null
      out.push({ name: name, value: value, ...(unit === '' ? {} : { unit: unit }), ...(definition === '' ? {} : { definition: definition }) })
      if (out.length > MAX_ENTRIES) return null
    }
    return out
  }

  /**
   * 数据集行整理：整行空丢掉，有划分或版本但没名称时拒绝；id 保留或补一个稳定的。
   *
   * @param {Array} rows - `{ id, name, split, version }` 行。
   * @param {string} stamp - 新行 id 的种子，通常是当前时刻。
   * @returns {Array|null} 归一后的数据集；不合法时是 null。
   */
  function cleanDatasets(rows, stamp) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') continue
      var name = typeof row.name === 'string' ? row.name.trim() : ''
      var split = typeof row.split === 'string' ? row.split.trim() : ''
      var version = typeof row.version === 'string' ? row.version.trim() : ''
      if (name === '' && split === '' && version === '') continue
      if (name === '') return null
      var id = typeof row.id === 'string' && row.id !== '' ? row.id : 'dataset-' + String(stamp) + '-' + String(at)
      out.push({ id: id, name: name, ...(split === '' ? {} : { split: split }), ...(version === '' ? {} : { version: version }) })
      if (out.length > MAX_DATASETS) return null
    }
    return out
  }

  /**
   * 结果行整理：每条要有内容；汇总要选来源运行，或显式标记手工汇总。
   *
   * 已有结果保留原 id，方便来源引用的稳定；新结果按当前时刻补 id。
   *
   * @param {Array} rows - 结果行。
   * @param {string} stamp - 新行 id 的种子。
   * @returns {Array|null} 归一后的结果；不合法时是 null。
   */
  function cleanResults(rows, stamp) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') continue
      var text = typeof row.text === 'string' ? row.text.trim() : ''
      var method = typeof row.method === 'string' ? row.method.trim() : ''
      var dispersion = typeof row.dispersion === 'string' ? row.dispersion.trim() : ''
      var rawSources = resultSourcesOf(row)
      var sources = []
      var seenSources = {}
      for (var sourceAt = 0; sourceAt < rawSources.length; sourceAt += 1) {
        if (seenSources[rawSources[sourceAt]] === true) continue
        seenSources[rawSources[sourceAt]] = true
        sources.push(rawSources[sourceAt])
      }
      if (text === '' && method === '' && dispersion === '' && sources.length === 0) continue
      if (text === '') return null
      if (text.length > RESULT_TEXT_LENGTH) return null
      if (method.length > RESULT_METHOD_LENGTH || dispersion.length > RESULT_DISPERSION_LENGTH) return null
      var kind = resultKindOf(row)
      var manual = row.manual === true
      if (manual && sources.length > 0) return null
      if (kind === 'aggregate' && sources.length === 0 && !manual) return null
      var sampleSize = null
      if (row.sampleSize !== undefined && row.sampleSize !== null && row.sampleSize !== '') {
        sampleSize = Number(row.sampleSize)
        if (!Number.isInteger(sampleSize) || sampleSize < 0) return null
      }
      var id = typeof row.id === 'string' && row.id !== '' ? row.id : 'result-' + String(stamp) + '-' + String(at)
      out.push({
        id: id,
        kind: kind,
        text: text,
        ...(sources.length === 0 ? {} : { sources: sources }),
        ...(method === '' ? {} : { method: method }),
        ...(sampleSize === null ? {} : { sampleSize: sampleSize }),
        ...(dispersion === '' ? {} : { dispersion: dispersion }),
        ...(manual ? { manual: true } : {})
      })
      if (out.length > MAX_RESULTS) return null
    }
    return out
  }

  /**
   * 复制成一条计划中的运行：复制方案、代码、数据集、检查点、配置、环境与种子；
   * 不复制状态、观测指标、结果、起止时间、失败原因与产物。
   *
   * @param {object} record - 原运行。
   * @param {string} title - 新运行的标题。
   * @returns {object} 可以直接交给新建接口的记录。
   */
  function duplicateAsPlanned(record, title) {
    var out = { kind: KIND, title: title, status: 'planned' }
    if (record === null || typeof record !== 'object') return out
    if (planIdOf(record) !== '') out.plan = { kind: 'research', id: planIdOf(record) }
    if (record.code !== null && typeof record.code === 'object') {
      var repository = typeof record.code.repository === 'string' ? record.code.repository : ''
      var commit = typeof record.code.commit === 'string' ? record.code.commit : ''
      if (repository !== '' || commit !== '') out.code = { ...(repository === '' ? {} : { repository: repository }), ...(commit === '' ? {} : { commit: commit }) }
    }
    if (Array.isArray(record.datasets)) out.datasets = record.datasets.map(function (dataset) { return { id: dataset.id, name: dataset.name, ...(dataset.split === undefined ? {} : { split: dataset.split }), ...(dataset.version === undefined ? {} : { version: dataset.version }) } })
    if (Array.isArray(record.checkpoints)) out.checkpoints = record.checkpoints.map(function (entry) { return { name: entry.name, value: entry.value, ...(entry.unit === undefined ? {} : { unit: entry.unit }), ...(entry.definition === undefined ? {} : { definition: entry.definition }) } })
    if (Array.isArray(record.config)) out.config = record.config.map(function (entry) { return { name: entry.name, value: entry.value, ...(entry.unit === undefined ? {} : { unit: entry.unit }), ...(entry.definition === undefined ? {} : { definition: entry.definition }) } })
    if (typeof record.environment === 'string' && record.environment !== '') out.environment = record.environment
    if (typeof record.seed === 'string' && record.seed !== '') out.seed = record.seed
    if (typeof record.evaluation === 'string' && record.evaluation !== '') out.evaluation = record.evaluation
    if (typeof record.note === 'string' && record.note !== '') out.note = record.note
    return out
  }

  /** 新建运行的默认标题：运行加上当前时刻。 */
  function newRunTitle(now) {
    var at = typeof now === 'number' ? new Date(now) : new Date()
    return '运行 ' + at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes())
  }

  /** 复制运行的标题：原名后加标记，过长时截断。 */
  function duplicateTitle(record) {
    var base = textOf(record, 'title')
    if (base === '') base = newRunTitle()
    var suffix = '（计划副本）'
    var limit = 200 - suffix.length
    if (base.length > limit) base = base.slice(0, limit)
    return base + suffix
  }

  /** 产物地址只收 http/https 的完整地址，说明不能是空的。 */
  function artifactValid(url, title) {
    if (typeof title !== 'string' || title.trim() === '') return false
    return openableUrl(url)
  }

  /** 地址只收 http/https 的完整地址；空串表示未填。 */
  function openableUrl(url) {
    if (typeof url !== 'string' || url === '') return false
    try {
      return /^https?:$/.test(new URL(url).protocol)
    } catch (error) {
      return false
    }
  }

  /** 文案里的 `{name}` 替换。 */
  function fill(text, values) {
    var out = text
    for (var name in values) {
      if (Object.prototype.hasOwnProperty.call(values, name)) out = out.split('{' + name + '}').join(String(values[name]))
    }
    return out
  }

  /** 两位补零。 */
  function pad(value) { return value < 10 ? '0' + String(value) : String(value) }

  /** 时间写成 datetime-local 认识的本地时间。 */
  function timeValue(value) {
    if (typeof value !== 'string' || value === '') return ''
    var at = new Date(value)
    if (isNaN(at.getTime())) return ''
    return String(at.getFullYear()) + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + 'T' + pad(at.getHours()) + ':' + pad(at.getMinutes())
  }

  /** 本地时间写成 UTC；空着就是未填，认不出来时告诉调用方。 */
  function timeOut(raw) {
    var text = typeof raw === 'string' ? raw : ''
    if (text === '') return { ok: true, value: null }
    if (!timeValid(text)) return { ok: false, value: null }
    var at = new Date(text)
    if (isNaN(at.getTime())) return { ok: false, value: null }
    return { ok: true, value: at.toISOString() }
  }

  /** 表单行的一份浅拷贝。 */
  function copyRow(row) {
    return row !== null && typeof row === 'object' ? Object.assign({}, row) : {}
  }

  /** 结果行连同来源一起拷贝。 */
  function copyResult(result) {
    var out = copyRow(result)
    out.sources = resultSourcesOf(result)
    return out
  }

  root.RunRecords = {
    KIND: KIND,
    STATUSES: STATUSES,
    RESULT_KINDS: RESULT_KINDS,
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    MAX_ENTRIES: MAX_ENTRIES,
    MAX_DATASETS: MAX_DATASETS,
    MAX_RESULTS: MAX_RESULTS,
    UNIT_LENGTH: UNIT_LENGTH,
    RESULT_TEXT_LENGTH: RESULT_TEXT_LENGTH,
    RESULT_METHOD_LENGTH: RESULT_METHOD_LENGTH,
    RESULT_DISPERSION_LENGTH: RESULT_DISPERSION_LENGTH,
    statusOf: statusOf,
    statusKey: statusKey,
    textOf: textOf,
    shownText: shownText,
    labelledOf: labelledOf,
    planIdOf: planIdOf,
    planLabelOf: planLabelOf,
    entriesOf: entriesOf,
    entryLine: entryLine,
    entriesLine: entriesLine,
    datasetRows: datasetRows,
    datasetLine: datasetLine,
    datasetsLine: datasetsLine,
    resultKindOf: resultKindOf,
    resultKindKey: resultKindKey,
    resultRows: resultRows,
    resultSourcesOf: resultSourcesOf,
    resultsLine: resultsLine,
    daysLeft: daysLeft,
    timeValid: timeValid,
    timeLine: timeLine,
    timeValue: timeValue,
    timeOut: timeOut,
    copyRow: copyRow,
    copyResult: copyResult,
    viewRows: viewRows,
    cleanEntries: cleanEntries,
    cleanDatasets: cleanDatasets,
    cleanResults: cleanResults,
    duplicateAsPlanned: duplicateAsPlanned,
    newRunTitle: newRunTitle,
    duplicateTitle: duplicateTitle,
    artifactValid: artifactValid,
    openableUrl: openableUrl,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
