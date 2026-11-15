/*
 * 文献阅读卡的不碰 DOM 判定：阅读阶段、标识、阅读条目、摘要、视图过滤、年份与材料地址。
 *
 * 挂在全局的 LiteratureRecords 上；单元测试按副作用模块载入这一份，读的是卡片真正在用的实现。
 * 摘要只取用户写的理解与问题：订阅条目自带的摘要不代表读懂（领域术语）。
 * 阅读条目记录实际读到的位置，阶段由用户自己改；读了两节不等于全文已读。
 */
;(function (root) {
  'use strict'

  var KIND = 'literature'
  var STAGES = ['queued', 'reading', 'understood']
  var FORMATS = ['preprint', 'published', 'other']
  var READING_FIELDS = ['location', 'note', 'understanding', 'questions', 'reproduce']
  var DAY = 86400000
  var DRAFT_DELAY = 700
  var LOAD_TIMEOUT = 4000

  /** 记录里的阶段：不认识的值按待读算。 */
  function stageOf(record) {
    if (record === null || typeof record !== 'object') return 'queued'
    return STAGES.indexOf(record.stage) >= 0 ? record.stage : 'queued'
  }

  /** 阶段对应的文案键。 */
  function stageKey(stage) {
    return stage === 'reading' ? 'stageReading' : stage === 'understood' ? 'stageUnderstood' : 'stageQueued'
  }

  /** 标识与正式稿件类型：不认识的值按未填算。 */
  function formatOf(record) {
    if (record === null || typeof record !== 'object') return ''
    return FORMATS.indexOf(record.format) >= 0 ? record.format : ''
  }

  /** 正式稿件类型的文案键。 */
  function formatKey(format) {
    return format === 'preprint' ? 'formatPreprint' : format === 'published' ? 'formatPublished' : 'formatOther'
  }

  /** 一段非空文字；不是文字或空白时是空串。 */
  function fieldText(record, field) {
    if (record === null || typeof record !== 'object') return ''
    var value = record[field]
    return typeof value === 'string' ? value.trim() : ''
  }

  /** 一行的标识：先写 DOI，没有 DOI 时写 arXiv id 与版本，都没有时是空串。 */
  function identifierLine(record) {
    var doi = fieldText(record, 'doi')
    if (doi !== '') return 'DOI ' + doi
    var arxivId = fieldText(record, 'arxivId')
    if (arxivId === '') return ''
    return 'arXiv ' + arxivId + fieldText(record, 'arxivVersion')
  }

  /** 阅读条目的日期按 `YYYY-MM-DD` 显示；读不出来的日期不显示。 */
  function dateText(due) {
    if (due === null || typeof due !== 'object') return ''
    if (due.kind === 'date' && typeof due.date === 'string') return due.date
    if (due.kind === 'instant' && typeof due.at === 'string' && due.at.length >= 10) return due.at.slice(0, 10)
    return ''
  }

  /** 浏览器当前的 IANA 时区；读不出来时用 UTC。 */
  function zoneOf() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch (error) {
      return 'UTC'
    }
  }

  /** 日期输入与阅读条目里的 `{ kind: 'date' }` 互转。 */
  function dateValue(text, timeZone) {
    return typeof text === 'string' && text !== ''
      ? { kind: 'date', date: text, timeZone: typeof timeZone === 'string' && timeZone !== '' ? timeZone : 'UTC' }
      : null
  }

  /** 今天的本地日期，写成 `YYYY-MM-DD`。 */
  function todayText(now) {
    var date = new Date(typeof now === 'number' ? now : Date.now())
    var month = String(date.getMonth() + 1)
    var day = String(date.getDate())
    return String(date.getFullYear()) + '-' + (month.length < 2 ? '0' + month : month) + '-' + (day.length < 2 ? '0' + day : day)
  }

  /** 阅读条目按稳定 id 与文字整理；缺 id 的条目丢掉。 */
  function readingOf(record) {
    if (record === null || typeof record !== 'object' || !Array.isArray(record.reading)) return []
    var out = []
    for (var at = 0; at < record.reading.length; at += 1) {
      var entry = record.reading[at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.id !== 'string' || entry.id === '') continue
      var copy = { id: entry.id, date: dateText(entry.at) }
      for (var fieldAt = 0; fieldAt < READING_FIELDS.length; fieldAt += 1) {
        var field = READING_FIELDS[fieldAt]
        copy[field] = typeof entry[field] === 'string' ? entry[field] : ''
      }
      if (typeof entry.actionId === 'string' && entry.actionId !== '') copy.actionId = entry.actionId
      out.push(copy)
    }
    return out
  }

  /** 一条阅读条目的摘要：位置优先，其次笔记与理解。 */
  function readingTitle(entry) {
    if (entry === null || typeof entry !== 'object') return ''
    for (var at = 0; at < READING_FIELDS.length; at += 1) {
      var value = typeof entry[READING_FIELDS[at]] === 'string' ? entry[READING_FIELDS[at]].trim() : ''
      if (value !== '') return value.replace(/\s+/g, ' ')
    }
    return ''
  }

  /** 阅读条目的摘要与日期的地址行；都没有时是空串。 */
  function readingLine(entry) {
    var title = readingTitle(entry)
    var date = typeof entry.date === 'string' ? entry.date : ''
    if (title === '') return date
    return date === '' ? title : date + ' · ' + title
  }

  /**
   * 编辑中的阅读条目变成记录字段：空文字去掉，全部为空时是 `null`。
   *
   * @param {unknown} entries - 编辑面板里的条目。
   * @param {string} timeZone - 日期用的 IANA 时区。
   * @returns {Array<object> | null} 记录里的 `reading`。
   */
  function readingValue(entries, timeZone) {
    if (!Array.isArray(entries)) return null
    var out = []
    for (var at = 0; at < entries.length; at += 1) {
      var entry = entries[at]
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.id !== 'string' || entry.id === '') continue
      var copy = { id: entry.id }
      for (var fieldAt = 0; fieldAt < READING_FIELDS.length; fieldAt += 1) {
        var field = READING_FIELDS[fieldAt]
        var value = typeof entry[field] === 'string' ? entry[field].trim() : ''
        if (value !== '') copy[field] = value
      }
      var due = dateValue(typeof entry.date === 'string' ? entry.date : '', timeZone)
      if (due !== null) copy.at = due
      if (typeof entry.actionId === 'string' && entry.actionId !== '') copy.actionId = entry.actionId
      out.push(copy)
    }
    return out.length === 0 ? null : out
  }

  /** 列表的一行摘要：理解优先，没有理解时用问题，压成一行。 */
  function snippetOf(record) {
    if (record === null || typeof record !== 'object') return ''
    var source = typeof record.understanding === 'string' && record.understanding !== '' ? record.understanding : record.questions
    if (typeof source !== 'string' || source === '') return ''
    return source.replace(/\s+/g, ' ').trim()
  }

  /** 作者、期刊与年份一行；都没有时是空串。 */
  function metaOf(record) {
    if (record === null || typeof record !== 'object') return ''
    var parts = []
    if (typeof record.authors === 'string' && record.authors !== '') parts.push(record.authors)
    if (typeof record.venue === 'string' && record.venue !== '') parts.push(record.venue)
    if (typeof record.year === 'number' && isFinite(record.year)) parts.push(String(record.year))
    return parts.join(' · ')
  }

  /** 回收站里还剩几天：不认识的 deletedAt 不给倒计时。 */
  function daysLeft(record, now) {
    if (record === null || typeof record !== 'object' || typeof record.deletedAt !== 'string') return null
    var stamp = Date.parse(record.deletedAt)
    if (isNaN(stamp)) return null
    return Math.max(0, Math.ceil((stamp + 30 * DAY - (typeof now === 'number' ? now : Date.now())) / DAY))
  }

  /** 一个视图里的行：先按回收与归档状态筛，再按阶段筛，按最近更新从新到旧。 */
  function viewRows(records, view, stage) {
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
      if (view === 'active' && typeof stage === 'string' && STAGES.indexOf(stage) >= 0 && stageOf(record) !== stage) continue
      rows.push(record)
    }
    rows.sort(function (left, right) {
      return String(right.updatedAt).localeCompare(String(left.updatedAt))
    })
    return rows
  }

  /** 材料地址只收 http/https 的完整地址，说明不能是空的。 */
  function materialValid(url, title) {
    if (typeof title !== 'string' || title.trim() === '') return false
    return openableUrl(url)
  }

  /** 材料的来源：显式 kind 优先，旧记录按 url 与 path 推断。 */
  function materialKindOf(material) {
    if (material === null || typeof material !== 'object') return ''
    if (material.kind === 'web' || material.kind === 'local') return material.kind
    if (typeof material.url === 'string' && material.url !== '') return 'web'
    if (typeof material.path === 'string' && material.path !== '') return 'local'
    return ''
  }

  /**
   * 本地路径只当文本：长度有限、没有控制字符，也不是 `scheme:` 形式。
   *
   * 这里不检查文件是否存在——卡片不扫描磁盘，路径只是给人看的引用。
   */
  function localPathValid(path) {
    if (typeof path !== 'string') return false
    var text = path.trim()
    if (text === '' || text.length > 1024) return false
    if (/[\u0000-\u001f\u007f]/.test(text)) return false
    return !/^[A-Za-z][A-Za-z0-9+.-]+:/.test(text)
  }

  /** 一份材料的校验结果；空串表示通过，否则是文案键。 */
  function materialProblem(material) {
    if (material === null || typeof material !== 'object') return 'materialInvalid'
    if (typeof material.title !== 'string' || material.title.trim() === '') return 'materialInvalid'
    var kind = materialKindOf(material)
    if (kind === 'web') {
      if (!openableUrl(material.url)) return 'materialInvalid'
      return material.path === undefined || material.path === null || material.path === '' ? '' : 'materialInvalid'
    }
    if (kind === 'local') {
      if (!localPathValid(material.path)) return 'materialPathInvalid'
      return material.url === undefined || material.url === null || material.url === '' ? '' : 'materialInvalid'
    }
    return 'materialInvalid'
  }

  /** 可选日期按 `YYYY-MM-DD`；空串表示未填，其它形状不合法。 */
  function dateTextValid(text) {
    if (typeof text !== 'string' || text.trim() === '') return true
    return /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) && !isNaN(Date.parse(text.trim()))
  }

  /**
   * 添加材料时的输入变成记录里的材料引用：空字段不出现，网页与本地各留各的坐标。
   *
   * @param {object} input - `{ kind, url, path, title, purpose, device, version, checkedAt }`。
   * @param {number} now - 生成 id 用的时刻。
   * @param {number} index - 同一时刻的序号。
   * @returns {object | null} 材料；输入不合法时是 `null`。
   */
  function materialDraft(input, now, index) {
    if (input === null || typeof input !== 'object') return null
    var kind = input.kind === 'local' ? 'local' : 'web'
    var title = typeof input.title === 'string' ? input.title.trim() : ''
    var material = { id: 'm-' + String(now) + '-' + String(index), kind: kind, title: title }
    if (kind === 'web') material.url = typeof input.url === 'string' ? input.url.trim() : ''
    else material.path = typeof input.path === 'string' ? input.path.trim() : ''
    var purpose = typeof input.purpose === 'string' ? input.purpose.trim() : ''
    if (purpose !== '') material.purpose = purpose
    if (kind === 'local') {
      var device = typeof input.device === 'string' ? input.device.trim() : ''
      if (device !== '') material.device = device
    }
    var version = typeof input.version === 'string' ? input.version.trim() : ''
    if (version !== '') material.version = version
    var checkedAt = typeof input.checkedAt === 'string' ? input.checkedAt.trim() : ''
    if (checkedAt !== '' && dateTextValid(checkedAt)) material.checkedAt = checkedAt
    return materialProblem(material) === '' ? material : null
  }

  /** 材料记在哪台设备；没记设备时是空串。 */
  function materialDevice(material) {
    if (material === null || typeof material !== 'object') return ''
    return typeof material.device === 'string' ? material.device.trim() : ''
  }

  /** 这条本地材料是不是属于另一台设备；没有设备标签时不做判断。 */
  function deviceMismatch(material, device) {
    if (materialKindOf(material) !== 'local') return false
    var recorded = materialDevice(material)
    var current = typeof device === 'string' ? device.trim() : ''
    return recorded !== '' && current !== '' && recorded !== current
  }

  /** 一条材料的标题行；标题为空时退回路径或地址。 */
  function materialTitleOf(material) {
    if (material === null || typeof material !== 'object') return ''
    if (typeof material.title === 'string' && material.title.trim() !== '') return material.title.trim()
    var kind = materialKindOf(material)
    return kind === 'local' ? String(material.path || '') : String(material.url || '')
  }

  /** 一条材料的补充说明：用途、版本、设备与核查日期，有的才写。 */
  function materialMetaOf(material) {
    if (material === null || typeof material !== 'object') return ''
    var parts = []
    if (typeof material.purpose === 'string' && material.purpose !== '') parts.push(material.purpose)
    if (typeof material.version === 'string' && material.version !== '') parts.push('v' + material.version)
    if (materialKindOf(material) === 'local' && materialDevice(material) !== '') parts.push(materialDevice(material))
    if (typeof material.checkedAt === 'string' && material.checkedAt !== '') parts.push(material.checkedAt)
    return parts.join(' · ')
  }

  /** 外部来源：同一库同一条目只留最新的一份，最多四份。 */
  function externalWith(list, ref) {
    var out = Array.isArray(list) ? list.filter(function (entry) { return entry !== null && typeof entry === 'object' }).slice() : []
    if (ref === null || typeof ref !== 'object') return out
    var key = String(ref.library) + '\u0000' + String(ref.itemKey)
    out = out.filter(function (entry) {
      return String(entry.library) + '\u0000' + String(entry.itemKey) !== key
    })
    out.push(ref)
    return out.slice(-4)
  }

  /** 导入的 Zotero 条目变成一条外部来源。 */
  function zoteroExternal(library, item) {
    if (item === null || typeof item !== 'object' || typeof item.key !== 'string') return null
    return {
      provider: 'zotero',
      library: String(library),
      itemKey: item.key,
      apiVersion: '3',
      fetchedAt: new Date().toISOString()
    }
  }

  /** 外部来源的一行说明：Zotero 库与条目 key。 */
  function externalLine(ref) {
    if (ref === null || typeof ref !== 'object' || ref.provider !== 'zotero') return ''
    return 'Zotero · ' + String(ref.library) + ' · ' + String(ref.itemKey)
  }

  /** 一条 Zotero 条目的字段：与文献卡的表单同名，空值给空串。 */
  function zoteroFields(item) {
    if (item === null || typeof item !== 'object') return null
    return {
      title: typeof item.title === 'string' ? item.title : '',
      authors: Array.isArray(item.authors) ? item.authors.join(', ') : '',
      venue: typeof item.venue === 'string' ? item.venue : '',
      year: typeof item.year === 'number' ? String(item.year) : '',
      url: typeof item.url === 'string' ? item.url : '',
      doi: typeof item.doi === 'string' ? item.doi : ''
    }
  }

  /** 候选元数据的一行：当前值与候选值相同、冲突还是空缺。 */
  function adoptionState(value, current) {
    var candidate = typeof value === 'string' ? value.trim() : ''
    var existing = typeof current === 'string' ? current.trim() : ''
    if (candidate === '') return ''
    if (existing === '') return 'empty'
    return existing === candidate ? 'same' : 'conflict'
  }

  /**
   * DOI 候选的逐字段采用视图：标题、作者、出处、年份与来源地址。
   *
   * 只列候选里有的字段；笔记、阅读记录与材料不在其中，补入时碰不到。
   *
   * @param {object} candidate - 宿主回来的候选。
   * @param {object} current - 表单当前值。
   * @returns {Array<object>} 每一行的字段、候选值、当前值与状态。
   */
  function doiAdoption(candidate, current) {
    if (candidate === null || typeof candidate !== 'object') return []
    var values = current !== null && typeof current === 'object' ? current : {}
    var fields = [
      { field: 'title', label: 'fieldTitle', value: typeof candidate.title === 'string' ? candidate.title : '' },
      { field: 'authors', label: 'authors', value: Array.isArray(candidate.authors) ? candidate.authors.join(', ') : '' },
      { field: 'venue', label: 'venue', value: typeof candidate.venue === 'string' ? candidate.venue : '' },
      { field: 'year', label: 'year', value: typeof candidate.year === 'number' ? String(candidate.year) : '' },
      { field: 'url', label: 'sourceUrl', value: typeof candidate.url === 'string' ? candidate.url : '' }
    ]
    var out = []
    for (var at = 0; at < fields.length; at += 1) {
      var row = fields[at]
      var state = adoptionState(row.value, values[row.field])
      if (state === '') continue
      out.push({ field: row.field, label: row.label, value: row.value.trim(), current: typeof values[row.field] === 'string' ? values[row.field].trim() : '', state: state })
    }
    return out
  }

  /** 来源地址只收 http/https 的完整地址；空串表示未填。 */
  function openableUrl(url) {
    if (typeof url !== 'string' || url === '') return false
    try {
      return /^https?:$/.test(new URL(url).protocol)
    } catch (error) {
      return false
    }
  }

  /** 年份输入读成整数；空串表示未填，越界或不是整数时是 null。 */
  function yearValue(text) {
    if (typeof text !== 'string' || text.trim() === '') return { ok: true, value: null }
    var value = Number(text)
    if (!isFinite(value) || Math.round(value) !== value || value < 1000 || value > 3000) return { ok: false, value: null }
    return { ok: true, value: value }
  }

  /** 文案里的 `{name}` 替换。 */
  function fill(text, values) {
    var out = text
    for (var name in values) {
      if (Object.prototype.hasOwnProperty.call(values, name)) out = out.split('{' + name + '}').join(String(values[name]))
    }
    return out
  }

  root.LiteratureRecords = {
    KIND: KIND,
    STAGES: STAGES,
    FORMATS: FORMATS,
    READING_FIELDS: READING_FIELDS,
    DAY: DAY,
    DRAFT_DELAY: DRAFT_DELAY,
    LOAD_TIMEOUT: LOAD_TIMEOUT,
    stageOf: stageOf,
    stageKey: stageKey,
    formatOf: formatOf,
    formatKey: formatKey,
    identifierLine: identifierLine,
    dateText: dateText,
    dateValue: dateValue,
    todayText: todayText,
    zoneOf: zoneOf,
    readingOf: readingOf,
    readingTitle: readingTitle,
    readingLine: readingLine,
    readingValue: readingValue,
    snippetOf: snippetOf,
    metaOf: metaOf,
    daysLeft: daysLeft,
    viewRows: viewRows,
    materialValid: materialValid,
    materialKindOf: materialKindOf,
    localPathValid: localPathValid,
    materialProblem: materialProblem,
    dateTextValid: dateTextValid,
    materialDraft: materialDraft,
    materialDevice: materialDevice,
    deviceMismatch: deviceMismatch,
    materialTitleOf: materialTitleOf,
    materialMetaOf: materialMetaOf,
    externalWith: externalWith,
    zoteroExternal: zoteroExternal,
    externalLine: externalLine,
    zoteroFields: zoteroFields,
    doiAdoption: doiAdoption,
    openableUrl: openableUrl,
    yearValue: yearValue,
    fill: fill
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
