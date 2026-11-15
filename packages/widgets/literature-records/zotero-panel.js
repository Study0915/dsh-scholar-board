/*
 * 文献阅读卡的 Zotero 导入面板：连本机 Zotero 本地 API，选文库与分类、预览条目、补入元数据。
 *
 * 连接由卡片设置里的开关手动打开（props.zoteroEnabled）；关着时这里不发请求，只说明去哪里打开。
 * 只读：不写回 Zotero、不读它的数据库文件。导入只补空着的字段，已有的标题、笔记与阅读记录不动；
 * 导入成功后把库、条目 key 与接口版本记进记录的外部来源，供以后核对。
 */
;(function (root) {
  'use strict'

  /**
   * 建 Zotero 面板。
   *
   * @param {object} ctx - 节点、文案、当前表单值、设备标签与导入回调。
   * @returns {object} 面板对外的动作。
   */
  root.createLiteratureZoteroPanel = function (ctx) {
    var widget = ctx.widget
    var live = ctx.live
    var t = ctx.t
    var pure = ctx.pure
    var nodes = ctx.nodes
    var ZOTERO = 'literature.zotero'
    var library = '0'
    var items = []
    var selected = null
    var loading = false

    function enabled() {
      var props = widget.props !== null && typeof widget.props === 'object' ? widget.props : {}
      return props.zoteroEnabled === true
    }

    function deviceLabel() {
      var value = typeof ctx.deviceOf === 'function' ? String(ctx.deviceOf() || '') : ''
      return value !== '' ? value : t('deviceUnknown')
    }

    function setStatus(message, tone) {
      if (nodes.zoteroStatus === null) return
      nodes.zoteroStatus.textContent = message
      nodes.zoteroStatus.dataset.tone = tone || 'neutral'
    }

    function setNote(message) {
      if (nodes.zoteroNote !== null) nodes.zoteroNote.textContent = message
    }

    function setEnabledControls(on) {
      var controls = [nodes.zoteroLibrary, nodes.zoteroCollection, nodes.zoteroSearch, nodes.zoteroSearchGo]
      for (var at = 0; at < controls.length; at += 1) {
        if (controls[at] !== null && controls[at] !== undefined) controls[at].disabled = !on
      }
      if (nodes.zoteroImport !== null) nodes.zoteroImport.disabled = true
    }

    function show() {
      if (nodes.zotero === null) return
      if (typeof nodes.zotero.showModal === 'function') {
        if (!nodes.zotero.open) nodes.zotero.showModal()
      } else {
        nodes.zotero.setAttribute('open', '')
      }
    }

    function close() {
      if (nodes.zotero === null) return
      if (typeof nodes.zotero.close === 'function') nodes.zotero.close()
      else nodes.zotero.removeAttribute('open')
    }

    function messageFor(result) {
      if (result.status === 'disabled') return t('zoteroDisabled')
      if (result.status === 'offline') return t('zoteroOffline')
      if (result.status === 'forbidden') return t('zoteroForbidden')
      if (result.status === 'timeout') return t('zoteroTimeout')
      if (result.status === 'not-found') return t('zoteroNotFound')
      return t('zoteroFailed') + (typeof result.reason === 'string' && result.reason !== '' ? '：' + result.reason : '')
    }

    function call(op, extra) {
      var args = { op: op, enabled: true, library: library }
      if (extra !== null && typeof extra === 'object') {
        for (var name in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, name)) args[name] = extra[name]
        }
      }
      return widget.call(ZOTERO, args)
    }

    function setLibraries(list) {
      if (nodes.zoteroLibrary === null) return
      var options = []
      for (var at = 0; at < list.length; at += 1) {
        var entry = list[at]
        if (entry === null || typeof entry !== 'object' || typeof entry.library !== 'string') continue
        var option = document.createElement('option')
        option.value = entry.library
        option.textContent = typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.library
        options.push(option)
      }
      if (options.length === 0) return
      nodes.zoteroLibrary.replaceChildren.apply(nodes.zoteroLibrary, options)
      nodes.zoteroLibrary.value = library
    }

    function setCollections(list) {
      if (nodes.zoteroCollection === null) return
      var all = document.createElement('option')
      all.value = ''
      all.textContent = t('zoteroAllCollections')
      var options = [all]
      for (var at = 0; at < list.length; at += 1) {
        var entry = list[at]
        if (entry === null || typeof entry !== 'object' || typeof entry.key !== 'string') continue
        var option = document.createElement('option')
        option.value = entry.key
        option.textContent = typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.key
        options.push(option)
      }
      nodes.zoteroCollection.replaceChildren.apply(nodes.zoteroCollection, options)
      nodes.zoteroCollection.value = ''
    }

    function itemMeta(item) {
      var parts = []
      if (Array.isArray(item.authors) && item.authors.length > 0) parts.push(item.authors.join(', '))
      if (typeof item.venue === 'string' && item.venue !== '') parts.push(item.venue)
      if (typeof item.year === 'number') parts.push(String(item.year))
      if (typeof item.doi === 'string' && item.doi !== '') parts.push('DOI ' + item.doi)
      return parts.join(' · ')
    }

    function renderItems() {
      if (nodes.zoteroItems === null) return
      var rows = []
      for (var at = 0; at < items.length; at += 1) {
        var item = items[at]
        if (item === null || typeof item !== 'object' || typeof item.key !== 'string') continue
        var row = document.createElement('button')
        row.type = 'button'
        row.className = 'lt__zotero-item'
        row.dataset.key = item.key
        row.setAttribute('aria-pressed', selected !== null && selected.key === item.key ? 'true' : 'false')
        var title = document.createElement('span')
        title.className = 'lt__zotero-title'
        title.textContent = typeof item.title === 'string' && item.title !== '' ? item.title : item.key
        row.appendChild(title)
        var meta = itemMeta(item)
        if (meta !== '') {
          var line = document.createElement('span')
          line.className = 'lt__zotero-meta'
          line.textContent = meta
          row.appendChild(line)
        }
        rows.push(row)
      }
      nodes.zoteroItems.replaceChildren.apply(nodes.zoteroItems, rows)
      if (rows.length === 0) setStatus(t('zoteroEmpty'), 'neutral')
    }

    function previewOf(item) {
      if (nodes.zoteroPreview === null) return
      var fields = pure.zoteroFields(item)
      if (fields === null) {
        nodes.zoteroPreview.replaceChildren()
        nodes.zoteroPreview.hidden = true
        return
      }
      var current = ctx.current()
      var merge = mergeOf(fields, current)
      var rows = []
      var labels = { title: 'fieldTitle', authors: 'authors', venue: 'venue', year: 'year', doi: 'doi', url: 'sourceUrl' }
      var order = ['title', 'authors', 'venue', 'year', 'doi', 'url']
      for (var at = 0; at < order.length; at += 1) {
        var name = order[at]
        var value = fields[name]
        if (typeof value !== 'string' || value === '') continue
        var row = document.createElement('div')
        row.className = 'lt__zotero-field'
        var label = document.createElement('span')
        label.className = 'lt__doi-name'
        label.textContent = t(labels[name])
        var text = document.createElement('span')
        text.className = 'lt__doi-value'
        text.textContent = value
        row.append(label, text)
        if (merge.skipped.indexOf(name) >= 0) {
          var skip = document.createElement('span')
          skip.className = 'lt__doi-current'
          skip.textContent = t('zoteroKept')
          row.appendChild(skip)
        }
        rows.push(row)
      }
      nodes.zoteroPreview.replaceChildren.apply(nodes.zoteroPreview, rows)
      nodes.zoteroPreview.hidden = rows.length === 0
      if (nodes.zoteroImport !== null) nodes.zoteroImport.disabled = rows.length === 0
      setStatus(pure.fill(t('zoteroPreview'), { applied: merge.applied.length, kept: merge.skipped.length }), 'neutral')
    }

    /** 导入时会补入哪些、会保留哪些：只补空着的字段。 */
    function mergeOf(fields, current) {
      var applied = []
      var skipped = []
      var order = ['title', 'authors', 'venue', 'year', 'doi', 'url']
      for (var at = 0; at < order.length; at += 1) {
        var name = order[at]
        var value = typeof fields[name] === 'string' ? fields[name].trim() : ''
        if (value === '') continue
        var existing = typeof current[name] === 'string' ? current[name].trim() : ''
        if (existing === '') applied.push(name)
        else skipped.push(name)
      }
      return { applied: applied, skipped: skipped }
    }

    function select(item) {
      selected = item
      previewOf(item)
      if (nodes.zoteroItems === null) return
      var rows = nodes.zoteroItems.querySelectorAll('.lt__zotero-item')
      for (var at = 0; at < rows.length; at += 1) {
        var on = rows[at].getAttribute('data-key') === item.key
        rows[at].setAttribute('aria-pressed', on ? 'true' : 'false')
      }
    }

    function loadItems() {
      if (!live || loading) return
      loading = true
      setStatus(t('zoteroLoading'), 'neutral')
      var extra = { limit: 25 }
      if (nodes.zoteroCollection !== null && nodes.zoteroCollection.value !== '') extra.collection = nodes.zoteroCollection.value
      if (nodes.zoteroSearch !== null && nodes.zoteroSearch.value.trim() !== '') extra.q = nodes.zoteroSearch.value.trim()
      call('items', extra).then(function (result) {
        loading = false
        var value = result !== null && typeof result === 'object' ? result : { status: 'failed', reason: '' }
        if (value.status !== 'ready') {
          items = []
          selected = null
          renderItems()
          setStatus(messageFor(value), value.status === 'offline' ? 'error' : 'neutral')
          return
        }
        items = Array.isArray(value.items) ? value.items : []
        selected = null
        if (nodes.zoteroPreview !== null) {
          nodes.zoteroPreview.replaceChildren()
          nodes.zoteroPreview.hidden = true
        }
        if (nodes.zoteroImport !== null) nodes.zoteroImport.disabled = true
        renderItems()
        if (items.length > 0) setStatus('', 'neutral')
      }, function (error) {
        loading = false
        items = []
        selected = null
        renderItems()
        setStatus(t('zoteroFailed') + '：' + (error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error)), 'error')
      })
    }

    function loadCollections() {
      if (!live) return
      call('collections').then(function (result) {
        var value = result !== null && typeof result === 'object' ? result : { status: 'failed', reason: '' }
        if (value.status !== 'ready') {
          setCollections([])
          return
        }
        setCollections(Array.isArray(value.collections) ? value.collections : [])
      }, function () {
        setCollections([])
      })
    }

    function loadLibraries() {
      if (!live) {
        setNote(t('zoteroNoHost'))
        setStatus(t('zoteroNoHost'), 'error')
        return
      }
      setStatus(t('zoteroConnecting'), 'neutral')
      call('libraries').then(function (result) {
        var value = result !== null && typeof result === 'object' ? result : { status: 'failed', reason: '' }
        if (value.status !== 'ready') {
          setStatus(messageFor(value), value.status === 'offline' ? 'error' : 'neutral')
          return
        }
        setLibraries(Array.isArray(value.libraries) ? value.libraries : [])
        loadCollections()
        loadItems()
      }, function (error) {
        setStatus(t('zoteroFailed') + '：' + (error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error)), 'error')
      })
    }

    function open() {
      if (nodes.zotero === null) return
      selected = null
      items = []
      if (nodes.zoteroPreview !== null) {
        nodes.zoteroPreview.replaceChildren()
        nodes.zoteroPreview.hidden = true
      }
      if (nodes.zoteroItems !== null) nodes.zoteroItems.replaceChildren()
      setStatus('', 'neutral')
      if (!enabled()) {
        setNote(pure.fill(t('zoteroDisabledNote'), { device: deviceLabel() }))
        setEnabledControls(false)
        show()
        return
      }
      setNote(pure.fill(t('zoteroNote'), { device: deviceLabel() }))
      setEnabledControls(true)
      show()
      loadLibraries()
    }

    function importSelected() {
      if (selected === null || !live) return
      var fields = pure.zoteroFields(selected)
      if (fields === null) return
      var merge = mergeOf(fields, ctx.current())
      if (merge.applied.length === 0) {
        setStatus(t('zoteroNothingToFill'), 'neutral')
        return
      }
      ctx.onImport(selected, library, fields)
      setStatus(pure.fill(t('zoteroImported'), { applied: merge.applied.length, kept: merge.skipped.length }), 'ok')
      close()
    }

    if (nodes.zoteroItems !== null) {
      nodes.zoteroItems.addEventListener('click', function (event) {
        var target = event.target
        if (!(target instanceof Element)) return
        var row = target.closest('.lt__zotero-item')
        if (row === null) return
        var key = row.getAttribute('data-key')
        for (var at = 0; at < items.length; at += 1) {
          if (items[at] !== null && typeof items[at] === 'object' && items[at].key === key) {
            select(items[at])
            return
          }
        }
      })
    }
    if (nodes.zoteroSearchGo !== null) nodes.zoteroSearchGo.addEventListener('click', function () { loadItems() })
    if (nodes.zoteroSearch !== null) {
      nodes.zoteroSearch.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault()
          loadItems()
        }
      })
    }
    if (nodes.zoteroCollection !== null) nodes.zoteroCollection.addEventListener('change', function () { loadItems() })
    if (nodes.zoteroImport !== null) nodes.zoteroImport.addEventListener('click', function () { importSelected() })

    return { open: open, close: close, loadItems: loadItems }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)