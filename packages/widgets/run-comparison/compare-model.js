/*
 * 运行比较卡的不碰 DOM 判定：口径行、指标可比性与差值。
 *
 * 挂在全局的 RunComparison 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 * 比较只读记录，不换算单位、不合并多 seed 均值、不排名；差值要用户先确认同口径。
 */
;(function (root) {
  'use strict'

  var KIND = 'run'
  var ROLES = ['baseline', 'ablation', 'other']
  var DIRECTIONS = ['target-minus-baseline', 'baseline-minus-target']
  var LIMIT = 8
  var LOAD_TIMEOUT = 4000
  var DIMENSION_IDS = ['plan', 'datasets', 'environment', 'config', 'checkpoints', 'seed', 'evaluation', 'code', 'statistics']

  /** 是不是一条可读的对象。 */
  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  /** 一段非空文字；空白或不是文字时是空串。 */
  function textOf(record, field) {
    if (!isObject(record)) return ''
    var value = record[field]
    return typeof value === 'string' ? value.trim() : ''
  }

  /** 一组条目里的名称与数值；名称空白的丢掉。 */
  function entriesOf(record, field) {
    if (!isObject(record) || !Array.isArray(record[field])) return []
    var out = []
    for (var at = 0; at < record[field].length; at += 1) {
      var entry = record[field][at]
      if (!isObject(entry)) continue
      var name = typeof entry.name === 'string' ? entry.name.trim() : ''
      if (name === '') continue
      out.push({
        name: name,
        value: entry.value === null || entry.value === undefined ? '' : String(entry.value).trim(),
        unit: typeof entry.unit === 'string' ? entry.unit.trim() : ''
      })
    }
    return out
  }

  /** 名称与数值拼成一行，顺序保持记录里的原样。 */
  function entryLine(entry) {
    return entry.name + '=' + entry.value + (entry.unit === '' ? '' : ' ' + entry.unit)
  }

  /** 配置按名称排；顺序不同不算口径不同。 */
  function configLine(record) {
    var entries = entriesOf(record, 'config')
    if (entries.length === 0) return null
    var lines = entries.map(entryLine)
    lines.sort()
    return lines.join('；')
  }

  /** 检查点保留记录顺序：轮次本身有意义。 */
  function checkpointLine(record) {
    var entries = entriesOf(record, 'checkpoints')
    return entries.length === 0 ? null : entries.map(entryLine).join('；')
  }

  /** 数据集按名称、划分与版本排序后拼起来。 */
  function datasetLine(record) {
    if (!isObject(record) || !Array.isArray(record.datasets)) return null
    var lines = []
    for (var at = 0; at < record.datasets.length; at += 1) {
      var dataset = record.datasets[at]
      if (!isObject(dataset)) continue
      var name = typeof dataset.name === 'string' ? dataset.name.trim() : ''
      if (name === '') continue
      var split = typeof dataset.split === 'string' ? dataset.split.trim() : ''
      var version = typeof dataset.version === 'string' ? dataset.version.trim() : ''
      var suffix = split === '' && version === '' ? '' : ' (' + (split === '' ? '?' : split) + (version === '' ? '' : ' · ' + version) + ')'
      lines.push(name + suffix)
    }
    if (lines.length === 0) return null
    lines.sort()
    return lines.join('；')
  }

  /** 代码来源：仓库与提交都可能缺失，缺一段就标未知。 */
  function codeCell(record) {
    if (!isObject(record) || !isObject(record.code)) return { text: null, unknown: false }
    var repository = typeof record.code.repository === 'string' ? record.code.repository.trim() : ''
    var commit = typeof record.code.commit === 'string' ? record.code.commit.trim() : ''
    if (repository === '' && commit === '') return { text: null, unknown: false }
    return {
      text: (repository === '' ? '?' : repository) + (commit === '' ? '' : ' @ ' + commit),
      unknown: repository === '' || commit === ''
    }
  }

  /** 方案标题；只有 id 时说明来源已缺失。 */
  function planCell(record, plans) {
    var id = isObject(record) && isObject(record.plan) && typeof record.plan.id === 'string' ? record.plan.id : ''
    if (id === '') return { text: null, unknown: false }
    var title = isObject(plans) && typeof plans[id] === 'string' ? plans[id].trim() : ''
    if (title === '') return { text: null, unknown: false, missing: true }
    return { text: title, unknown: false }
  }

  /** 种子写了几个；逗号、分号与空白都算分隔。 */
  function seedCount(record) {
    var seed = textOf(record, 'seed')
    if (seed === '') return 0
    var parts = seed.split(/[,，;；\s]+/)
    var count = 0
    for (var at = 0; at < parts.length; at += 1) {
      if (parts[at] !== '') count += 1
    }
    return count
  }

  /** 统计口径：单次、汇总还是没写清楚。 */
  function statKind(record) {
    var results = isObject(record) && Array.isArray(record.results) ? record.results : []
    var single = false
    for (var at = 0; at < results.length; at += 1) {
      var kind = isObject(results[at]) ? results[at].kind : undefined
      if (kind === 'aggregate') return 'aggregate'
      if (kind === 'single') single = true
    }
    var seeds = seedCount(record)
    if (seeds > 1) return 'aggregate'
    if (single) return 'single'
    if (seeds === 1) return 'single'
    return 'unknown'
  }

  /** 统计口径的一行说明；没有结果也不写种子时是 null。 */
  function statLine(record) {
    var results = isObject(record) && Array.isArray(record.results) ? record.results : []
    var lines = []
    for (var at = 0; at < results.length; at += 1) {
      var result = results[at]
      if (!isObject(result)) continue
      if (result.kind === 'aggregate') {
        var parts = []
        var method = typeof result.method === 'string' ? result.method.trim() : ''
        var sample = typeof result.sampleSize === 'number' && Number.isFinite(result.sampleSize) ? String(result.sampleSize) : ''
        var dispersion = typeof result.dispersion === 'string' ? result.dispersion.trim() : ''
        if (method !== '') parts.push(method)
        if (sample !== '') parts.push('n=' + sample)
        if (dispersion !== '') parts.push('离散度 ' + dispersion)
        lines.push((parts.length === 0 ? '汇总' : '汇总 · ' + parts.join(' · ')))
      } else if (result.kind === 'single') {
        lines.push('单次运行')
      }
    }
    if (lines.length > 0) return lines.join('；')
    var seeds = seedCount(record)
    if (seeds > 1) return '多组种子（' + String(seeds) + '）'
    if (seeds === 1) return '单次运行'
    return null
  }

  /** 某个口径字段在一组运行里的单元格。 */
  function dimensionValue(id, record, plans) {
    if (id === 'plan') return planCell(record, plans)
    if (id === 'datasets') {
      var datasets = datasetLine(record)
      return datasets === null ? { text: null, unknown: false } : { text: datasets, unknown: false }
    }
    if (id === 'environment') {
      var environment = textOf(record, 'environment')
      return environment === '' ? { text: null, unknown: false } : { text: environment, unknown: false }
    }
    if (id === 'config') {
      var config = configLine(record)
      return config === null ? { text: null, unknown: false } : { text: config, unknown: false }
    }
    if (id === 'checkpoints') {
      var checkpoints = checkpointLine(record)
      return checkpoints === null ? { text: null, unknown: false } : { text: checkpoints, unknown: false }
    }
    if (id === 'seed') {
      var seed = textOf(record, 'seed')
      return seed === '' ? { text: null, unknown: false } : { text: seed, unknown: false }
    }
    if (id === 'evaluation') {
      var evaluation = textOf(record, 'evaluation')
      return evaluation === '' ? { text: null, unknown: false } : { text: evaluation, unknown: false }
    }
    if (id === 'code') return codeCell(record)
    var statistics = statLine(record)
    return statistics === null ? { text: null, unknown: false } : { text: statistics, unknown: false }
  }

  /** 一组单元格的状态：有未知就是未知，否则看是否全同。 */
  function cellsStatus(cells) {
    var first = null
    for (var at = 0; at < cells.length; at += 1) {
      if (cells[at].text === null || cells[at].unknown === true || cells[at].missing === true) return 'unknown'
      if (first === null) first = cells[at].text
      else if (cells[at].text !== first) return 'different'
    }
    return 'same'
  }

  /** 运行对象按比较里的次序排好；缺记录的原位保留 null。 */
  function aligned(runs) {
    var out = []
    for (var at = 0; at < runs.length; at += 1) out.push(isObject(runs[at]) ? runs[at] : null)
    return out
  }

  /** 口径表：每个维度一行，每行给出各运行的单元格与状态。 */
  function conditionRows(runs, plans) {
    var records = aligned(runs)
    var rows = []
    for (var at = 0; at < DIMENSION_IDS.length; at += 1) {
      var id = DIMENSION_IDS[at]
      var cells = []
      for (var runAt = 0; runAt < records.length; runAt += 1) {
        var run = records[runAt]
        if (run === null) {
          cells.push({ runId: '', text: null, unknown: false, missing: true })
          continue
        }
        var cell = dimensionValue(id, run, plans)
        cells.push({ runId: typeof run.id === 'string' ? run.id : '', text: cell.text, unknown: cell.unknown === true, missing: cell.missing === true })
      }
      rows.push({ id: id, cells: cells, status: cellsStatus(cells) })
    }
    return rows
  }

  /** 一条运行里按名称索引的指标。 */
  function metricMap(record) {
    var map = {}
    if (!isObject(record) || !Array.isArray(record.metrics)) return map
    for (var at = 0; at < record.metrics.length; at += 1) {
      var entry = record.metrics[at]
      if (!isObject(entry)) continue
      var name = typeof entry.name === 'string' ? entry.name.trim() : ''
      if (name === '' || map[name] !== undefined) continue
      var raw = entry.value === null || entry.value === undefined ? '' : String(entry.value).trim()
      var numeric = raw === '' ? null : Number(raw)
      map[name] = {
        name: name,
        value: raw,
        numeric: typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : null,
        unit: typeof entry.unit === 'string' ? entry.unit.trim() : '',
        definition: typeof entry.definition === 'string' ? entry.definition.trim() : ''
      }
    }
    return map
  }

  /** 指标名按首次出现的次序合在一起。 */
  function metricNames(runs) {
    var names = []
    var seen = {}
    for (var at = 0; at < runs.length; at += 1) {
      var map = metricMap(runs[at])
      for (var name in map) {
        if (!Object.prototype.hasOwnProperty.call(map, name) || seen[name] === true) continue
        seen[name] = true
        names.push(name)
      }
    }
    return names
  }

  /** 一组指标单元格的可比性：缺值、单位、定义、文字值依次判断。 */
  function metricStatus(cells) {
    var units = {}
    var definitions = {}
    var definitionConflict = false
    var unitMissing = false
    var unitDifferent = false
    var textValue = false
    for (var at = 0; at < cells.length; at += 1) {
      var cell = cells[at]
      if (cell.missing === true) return { status: 'unknown', reason: 'missing' }
      if (cell.unit === '') unitMissing = true
      else if (units[cell.unit] === undefined) {
        if (Object.keys(units).length > 0) unitDifferent = true
        units[cell.unit] = true
      }
      if (cell.definition !== '') {
        if (Object.keys(definitions).length > 0 && definitions[cell.definition] === undefined) definitionConflict = true
        definitions[cell.definition] = true
      }
      if (cell.numeric === null) textValue = true
    }
    if (unitMissing) return { status: 'unknown', reason: 'unit' }
    if (unitDifferent) return { status: 'different', reason: 'unit' }
    if (definitionConflict) return { status: 'different', reason: 'definition' }
    if (textValue) return { status: 'text', reason: 'value' }
    return { status: 'comparable', reason: 'ok' }
  }

  /** 指标表：每个指标一行，给出各运行的值、单位、定义与可比性。 */
  function metricRows(runs) {
    var records = aligned(runs)
    var names = metricNames(records)
    var rows = []
    for (var at = 0; at < names.length; at += 1) {
      var name = names[at]
      var cells = []
      for (var runAt = 0; runAt < records.length; runAt += 1) {
        var record = records[runAt]
        var runId = isObject(record) && typeof record.id === 'string' ? record.id : ''
        if (record === null) {
          cells.push({ runId: runId, missing: true, value: '', numeric: null, unit: '', definition: '', name: name })
          continue
        }
        var map = metricMap(record)
        var entry = map[name]
        cells.push(entry === undefined
          ? { runId: runId, missing: true, value: '', numeric: null, unit: '', definition: '', name: name }
          : { runId: runId, missing: false, value: entry.value, numeric: entry.numeric, unit: entry.unit, definition: entry.definition, name: name })
      }
      var state = metricStatus(cells)
      rows.push({ name: name, cells: cells, status: state.status, reason: state.reason })
    }
    return rows
  }

  /** 口径里有几行不同、几行未知。 */
  function differencesOf(rows) {
    var out = []
    for (var at = 0; at < rows.length; at += 1) if (rows[at].status === 'different') out.push(rows[at].id)
    return out
  }

  function unknownsOf(rows) {
    var out = []
    for (var at = 0; at < rows.length; at += 1) if (rows[at].status === 'unknown') out.push(rows[at].id)
    return out
  }

  /** 选中的运行：只留合法 id，最多八条，基线最多一条。 */
  function normalizeSelection(value) {
    var list = Array.isArray(value) ? value : []
    var out = []
    var seen = {}
    var hasBaseline = false
    for (var at = 0; at < list.length; at += 1) {
      var item = list[at]
      var id = isObject(item) && typeof item.id === 'string' ? item.id.trim() : ''
      if (id === '' || seen[id] === true || out.length >= LIMIT) continue
      var role = isObject(item) && ROLES.indexOf(item.role) >= 0 ? item.role : 'other'
      if (role === 'baseline') {
        if (hasBaseline) role = 'other'
        else hasBaseline = true
      }
      seen[id] = true
      out.push({ id: id, role: role })
    }
    return out
  }

  /** 给一条运行换角色；选成基线时原基线退回其他方案。 */
  function selectionWithRole(value, id, role) {
    var selection = normalizeSelection(value)
    if (ROLES.indexOf(role) < 0) return selection
    for (var at = 0; at < selection.length; at += 1) {
      if (selection[at].id !== id) continue
      if (role === 'baseline') {
        for (var other = 0; other < selection.length; other += 1) {
          if (selection[other].role === 'baseline') selection[other].role = 'other'
        }
      }
      selection[at].role = role
      return selection
    }
    return selection
  }

  /** 方向选择：不认识的值回到「目标减基线」。 */
  function directionOf(value) {
    return DIRECTIONS.indexOf(value) >= 0 ? value : 'target-minus-baseline'
  }

  /** 两条运行是否都是单次口径；汇总与未知都不参与差值。 */
  function singleStat(baseline, target) {
    var left = statKind(baseline)
    var right = statKind(target)
    if (left === 'aggregate' || right === 'aggregate') return 'aggregate'
    if (left !== 'single' || right !== 'single') return 'statistics'
    return null
  }

  /** 按运行 id 找指标单元格。 */
  function cellOf(row, id) {
    if (!isObject(row) || !Array.isArray(row.cells)) return null
    for (var at = 0; at < row.cells.length; at += 1) {
      if (row.cells[at].runId === id) return row.cells[at]
    }
    return null
  }

  /** 数值的写法：整数不带小数点，其余保留六位有效数字。 */
  function numberText(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return ''
    if (Number.isInteger(value)) return String(value)
    return String(Number(value.toPrecision(6)))
  }

  /** 相对差异的写法：带符号的百分数，很小的值保留一位小数。 */
  function percentText(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return ''
    var percent = value * 100
    var digits = Math.abs(percent) >= 10 || percent === 0 ? 0 : 1
    return (percent > 0 ? '+' : '') + percent.toFixed(digits) + '%'
  }

  /**
   * 指标行上的差值：只在用户确认、单次口径、数值与单位一致时给出。
   *
   * @param row - `metricRows` 里的一行。
   * @param baseline - 基线运行。
   * @param target - 目标运行。
   * @param options - `{ confirmed, direction }`；`confirmed` 必须显式为 true。
   * @returns `{ ok: true, difference, relative, relativeReason, ... }` 或 `{ ok: false, reason }`。
   */
  function deltaOf(row, baseline, target, options) {
    var settings = options !== null && typeof options === 'object' ? options : {}
    if (settings.confirmed !== true) return { ok: false, reason: 'unconfirmed' }
    if (!isObject(row) || row.status !== 'comparable') return { ok: false, reason: isObject(row) ? row.reason || row.status : 'missing' }
    var stat = singleStat(baseline, target)
    if (stat !== null) return { ok: false, reason: stat }
    var baselineId = isObject(baseline) && typeof baseline.id === 'string' ? baseline.id : ''
    var targetId = isObject(target) && typeof target.id === 'string' ? target.id : ''
    var left = cellOf(row, baselineId)
    var right = cellOf(row, targetId)
    if (left === null || right === null || left.missing === true || right.missing === true) return { ok: false, reason: 'missing' }
    if (left.numeric === null || right.numeric === null) return { ok: false, reason: 'value' }
    if (left.unit === '' || right.unit === '' || left.unit !== right.unit) return { ok: false, reason: 'unit' }
    var direction = directionOf(settings.direction)
    var difference = direction === 'baseline-minus-target' ? left.numeric - right.numeric : right.numeric - left.numeric
    var relative = left.numeric === 0 ? null : difference / Math.abs(left.numeric)
    return {
      ok: true,
      direction: direction,
      unit: left.unit,
      baseline: left.numeric,
      target: right.numeric,
      difference: difference,
      relative: relative,
      relativeReason: relative === null ? 'zero-baseline' : 'ok'
    }
  }

  root.RunComparison = {
    KIND: KIND,
    ROLES: ROLES,
    DIRECTIONS: DIRECTIONS,
    LIMIT: LIMIT,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    DIMENSION_IDS: DIMENSION_IDS,
    isObject: isObject,
    textOf: textOf,
    planCell: planCell,
    datasetLine: datasetLine,
    configLine: configLine,
    checkpointLine: checkpointLine,
    codeCell: codeCell,
    seedCount: seedCount,
    statKind: statKind,
    statLine: statLine,
    cellsStatus: cellsStatus,
    conditionRows: conditionRows,
    metricMap: metricMap,
    metricNames: metricNames,
    metricRows: metricRows,
    metricStatus: metricStatus,
    differencesOf: differencesOf,
    unknownsOf: unknownsOf,
    normalizeSelection: normalizeSelection,
    selectionWithRole: selectionWithRole,
    directionOf: directionOf,
    deltaOf: deltaOf,
    numberText: numberText,
    percentText: percentText
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)