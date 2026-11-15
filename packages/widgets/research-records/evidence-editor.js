/*
 * 研究结论的证据引用：选择来源记录、冻结引用时的修订号，并可选到条目与材料。
 *
 * 引用版本与当前版本不同时只提示「来源已更新」，不改写冻结的修订号；来源缺失、回收站与归档都只标记。
 * 读取与打开都走组件的公开能力，单独的块由 editor.js 建出来，保存仍随研究记录一起提交。
 */
;(function (root) {
  'use strict'

  var model = root.ResearchRecords
  var READ = 'widget-board:records.read'
  var OPEN = 'widget-board:records.open'
  var SEARCH_DELAY = 250

  /**
   * 建证据引用面板。
   *
   * @param {object} ctx - 组件能力、文案、容器与变更回调。
   * @returns {object} 取值、载入、重读与只读切换。
   */
  root.createResearchEvidence = function (ctx) {
    var widget = ctx.widget
    var live = ctx.live
    var t = ctx.t
    var app = ctx.app
    var container = ctx.container
    if (container === null || container === undefined) {
      return { value: function () { return [] }, load: function () {}, refresh: function () {}, setDisabled: function () {} }
    }

    var cache = {}
    var refs = []
    var epoch = 0
    var sequence = 0
    var nextOffset
    var timer = null
    var disabled = false
    var resolved = false

    var host = document.createElement('section')
    host.className = 'rs__materials'
    var title = document.createElement('h3')
    title.className = 'rs__label'
    title.textContent = t('evidence')
    var hint = document.createElement('p')
    hint.className = 'rs__note-line'
    hint.textContent = t('evidenceHint')
    var list = document.createElement('ul')
    list.className = 'rs__material-list'
    var filters = document.createElement('div')
    filters.className = 'rs__material-add'
    var search = document.createElement('input')
    search.type = 'search'
    search.className = 'rs__input'
    search.placeholder = t('evidenceSearch')
    search.setAttribute('aria-label', t('evidenceSearch'))
    var find = document.createElement('button')
    find.type = 'button'
    find.className = 'rs__ghost'
    find.textContent = t('evidenceFind')
    filters.append(search, find)
    var status = document.createElement('p')
    status.className = 'rs__note-line'
    status.setAttribute('role', 'status')
    var candidates = document.createElement('ul')
    candidates.className = 'rs__material-list'
    var more = document.createElement('button')
    more.type = 'button'
    more.className = 'rs__ghost'
    more.textContent = t('evidenceMore')
    more.hidden = true
    host.append(title, hint, list, filters, status, candidates, more)
    container.replaceChildren(host)

    function say(message) {
      status.textContent = message === undefined ? '' : message
    }

    function keyOf(kind, id) {
      return String(kind) + ':' + String(id)
    }

    function recordOf(ref) {
      return cache[keyOf(ref.kind, ref.id)]
    }

    function changed() {
      if (typeof ctx.onChange === 'function') ctx.onChange()
    }

    function messageOf(error) {
      return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
    }

    function tagOf(text, tone) {
      var tag = document.createElement('span')
      tag.className = 'rs__tag'
      tag.dataset.tone = tone
      tag.textContent = text
      return tag
    }

    function selectOf(label, value, options, noneText, onPick) {
      var select = document.createElement('select')
      select.className = 'rs__input'
      select.setAttribute('aria-label', label)
      select.disabled = disabled
      var none = document.createElement('option')
      none.value = ''
      none.textContent = noneText
      select.appendChild(none)
      var found = false
      for (var at = 0; at < options.length; at += 1) {
        var option = document.createElement('option')
        option.value = options[at].id
        option.textContent = options[at].label
        select.appendChild(option)
        if (options[at].id === value) found = true
      }
      select.value = found && typeof value === 'string' ? value : ''
      select.addEventListener('change', function () { onPick(select.value) })
      return select
    }

    function openRecord(kind, id) {
      widget.call(OPEN, { kind: kind, id: id }).catch(function (error) {
        say(t('evidenceReadFailed') + '：' + messageOf(error))
      })
    }

    function rowOf(ref) {
      var record = recordOf(ref)
      var item = document.createElement('li')
      item.className = 'rs__field'
      var head = document.createElement('div')
      head.className = 'rs__material'
      var open = document.createElement('button')
      open.type = 'button'
      open.className = 'rs__material-open'
      open.textContent = record !== undefined && typeof record.title === 'string' && record.title !== ''
        ? record.title
        : (resolved || !live ? t('evidenceMissing') : t('evidenceLoading'))
      open.disabled = record === undefined || !live
      open.addEventListener('click', function () { openRecord(ref.kind, ref.id) })
      head.appendChild(open)
      var tags = document.createElement('span')
      tags.className = 'rs__tags'
      tags.appendChild(tagOf(t(model.kindKey(ref.kind)), 'neutral'))
      if (record !== undefined && typeof record.deletedAt === 'string') tags.appendChild(tagOf(t('evidenceTrash'), 'trash'))
      if (record !== undefined && record.archived === true) tags.appendChild(tagOf(t('evidenceArchived'), 'neutral'))
      if (model.evidenceUpdated(ref, record)) tags.appendChild(tagOf(t('evidenceUpdated'), 'question'))
      head.appendChild(tags)
      var revision = document.createElement('span')
      revision.className = 'rs__note-line'
      revision.textContent = model.fill(t('evidenceRevision'), { n: ref.revision })
      head.appendChild(revision)
      var remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'rs__ghost rs__material-remove'
      remove.textContent = t('evidenceRemove')
      remove.disabled = disabled
      remove.addEventListener('click', function () {
        var wanted = model.evidenceKey(ref)
        refs = refs.filter(function (entry) { return model.evidenceKey(entry) !== wanted })
        renderList()
        changed()
      })
      head.appendChild(remove)
      item.appendChild(head)
      var picks = document.createElement('div')
      picks.className = 'rs__material-add'
      var entries = model.evidenceEntries(record)
      var materials = model.evidenceMaterials(record)
      picks.append(
        selectOf(t('evidenceEntry'), ref.entryId, entries, t('evidenceNone'), function (value) {
          if (value === '') delete ref.entryId
          else ref.entryId = value
          changed()
        }),
        selectOf(t('evidenceMaterial'), ref.materialId, materials, t('evidenceNone'), function (value) {
          if (value === '') delete ref.materialId
          else ref.materialId = value
          changed()
        })
      )
      item.appendChild(picks)
      var summaryRow = document.createElement('div')
      summaryRow.className = 'rs__material-add'
      var summary = document.createElement('input')
      summary.type = 'text'
      summary.className = 'rs__input'
      summary.maxLength = model.EVIDENCE_SUMMARY
      summary.placeholder = t('evidenceSummary')
      summary.setAttribute('aria-label', t('evidenceSummary'))
      summary.value = typeof ref.summary === 'string' ? ref.summary : ''
      summary.disabled = disabled
      summary.addEventListener('input', function () {
        if (summary.value.trim() === '') delete ref.summary
        else ref.summary = summary.value
        changed()
      })
      summaryRow.appendChild(summary)
      item.appendChild(summaryRow)
      return item
    }

    function renderList() {
      var rows = []
      if (refs.length === 0) {
        var empty = document.createElement('li')
        empty.className = 'rs__note-line'
        empty.textContent = t('evidenceEmpty')
        rows.push(empty)
      }
      for (var at = 0; at < refs.length; at += 1) rows.push(rowOf(refs[at]))
      list.replaceChildren.apply(list, rows)
      search.disabled = disabled || !live
      find.disabled = disabled || !live
      more.disabled = disabled || !live
    }

    function resolve() {
      var wanted = epoch
      resolved = false
      renderList()
      if (!live || refs.length === 0) {
        resolved = true
        renderList()
        return
      }
      var ids = []
      for (var at = 0; at < refs.length; at += 1) ids.push(refs[at].id)
      function step(offset, pages) {
        var query = { ids: ids, includeArchived: true, includeTrashed: true }
        if (offset > 0) query.offset = offset
        widget.call(READ, query).then(function (result) {
          if (wanted !== epoch) return
          if (result === null || typeof result !== 'object' || !Array.isArray(result.records)) {
            say(t('evidenceReadFailed'))
            resolved = true
            renderList()
            return
          }
          for (var index = 0; index < result.records.length; index += 1) {
            var record = result.records[index]
            if (record !== null && typeof record === 'object' && typeof record.kind === 'string' && typeof record.id === 'string') {
              cache[keyOf(record.kind, record.id)] = record
            }
          }
          if (result.nextOffset !== undefined && result.nextOffset > offset && pages < 20) {
            step(result.nextOffset, pages + 1)
            return
          }
          resolved = true
          renderList()
        }, function (error) {
          if (wanted !== epoch) return
          say(t('evidenceReadFailed') + '：' + messageOf(error))
          resolved = true
          renderList()
        })
      }
      step(0, 0)
    }

    function lookup(offset) {
      if (!live) return
      var wanted = epoch
      var current = ++sequence
      say(t('evidenceLoading'))
      more.hidden = true
      find.disabled = true
      widget.call(READ, { search: search.value.trim(), includeArchived: true, offset: typeof offset === 'number' ? offset : 0 }).then(function (result) {
        if (wanted !== epoch || current !== sequence) return
        if (result === null || typeof result !== 'object' || !Array.isArray(result.records)) {
          say(t('evidenceReadFailed'))
          return
        }
        var own = app.baseline
        var rows = []
        for (var at = 0; at < result.records.length; at += 1) {
          var record = result.records[at]
          if (record === null || typeof record !== 'object' || typeof record.id !== 'string') continue
          if (own !== null && own.id === record.id && own.kind === record.kind) continue
          cache[keyOf(record.kind, record.id)] = record
          rows.push(candidateRow(record))
        }
        candidates.replaceChildren.apply(candidates, rows)
        nextOffset = result.nextOffset
        more.hidden = nextOffset === undefined
        say(result.records.length > 0 ? t('evidenceAddHint') : t('evidenceNoMatch'))
      }, function (error) {
        if (wanted === epoch && current === sequence) say(t('evidenceReadFailed') + '：' + messageOf(error))
      }).then(function () {
        if (wanted === epoch && current === sequence) find.disabled = disabled || !live
      })
    }

    function candidateRow(record) {
      var row = document.createElement('li')
      row.className = 'rs__material'
      var check = document.createElement('input')
      check.type = 'checkbox'
      check.disabled = disabled
      check.checked = refs.some(function (ref) { return ref.kind === record.kind && ref.id === record.id })
      check.setAttribute('aria-label', String(record.title))
      var label = document.createElement('label')
      label.className = 'rs__material-open'
      label.append(check, document.createTextNode(' ' + t(model.kindKey(record.kind)) + ' · ' + String(record.title)))
      check.addEventListener('change', function () {
        if (check.checked) {
          if (refs.length >= model.EVIDENCE_LIMIT) {
            check.checked = false
            say(t('evidenceLimit'))
            return
          }
          refs.push({ kind: record.kind, id: record.id, revision: Number.isInteger(record.revision) ? record.revision : 0 })
        } else {
          refs = refs.filter(function (ref) { return !(ref.kind === record.kind && ref.id === record.id) })
        }
        renderList()
        changed()
      })
      row.append(label)
      if (live) {
        var view = document.createElement('button')
        view.type = 'button'
        view.className = 'rs__ghost'
        view.textContent = t('evidenceOpen')
        view.addEventListener('click', function () { openRecord(record.kind, record.id) })
        row.appendChild(view)
      }
      return row
    }

    find.addEventListener('click', function () { lookup(0) })
    search.addEventListener('input', function () {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(function () { lookup(0) }, SEARCH_DELAY)
    })
    more.addEventListener('click', function () {
      if (nextOffset !== undefined) lookup(nextOffset)
    })

    renderList()

    return {
      value: function () {
        return refs.map(function (ref) {
          var copy = { kind: ref.kind, id: ref.id, revision: ref.revision }
          if (typeof ref.entryId === 'string') copy.entryId = ref.entryId
          if (typeof ref.materialId === 'string') copy.materialId = ref.materialId
          if (typeof ref.summary === 'string') copy.summary = ref.summary
          return copy
        })
      },
      load: function (value) {
        epoch += 1
        cache = {}
        var normalized = []
        var list = Array.isArray(value) ? value : []
        for (var at = 0; at < list.length && normalized.length < model.EVIDENCE_LIMIT; at += 1) {
          var one = model.cleanEvidence([list[at]])
          if (one === null || one.length !== 1) continue
          normalized.push(one[0])
        }
        refs = normalized
        candidates.replaceChildren()
        nextOffset = undefined
        more.hidden = true
        say('')
        resolve()
      },
      refresh: resolve,
      setDisabled: function (value) {
        disabled = value === true
        renderList()
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)