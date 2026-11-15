/*
 * 文献追踪卡的「加入工作台」：先查重，再让用户选保留、补充、建立版本关系或仍要加入。
 *
 * 由 main.js 在启动时用节点、文案与判定建出来。判定（DOI 与 arXiv 主 id 的比对形式、标题相近、
 * 可补的字段）都在 main.js 前半份，这里只负责读回文献、办写入和画预览对话框。
 *
 * 批量加入只处理没有重复的行：需要确认的行留给用户逐条处理，统计里写成「需要确认」。
 */
;(function (root) {
  'use strict'

  /**
   * 建加入控制器。
   *
   * @param {object} ctx - 卡片节点、组件句柄、文案、判定与按钮状态回调。
   * @returns {object} 对外的加入动作。
   */
  root.createPaperFeedSync = function (ctx) {
    var pure = ctx.pure
    var READ = 'widget-board:records.read'
    var WRITE = 'widget-board:records.write'
    var card = ctx.card
    var dialogRoot = card.querySelector('[data-role="preview"]')
    var preview = {
      root: dialogRoot,
      title: card.querySelector('[data-role="preview-title"]'),
      reason: card.querySelector('[data-role="preview-reason"]'),
      fields: card.querySelector('[data-role="preview-fields"]'),
      hint: card.querySelector('[data-role="preview-hint"]')
    }
    var addAll = card.querySelector('[data-action="add-all"]')
    var busy = false
    var pending = null

    function t(key) {
      return ctx.t(key)
    }

    function fill(text, vars) {
      return String(text).replace(/\{([a-zA-Z_][\w-]*)\}/g, function (match, name) {
        return typeof vars[name] === 'string' ? vars[name] : match
      })
    }

    function messageOf(error) {
      return error !== null && error !== undefined && typeof error.message === 'string' && error.message !== ''
        ? error.message
        : String(error)
    }

    function call(id, args) {
      return ctx.widget.call(id, args)
    }

    function rowByUrl(url) {
      var rows = ctx.rows()
      for (var index = 0; index < rows.length; index += 1) {
        if (rows[index].url === url) return rows[index]
      }
      return null
    }

    /** 读回全部活跃与归档文献；下一批按 nextOffset 继续，最多二十批。 */
    function readAll() {
      var out = []
      function page(offset, depth) {
        var query = { kind: 'literature', includeArchived: true }
        if (offset > 0) query.offset = offset
        return call(READ, query).then(function (view) {
          var records = view !== null && typeof view === 'object' && Array.isArray(view.records) ? view.records : []
          for (var index = 0; index < records.length; index += 1) out.push(records[index])
          var next = view !== null && typeof view === 'object' && typeof view.nextOffset === 'number' ? view.nextOffset : undefined
          if (next === undefined || next <= offset || depth >= 20) return out
          return page(next, depth + 1)
        })
      }
      return page(0, 0)
    }

    function settle(button) {
      pending = null
      if (preview.root !== null && preview.root.open === true && typeof preview.root.close === 'function') preview.root.close()
      button.removeAttribute('aria-busy')
    }

    function release(button) {
      pending = null
      if (preview.root !== null && preview.root.open === true && typeof preview.root.close === 'function') preview.root.close()
      button.disabled = false
      button.removeAttribute('aria-busy')
      ctx.say(button, t('addToBoard'), '')
    }

    function fail(error) {
      ctx.status(t('addFailed') + '：' + messageOf(error), 'failed')
    }

    /** 这一次操作没成：对话框与按钮留在原地，只把忙碌标记收掉。 */
    function afterFailure(button, error) {
      button.removeAttribute('aria-busy')
      fail(error)
    }

    function createRecord(row, versions) {
      var record = pure.recordOf(row)
      if (record === null) return Promise.reject(new Error(t('addFailed')))
      if (Array.isArray(versions) && versions.length > 0) record.versions = versions
      return call(WRITE, { op: 'create', record: record }).then(function (result) {
        return result !== null && typeof result === 'object' && result.record !== null && typeof result.record === 'object' ? result.record : null
      })
    }

    function reasonOf(match) {
      var record = match.record !== null && typeof match.record === 'object' ? match.record : {}
      if (match.reason === 'doi') return fill(t('reasonDoi'), { doi: typeof record.doi === 'string' ? record.doi : '' })
      if (match.reason === 'arxiv') return fill(t('reasonArxiv'), { id: typeof record.arxivId === 'string' ? record.arxivId : '' })
      if (match.reason === 'url') return t('reasonUrl')
      return fill(t('reasonTitle'), { title: typeof record.title === 'string' ? record.title : '' })
    }

    function showFields(row, match) {
      if (preview.fields === null) return
      var rows = pure.comparisonOf(match.record, row)
      var items = []
      for (var index = 0; index < rows.length; index += 1) {
        var entry = rows[index]
        var item = document.createElement('li')
        item.className = 'paper-feed-card__diff-row'
        var name = document.createElement('span')
        name.className = 'paper-feed-card__diff-name'
        name.textContent = t(entry.label)
        var current = document.createElement('span')
        current.className = 'paper-feed-card__diff-current'
        current.textContent = entry.current === '' ? t('missing') : entry.current
        var next = document.createElement('span')
        next.className = 'paper-feed-card__diff-next'
        next.textContent = entry.next === '' ? t('missing') : entry.next
        item.dataset.missing = entry.missing ? 'true' : 'false'
        item.append(name, current, next)
        items.push(item)
      }
      preview.fields.replaceChildren.apply(preview.fields, items)
    }

    function openPreview(row, button, matches) {
      var match = matches[0]
      var exact = match.reason !== 'title'
      pending = { row: row, button: button, match: match, exact: exact }
      if (preview.root === null || typeof preview.root.showModal !== 'function') {
        // 没有对话框时把重复当成已在工作台处理，不悄悄新建一条。
        ctx.say(button, t('alreadyInBoard'), 'done')
        settle(button)
        return
      }
      if (preview.title !== null) preview.title.textContent = t('previewTitle')
      if (preview.reason !== null) preview.reason.textContent = reasonOf(match)
      showFields(row, match)
      if (preview.hint !== null) {
        preview.hint.textContent = exact ? '' : t('candidateHint')
        preview.hint.hidden = exact
      }
      var keep = preview.root.querySelector('[data-action="preview-keep"]')
      var supplement = preview.root.querySelector('[data-action="preview-supplement"]')
      var version = preview.root.querySelector('[data-action="preview-version"]')
      var add = preview.root.querySelector('[data-action="preview-add"]')
      var close = preview.root.querySelector('[data-action="preview-close"]')
      if (keep !== null) keep.textContent = t('keepExisting')
      if (supplement !== null) {
        supplement.textContent = t('supplementMissing')
        supplement.hidden = !exact
      }
      if (version !== null) version.textContent = t('createVersion')
      if (add !== null) add.textContent = t('addAnyway')
      if (close !== null) close.textContent = t('closePreview')
      preview.root.showModal()
    }

    function keepExisting() {
      if (pending === null) return
      var button = pending.button
      settle(button)
      ctx.say(button, t('alreadyInBoard'), 'done')
      ctx.status('')
    }

    function addAnyway() {
      if (pending === null) return
      var current = pending
      createRecord(current.row, null).then(function () {
        settle(current.button)
        ctx.say(current.button, t('addedToBoard'), 'done')
        ctx.status('')
      }, function (error) {
        afterFailure(current.button, error)
      })
    }

    function supplement() {
      if (pending === null) return
      var current = pending
      var record = current.match.record
      var patch = pure.missingPatchOf(record, current.row)
      if (Object.keys(patch).length === 0) {
        ctx.status(t('noMissing'))
        return
      }
      call(WRITE, { op: 'update', id: record.id, expectedRevision: record.revision, patch: patch }).then(function () {
        settle(current.button)
        ctx.say(current.button, t('supplemented'), 'done')
        ctx.status('')
      }, function (error) {
        afterFailure(current.button, error)
      })
    }

    function linkVersions() {
      if (pending === null) return
      var current = pending
      var record = current.match.record
      createRecord(current.row, [{ kind: 'literature', id: record.id }]).then(function (created) {
        if (created === null || typeof created.id !== 'string') throw new Error(t('addFailed'))
        var versions = Array.isArray(record.versions) ? record.versions.slice() : []
        versions.push({ kind: 'literature', id: created.id })
        return call(WRITE, { op: 'update', id: record.id, expectedRevision: record.revision, patch: { versions: versions } }).then(function () {
          settle(current.button)
          ctx.say(current.button, t('versionLinked'), 'done')
          ctx.status('')
        }, function () {
          // 新记录已经加入；反向关联没写上时说明在哪补。
          settle(current.button)
          ctx.say(current.button, t('addedToBoard'), 'done')
          ctx.status(t('versionPartial'))
        })
      }, function (error) {
        afterFailure(current.button, error)
      })
    }

    /**
     * 把一行加入工作台；有重复时打开预览，等用户选择。
     *
     * @param {string} url - 订阅条目的来源地址。
     * @param {HTMLButtonElement} button - 这一行的加入按钮。
     * @returns {Promise<void>} 加入或预览结束后完成。
     */
    function add(url, button) {
      if (ctx.widget === undefined || typeof ctx.widget.call !== 'function' || button.disabled) return Promise.resolve()
      var row = rowByUrl(url)
      if (row === null) return Promise.resolve()
      button.disabled = true
      button.setAttribute('aria-busy', 'true')
      ctx.status('')
      return readAll().then(function (records) {
        var matches = pure.duplicatesOf(records, row)
        if (matches.length > 0) {
          openPreview(row, button, matches)
          return
        }
        return createRecord(row, null).then(function () {
          button.removeAttribute('aria-busy')
          ctx.say(button, t('addedToBoard'), 'done')
        })
      }).catch(function (error) {
        button.disabled = false
        button.removeAttribute('aria-busy')
        ctx.say(button, t('addFailed'), 'failed')
        fail(error)
        ctx.reset(button)
      })
    }

    /** 当前这一面上每一行的加入按钮与对应的行。 */
    function entries() {
      var list = []
      if (ctx.rowsRoot === null) return list
      var buttons = ctx.rowsRoot.querySelectorAll('.paper-feed-card__add')
      var rows = ctx.rows()
      for (var at = 0; at < buttons.length; at += 1) {
        var url = typeof buttons[at].dataset.url === 'string' ? buttons[at].dataset.url : ''
        for (var index = 0; index < rows.length; index += 1) {
          if (rows[index].url === url) {
            list.push({ row: rows[index], button: buttons[at], url: url })
            break
          }
        }
      }
      return list
    }

    /** 逐条加入没有重复的行；需要确认的行留给用户。 */
    function addAllRows() {
      if (busy || ctx.widget === undefined || typeof ctx.widget.call !== 'function') return
      var list = entries()
      if (list.length === 0) return
      busy = true
      if (addAll !== null) addAll.disabled = true
      ctx.status(t('batchBusy'))
      var added = 0
      var skipped = 0
      var failed = 0
      readAll().then(function (records) {
        return list.reduce(function (chain, entry) {
          return chain.then(function () {
            if (entry.button.dataset.state === 'done') {
              skipped += 1
              return
            }
            if (pure.duplicatesOf(records, entry.row).length > 0) {
              skipped += 1
              return
            }
            entry.button.disabled = true
            entry.button.setAttribute('aria-busy', 'true')
            return createRecord(entry.row, null).then(function (saved) {
              if (saved !== null) records.push(saved)
              ctx.say(entry.button, t('addedToBoard'), 'done')
              added += 1
            }, function (error) {
              failed += 1
              ctx.say(entry.button, t('addFailed'), 'failed')
              // 批量里不停下来问：这一条为什么没成写进按钮的提示，统计仍照常往下走。
              entry.button.title = messageOf(error)
            }).then(function () {
              entry.button.removeAttribute('aria-busy')
            })
          })
        }, Promise.resolve()).then(function () {
          ctx.status(fill(t('batchDone'), { added: String(added), skipped: String(skipped), failed: String(failed) }))
        })
      }).catch(function (error) {
        fail(error)
      }).then(function () {
        busy = false
        if (addAll !== null) addAll.disabled = false
      })
    }

    if (preview.root !== null) {
      preview.root.addEventListener('click', function (event) {
        var target = event.target
        if (!(target instanceof Element)) return
        var action = target.closest('[data-action]')
        if (action === null) return
        var name = action.getAttribute('data-action')
        if (name === 'preview-keep') keepExisting()
        else if (name === 'preview-supplement') supplement()
        else if (name === 'preview-version') linkVersions()
        else if (name === 'preview-add') addAnyway()
        else if (name === 'preview-close' && pending !== null) release(pending.button)
      })
      preview.root.addEventListener('close', function () {
        if (pending === null) return
        release(pending.button)
      })
    }
    if (addAll !== null) addAll.addEventListener('click', function () { addAllRows() })

    return { add: add, close: function () { if (pending !== null) release(pending.button) } }
  }
})(globalThis)
