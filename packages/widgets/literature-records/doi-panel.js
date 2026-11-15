/*
 * 文献阅读卡的 DOI 补全面板：按 DOI 查 Crossref，把候选字段逐项摆出来由人选择。
 *
 * 只补标题、作者、出处、年份与来源地址；理解、问题、阅读记录与材料不在候选里，补入时碰不到。
 * 当前已有内容与候选不同的字段标成「替换」，由人点了才改；空着的字段点一下补入。查询在宿主完成
 * （组件拿不到网络），来源与查询时间写在候选上方。
 */
;(function (root) {
  'use strict'

  /**
   * 建 DOI 面板。
   *
   * @param {object} ctx - 节点、文案、当前表单值与写回表单的回调。
   * @returns {object} 面板对外的动作。
   */
  root.createLiteratureDoiPanel = function (ctx) {
    var widget = ctx.widget
    var live = ctx.live
    var t = ctx.t
    var pure = ctx.pure
    var nodes = ctx.nodes
    var DOI = 'literature.doi'
    var rows = []
    var queriedAt = ''
    var querying = false

    /** 查询时间按本地时间写；读不出来时原样给。 */
    function atText(value) {
      if (typeof value !== 'string') return ''
      var stamp = Date.parse(value)
      if (isNaN(stamp)) return value
      try {
        return new Date(stamp).toLocaleString()
      } catch (error) {
        return value
      }
    }

    function clear() {
      rows = []
      if (nodes.doiCandidates !== null) {
        nodes.doiCandidates.replaceChildren()
        nodes.doiCandidates.hidden = true
      }
    }

    function reset() {
      clear()
      if (nodes.doiStatus !== null) nodes.doiStatus.textContent = ''
    }

    function label(key) {
      return t(key)
    }

    /** 一行采用按钮：已经一致的不再可点，冲突的写「替换」。 */
    function rowOf(entry) {
      var row = document.createElement('div')
      row.className = 'lt__doi-field'
      row.dataset.state = entry.state
      var name = document.createElement('span')
      name.className = 'lt__doi-name'
      name.textContent = label(entry.label)
      var value = document.createElement('span')
      value.className = 'lt__doi-value'
      value.textContent = entry.value
      var action = document.createElement('button')
      action.type = 'button'
      action.className = 'lt__ghost lt__doi-adopt'
      action.dataset.field = entry.field
      action.textContent = entry.state === 'same' ? t('doiSame') : entry.state === 'conflict' ? t('doiReplace') : t('doiAdopt')
      action.disabled = entry.state === 'same'
      row.append(name, value, action)
      if (entry.state === 'conflict') {
        var current = document.createElement('span')
        current.className = 'lt__doi-current'
        current.textContent = pure.fill(t('doiCurrent'), { value: entry.current })
        row.appendChild(current)
      }
      return row
    }

    /** 一份候选：来源、查询时间与逐字段的采用按钮。 */
    function candidateOf(candidate, queriedAt) {
      var card = document.createElement('article')
      card.className = 'lt__doi-candidate'
      var head = document.createElement('p')
      head.className = 'lt__doi-source'
      head.textContent = pure.fill(t('doiSource'), { source: 'Crossref', at: atText(queriedAt) })
      card.appendChild(head)
      var adopted = pure.doiAdoption(candidate, ctx.current())
      if (adopted.length === 0) {
        var empty = document.createElement('p')
        empty.className = 'lt__hint'
        empty.textContent = t('doiNoNewFields')
        card.appendChild(empty)
        return card
      }
      for (var at = 0; at < adopted.length; at += 1) card.appendChild(rowOf(adopted[at]))
      return card
    }

    function render(result) {
      clear()
      if (nodes.doiCandidates === null) return
      var candidates = Array.isArray(result.candidates) ? result.candidates : []
      rows = candidates.filter(function (entry) { return entry !== null && typeof entry === 'object' })
      queriedAt = typeof result.queriedAt === 'string' ? result.queriedAt : ''
      var cards = []
      for (var at = 0; at < rows.length; at += 1) {
        cards.push(candidateOf(rows[at], queriedAt))
      }
      nodes.doiCandidates.replaceChildren.apply(nodes.doiCandidates, cards)
      nodes.doiCandidates.hidden = cards.length === 0
      if (nodes.doiStatus !== null) {
        nodes.doiStatus.textContent = cards.length === 0 ? t('doiNoNewFields') : t('doiChooseFields')
      }
    }

    function errorText(result) {
      if (result.status === 'invalid') return t('doiInvalid') + '：' + String(result.reason || '')
      if (result.status === 'not-found') return t('doiNotFound')
      if (result.status === 'limited') {
        return typeof result.retryAfter === 'string' && result.retryAfter !== ''
          ? pure.fill(t('doiLimitedAfter'), { after: result.retryAfter })
          : t('doiLimited')
      }
      return t('doiFailed') + (typeof result.reason === 'string' && result.reason !== '' ? '：' + result.reason : '')
    }

    function lookup() {
      if (!live || querying) return
      var doi = nodes.doiInput.value.trim()
      if (doi === '') {
        if (nodes.doiStatus !== null) nodes.doiStatus.textContent = t('doiRequired')
        return
      }
      var args = { doi: doi }
      var props = widget.props !== null && typeof widget.props === 'object' ? widget.props : {}
      if (typeof props.crossrefMailto === 'string' && props.crossrefMailto.trim() !== '') args.mailto = props.crossrefMailto.trim()
      querying = true
      if (nodes.doiLookup !== null) {
        nodes.doiLookup.disabled = true
        nodes.doiLookup.textContent = t('doiQuerying')
      }
      if (nodes.doiStatus !== null) nodes.doiStatus.textContent = t('doiQuerying')
      widget.call(DOI, args).then(function (result) {
        querying = false
        if (nodes.doiLookup !== null) {
          nodes.doiLookup.disabled = false
          nodes.doiLookup.textContent = t('lookupDoi')
        }
        var value = result !== null && typeof result === 'object' ? result : { status: 'failed', reason: '' }
        if (value.status === 'ready') {
          render(value)
          return
        }
        clear()
        if (nodes.doiStatus !== null) nodes.doiStatus.textContent = errorText(value)
      }, function (error) {
        querying = false
        if (nodes.doiLookup !== null) {
          nodes.doiLookup.disabled = false
          nodes.doiLookup.textContent = t('lookupDoi')
        }
        clear()
        if (nodes.doiStatus !== null) {
          nodes.doiStatus.textContent = t('doiFailed') + '：' + (error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error))
        }
      })
    }

    /** 采用某一行的候选值；只改表单里对应的那一项。 */
    function adopt(field, index) {
      var candidate = rows[index]
      if (candidate === null || typeof candidate !== 'object') return
      var adopted = pure.doiAdoption(candidate, ctx.current())
      for (var at = 0; at < adopted.length; at += 1) {
        if (adopted[at].field !== field) continue
        ctx.apply(field, adopted[at].value)
        render({ candidates: rows, queriedAt: queriedAt })
        return
      }
    }

    if (nodes.doiCandidates !== null) {
      nodes.doiCandidates.addEventListener('click', function (event) {
        var target = event.target
        if (!(target instanceof Element)) return
        var button = target.closest('.lt__doi-adopt')
        if (button === null) return
        var card = button.closest('.lt__doi-candidate')
        if (card === null) return
        var cards = Array.prototype.slice.call(nodes.doiCandidates.querySelectorAll('.lt__doi-candidate'))
        adopt(button.getAttribute('data-field'), cards.indexOf(card))
      })
    }

    return { lookup: lookup, reset: reset }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)