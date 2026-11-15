/*
 * 研究记录卡的不碰 DOM 判定：做法、参数与指标、缺失内容的说法、视图过滤与材料地址。
 *
 * 挂在全局的 ResearchRecords 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 * 这一份不执行任何实验程序：参数、环境、种子、指标与结论都只是记录下来的文字。
 */
;(function (root) {
  'use strict'

  var KIND = 'research'
  var METHODS = ['derivation', 'simulation', 'experiment']
  var RUN_STATUSES = ['planned', 'running', 'succeeded', 'failed', 'cancelled']
  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000
  var MAX_ENTRIES = 64
  var UNIT_LENGTH = 32
  var RUN_TITLE_LENGTH = 160
  var EVIDENCE_LIMIT = 50
  var EVIDENCE_ID = 64
  var EVIDENCE_SUMMARY = 2000
  var EVIDENCE_KINDS = ['meeting', 'action', 'manuscript', 'literature', 'research', 'thesis', 'project', 'course', 'chore', 'topic', 'run', 'template']
  var KIND_KEYS = {
    meeting: 'kindMeeting',
    action: 'kindAction',
    manuscript: 'kindManuscript',
    literature: 'kindLiterature',
    research: 'kindResearch',
    thesis: 'kindThesis',
    project: 'kindProject',
    course: 'kindCourse',
    chore: 'kindChore',
    topic: 'kindTopic',
    run: 'kindRun',
    template: 'kindTemplate'
  }

  /** 记录里的做法：不认识的值按仿真算。 */
  function methodOf(record) {
    if (record === null || typeof record !== 'object') return 'simulation'
    return METHODS.indexOf(record.method) >= 0 ? record.method : 'simulation'
  }

  /** 做法对应的文案键。 */
  function methodKey(method) {
    return method === 'derivation' ? 'methodDerivation' : method === 'experiment' ? 'methodExperiment' : 'methodSimulation'
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

  /** 一行摘要：结论优先，没有结论时用研究问题，都没有时说明未知。 */
  function summaryOf(record, unknown) {
    var value = textOf(record, 'conclusion')
    if (value === '') value = textOf(record, 'question')
    return value === '' ? String(unknown) : value
  }

  /** 环境（或别的单行字段）的一行提示；缺失时显式说明未知。 */
  function labelledOf(record, field, label, unknown) {
    return String(label) + '：' + shownText(record, field, unknown)
  }

  /** 一组参数或指标里真正有名称与数值的条目。 */
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

  /** 一行参数或指标：名称、数值与单位；没有单位就不补。 */
  function entryLine(entry) {
    if (entry === null || typeof entry !== 'object') return ''
    var line = String(entry.name).trim() + ' ' + String(entry.value).trim()
    if (typeof entry.unit === 'string' && entry.unit.trim() !== '') line += ' ' + entry.unit.trim()
    return line
  }

  /** 一组参数或指标的一行摘要；一条都没有时说明未知。 */
  function entriesLine(record, field, unknown) {
    var entries = entriesOf(record, field)
    if (entries.length === 0) return String(unknown)
    var parts = []
    for (var at = 0; at < entries.length && at < 3; at += 1) parts.push(entryLine(entries[at]))
    return parts.join(' · ')
  }

  /** 回收站里还剩几天：不认识的 deletedAt 不给倒计时。 */
  function daysLeft(record, now) {
    if (record === null || typeof record !== 'object' || typeof record.deletedAt !== 'string') return null
    var stamp = Date.parse(record.deletedAt)
    if (isNaN(stamp)) return null
    return Math.max(0, Math.ceil((stamp + 30 * DAY - (typeof now === 'number' ? now : Date.now())) / DAY))
  }

  /** 运行状态：不认识的值按计划中算。 */
  function runStatusOf(run) {
    if (run === null || typeof run !== 'object') return 'planned'
    return RUN_STATUSES.indexOf(run.status) >= 0 ? run.status : 'planned'
  }

  /** 运行状态对应的文案键。 */
  function runStatusKey(status) {
    return status === 'running'
      ? 'runRunning'
      : status === 'succeeded'
        ? 'runSucceeded'
        : status === 'failed'
          ? 'runFailed'
          : status === 'cancelled'
            ? 'runCancelled'
            : 'runPlanned'
  }

  /** 一条运行的时间说法：起止都有时写成一段，只有一个时写那一个。 */
  function runTimeLine(run) {
    if (run === null || typeof run !== 'object') return ''
    var started = typeof run.startedAt === 'string' ? run.startedAt.slice(0, 16).replace('T', ' ') : ''
    var ended = typeof run.endedAt === 'string' ? run.endedAt.slice(0, 16).replace('T', ' ') : ''
    if (started !== '' && ended !== '') return started + ' → ' + ended
    return started !== '' ? started : ended
  }

  /** 一套方案下的运行标题：沿用方案标题，附上创建时刻，避免多次新建后分不清。 */
  function runTitleOf(record, now) {
    var base = textOf(record, 'title')
    if (base === '') base = '研究运行'
    if (base.length > RUN_TITLE_LENGTH) base = base.slice(0, RUN_TITLE_LENGTH)
    var at = typeof now === 'number' ? new Date(now) : new Date()
    function pad(value) { return value < 10 ? '0' + String(value) : String(value) }
    return base + ' · 运行 ' + at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes())
  }

  /** 一套方案下的运行：没有回收的，按最近更新从新到旧。 */
  function planRuns(records) {
    var list = Array.isArray(records) ? records : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var run = list[at]
      if (run === null || typeof run !== 'object') continue
      if (typeof run.deletedAt === 'string') continue
      out.push(run)
    }
    out.sort(function (left, right) {
      return String(right.updatedAt).localeCompare(String(left.updatedAt))
    })
    return out
  }

  /** 一个视图里的行：先按回收与归档状态筛，再按做法筛，按最近更新从新到旧。 */
  function viewRows(records, view, method) {
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
      if (view === 'active' && typeof method === 'string' && METHODS.indexOf(method) >= 0 && methodOf(record) !== method) continue
      rows.push(record)
    }
    rows.sort(function (left, right) {
      return String(right.updatedAt).localeCompare(String(left.updatedAt))
    })
    return rows
  }

  /**
   * 把编辑面板里的参数或指标行整理成可保存的样子。
   *
   * 整行都空的行丢掉；只填了一半（缺名称或缺数值）时返回 null，由界面提示。
   *
   * @param {Array} rows - `{ name, value, unit }` 行。
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
      if (name === '' && value === '' && unit === '') continue
      if (name === '' || value === '') return null
      if (unit.length > UNIT_LENGTH) return null
      out.push(unit === '' ? { name: name, value: value } : { name: name, value: value, unit: unit })
      if (out.length > MAX_ENTRIES) return null
    }
    return out
  }

  /** 记录类型读成文案键；不认识的类型按未知说。 */
  function kindKey(kind) {
    return typeof kind === 'string' && KIND_KEYS[kind] !== undefined ? KIND_KEYS[kind] : 'unknown'
  }

  /** 一条证据引用的身份：记录、条目与材料三段一起判重。 */
  function evidenceKey(ref) {
    if (ref === null || typeof ref !== 'object') return ''
    return String(ref.kind) + ':' + String(ref.id) + ':' + (typeof ref.entryId === 'string' ? ref.entryId : '') + ':' + (typeof ref.materialId === 'string' ? ref.materialId : '')
  }

  /** 记录里的证据引用；没有时是空数组。 */
  function evidenceOf(record) {
    return record !== null && typeof record === 'object' && Array.isArray(record.conclusionEvidence) ? record.conclusionEvidence : []
  }

  /** 证据引用的条数。 */
  function evidenceCount(record) {
    return evidenceOf(record).length
  }

  /**
   * 把编辑器里的证据行整理成可保存的样子。
   *
   * 类型、id 与修订号必须齐全；同一记录、条目与材料只能出现一次；超过五十条或半填时返回 null。
   *
   * @param {Array} rows - `{ kind, id, revision, entryId?, materialId?, summary? }` 行。
   * @returns {Array|null} 归一后的引用；有问题时是 null。
   */
  function cleanEvidence(rows) {
    var list = Array.isArray(rows) ? rows : []
    var seen = {}
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var ref = list[at]
      if (ref === null || typeof ref !== 'object') return null
      if (EVIDENCE_KINDS.indexOf(ref.kind) < 0) return null
      if (typeof ref.id !== 'string' || ref.id === '' || ref.id.length > EVIDENCE_ID) return null
      if (!Number.isInteger(ref.revision) || ref.revision < 0) return null
      var entry = { kind: ref.kind, id: ref.id, revision: ref.revision }
      var entryId = typeof ref.entryId === 'string' ? ref.entryId.trim() : ''
      if (entryId !== '') {
        if (entryId.length > EVIDENCE_ID) return null
        entry.entryId = entryId
      }
      var materialId = typeof ref.materialId === 'string' ? ref.materialId.trim() : ''
      if (materialId !== '') {
        if (materialId.length > EVIDENCE_ID) return null
        entry.materialId = materialId
      }
      var summary = typeof ref.summary === 'string' ? ref.summary.trim() : ''
      if (summary !== '') {
        if (summary.length > EVIDENCE_SUMMARY) return null
        entry.summary = summary
      }
      var key = evidenceKey(entry)
      if (seen[key] === true) return null
      seen[key] = true
      out.push(entry)
      if (out.length > EVIDENCE_LIMIT) return null
    }
    return out
  }

  /** 来源在引用之后改过：当前修订号与引用时不同。 */
  function evidenceUpdated(ref, record) {
    if (ref === null || typeof ref !== 'object' || record === null || typeof record !== 'object') return false
    return Number.isInteger(record.revision) && record.revision !== ref.revision
  }

  /** 一段条目文字：先找名称，再找标题与正文；都没有时用 id。 */
  function entryLabel(entry) {
    var fields = ['name', 'title', 'label', 'text', 'feedback', 'content', 'question', 'venue']
    for (var at = 0; at < fields.length; at += 1) {
      var value = entry[fields[at]]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
    return String(entry.id)
  }

  /**
   * 记录里可以单独引用的条目：带稳定 id，且有可读的名称或标题。
   *
   * @param {object} record - 来源记录。
   * @returns {Array} `{ id, label }`；去重并保持原顺序。
   */
  function evidenceEntries(record) {
    var fields = ['parameters', 'metrics', 'checkpoints', 'config', 'datasets', 'results', 'figures', 'issues', 'items', 'problemEntries', 'chapters', 'sections', 'submissions', 'revisions', 'tasks', 'members', 'deliverables', 'requirements', 'tests', 'milestones', 'experiments']
    var seen = {}
    var out = []
    if (record === null || typeof record !== 'object') return out
    for (var fieldAt = 0; fieldAt < fields.length; fieldAt += 1) {
      var list = record[fields[fieldAt]]
      if (!Array.isArray(list)) continue
      for (var at = 0; at < list.length; at += 1) {
        var entry = list[at]
        if (entry === null || typeof entry !== 'object') continue
        if (typeof entry.id !== 'string' || entry.id === '' || seen[entry.id] === true) continue
        seen[entry.id] = true
        out.push({ id: entry.id, label: entryLabel(entry) })
      }
    }
    return out
  }

  /** 记录里可以单独引用的材料：结果材料与产物。 */
  function evidenceMaterials(record) {
    var out = []
    var seen = {}
    if (record === null || typeof record !== 'object') return out
    var lists = [record.materials, record.artifacts]
    for (var listAt = 0; listAt < lists.length; listAt += 1) {
      if (!Array.isArray(lists[listAt])) continue
      for (var at = 0; at < lists[listAt].length; at += 1) {
        var material = lists[listAt][at]
        if (material === null || typeof material !== 'object') continue
        if (typeof material.id !== 'string' || material.id === '' || seen[material.id] === true) continue
        seen[material.id] = true
        out.push({ id: material.id, label: typeof material.title === 'string' && material.title !== '' ? material.title : String(material.url) })
      }
    }
    return out
  }

  /** 材料地址只收 http/https 的完整地址，说明不能是空的。 */
  function materialValid(url, title) {
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

  root.ResearchRecords = {
    KIND: KIND,
    METHODS: METHODS,
    RUN_STATUSES: RUN_STATUSES,
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    MAX_ENTRIES: MAX_ENTRIES,
    UNIT_LENGTH: UNIT_LENGTH,
    RUN_TITLE_LENGTH: RUN_TITLE_LENGTH,
    EVIDENCE_LIMIT: EVIDENCE_LIMIT,
    EVIDENCE_ID: EVIDENCE_ID,
    EVIDENCE_SUMMARY: EVIDENCE_SUMMARY,
    EVIDENCE_KINDS: EVIDENCE_KINDS,
    methodOf: methodOf,
    methodKey: methodKey,
    textOf: textOf,
    shownText: shownText,
    summaryOf: summaryOf,
    labelledOf: labelledOf,
    entriesOf: entriesOf,
    entryLine: entryLine,
    entriesLine: entriesLine,
    daysLeft: daysLeft,
    runStatusOf: runStatusOf,
    runStatusKey: runStatusKey,
    runTimeLine: runTimeLine,
    runTitleOf: runTitleOf,
    planRuns: planRuns,
    viewRows: viewRows,
    cleanEntries: cleanEntries,
    kindKey: kindKey,
    evidenceKey: evidenceKey,
    evidenceOf: evidenceOf,
    evidenceCount: evidenceCount,
    cleanEvidence: cleanEvidence,
    evidenceUpdated: evidenceUpdated,
    evidenceEntries: evidenceEntries,
    evidenceMaterials: evidenceMaterials,
    materialValid: materialValid,
    openableUrl: openableUrl,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
