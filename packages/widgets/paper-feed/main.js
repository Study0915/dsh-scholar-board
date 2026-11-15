/*
 * 文献追踪卡的脚本：把宿主解析好的 Atom feed 铺成一行一篇。
 *
 * 数据源是 http（format 为 atom）：宿主请求 arXiv 并把 XML 解析成对象推过来，entry、author、link、
 * category 都已是数组，属性带 `@_` 前缀。这里只做映射与截断，不联网（D3）。
 *
 * 前半份是不碰 DOM 的判定：文本与链接怎么从 Atom 条目里取、DOI 与 arXiv 主 id 怎么规范化、已有文献里
 * 哪一条算重复、链接能不能交给宿主打开、卡片该显示哪一种状态。它们挂在全局的 PaperFeed 上，单元测试
 * 读的是同一份实现。后半份才画画面，加入与查重的交互在 board-sync.js。
 *
 * 三种状态分开画：还没收到数据是「读取中」，收到一份空的 feed 是「这个订阅下没有新稿」，等了足够久
 * 仍没有数据就是「读不到 arXiv」。请求失败不会把空结果推到卡上，所以第三种状态由时间兜住（D11）。
 *
 * 行主体是按钮：点它把 abs 地址交给 `widget.open`，由包着它的页面在新标签页里打开（D26）。地址只认
 * arXiv 的 https 页面，外部内容给的任何别的地址都不做成按钮。
 */
