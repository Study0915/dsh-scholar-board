/*
 * 文献阅读卡的阅读记录面板：实际读到的位置、笔记、理解、疑问、待复现与日期，疑问可转行动项。
 *
 * 由 editor.js 建出来；条目挂在记录 `reading` 上，保存与草稿走编辑面板同一条路。
 * 阶段不随条目改变：读了两节不等于全文已读，用户自己在阶段下拉里改。
 * 转换行动项沿用课题卡的口径：`source` 指向文献、`sourceEntry` 指向条目 id，宿主按这两项幂等。
 */
;(function (root) {
  'use strict'

  var LIMIT = 100

  /**
   * 建阅读记录面板。
   *
   * @param {object} ctx - 节点、文案、保存回调与状态。
   * @returns {object} 面板对外的动作。
   */
  root.createLiteratureReading = function (ctx) {
    var widget = ctx.widget
    var live = ctx.live
    var t = ctx.t
    var pure = ctx.pure
    var nodes = ctx.nodes
    var OPEN = 'widget-board:records.open'
    var WRITE = 'widget-board:records.write'
    var READ = 'widget-board:records.read'
    var items = []
    var readonly = false
    var converting = false
    var sequence = 0

    function newId() {
      sequence += 1
      return 'r-' + Date.now().toString(36) + '-' + String(sequence)
    }

    function find(id) {
      for (var at = 0; at < items.length; at += 1) {
        if (items[at].id === id) return items[at]
      }
      return null
    }

    function fieldNode(part, entry) {
      var node = document.createElement('input')
      node.className = 'lt__input lt__reading-field'
      node.type = part === 'date' ? 'date' : 'text'
      node.dataset.part = part
      node.value = typeof entry[part] === 'string' ? entry[part] : ''
      node.disabled = readonly
      if (part === 'location') {
        node.placeholder = t('readingLocation')
        node.setAttribute('aria-label', t('readingLocation'))
        node.autocomplete = 'off'
      }
      if (part === 'date') node.setAttribute('aria-label', t('readingDate'))
      return node
    }

    function areaNode(part, entry) {
      var node = document.createElement('textarea')
      node.className = 'lt__input lt__reading-area'
      node.dataset.part = part
      node.rows = 2
      node.value = typeof entry[part] === 'string' ? entry[part] : ''
      node.placeholder = t('reading' + part.charAt(0).toUpperCase() + part.slice(1))
      node.setAttribute('aria-label', node.placeholder)
      node.disabled = readonly
      return node
    }

    function actionButton(entry) {
      var button = document.createElement('button')
      button.type = 'button'
      button.className = 'lt__ghost lt__reading-action'
      if (typeof entry.actionId === 'string' && entry.actionId !== '') {
        button.dataset.action = 'open-reading-action'
        button.dataset.actionId = entry.actionId
        button.textContent = t('openReadingAction')
      } else {
        button.dataset.action = 'convert-reading'
        button.dataset.readingId = entry.id
        button.textContent = t('convertReading')
      }
      button.disabled = readonly
      return button
    }

    function rowOf(entry) {
      var row = document.createElement('li')
      row.className = 'lt__reading'
      row.dataset.readingId = entry.id
      var head = document.createElement('div')
      head.className = 'lt__reading-row-head'
      var remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'lt__ghost lt__danger lt__reading-remove'
      remove.dataset.action = 'remove-reading'
      remove.dataset.readingId = entry.id
      remove.textContent = t('removeReading')
      remove.disabled = readonly
      head.append(fieldNode('location', entry), fieldNode('date', entry), remove)
      var fields = document.createElement('div')
      fields.className = 'lt__reading-fields'
      fields.append(areaNode('note', entry), areaNode('understanding', entry), areaNode('questions', entry), areaNode('reproduce', entry))
      var foot = document.createElement('div')
      foot.className = 'lt__reading-foot'
      foot.appendChild(actionButton(entry))
      row.append(head, fields, foot)
      return row
    }

    function render() {
      if (nodes.readings === null) return
      var rows = []
      for (var at = 0; at < items.length; at += 1) rows.push(rowOf(items[at]))
      nodes.readings.replaceChildren.apply(nodes.readings, rows)
      if (nodes.readingEmpty !== null) nodes.readingEmpty.hidden = items.length > 0
    }

    function error(message) {
      if (nodes.readingError !== null) nodes.readingError.textContent = message
    }

    function load(value) {
      items = pure.readingOf({ reading: value })
      render()
      error('')
    }

    function value() {
      return pure.readingValue(items, pure.zoneOf())
    }

    function setReadonly(flag) {
      readonly = flag === true
      render()
    }

    function add() {
      if (readonly) return
      if (items.length >= LIMIT) {
        error(t('readingLimit'))
        return
      }
      var entry = { id: newId(), date: pure.todayText(), location: '', note: '', understanding: '', questions: '', reproduce: '' }
      items.push(entry)
      render()
      error('')
      var rows = nodes.readings.querySelectorAll('.lt__reading')
      var last = rows[rows.length - 1]
      if (last !== undefined) {
        var input = last.querySelector('[data-part="location"]')
        if (input !== null) input.focus()
      }
      ctx.onInput()
    }

    function update(id, part, text) {
      var entry = find(id)
      if (entry === null || readonly) return
      entry[part] = text
      ctx.onInput()
    }

    function remove(id) {
      if (readonly) return
      var before = items.length
      items = items.filter(function (entry) { return entry.id !== id })
      if (items.length === before) return
      render()
      ctx.onInput()
    }

    /** 把行动项 id 写回记录：读最新修订后只补这一条，冲突时重试。 */
    function linkAction(recordId, readingId, actionId, attempt) {
      return widget.call(READ, { ids: [recordId], includeArchived: true, includeTrashed: true }).then(function (result) {
        var current = result !== null && typeof result === 'object' && Array.isArray(result.records) ? result.records[0] : null
        if (current === null || typeof current !== 'object') throw new Error(t('recordMissing'))
        if (typeof current.deletedAt === 'string') throw new Error(t('recordMissing'))
        var reading = Array.isArray(current.reading) ? current.reading.map(function (entry) { return Object.assign({}, entry) }) : []
        var found = null
        for (var at = 0; at < reading.length; at += 1) {
          if (reading[at] !== null && typeof reading[at] === 'object' && reading[at].id === readingId) found = reading[at]
        }
        if (found === null) return null
        if (found.actionId === actionId) return current
        found.actionId = actionId
        return widget.call(WRITE, { op: 'update', id: recordId, expectedRevision: current.revision, patch: { reading: reading.length === 0 ? null : reading } }).then(function (written) {
          return written !== null && typeof written === 'object' && written.record !== null && typeof written.record === 'object' ? written.record : null
        }, function (failure) {
          if (attempt >= 2) throw failure
          return linkAction(recordId, readingId, actionId, attempt + 1)
        })
      })
    }

    function convert(id) {
      if (!live || readonly || converting) return
      var entry = find(id)
      if (entry === null) return
      var question = typeof entry.questions === 'string' ? entry.questions.trim() : ''
      if (question === '') {
        error(t('readingQuestionRequired'))
        return
      }
      var title = [...question].slice(0, 200).join('')
      converting = true
      error('')
      ctx.setStatus(t('converting'), 'neutral')
      ctx.ensureSaved().then(function (record) {
        if (record === null || typeof record !== 'object') {
          converting = false
          return null
        }
        return widget.call(WRITE, {
          op: 'create',
          record: {
            kind: 'action',
            title: title,
            status: 'todo',
            source: { kind: 'literature', id: record.id },
            sourceEntry: id
          }
        }).then(function (result) {
          var action = result !== null && typeof result === 'object' && result.record !== null && typeof result.record === 'object' ? result.record : null
          if (action === null || typeof action.id !== 'string') throw new Error(t('saveFailed'))
          return linkAction(record.id, id, action.id, 0)
        }).then(function (latest) {
          converting = false
          if (latest === null) {
            error(t('recordMissing'))
            return
          }
          ctx.adopt(latest)
          ctx.setStatus(t('actionLinked'), 'ok')
        })
      }).catch(function (failure) {
        converting = false
        error(t('readingActionFailed') + '：' + messageOf(failure))
        ctx.setStatus(t('readingActionFailed') + '：' + messageOf(failure), 'error')
      })
    }

    function openAction(id) {
      if (!live || typeof id !== 'string' || id === '') return
      widget.call(OPEN, { kind: 'action', id: id }).catch(function (failure) {
        error(t('readingActionFailed') + '：' + messageOf(failure))
      })
    }

    function messageOf(error) {
      return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
    }

    if (nodes.readings !== null) {
      nodes.readings.addEventListener('input', function (event) {
        var target = event.target
        if (!(target instanceof Element)) return
        var row = target.closest('.lt__reading')
        if (row === null) return
        var part = target.getAttribute('data-part')
        if (part === null) return
        update(row.getAttribute('data-reading-id'), part, target.value)
      })
      nodes.readings.addEventListener('click', function (event) {
        var target = event.target
        if (!(target instanceof Element)) return
        var button = target.closest('button')
        if (button === null) return
        var action = button.getAttribute('data-action')
        if (action === 'remove-reading') remove(button.getAttribute('data-reading-id'))
        else if (action === 'convert-reading') convert(button.getAttribute('data-reading-id'))
        else if (action === 'open-reading-action') openAction(button.getAttribute('data-action-id'))
      })
    }

    return {
      load: load,
      value: value,
      setReadonly: setReadonly,
      add: add,
      render: render
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
