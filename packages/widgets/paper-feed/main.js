/*
 * 文献追踪卡的脚本：把宿主解析好的 Atom feed 铺成一行一篇。
 *
 * 数据源是 http（format 为 atom）：宿主请求 arXiv 并把 XML 解析成对象推过来，entry、author、link、
 * category 都已是数组，属性带 `@_` 前缀。这里只做映射与截断，不联网（D3）。
 *
 * 前半份是不碰 DOM 的判定：文本与链接怎么从 Atom 条目里取、链接能不能交给宿主打开、卡片该显示哪一种
 * 状态。它们挂在全局的 PaperFeed 上，单元测试读的是同一份实现。后半份才画画面。
 *
 * 三种状态分开画：还没收到数据是「读取中」，收到一份空的 feed 是「这个分类下没有新稿」，等了足够久
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
   * 从 Atom 对象里读出要画的行。
   *
   * 没有标题的条目跳过；`limit` 之外的条目不再映射，省下不必要的 DOM 节点。
   *
   * @param {unknown} data - 宿主推来的 Atom 对象。
   * @param {unknown} props - 这张卡的 props。
   * @returns {Array<{ title: string, url: string, openable: boolean, authors: string, date: string, summary: string }>} 行。
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
      rows.push({
        title: title,
        url: url,
        openable: openable(url),
        authors: authorsOf(entry),
        date: dateOf(entry),
        summary: textOf(entry.summary)
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
    var record = { kind: 'literature', title: title, url: row.url, venue: 'arXiv', stage: 'queued' }
    if (typeof row.authors === 'string' && row.authors !== '') record.authors = row.authors
    var year = yearOfDate(row.date)
    if (year !== null) record.year = year
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
    rowsOf: rowsOf,
    stateOf: stateOf,
    yearOfDate: yearOfDate,
    recordOf: recordOf,
    alreadyAdded: alreadyAdded
  }

  /* 下面这半要 DOM；单元测试在没有 DOM 的环境里载入这一份文件时停在这里。 */
  if (typeof document === 'undefined') return

  var card = document.querySelector('.paper-feed-card')
  if (card === null) return

  var widget = window.widget
  var READ = 'widget-board:records.read'
  var WRITE = 'widget-board:records.write'
  var props = {}
  var data = null
  var failed = false
  var timer = 0
  /** 上一面看的分类：换过之后手上那份数据属于另一个分类，要当没收到过。 */
  var shownCategory = ''

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    rows: card.querySelector('[data-role="rows"]'),
    empty: card.querySelector('[data-role="empty"]')
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
        : label('empty', '这个分类下暂时没有新稿', 'No new submissions in this category'))
    el.rows.hidden = rows.length === 0
    el.empty.hidden = rows.length > 0
    var category = categoryOf(props)
    write(el.kicker, typeof props.kicker === 'string' && props.kicker.trim() !== '' ? props.kicker : label('kicker', 'arXiv 新稿', 'New on arXiv'))
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : label('title', '文献追踪', 'Paper feed'))
    write(el.meta, category + ' · ' + rows.length + (isZh() ? ' 篇' : ' papers'))
  }

  /** 按来源地址找回这一面正在画的那一行。 */
  function rowByUrl(url) {
    var rows = rowsOf(data, props)
    for (var index = 0; index < rows.length; index += 1) {
      if (rows[index].url === url) return rows[index]
    }
    return null
  }

  function say(button, text, state) {
    button.textContent = text
    if (state === '') delete button.dataset.state
    else button.dataset.state = state
  }

  /**
   * 把一行订阅条目加入工作台：先查同一地址的文献，没有才新建。
   *
   * 加入之后按钮停在结果上，不再重复提交；失败四下后恢复成「加入工作台」，可以再试。
   *
   * @param {string} url - 订阅条目的来源地址。
   * @param {HTMLButtonElement} button - 这一行的加入按钮。
   */
  function addToBoard(url, button) {
    if (widget === undefined || typeof widget.call !== 'function' || button.disabled) return
    var record = recordOf(rowByUrl(url))
    if (record === null) return
    button.disabled = true
    button.setAttribute('aria-busy', 'true')
    widget.call(READ, { kind: 'literature', includeArchived: true }).then(function (view) {
      var records = view !== null && typeof view === 'object' && Array.isArray(view.records) ? view.records : []
      if (alreadyAdded(records, url)) {
        say(button, label('alreadyInBoard', '已在工作台', 'Already on the board'), 'done')
        return null
      }
      return widget.call(WRITE, { op: 'create', record: record }).then(function () {
        say(button, label('addedToBoard', '已加入', 'Added'), 'done')
      })
    }).catch(function () {
      say(button, label('addFailed', '加入失败', 'Could not add'), 'failed')
      button.disabled = false
      window.setTimeout(function () {
        if (button.dataset.state !== 'failed') return
        say(button, label('addToBoard', '加入工作台', 'Add to board'), '')
      }, 4000)
    }).then(function () {
      button.removeAttribute('aria-busy')
    })
  }

  el.rows.addEventListener('click', function (event) {
    var target = event.target
    if (!(target instanceof Element)) return
    var add = target.closest('.paper-feed-card__add')
    if (add !== null) {
      if (typeof add.dataset.url === 'string') addToBoard(add.dataset.url, add)
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
      if (shownCategory !== '' && categoryOf(next) !== shownCategory) restartWait()
      props = next
      shownCategory = categoryOf(props)
      render()
    })
    widget.onData(function (source) {
      data = source !== null && typeof source === 'object' ? source : null
      if (data !== null) {
        failed = false
        shownCategory = categoryOf(props)
        window.clearTimeout(timer)
      }
      render()
    })
  }

  props = widget === undefined || widget.props === null || typeof widget.props !== 'object' ? {} : widget.props
  data = widget === undefined || widget.data === null || typeof widget.data !== 'object' ? null : widget.data
  shownCategory = categoryOf(props)
  render()
  // 数据可能在本脚本注册监听之前就到了；那一次会在 onData 里清掉这个计时器。
  timer = window.setTimeout(function () {
    if (data !== null) return
    failed = true
    render()
  }, WAIT_MS)
})(globalThis)