;(function (root) {
  'use strict'

  /** 一张卡最多画多少篇。 */
  var LIMIT = 20

  /** 等这么久还没有数据，就把「读取中」换成一句可见的原因。 */
  var WAIT_MS = 15000

  /** 默认分类；与 widget.json 里 props schema 的默认值一致。 */
  var DEFAULT_CATEGORY = 'eess.SP'

  /** 只有 arXiv 的 https 页面能交给宿主打开：别的地址来自外部内容，不替它开。 */
  var OPENABLE = /^https:\/\/arxiv\.org\/(?:abs|pdf)\/[^\s]+$/i

  /** 一段 XML 文本节点读成字符串：解析器把只有文字的元素读成字符串，带属性时读成对象。 */
  function textOf(value) {
    if (typeof value === 'string') return value.trim()
    if (value !== null && typeof value === 'object' && typeof value['#text'] === 'string') return value['#text'].trim()
    return ''
  }

  function arrayOf(value) {
    return Array.isArray(value) ? value : []
  }

  function openable(url) {
    return typeof url === 'string' && OPENABLE.test(url)
  }

  /** 取 alternate 链接（abs 页）；没有时退回第一条带 href 的链接。 */
  function linkOf(entry) {
    if (entry === null || typeof entry !== 'object') return ''
    var links = arrayOf(entry.link)
    var alternate = ''
    var first = ''
    for (var index = 0; index < links.length; index += 1) {
      var href = typeof links[index]['@_href'] === 'string' ? links[index]['@_href'] : ''
      if (href === '') continue
      if (first === '') first = href
      if (alternate === '' && links[index]['@_rel'] === 'alternate') alternate = href
    }
    return alternate === '' ? first : alternate
  }

  function authorsOf(entry) {
    if (entry === null || typeof entry !== 'object') return ''
    var names = []
    var authors = arrayOf(entry.author)
    for (var index = 0; index < authors.length; index += 1) {
      var name = textOf(authors[index].name)
      if (name !== '') names.push(name)
    }
    return names.join(', ')
  }

  /** 提交日期只留日期那十个字符：时区与时刻在列表里读不出用处。 */
  function dateOf(entry) {
    if (entry === null || typeof entry !== 'object') return ''
    var published = textOf(entry.published)
    return published.length >= 10 ? published.slice(0, 10) : published
  }

  /** 分类取 props 里的值；空串与读不出来的值退回默认分类。 */
  function categoryOf(props) {
    var value = props !== null && typeof props === 'object' ? props.category : undefined
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_CATEGORY
  }

  /** 最多显示几篇：props 里的值收在 3 到 LIMIT 之间。 */
  function limitOf(props) {
    var value = props !== null && typeof props === 'object' ? props.limit : undefined
    if (typeof value !== 'number' || !isFinite(value)) return 8
    return Math.max(3, Math.min(LIMIT, Math.round(value)))
  }

  /**
   * 订阅的查询条件：props.query 优先，留空时按分类组成 `cat:<分类>`。
   *
   * 这与 widget.json 里 `query` 的默认值一致；旧卡片只写了 category 时仍读到原来那个分类。
   */
  function queryOf(props) {
    var value = props !== null && typeof props === 'object' ? props.query : undefined
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    var category = categoryOf(props)
    return category.indexOf(':') >= 0 ? category : 'cat:' + category
  }

  /** 订阅来源；现在只接 arXiv。 */
  function sourceOf(props) {
    var value = props !== null && typeof props === 'object' ? props.source : undefined
    return value === 'arxiv' ? 'arxiv' : 'arxiv'
  }

  /** 订阅名称；留空时是空串，画面退回卡片标题。 */
  function nameOf(props) {
    var value = props !== null && typeof props === 'object' ? props.name : undefined
    return typeof value === 'string' ? value.trim() : ''
  }

  /** 换订阅时用来判断手上那份数据还作不作数。 */
  function subscriptionKey(props) {
    return sourceOf(props) + '\u0000' + queryOf(props)
  }

  /** DOI 的比对形式：去掉地址前缀与大小写，形状不合法时是空串。 */
  function normalizeDoi(value) {
    if (typeof value !== 'string') return ''
    var text = value.trim()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
      .replace(/^doi:\s*/i, '')
      .replace(/[.,;\s]+$/, '')
    return /^10\.\d{4,9}\/\S+$/.test(text) ? text.toLowerCase() : ''
  }

  /** arXiv 地址或裸 id 里的主 id：去掉网址前缀、`.pdf` 与版本号。 */
  function arxivMainId(value) {
    if (typeof value !== 'string') return ''
    var text = value.trim().replace(/[?#].*$/, '')
    var at = text.search(/arxiv\.org\/(?:abs|pdf)\//i)
    if (at >= 0) text = text.slice(at).replace(/^arxiv\.org\/(?:abs|pdf)\//i, '')
    text = text.replace(/^\/+/, '').replace(/\.pdf$/i, '').replace(/v\d+$/i, '')
    if (/^\d{4}\.\d{4,5}$/.test(text)) return text
    if (/^[a-z-]+(?:\.[a-z-]+)?\/\d{7}$/i.test(text)) return text.toLowerCase()
    return ''
  }

  /** arXiv 版本号，例如 `v3`；地址里没有时是空串。 */
  function arxivVersionOf(value) {
    if (typeof value !== 'string') return ''
    var match = /v(\d+)(?:\.pdf)?$/i.exec(value.trim().replace(/[?#].*$/, ''))
    return match === null ? '' : 'v' + match[1]
  }

  /** 条目里的 DOI：arXiv 把正式发表版本的 DOI 放在 `arxiv:doi` 上。 */
  function doiOf(entry) {
    if (entry === null || typeof entry !== 'object') return ''
    return textOf(entry['arxiv:doi']) || textOf(entry.doi)
  }

  /** 条目对应的 arXiv 主 id 与版本：先看 `id`，再看链接。 */
  function arxivOf(entry) {
    if (entry === null || typeof entry !== 'object') return { id: '', version: '' }
    var candidates = [textOf(entry.id)]
    var links = arrayOf(entry.link)
    for (var index = 0; index < links.length; index += 1) {
      if (typeof links[index]['@_href'] === 'string') candidates.push(links[index]['@_href'])
    }
    var id = ''
    var version = ''
    for (var at = 0; at < candidates.length; at += 1) {
      var main = arxivMainId(candidates[at])
      if (main === '') continue
      if (id === '') {
        id = main
        version = arxivVersionOf(candidates[at])
      }
    }
    return { id: id, version: version }
  }

  /** 标题的比对形式：去掉空白与标点，只留文字与数字。 */
  function titleKey(title) {
    if (typeof title !== 'string') return ''
    return title.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '')
  }

  /** 两个字符串的二元组 Dice 系数，用来判断中英文标题是否相近。 */
  function diceOf(left, right) {
    if (left === right) return 1
    if (left.length < 2 || right.length < 2) return 0
    var counts = new Map()
    for (var index = 0; index < left.length - 1; index += 1) {
      var gram = left.slice(index, index + 2)
      counts.set(gram, (counts.get(gram) || 0) + 1)
    }
    var hits = 0
    for (var at = 0; at < right.length - 1; at += 1) {
      var pair = right.slice(at, at + 2)
      var left1 = counts.get(pair) || 0
      if (left1 > 0) {
        hits += 1
        counts.set(pair, left1 - 1)
      }
    }
    return (2 * hits) / (left.length + right.length - 2)
  }

  /** 标题相近的判定：两边都够长，且二元组重合到八成以上。 */
  function titleSimilar(left, right) {
    var a = titleKey(left)
    var b = titleKey(right)
    if (a.length < 8 || b.length < 8) return false
    return diceOf(a, b) >= 0.82
  }

  /** 来源地址的比对形式：去掉版本号，只看 abs 主地址。 */
  function urlKey(url) {
    return typeof url === 'string' ? url.trim().replace(/v\d+$/i, '') : ''
  }

  /**
   * 已有文献里与这一行重复或相近的记录。
   *
   * DOI 与 arXiv 主 id 是确定的重复；来源地址相同也算同一份；标题相近只作候选。
   * 回收站里的记录不参与——用户已经主动移走，不能挡住重新加入。
   *
   * @param {unknown} records - `records.read` 读回来的文献。
   * @param {unknown} row - 订阅里的一行。
   * @returns {Array<{ reason: string, record: object }>} 先确定重复，再标题候选。
   */
  function duplicatesOf(records, row) {
    if (!Array.isArray(records) || row === null || typeof row !== 'object') return []
    var doi = normalizeDoi(row.doi)
    var arxiv = arxivMainId(row.arxivId)
    var url = urlKey(row.url)
    var exact = []
    var similar = []
    for (var index = 0; index < records.length; index += 1) {
      var record = records[index]
      if (record === null || typeof record !== 'object' || typeof record.deletedAt === 'string') continue
      if (doi !== '' && normalizeDoi(record.doi) === doi) exact.push({ reason: 'doi', record: record })
      else if (arxiv !== '' && arxivMainId(record.arxivId) === arxiv) exact.push({ reason: 'arxiv', record: record })
      else if (url !== '' && urlKey(record.url) === url) exact.push({ reason: 'url', record: record })
      else if (titleSimilar(row.title, record.title)) similar.push({ reason: 'title', record: record })
    }
    return exact.concat(similar)
  }

  /** 预览里逐项对比的字段，顺序就是画出来的顺序。 */
  var COMPARE_FIELDS = [
    { key: 'title', label: 'fieldTitle' },
    { key: 'authors', label: 'fieldAuthors' },
    { key: 'venue', label: 'fieldVenue' },
    { key: 'year', label: 'fieldYear' },
    { key: 'doi', label: 'fieldDoi' },
    { key: 'arxivId', label: 'fieldArxiv' },
    { key: 'url', label: 'fieldUrl' }
  ]

  /** 一行订阅条目在记录里的字段值；空值统一成空串。 */
  function rowField(row, key) {
    if (key === 'year') return typeof row.year === 'number' ? String(row.year) : ''
    if (key === 'arxivId') return typeof row.arxivId === 'string' && row.arxivId !== '' ? row.arxivId + (typeof row.arxivVersion === 'string' ? row.arxivVersion : '') : ''
    var value = row !== null && typeof row === 'object' ? row[key] : undefined
    return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
  }

  /** 记录里的字段值；空值统一成空串。 */
  function recordField(record, key) {
    if (record === null || typeof record !== 'object') return ''
    if (key === 'arxivId') return typeof record.arxivId === 'string' && record.arxivId !== '' ? record.arxivId + (typeof record.arxivVersion === 'string' ? record.arxivVersion : '') : ''
    var value = record[key]
    return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
  }

  /**
   * 预览用的双方字段：现有记录在前，订阅这一行在后。
   *
   * @param {unknown} record - 已有文献。
   * @param {unknown} row - 订阅里的一行。
   * @returns {Array<{ label: string, current: string, next: string, missing: boolean }>} 对比行。
   */
  function comparisonOf(record, row) {
    var out = []
    for (var index = 0; index < COMPARE_FIELDS.length; index += 1) {
      var field = COMPARE_FIELDS[index]
      var current = recordField(record, field.key)
      var next = rowField(row, field.key)
      out.push({ label: field.label, current: current, next: next, missing: current === '' && next !== '' })
    }
    return out
  }

  /** 一条记录缺、而订阅这一行能补上的字段；没有可补的时是空对象。 */
  function missingPatchOf(record, row) {
    var patch = {}
    for (var index = 0; index < COMPARE_FIELDS.length; index += 1) {
      var key = COMPARE_FIELDS[index].key
      if (key === 'title' || key === 'url') continue
      var current = recordField(record, key)
      var next = rowField(row, key)
      if (current !== '' || next === '') continue
      if (key === 'year') patch.year = row.year
      else if (key === 'arxivId') {
        patch.arxivId = row.arxivId
        if (typeof row.arxivVersion === 'string' && row.arxivVersion !== '') patch.arxivVersion = row.arxivVersion
      } else patch[key] = next
    }
    if ((record === null || typeof record !== 'object' || !record.format) && typeof row.format === 'string' && row.format !== '') {
      patch.format = row.format
    }
    return patch
  }

  /**
   * 从 Atom 对象里读出要画的行。
   *
   * 没有标题的条目跳过；`limit` 之外的条目不再映射，省下不必要的 DOM 节点。
   *
   * @param {unknown} data - 宿主推来的 Atom 对象。
   * @param {unknown} props - 这张卡的 props。
   * @returns {Array<{ title: string, url: string, openable: boolean, venue: string, authors: string, date: string, year: number | null, summary: string, doi: string, arxivId: string, arxivVersion: string, format: string }>} 行。
   */
  function rowsOf(data, props) {
    var feed = data !== null && typeof data === 'object' && data.feed !== null && typeof data.feed === 'object' ? data.feed : {}
    var entries = arrayOf(feed.entry)
    var limit = limitOf(props)
    var rows = []
    for (var index = 0; index < entries.length && rows.length < limit; index += 1) {
      var entry = entries[index]
      if (entry === null || typeof entry !== 'object') continue
      var title = textOf(entry.title)
      if (title === '') continue
      var url = linkOf(entry)
      var arxiv = arxivOf(entry)
      rows.push({
        title: title,
        url: url,
        openable: openable(url),
        venue: 'arXiv',
        authors: authorsOf(entry),
        date: dateOf(entry),
        year: yearOfDate(dateOf(entry)),
        summary: textOf(entry.summary),
        doi: doiOf(entry),
        arxivId: arxiv.id,
        arxivVersion: arxiv.version,
        format: 'preprint'
      })
    }
    return rows
  }

  /**
   * 卡片现在该说哪一句。
   *
   * 收到过数据就按有没有行分「空分类」与「正常」；没收到数据时，等过头说读不到，否则还在读取。
   *
   * @param {{ data: unknown, failed: boolean, rowCount: number }} state - 卡片手上的事实。
   * @returns {string} `ready`、`empty`、`loading` 或 `failed`。
   */
  function stateOf(state) {
    if (state.data !== null && state.data !== undefined) return state.rowCount === 0 ? 'empty' : 'ready'
    return state.failed === true ? 'failed' : 'loading'
  }

  /** 提交日期里的年份；读不出来时是 null。 */
  function yearOfDate(date) {
    if (typeof date !== 'string' || date.length < 4) return null
    var year = Number(date.slice(0, 4))
    if (!isFinite(year) || Math.round(year) !== year || year < 1000 || year > 3000) return null
    return year
  }

  /**
   * 订阅条目变成一条文献记录：摘要留在订阅里，阅读阶段从「待读」开始。
   *
   * 只有能交给宿主打开的 arXiv 页面才转成记录：来源地址是这条记录唯一的出处。
   *
   * @param {unknown} row - `rowsOf` 画出来的一行。
   * @returns {object | null} 新建记录用的字段。
   */
  function recordOf(row) {
    if (row === null || typeof row !== 'object') return null
    var title = typeof row.title === 'string' ? row.title.trim() : ''
    if (title === '' || !openable(row.url)) return null
    var record = { kind: 'literature', title: title, url: row.url, venue: 'arXiv', stage: 'queued', format: 'preprint' }
    if (typeof row.authors === 'string' && row.authors !== '') record.authors = row.authors
    var year = typeof row.year === 'number' ? row.year : yearOfDate(row.date)
    if (year !== null) record.year = year
    if (typeof row.doi === 'string' && row.doi !== '') record.doi = row.doi
    if (typeof row.arxivId === 'string' && row.arxivId !== '') record.arxivId = row.arxivId
    if (typeof row.arxivVersion === 'string' && row.arxivVersion !== '') record.arxivVersion = row.arxivVersion
    return record
  }

  /**
   * 工作台里有没有同一个来源地址的活跃或归档文献。
   *
   * 回收站里的不算：那里的一条是用户主动移走的，不能挡住重新加入。
   *
   * @param {unknown} records - `records.read` 读回来的记录。
   * @param {unknown} url - 订阅条目的来源地址。
   * @returns {boolean} 是否已经在工作台里。
   */
  function alreadyAdded(records, url) {
    if (!Array.isArray(records) || typeof url !== 'string' || url === '') return false
    for (var index = 0; index < records.length; index += 1) {
      var record = records[index]
      if (record !== null && typeof record === 'object' && record.url === url && typeof record.deletedAt !== 'string') return true
    }
    return false
  }

  root.PaperFeed = {
    LIMIT: LIMIT,
    WAIT_MS: WAIT_MS,
    DEFAULT_CATEGORY: DEFAULT_CATEGORY,
    textOf: textOf,
    openable: openable,
    linkOf: linkOf,
    authorsOf: authorsOf,
    dateOf: dateOf,
    categoryOf: categoryOf,
    limitOf: limitOf,
    queryOf: queryOf,
    sourceOf: sourceOf,
    nameOf: nameOf,
    subscriptionKey: subscriptionKey,
    normalizeDoi: normalizeDoi,
    arxivMainId: arxivMainId,
    arxivVersionOf: arxivVersionOf,
    doiOf: doiOf,
    arxivOf: arxivOf,
    titleKey: titleKey,
    titleSimilar: titleSimilar,
    rowsOf: rowsOf,
    stateOf: stateOf,
    yearOfDate: yearOfDate,
    recordOf: recordOf,
    alreadyAdded: alreadyAdded,
    duplicatesOf: duplicatesOf,
    comparisonOf: comparisonOf,
    missingPatchOf: missingPatchOf
  }

  /* 下面这半要 DOM；单元测试在没有 DOM 的环境里载入这一份文件时停在这里。 */
  if (typeof document === 'undefined') return

  var card = document.querySelector('.paper-feed-card')
  if (card === null) return

  var widget = window.widget
  var props = {}
  var data = null
  var failed = false
  var timer = 0
  var sync = null
  /** 上一面订阅的查询条件：换过之后手上那份数据属于另一个订阅，要当没收到过。 */
  var shownSubscription = ''

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    rows: card.querySelector('[data-role="rows"]'),
    empty: card.querySelector('[data-role="empty"]'),
    status: card.querySelector('[data-role="status"]'),
    addAll: card.querySelector('[data-action="add-all"]')
  }

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function label(key, fallbackZh, fallbackEn) {
    if (widget === undefined) return isZh() ? fallbackZh : fallbackEn
    var value = widget.t(key)
    return value === key ? (isZh() ? fallbackZh : fallbackEn) : value
  }

  function write(node, value) {
    if (node !== null && node !== undefined) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function rowOf(row) {
    var wrapper = document.createElement('div')
    wrapper.className = 'paper-feed-card__row'
    var node = document.createElement(row.openable ? 'button' : 'div')
    node.className = 'paper-feed-card__open'
    if (row.openable) {
      node.type = 'button'
      node.dataset.url = row.url
      node.setAttribute('aria-label', (isZh() ? '打开 ' : 'Open ') + row.title)
    }
    var titleNode = document.createElement('span')
    titleNode.className = 'paper-feed-card__title'
    titleNode.textContent = row.title
    var byline = document.createElement('span')
    byline.className = 'paper-feed-card__byline'
    var authors = document.createElement('span')
    authors.className = 'paper-feed-card__authors'
    authors.textContent = row.authors
    var date = document.createElement('span')
    date.className = 'paper-feed-card__date'
    date.textContent = row.date
    byline.append(authors, date)
    node.append(titleNode, byline)
    if (row.summary !== '') {
      var summary = document.createElement('span')
      summary.className = 'paper-feed-card__summary'
      summary.textContent = row.summary
      node.append(summary)
    }
    wrapper.appendChild(node)
    if (row.openable) {
      var actions = document.createElement('div')
      actions.className = 'paper-feed-card__actions'
      var add = document.createElement('button')
      add.type = 'button'
      add.className = 'paper-feed-card__add'
      add.dataset.url = row.url
      add.textContent = label('addToBoard', '加入工作台', 'Add to board')
      actions.appendChild(add)
      wrapper.appendChild(actions)
    }
    return wrapper
  }

  function render() {
    var rows = rowsOf(data, props)
    el.rows.replaceChildren.apply(el.rows, rows.map(rowOf))
    var state = stateOf({ data: data, failed: failed, rowCount: rows.length })
    card.dataset.state = state
    // 有行时这一句是藏着的；仍写成空那一句，读屏与卡片上的文字不留下上一面的说法。
    write(el.empty, state === 'failed'
      ? label('failed', '读不到 arXiv', 'arXiv unavailable')
      : state === 'loading'
        ? label('loading', '读取 arXiv…', 'Reading arXiv…')
        : label('empty', '这个订阅下暂时没有新稿', 'No new submissions for this subscription'))
    el.rows.hidden = rows.length === 0
    el.empty.hidden = rows.length > 0
    var named = typeof props.title === 'string' && props.title.trim() !== '' ? props.title.trim() : nameOf(props)
    write(el.kicker, typeof props.kicker === 'string' && props.kicker.trim() !== '' ? props.kicker : label('kicker', 'arXiv 新稿', 'New on arXiv'))
    write(el.title, named !== '' ? named : label('title', '文献追踪', 'Paper feed'))
    write(el.meta, sourceOf(props) + ' · ' + queryOf(props) + ' · ' + rows.length + (isZh() ? ' 篇' : ' papers'))
    // 全新一面上没有旧预览的位置：数据或订阅换了，就把它收掉。
    if (sync !== null) sync.close()
    var canAddAll = widget !== undefined && typeof widget.call === 'function' && rows.length > 0
    if (el.addAll !== null) {
      el.addAll.hidden = !canAddAll
      if (!canAddAll) el.addAll.disabled = true
    }
  }

  function say(button, text, state) {
    button.textContent = text
    if (state === '') delete button.dataset.state
    else button.dataset.state = state
  }

  /**
   * 卡片底下那一行结果：批量进度与出错的原因写在这里，空串时收起来。
   *
   * @param {string} text - 要说的一句话。
   * @param {string} [tone] - 写 `failed` 时按出错的颜色说。
   */
  function writeStatus(text, tone) {
    if (el.status === null) return
    el.status.textContent = text
    el.status.hidden = text === ''
    if (tone === 'failed') el.status.dataset.tone = 'failed'
    else delete el.status.dataset.tone
  }

  /** 失败四下后把按钮恢复成「加入工作台」，可以再试。 */
  function resetButton(button) {
    window.setTimeout(function () {
      if (button.dataset.state !== 'failed' || button.disabled) return
      say(button, label('addToBoard', '加入工作台', 'Add to board'), '')
    }, 4000)
  }

  /** 组件文案；宿主没有给出这一条时退回键名。 */
  function text(key) {
    if (widget === undefined) return key
    var value = widget.t(key)
    return value === key ? key : value
  }

  sync = root.createPaperFeedSync({
    card: card,
    widget: widget,
    pure: root.PaperFeed,
    t: text,
    say: say,
    status: writeStatus,
    reset: resetButton,
    rows: function () { return rowsOf(data, props) },
    rowsRoot: el.rows
  })

  el.rows.addEventListener('click', function (event) {
    var target = event.target
    if (!(target instanceof Element)) return
    var add = target.closest('.paper-feed-card__add')
    if (add !== null) {
      if (sync !== null && typeof add.dataset.url === 'string') sync.add(add.dataset.url, add)
      return
    }
    var open = target.closest('.paper-feed-card__open')
    if (open === null || open.dataset.url === undefined) return
    var url = open.dataset.url
    if (!openable(url)) return
    if (widget !== undefined && typeof widget.open === 'function') widget.open(url)
  })

  /**
   * 换一份等待：手上这一份数据不再属于这一面，卡片回到「读取中」。
   *
   * 保存了新分类之后宿主会按新分类读一次；那一次回来之前，旧分类的行留在卡上就成了「这一面现在的结果」。
   */
  function restartWait() {
    data = null
    failed = false
    window.clearTimeout(timer)
    timer = window.setTimeout(function () {
      if (data !== null) return
      failed = true
      render()
    }, WAIT_MS)
  }

  if (widget !== undefined) {
    widget.onProps(function (source) {
      var next = source !== null && typeof source === 'object' ? source : {}
      if (shownSubscription !== '' && subscriptionKey(next) !== shownSubscription) restartWait()
      props = next
      shownSubscription = subscriptionKey(props)
      render()
    })
    widget.onData(function (source) {
      data = source !== null && typeof source === 'object' ? source : null
      if (data !== null) {
        failed = false
        shownSubscription = subscriptionKey(props)
        window.clearTimeout(timer)
      }
      render()
    })
  }

  props = widget === undefined || widget.props === null || typeof widget.props !== 'object' ? {} : widget.props
  data = widget === undefined || widget.data === null || typeof widget.data !== 'object' ? null : widget.data
  shownSubscription = subscriptionKey(props)
  render()
  // 数据可能在本脚本注册监听之前就到了；那一次会在 onData 里清掉这个计时器。
  timer = window.setTimeout(function () {
    if (data !== null) return
    failed = true
    render()
  }, WAIT_MS)
})(globalThis)
