/*
 * 横向项目卡里的需求、需求变更与追溯链：不碰 DOM 的判定。
 *
 * 需求版本只增不改历史；交付物建立时记下当时的需求版本，需求升到新版本后旧交付仍按旧版本判验收。
 * 这里不判断合同履约，也不管审批与经费；模板只给常见的六个出厂形状，不收合同金额与客户细节。
 */
;(function (root) {
  'use strict'

  var model = root.ProjectRecords
  var STATUSES = ['pending', 'confirmed', 'cancelled']
  var MAX_REQUIREMENTS = 100
  var MAX_CHANGES = 200
  var NO_LENGTH = 40
  var METRIC_LENGTH = 200
  var UNIT_LENGTH = 32
  var THRESHOLD_LENGTH = 400
  var METHOD_LENGTH = 1000
  var CONFIRM_LENGTH = 200
  var TEMPLATES = ['tplAlgorithm', 'tplSimulation', 'tplPrototype', 'tplTestReport', 'tplTechnical', 'tplDemo']
  var TEMPLATE_SHAPES = {
    tplAlgorithm: { title: '算法实现', metric: '相对基线提升', unit: '%', threshold: '不低于 10', testMethod: '同一数据与随机种子下跑三组对照，保留日志与结果表' },
    tplSimulation: { title: '仿真验证', metric: '可复现实验数', unit: '个', threshold: '至少 3 组', testMethod: '固定版本与参数，记录运行脚本、输入与输出摘要' },
    tplPrototype: { title: '原型软件', metric: '主流程通过', unit: '项', threshold: '全部通过', testMethod: '按操作步骤逐项走查，记录问题与修复结果' },
    tplTestReport: { title: '测试报告', metric: '用例通过率', unit: '%', threshold: '100', testMethod: '列出用例、环境与结论；失败的用例保留待补事项' },
    tplTechnical: { title: '技术报告', metric: '评审结论', unit: '', threshold: '通过内部评审', testMethod: '按章节核对方法、结果与限制，评审意见留在沟通结论' },
    tplDemo: { title: '演示材料', metric: '演示流程', unit: '步', threshold: '完整走通', testMethod: '照最终用户路径演示一遍，记录卡点' }
  }

  function inList(list, value) {
    return typeof value === 'string' && list.indexOf(value) >= 0
  }

  /** 需求状态的文案键。 */
  function requirementKey(status) {
    return status === 'confirmed' ? 'requirementConfirmed' : status === 'cancelled' ? 'requirementCancelled' : 'requirementPending'
  }

  function isRequirementStatus(status) {
    return inList(STATUSES, status)
  }

  /** 需求：要有 id、标题、版本与认识的状态。 */
  function requirementsOf(record) {
    var list = record !== null && typeof record === 'object' && Array.isArray(record.requirements) ? record.requirements : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var entry = list[at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.id !== 'string' || entry.id === '') continue
      if (model.textOf(entry.title) === '' || model.textOf(entry.version) === '' || !isRequirementStatus(entry.status)) continue
      out.push(entry)
    }
    return out
  }

  /** 需求变更：要有 id、需求 id、前后版本与原因。 */
  function changesOf(record) {
    var list = record !== null && typeof record === 'object' && Array.isArray(record.requirementChanges) ? record.requirementChanges : []
    var out = []
    for (var at = 0; at < list.length; at += 1) {
      var entry = list[at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.id !== 'string' || entry.id === '') continue
      if (typeof entry.requirementId !== 'string' || entry.requirementId === '') continue
      if (model.textOf(entry.fromVersion) === '' || model.textOf(entry.toVersion) === '') continue
      if (model.textOf(entry.reason) === '') continue
      out.push(entry)
    }
    return out
  }

  function requirementOf(record, id) {
    var list = requirementsOf(record)
    for (var at = 0; at < list.length; at += 1) if (list[at].id === id) return list[at]
    return null
  }

  function changesFor(record, id) {
    var list = changesOf(record)
    var out = []
    for (var at = 0; at < list.length; at += 1) if (list[at].requirementId === id) out.push(list[at])
    return out
  }

  /** 需求的一行字：编号、标题与版本。 */
  function requirementLine(requirement) {
    if (requirement === null || typeof requirement !== 'object') return ''
    var no = model.textOf(requirement.no)
    var title = model.textOf(requirement.title)
    var version = model.textOf(requirement.version)
    return (no === '' ? '' : no + ' · ') + title + ' · ' + version
  }

  /** 下一个版本号：末尾数字加一，没有数字时补一个 2。 */
  function nextVersion(version) {
    var text = model.textOf(version)
    var match = /^(.*?)(\d+)$/.exec(text)
    if (match === null) return text === '' ? '2' : text + ' 2'
    return match[1] + String(Number(match[2]) + 1)
  }

  /** 六个出厂模板；只给形状，不给合同金额或客户细节。 */
  function templates() {
    var out = []
    for (var at = 0; at < TEMPLATES.length; at += 1) out.push(Object.assign({ key: TEMPLATES[at] }, TEMPLATE_SHAPES[TEMPLATES[at]]))
    return out
  }

  /** 需求下的来源记录：只收带 kind 与 id 的对象。 */
  function sourcesOfValue(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    var seen = {}
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') return null
      var kind = model.textOf(row.kind)
      var id = model.linkOf(row.id)
      var key = kind + ':' + id
      if (kind === '' || id === '' || seen[key] === true) return null
      seen[key] = true
      out.push({ kind: kind, id: id })
    }
    return out
  }

  function linkedTasksOfValue(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    var seen = {}
    for (var at = 0; at < list.length; at += 1) {
      var id = model.linkOf(list[at])
      if (id === '') return null
      if (seen[id] === true) return null
      seen[id] = true
      out.push(id)
    }
    return out
  }

  /**
   * 需求：编号、标题、版本、状态必填；描述、口径、来源、材料与关联事项可留空。
   *
   * @param {Array} rows - 需求行。
   * @returns {Array|null} 归一后的需求；有问题时是 null。
   */
  function cleanRequirements(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    var seen = {}
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') return null
      var title = model.labelOf(row.title, model.TITLE_LENGTH)
      var version = model.labelOf(row.version, model.VERSION_LENGTH)
      if (title === null || version === null || !isRequirementStatus(row.status)) return null
      var id = model.linkOf(row.id)
      if (id === '' || seen[id] === true) return null
      seen[id] = true
      var entry = { id: id, title: title, version: version, status: row.status }
      var no = model.noteOf(row.no, NO_LENGTH)
      if (no === null) return null
      if (no !== '') entry.no = no
      var fields = { description: model.TEXT_LENGTH, metric: METRIC_LENGTH, unit: UNIT_LENGTH, threshold: THRESHOLD_LENGTH, testMethod: METHOD_LENGTH }
      for (var name in fields) {
        if (!Object.prototype.hasOwnProperty.call(fields, name)) continue
        var text = model.noteOf(row[name], fields[name])
        if (text === null) return null
        if (text !== '') entry[name] = text
      }
      var sources = sourcesOfValue(row.sources)
      if (sources === null) return null
      if (sources.length > 0) entry.sources = sources
      var materials = model.materialsOfValue(row.materials, 'rm')
      if (materials === null) return null
      if (materials.length > 0) entry.materials = materials
      var tasks = linkedTasksOfValue(row.tasks)
      if (tasks === null) return null
      if (tasks.length > 0) entry.tasks = tasks
      var actionId = model.linkOf(row.actionId)
      if (actionId !== '') entry.actionId = actionId
      out.push(entry)
      if (out.length > MAX_REQUIREMENTS) return null
    }
    return out
  }

  /**
   * 需求变更：需求 id、前后版本与原因必填；日期、影响、沟通依据与确认情况可留空。
   *
   * @param {Array} rows - 变更行。
   * @returns {Array|null} 归一后的变更；有问题时是 null。
   */
  function cleanChanges(rows) {
    var list = Array.isArray(rows) ? rows : []
    var out = []
    var seen = {}
    for (var at = 0; at < list.length; at += 1) {
      var row = list[at]
      if (row === null || typeof row !== 'object') return null
      var requirementId = model.linkOf(row.requirementId)
      var fromVersion = model.labelOf(row.fromVersion, model.VERSION_LENGTH)
      var toVersion = model.labelOf(row.toVersion, model.VERSION_LENGTH)
      var reason = model.labelOf(row.reason, model.TEXT_LENGTH)
      if (requirementId === '' || fromVersion === null || toVersion === null || reason === null) return null
      var id = model.linkOf(row.id)
      if (id === '' || seen[id] === true) return null
      seen[id] = true
      var entry = { id: id, requirementId: requirementId, fromVersion: fromVersion, toVersion: toVersion, reason: reason }
      var when = model.dueOf(row, 'at')
      if (when === null) return null
      if (when !== undefined) entry.at = when
      var fields = { impact: model.TEXT_LENGTH, communication: model.TEXT_LENGTH, confirmation: CONFIRM_LENGTH }
      for (var name in fields) {
        if (!Object.prototype.hasOwnProperty.call(fields, name)) continue
        var text = model.noteOf(row[name], fields[name])
        if (text === null) return null
        if (text !== '') entry[name] = text
      }
      out.push(entry)
      if (out.length > MAX_CHANGES) return null
    }
    return out
  }

  /**
   * 应用一次需求变更：改需求版本，留下变更记录；旧交付物不动。
   *
   * @param {Array} requirements - 当前需求行。
   * @param {object} change - `{ requirementId, toVersion, ... }`。
   * @returns {{ requirements: Array, change: object }|null} 新需求与补全后的变更；需求不在时是 null。
   */
  function applyChange(requirements, change) {
    var list = Array.isArray(requirements) ? requirements : []
    var found = null
    var next = list.map(function (requirement) {
      if (requirement === null || typeof requirement !== 'object' || requirement.id !== change.requirementId) return requirement
      found = requirement
      return Object.assign({}, requirement, { version: change.toVersion })
    })
    if (found === null) return null
    return {
      requirements: next,
      change: Object.assign({}, change, { fromVersion: found.version, toVersion: change.toVersion })
    }
  }

  /** 交付物绑定过的需求版本；建立后不再随需求升版变化。 */
  function boundVersions(deliverable, requirementId) {
    var list = deliverable !== null && typeof deliverable === 'object' && Array.isArray(deliverable.requirements) ? deliverable.requirements : []
    for (var at = 0; at < list.length; at += 1) {
      if (list[at] !== null && typeof list[at] === 'object' && list[at].id === requirementId) return model.textOf(list[at].version)
    }
    return ''
  }

  /** 一条交付物的验收结论：最近一次、通过与未通过的次数。 */
  function acceptanceState(deliverable) {
    var list = deliverable !== null && typeof deliverable === 'object' && Array.isArray(deliverable.acceptances) ? deliverable.acceptances : []
    var passed = 0
    var failed = 0
    var last = null
    for (var at = 0; at < list.length; at += 1) {
      var entry = list[at]
      if (entry === null || typeof entry !== 'object') continue
      if (entry.passed === true) passed += 1
      else failed += 1
      last = entry
    }
    return { passed: passed, failed: failed, last: last }
  }

  /** 缺交付依据的需求：被事项或交付物引用却不在清单里。 */
  function missingReferences(record) {
    var known = {}
    var list = requirementsOf(record)
    for (var at = 0; at < list.length; at += 1) known[list[at].id] = true
    var missing = []
    function check(id) {
      if (typeof id !== 'string' || id === '' || known[id] === true) return
      if (missing.indexOf(id) < 0) missing.push(id)
    }
    var tasks = Array.isArray(record !== null && typeof record === 'object' && record.tasks) ? record.tasks : []
    for (var taskAt = 0; taskAt < tasks.length; taskAt += 1) check(tasks[taskAt] !== null && typeof tasks[taskAt] === 'object' ? tasks[taskAt].requirement : '')
    var deliverables = Array.isArray(record !== null && typeof record === 'object' && record.deliverables) ? record.deliverables : []
    for (var dAt = 0; dAt < deliverables.length; dAt += 1) {
      var refs = deliverables[dAt] !== null && typeof deliverables[dAt] === 'object' && Array.isArray(deliverables[dAt].requirements) ? deliverables[dAt].requirements : []
      for (var refAt = 0; refAt < refs.length; refAt += 1) check(refs[refAt] !== null && typeof refs[refAt] === 'object' ? refs[refAt].id : '')
    }
    var changes = changesOf(record)
    for (var cAt = 0; cAt < changes.length; cAt += 1) check(changes[cAt].requirementId)
    return missing
  }

  /**
   * 追溯链：需求 → 事项 → 测试报告 → 交付物 → 验收。
   *
   * @param {object} record - 一条项目记录。
   * @param {string} requirementId - 需求 id。
   * @returns {object|null} 链；需求不在时是 null。
   */
  function chainOf(record, requirementId) {
    var requirement = requirementOf(record, requirementId)
    if (requirement === null) return null
    var tasks = []
    var missingTasks = []
    var allTasks = Array.isArray(record.tasks) ? record.tasks : []
    var byId = {}
    for (var at = 0; at < allTasks.length; at += 1) {
      var task = allTasks[at]
      if (task !== null && typeof task === 'object' && typeof task.id === 'string') byId[task.id] = task
    }
    var linked = Array.isArray(requirement.tasks) ? requirement.tasks : []
    for (var linkAt = 0; linkAt < linked.length; linkAt += 1) {
      if (byId[linked[linkAt]] === undefined) missingTasks.push(linked[linkAt])
      else tasks.push(byId[linked[linkAt]])
    }
    for (var taskAt = 0; taskAt < allTasks.length; taskAt += 1) {
      var entry = allTasks[taskAt]
      if (entry !== null && typeof entry === 'object' && entry.requirement === requirementId && tasks.indexOf(entry) < 0) tasks.push(entry)
    }
    var deliveries = []
    var allDeliverables = Array.isArray(record.deliverables) ? record.deliverables : []
    for (var dAt = 0; dAt < allDeliverables.length; dAt += 1) {
      var deliverable = allDeliverables[dAt]
      if (deliverable === null || typeof deliverable !== 'object') continue
      var version = boundVersions(deliverable, requirementId)
      if (version === '') continue
      deliveries.push({ deliverable: deliverable, version: version, acceptance: acceptanceState(deliverable) })
    }
    return { requirement: requirement, tasks: tasks, missingTasks: missingTasks, deliveries: deliveries, changes: changesFor(record, requirementId) }
  }

  /** 需求进度：确认多少、交付多少、验收通过多少。 */
  function requirementProgress(record) {
    var list = requirementsOf(record)
    var confirmed = 0
    var cancelled = 0
    for (var at = 0; at < list.length; at += 1) {
      if (list[at].status === 'confirmed') confirmed += 1
      if (list[at].status === 'cancelled') cancelled += 1
    }
    var accepted = 0
    var delivered = 0
    var allDeliverables = Array.isArray(record !== null && typeof record === 'object' && record.deliverables) ? record.deliverables : []
    for (var dAt = 0; dAt < allDeliverables.length; dAt += 1) {
      var deliverable = allDeliverables[dAt]
      if (deliverable === null || typeof deliverable !== 'object') continue
      if (deliverable.status === 'delivered' || deliverable.status === 'accepted') delivered += 1
      if (deliverable.status === 'accepted' || acceptanceState(deliverable).passed > 0) accepted += 1
    }
    return { total: list.length, confirmed: confirmed, cancelled: cancelled, delivered: delivered, accepted: accepted }
  }

  /** 一行交付物的依据：需求版本、测试报告与验收次数。 */
  function evidenceLine(deliverable, text) {
    var refs = deliverable !== null && typeof deliverable === 'object' && Array.isArray(deliverable.requirements) ? deliverable.requirements : []
    var parts = []
    for (var at = 0; at < refs.length; at += 1) {
      if (refs[at] !== null && typeof refs[at] === 'object') parts.push(model.textOf(refs[at].version))
    }
    var reports = deliverable !== null && typeof deliverable === 'object' && Array.isArray(deliverable.testReports) ? deliverable.testReports.length : 0
    if (reports > 0) parts.push(text.fill(text.t('testReportsCount'), { n: reports }))
    var state = acceptanceState(deliverable)
    if (state.passed + state.failed > 0) parts.push(text.fill(text.t('acceptanceCount'), { passed: state.passed, failed: state.failed }))
    return parts.join(' · ')
  }

  /** 冻结一份材料快照：交付时把测试报告与材料按引用记下来。 */
  function freezeOf(deliverable, date, id) {
    if (deliverable === null || typeof deliverable !== 'object') return null
    var materials = []
    var reports = Array.isArray(deliverable.testReports) ? deliverable.testReports : []
    var own = Array.isArray(deliverable.materials) ? deliverable.materials : []
    for (var at = 0; at < reports.length; at += 1) materials.push(reports[at])
    for (var ownAt = 0; ownAt < own.length; ownAt += 1) materials.push(own[ownAt])
    if (materials.length === 0) return null
    return { at: { kind: 'date', date: date, timeZone: model.zone() }, materials: materials }
  }

  var api = {
    REQUIREMENT_STATUSES: STATUSES,
    MAX_REQUIREMENTS: MAX_REQUIREMENTS,
    MAX_CHANGES: MAX_CHANGES,
    requirementKey: requirementKey,
    isRequirementStatus: isRequirementStatus,
    requirementsOf: requirementsOf,
    changesOf: changesOf,
    requirementOf: requirementOf,
    changesFor: changesFor,
    requirementLine: requirementLine,
    nextVersion: nextVersion,
    templates: templates,
    cleanRequirements: cleanRequirements,
    cleanChanges: cleanChanges,
    applyChange: applyChange,
    boundVersions: boundVersions,
    acceptanceState: acceptanceState,
    missingReferences: missingReferences,
    chainOf: chainOf,
    requirementProgress: requirementProgress,
    evidenceLine: evidenceLine,
    freezeOf: freezeOf
  }
  for (var key in api) {
    if (Object.prototype.hasOwnProperty.call(api, key)) model[key] = api[key]
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
